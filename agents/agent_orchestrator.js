'use strict';
// Agent Orchestrator — drop-in replacement for aggregator_core.run(config)
// Industry wrappers call: require('./agents/agent_orchestrator').run(config)

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  createSharedState,
  loadSeenCompanies,
  saveSeenCompanies,
  saveWaterfallCache,
  buildHitRateTable,
} = require('./shared_state');

const { fetchCity, serperPost } = require('./agent_serper');
const { findOwner }             = require('./agent_scraper');
const { getFbFollowers }        = require('./agent_directory');
const { fetchCityFacebook }     = require('./agent_facebook');
const { fetchCityLinkedIn }     = require('./agent_linkedin');
const { scoreLead, saveExcel, saveManualReview, initProgressFile, appendToProgress, loadProgress } = require('./agent_output');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────
// BATCH NAME — prompt in terminal, env var when run from web UI
// ─────────────────────────────────────────────────────────────
function askSheetName(config) {
  const envName = (process.env.BATCH_NAME || '').trim();
  if (envName) return Promise.resolve(envName);
  if (!process.stdin.isTTY) {
    return Promise.resolve(`${config.INDUSTRY_NAME} ${new Date().toLocaleDateString('en-US')}`);
  }
  const defaultName = `${config.INDUSTRY_NAME} ${new Date().toLocaleDateString('en-US')}`;
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n📋 Name this batch (Enter = "${defaultName}"): `, answer => {
      rl.close();
      resolve((answer || '').trim() || defaultName);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// LINKEDIN URL LOOKUP
// ─────────────────────────────────────────────────────────────
async function getLinkedInUrl(state, companyName, city) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', {
      q: `site:linkedin.com/company "${clean}" ${city}`, gl: 'us', hl: 'en', num: 3,
    }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (r.link?.includes('linkedin.com/company')) return r.link;
    }
  } catch { }
  return null;
}

// ─────────────────────────────────────────────────────────────
// PHONE TYPE VERIFICATION — Veriphone API (1,000 free/month)
// ─────────────────────────────────────────────────────────────
const VERIPHONE_KEY = '3E269BE15CF84916977BF13D4534FE36';
async function verifyPhone(state, phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const e164 = `+1${digits.slice(-10)}`;
  try {
    const res = await fetch(
      `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(e164)}&key=${VERIPHONE_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.phone_valid) return null;
    const raw = data.phone_type || null;
    // Normalize fixed_line → landline
    if (raw === 'fixed_line' || raw === 'fixed_line_or_mobile') return 'landline';
    return raw; // 'mobile', 'voip', 'landline'
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────
// PHONE LOOKUP — for FB/LI leads that have no phone
// ─────────────────────────────────────────────────────────────
async function findPhoneForLead(state, companyName, city, stateAbbr) {
  if (!companyName) return null;
  try {
    const res = await state.serperLimit(() => serperPost(state, 'maps', {
      q: `${companyName} ${city} ${stateAbbr}`, gl: 'us', hl: 'en', num: 3,
    }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.places || [])) {
      if (r.phoneNumber) return r.phoneNumber;
    }
  } catch {}
  return null;
}

// ─────────────────────────────────────────────────────────────
// SIGNAL 1 — TRIGGER DETECTION (domain age via RDAP + review count)
// ─────────────────────────────────────────────────────────────
async function getDomainAge(domain) {
  if (!domain) return null;
  const apex = domain.replace(/^www\./, '').split('/')[0];
  try {
    const res = await fetch(`https://rdap.org/domain/${apex}`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/rdap+json, application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const reg = (data.events || []).find(e => e.eventAction === 'registration');
    if (!reg) return null;
    const ms = Date.now() - new Date(reg.eventDate).getTime();
    return Math.floor(ms / 86400000); // days old
  } catch { return null; }
}

function classifyTrigger(domainAgeDays, reviewCount) {
  const newDomain  = domainAgeDays !== null && domainAgeDays < 730;
  const fewReviews = reviewCount >= 1 && reviewCount <= 10;
  if (newDomain && fewReviews) return 'hot_trigger';
  if (newDomain)               return 'new_biz';
  if (fewReviews)              return 'recently_active';
  return '';
}

// ─────────────────────────────────────────────────────────────
// FILTER — same thresholds as aggregator_core
// ─────────────────────────────────────────────────────────────
const TOLL_FREE = /^(800|888|877|866|855|844|833)/;
function passesFilter(lead) {
  const digits = (lead.phone || '').replace(/\D/g, '');
  // Drop only if phone exists AND is toll-free/invalid — no phone is fine (enriched later)
  if (digits.length >= 10 && TOLL_FREE.test(digits)) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────
// DEDUP — domain + fuzzy name + phone
// ─────────────────────────────────────────────────────────────
const lev = require('fast-levenshtein');
function normalizeCo(name) {
  return (name || '').toLowerCase()
    .replace(/,?\s*(inc|llc|co|corp|ltd|company|services|group|roofing|solar|hvac|plumbing|electrical|landscaping|painting|contracting)\.?/gi, '')
    .replace(/[^a-z]/g, '').trim();
}
function dedupe(leads) {
  const seenD = new Set(), seenP = new Set(), seenC = [], result = [];
  for (const l of leads) {
    const d = (l.company_domain || '').toLowerCase().trim();
    const c = normalizeCo(l.company_name);
    const p = (l.phone || '').replace(/\D/g, '');
    if (d && seenD.has(d)) continue;
    if (p && p.length >= 10 && seenP.has(p)) continue;
    let dup = false;
    for (const ec of seenC) { if (c.length > 4 && ec.length > 4 && lev.get(c, ec) <= 2) { dup = true; break; } }
    if (dup) continue;
    if (d) seenD.add(d);
    if (p && p.length >= 10) seenP.add(p);
    if (c) seenC.push(c);
    result.push(l);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// MAIN RUN
// ─────────────────────────────────────────────────────────────
async function runInternal(industryConfig) {
  const config = {
    SERPER_API_KEYS:     ['c21c3794e99931d1e98e28e400a63b932eee6924', 'f71038304481e8349ce67a01cbfc9739f84616a3', 'f7214593bd0fc35ab1f4fcd49bce360c3070d377'],
    SCRAPINGBEE_API_KEY: 'CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB',
    TWILIO_SID:          'ACafd5287a596607aa225236a755ededb6',
    TWILIO_TOKEN:        'd3410a481413b97a371c7b0ffab111ae',
    BRAVE_API_KEY:       '',
    HOT_COUNT:           70,
    ALL_COUNT:           30,
    CITIES:              require('../cities'),
    ...industryConfig,
  };

  if (process.env.LEAD_TOTAL) {
    const total = parseInt(process.env.LEAD_TOTAL);
    if (total > 0) {
      config.HOT_COUNT = 100;
      config.ALL_COUNT = 2000; // Increased to allow for multiple 400-lead batches
    }
  }

  // Override to ensure exactly 100/300 split as per elite requirement
  // (skipped when PHONE_QUOTAS is set — caller controls counts directly)
  if (!config.PHONE_QUOTAS) {
    config.HOT_COUNT = 100;
    config.ALL_COUNT = 1900;
  }

  const QM = (config.PHONE_QUOTAS || {}).mobile   ?? 200;
  const QV = (config.PHONE_QUOTAS || {}).voip     ?? 100;
  const QL = (config.PHONE_QUOTAS || {}).landline  ?? 100;

  const SQ_GM = (config.SOURCE_QUOTAS || {}).google_maps ?? Infinity;
  const SQ_FB = (config.SOURCE_QUOTAS || {}).facebook    ?? Infinity;
  const SQ_LI = (config.SOURCE_QUOTAS || {}).linkedin    ?? Infinity;

  // Validate stored keys and recover any that have been reset
  const KeyManager = require('../key_manager');
  await KeyManager.recheckAll().catch(() => {});
  for (const key of config.SERPER_API_KEYS || []) {
    await KeyManager.addKey(key).catch(() => {});
  }

  const state = createSharedState(config);
  state.seenCompanies = loadSeenCompanies(config);

  const ID = config.INDUSTRY_ID;
  const P1_CHECKPOINT = path.join('D:\\LEADS GENERATION', `p1_checkpoint_${ID}.json`);
  console.log(`\n🚀 ${config.INDUSTRY_NAME} Lead Aggregator (Agent Team)\n`);
  console.log(`━━━ STEP 1: Collect from Google Maps + Facebook + LinkedIn ━━━\n`);

  // ── Phase 1 checkpoint: resume from last saved city ──────────
  let raw = [];
  let scannedCities = new Set();
  if (fs.existsSync(P1_CHECKPOINT)) {
    try {
      const ckpt = JSON.parse(fs.readFileSync(P1_CHECKPOINT, 'utf8'));
      raw = ckpt.raw || [];
      scannedCities = new Set(ckpt.scanned || []);
      console.log(`▶ Resuming Phase 1 — ${scannedCities.size} cities already scanned, ${raw.length} raw leads loaded.\n`);
    } catch { raw = []; scannedCities = new Set(); }
  }

  // Gather raw leads from all 3 sources in parallel per city
  // We scan in small batches (e.g., 5 cities) then process, to keep movement steady
  let citiesScannedThisRun = 0;
  for (const loc of config.CITIES) {
    const cityKey = `${loc.city},${loc.state}`;
    if (scannedCities.has(cityKey)) continue;  // skip already-scanned cities
    
    const [gm, fb, li] = await Promise.all([
      fetchCity(state, loc.city, loc.state, loc.stateFull),
      fetchCityFacebook(state, loc.city, loc.state, loc.stateFull, config.INDUSTRY_NAME),
      fetchCityLinkedIn(state, loc.city, loc.state, loc.stateFull, config.INDUSTRY_NAME),
    ]);
    gm.forEach(l => { if (!l.source) l.source = 'google_maps'; });
    raw = raw.concat(gm, fb, li);
    scannedCities.add(cityKey);
    citiesScannedThisRun++;

    // Save checkpoint after every city
    fs.writeFileSync(P1_CHECKPOINT, JSON.stringify({ scanned: [...scannedCities], raw: [] })); // raw is transient, scanned is permanent
    
    // Stop scanning after 10 NEW cities to go process them (wider net for faster loop)
    if (citiesScannedThisRun >= 10) break; 
    await sleep(500);
  }

  // Reset if we hit the end of the US city list
  if (scannedCities.size >= config.CITIES.length) {
    console.log(`\n🇺🇸 All ${config.CITIES.length} cities scanned! Resetting scan list for fresh cycle...`);
    try { fs.unlinkSync(P1_CHECKPOINT); } catch {}
  }

  const src = { google_maps: 0, facebook: 0, linkedin: 0 };
  raw.forEach(l => { src[l.source || 'google_maps']++; });
  console.log(`\nSources — Maps: ${src.google_maps} | FB: ${src.facebook} | LI: ${src.linkedin}`);
  console.log(`Raw collected: ${raw.length}`);

  // Phone enrichment for FB/LI leads that have no phone (capped at 30 Serper /maps calls)
  let phoneEnrichCount = 0;
  for (const lead of raw) {
    if (phoneEnrichCount >= 30) break;
    if (lead.phone || lead.source === 'google_maps') continue;
    const phone = await findPhoneForLead(state, lead.company_name, lead.location_city, lead.location_state);
    if (phone) { lead.phone = phone; phoneEnrichCount++; }
    await sleep(300);
  }
  if (phoneEnrichCount) console.log(`Phone-enriched ${phoneEnrichCount} FB/LI leads.\n`);

  const filtered = raw.filter(passesFilter);
  console.log(`After filter: ${filtered.length}`);

  const unique = dedupe(filtered);
  console.log(`After dedup: ${unique.length}\n`);

  // Leads with a domain go first
  unique.sort((a, b) => (b.company_domain ? 1 : 0) - (a.company_domain ? 1 : 0));

  console.log(`━━━ STEP 2: Find owner names (13-layer waterfall) ━━━\n`);

  const { leads: resumed, done: alreadyDone } = loadProgress(config);
  const namedLeads = [...resumed];
  const noNameLeads = [];
  let dropped = 0;

  if (resumed.length > 0) {
    console.log(`▶ Resuming — ${resumed.length} leads already saved.\n`);
    state.progress.resumed = resumed.length;
  } else {
    initProgressFile(config);
  }

  // 5x Parallel Processing for owner extraction (using built-in state limit)
  const tasks = unique.map((lead, i) => state.leadLimit(async () => {
    if (namedLeads.length >= config.HOT_COUNT + config.ALL_COUNT) return;

    const key = (lead.company_name || '').toLowerCase().trim();
    if (alreadyDone.has(key) || state.seenCompanies.has(key)) {
      console.log(`[${i+1}/${unique.length}] ⏩ ${lead.company_name}`);
      return;
    }
    if (!lead.company_domain && !lead.company_name) { dropped++; return; }

    const mCountCheck = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const vCountCheck = namedLeads.filter(l => l.phone_type === 'voip').length;
    const lCountCheck = namedLeads.filter(l => l.phone_type === 'landline').length;
    if ((QM === 0 || mCountCheck >= QM) && (QV === 0 || vCountCheck >= QV) && (QL === 0 || lCountCheck >= QL)) return;

    const gmCheck = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const fbCheck = namedLeads.filter(l => l.source === 'facebook').length;
    const liCheck = namedLeads.filter(l => l.source === 'linkedin').length;
    const leadSrcCheck = lead.source || 'google_maps';
    if (leadSrcCheck === 'google_maps' && gmCheck >= SQ_GM) { return; }
    if (leadSrcCheck === 'facebook'    && fbCheck >= SQ_FB) { return; }
    if (leadSrcCheck === 'linkedin'    && liCheck >= SQ_LI) { return; }

    process.stdout.write(`[${i+1}/${unique.length}] ${lead.company_name} (${lead.location_city}) ... `);

    const { name, email, linkedin_url, nameLayer } = await findOwner(state, lead);
    if (!name) {
      process.stdout.write('⚠️  no name — skipped\n');
      dropped++;
      if (lead.phone) noNameLeads.push({ ...lead, status: 'no_name' });
      return;
    }

    // Phone type verification — null means Veriphone API unavailable; allow lead through as 'unknown'
    const phoneType = await verifyPhone(state, lead.phone) || 'unknown';

    const curM = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const curV = namedLeads.filter(l => l.phone_type === 'voip').length;
    const curL = namedLeads.filter(l => l.phone_type === 'landline').length;

    if (phoneType === 'mobile' && curM >= QM) { process.stdout.write('⚠️  mobile quota full\n'); dropped++; return; }
    if (phoneType === 'voip' && curV >= QV) { process.stdout.write('⚠️  voip quota full\n'); dropped++; return; }
    if (phoneType === 'landline' && curL >= QL) { process.stdout.write('⚠️  landline quota full\n'); dropped++; return; }

    const curGM = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const curFB = namedLeads.filter(l => l.source === 'facebook').length;
    const curLI = namedLeads.filter(l => l.source === 'linkedin').length;
    const leadSrc = lead.source || 'google_maps';
    if (leadSrc === 'google_maps' && curGM >= SQ_GM) { process.stdout.write('⚠️  GM quota full\n'); dropped++; return; }
    if (leadSrc === 'facebook'    && curFB >= SQ_FB) { process.stdout.write('⚠️  FB quota full\n'); dropped++; return; }
    if (leadSrc === 'linkedin'    && curLI >= SQ_LI) { process.stdout.write('⚠️  LI quota full\n'); dropped++; return; }

    lead.phone_type = phoneType;
    if (phoneType) await sleep(200);

    lead.first_name   = name.firstName;
    lead.last_name    = name.lastName;
    lead.full_name    = name.fullName;
    lead.job_title    = 'Owner';
    if (email)        lead.email        = email;
    if (linkedin_url) lead.linkedin_url = linkedin_url;
    lead.name_source  = nameLayer || '';

    // FB followers enrichment
    const fbFollowers = await getFbFollowers(state, lead.company_name, lead.location_city);
    if (fbFollowers !== null) lead.facebook_followers = fbFollowers;
    await sleep(300);

    // LinkedIn URL enrichment (if not already found)
    if (!lead.linkedin_url) {
      const liUrl = await getLinkedInUrl(state, lead.company_name, lead.location_city);
      if (liUrl) lead.linkedin_url = liUrl;
      await sleep(300);
    }

    lead.scraped_date = new Date().toLocaleDateString('en-US');

    // Signal 1 — trigger detection
    const domainAgeDays = await getDomainAge(lead.company_domain);
    const triggerSignal = classifyTrigger(domainAgeDays, parseInt(lead.review_count) || 0);
    lead.domain_age_days = domainAgeDays;
    lead.trigger_signal  = triggerSignal;
    if (triggerSignal) await sleep(200);

    // Signal 2 — review velocity (reviews/year)
    const rv = (domainAgeDays && domainAgeDays > 30)
      ? parseFloat(((parseInt(lead.review_count) || 0) / (domainAgeDays / 365)).toFixed(1))
      : null;
    lead.review_velocity = rv;

    // Signal 3 — completeness (6 outreach-critical fields)
    const completeFields = [lead.full_name, lead.phone, lead.email, lead.company_domain, lead.location_city, lead.facebook_followers].filter(Boolean).length;
    lead.completeness_pct = Math.round((completeFields / 6) * 100);

    const { score, reason } = scoreLead(lead, nameLayer);
    lead.lead_score   = score;
    lead.score_reason = reason;
    lead.lead_id      = `${ID}-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;
    lead.status       = 'new';
    delete lead._website;

    appendToProgress(config, lead);
    namedLeads.push(lead);
    process.stdout.write(`✅ [${phoneType.toUpperCase()}] Saved.\n`);

    const finalM = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const finalV = namedLeads.filter(l => l.phone_type === 'voip').length;
    const finalL = namedLeads.filter(l => l.phone_type === 'landline').length;
    if (finalM >= QM && finalV >= QV && finalL >= QL) console.log(`\n🎯 EXACT QUOTA REACHED! (${QM} M / ${QV} V / ${QL} L)`);
    const finalGM = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const finalFB = namedLeads.filter(l => l.source === 'facebook').length;
    const finalLI = namedLeads.filter(l => l.source === 'linkedin').length;
    if (finalGM >= SQ_GM && finalFB >= SQ_FB && finalLI >= SQ_LI) console.log(`\n🎯 SOURCE QUOTA REACHED! (GM: ${finalGM} / FB: ${finalFB} / LI: ${finalLI})`);
  }));

  await Promise.all(tasks);

  console.log(`\n━━━ STEP 3: Split & Save ━━━`);
  console.log(`Named leads: ${namedLeads.length} | Dropped: ${dropped}`);

  namedLeads.sort((a, b) => b.lead_score - a.lead_score);

  const hotLeads = namedLeads.filter(l => parseInt(l.review_count) <= 120).slice(0, config.HOT_COUNT);
  const hotIds   = new Set(hotLeads.map(l => l.lead_id));
  const allLeads = namedLeads.filter(l => !hotIds.has(l.lead_id) && parseInt(l.review_count) <= 200).slice(0, config.ALL_COUNT);

  const sheetName = await askSheetName(config);
  saveExcel(config, allLeads, hotLeads, sheetName);
  
  // Also save manual review for those with no name but have phone
  if (noNameLeads.length) saveManualReview(config, noNameLeads);
}

async function run(industryConfig) {
  const { loadLeadsProgress } = require('../db');
  const QM = (industryConfig.PHONE_QUOTAS || {}).mobile   ?? 200;
  const QV = (industryConfig.PHONE_QUOTAS || {}).voip     ?? 100;
  const QL = (industryConfig.PHONE_QUOTAS || {}).landline  ?? 100;
  while (true) {
    const { leads } = loadLeadsProgress(industryConfig.INDUSTRY_ID);

    const m = leads.filter(l => l.phone_type === 'mobile').length;
    const v = leads.filter(l => l.phone_type === 'voip').length;
    const l = leads.filter(l => l.phone_type === 'landline').length;

    if (m >= QM && v >= QV && l >= QL) {
      console.log(`\n✅ TARGET QUOTAS REACHED: Mobile: ${m}/${QM} | VOIP: ${v}/${QV} | Landline: ${l}/${QL}.`);
      break;
    }

    console.log(`\n🔄 [Loop] Mobile: ${m}/${QM} | VOIP: ${v}/${QV} | Landline: ${l}/${QL}. Starting next batch...`);
    await runInternal(industryConfig);
    // Safety sleep between loops
    await new Promise(r => setTimeout(r, 2000));
  }
}

module.exports = { run, verifyPhone, findOwner };
