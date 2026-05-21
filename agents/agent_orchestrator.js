'use strict';
// Agent Orchestrator â€” drop-in replacement for aggregator_core.run(config)
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

const { fetchCity, serperPost, extractName } = require('./agent_serper');
const { enrichInstagram, fetchCityInstagram } = require('./agent_instagram');
const { findOwner }             = require('./agent_scraper');
const { getFbFollowers }        = require('./agent_directory');
const { fetchCityFacebook }     = require('./agent_facebook');
const { scoreLead, saveExcel, saveManualReview, initProgressFile, appendToProgress, loadProgress } = require('./agent_output');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// BATCH NAME â€” prompt in terminal, env var when run from web UI
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function askSheetName(config) {
  const envName = (process.env.BATCH_NAME || '').trim();
  if (envName) return Promise.resolve(envName);
  if (!process.stdin.isTTY) {
    return Promise.resolve(`${config.INDUSTRY_NAME} ${new Date().toLocaleDateString('en-US')}`);
  }
  const defaultName = `${config.INDUSTRY_NAME} ${new Date().toLocaleDateString('en-US')}`;
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\nðŸ“‹ Name this batch (Enter = "${defaultName}"): `, answer => {
      rl.close();
      resolve((answer || '').trim() || defaultName);
    });
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LINKEDIN URL LOOKUP
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getLinkedInUrl(state, companyName, city) {
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', {
      q: `site:linkedin.com/company "${clean}" ${city}`, gl: 'eg', hl: 'en', num: 3,
    }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (r.link?.includes('linkedin.com/company')) return r.link;
    }
  } catch { }
  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PHONE TYPE VERIFICATION â€” Veriphone API (1,000 free/month)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VERIPHONE_KEY = process.env.VERIPHONE_KEY || '';
async function verifyPhone(state, phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const countryCode = state.config.COUNTRY_CODE || '+1';

  // Egyptian Mobile Pre-Filter
  if (countryCode === '+20') {
    const egMobileRegex = /^(?:20|0)?1[0125]\d{8}$/;
    if (egMobileRegex.test(digits)) {
      return 'mobile';
    }
  }

  let e164;
  if (digits.startsWith(countryCode.replace('+', '')) && digits.length >= 11) {
    e164 = '+' + digits;
  } else if (digits.startsWith('0')) {
    e164 = countryCode + digits.slice(1);
  } else {
    e164 = countryCode + digits;
  }
  try {
    const res = await fetch(
      `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(e164)}&key=${VERIPHONE_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.phone_valid) return null;
    const raw = data.phone_type || null;
    // Normalize fixed_line â†’ landline
    if (raw === 'fixed_line' || raw === 'fixed_line_or_mobile') return 'landline';
    return raw; // 'mobile', 'voip', 'landline'
  } catch { return null; }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PHONE LOOKUP â€” for FB/LI leads that have no phone
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function findPhoneForLead(state, companyName, city, stateAbbr) {
  if (!companyName) return null;
  try {
    const res = await state.serperLimit(() => serperPost(state, 'maps', {
      q: `${companyName} ${city} ${stateAbbr}`, gl: 'eg', hl: 'en', num: 3,
    }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.places || [])) {
      if (r.phoneNumber) return r.phoneNumber;
    }
  } catch {}
  return null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SIGNAL 1 â€” TRIGGER DETECTION (domain age via RDAP + review count)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FILTER â€” same thresholds as aggregator_core
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function passesFilter(lead) {
  const digits = (lead.phone || '').replace(/\D/g, '');
  if (digits.length > 0 && digits.length < 8) return false;
  return true;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DEDUP â€” domain + fuzzy name + phone
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const lev = require('fast-levenshtein');
function normalizeCo(name) {
  return (name || '').toLowerCase()
    .replace(/,?\s*(architecture|landscaping|contracting|electrical|decoration|architects|designers|plumbing|services|painting|interior|designer|roofing|architect|furniture|company|studio|design|decor|group|solar|hvac|corp|inc|llc|ltd|co|للديكور|للتصميم|الداخلي)\.?/gi, '')
    .replace(/[^\p{L}\p{N}]/gu, '').trim();
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN RUN
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runInternal(industryConfig) {
  // Load Serper keys from live pool â€” picks up any keys added by keygen automatically.
  // Falls back to bootstrap keys only if pool is empty.
  const KeyManager = require('../key_manager');
  const poolKeys = KeyManager.getAllKeys().filter(k => k.status === 'ok').map(k => k.key);
  const BOOTSTRAP_SERPER_KEYS = [
    'c21c3794e99931d1e98e28e400a63b932eee6924',
    'f71038304481e8349ce67a01cbfc9739f84616a3',
    'f7214593bd0fc35ab1f4fcd49bce360c3070d377',
  ];

  const config = {
    SERPER_API_KEYS:     poolKeys.length ? poolKeys : BOOTSTRAP_SERPER_KEYS,
    SERPER_REQUEST_CAP:  parseInt(process.env.SERPER_REQUEST_CAP) || 2000,
    SCRAPINGBEE_API_KEY: process.env.SCRAPINGBEE_API_KEY || '',
    TWILIO_SID:          process.env.TWILIO_SID          || '',
    TWILIO_TOKEN:        process.env.TWILIO_TOKEN        || '',
    BRAVE_API_KEY:       process.env.BRAVE_API_KEY       || '',
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
  // (skipped when PHONE_QUOTAS is set OR FIXED_COUNTS is set — caller controls counts directly)
  if (!config.PHONE_QUOTAS && !config.FIXED_COUNTS) {
    config.HOT_COUNT = 100;
    config.ALL_COUNT = 1900;
  }

  const QM = (config.PHONE_QUOTAS || {}).mobile   ?? 200;
  const QV = (config.PHONE_QUOTAS || {}).voip     ?? 100;
  const QL = (config.PHONE_QUOTAS || {}).landline  ?? 100;

  const SQ_GM = (config.SOURCE_QUOTAS || {}).google_maps ?? Infinity;
  const SQ_FB = (config.SOURCE_QUOTAS || {}).facebook    ?? Infinity;
  const SQ_IG = (config.SOURCE_QUOTAS || {}).instagram   ?? Infinity;

  // Validate stored keys and recover any that have been reset
  await KeyManager.recheckAll().catch(() => {});
  for (const key of config.SERPER_API_KEYS || []) {
    await KeyManager.addKey(key).catch(() => {});
  }

  const state = createSharedState(config);
  state.seenCompanies = loadSeenCompanies(config);

  const ID = config.INDUSTRY_ID;
  const P1_CHECKPOINT = path.join(__dirname, '..', `p1_checkpoint_${ID}.json`);
  console.log(`\nðŸš€ ${config.INDUSTRY_NAME} Lead Aggregator (Agent Team)\n`);
  console.log(`â”â”â” STEP 1: Collect from Google Maps + Facebook + LinkedIn â”â”â”\n`);

  // â”€â”€ Phase 1 checkpoint: resume from last saved city â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let raw = [];
  let scannedCities = new Set();
  if (fs.existsSync(P1_CHECKPOINT)) {
    try {
      const ckpt = JSON.parse(fs.readFileSync(P1_CHECKPOINT, 'utf8'));
      raw = ckpt.raw || [];
      scannedCities = new Set(ckpt.scanned || []);
      console.log(`â–¶ Resuming Phase 1 â€” ${scannedCities.size} cities already scanned, ${raw.length} raw leads loaded.\n`);
    } catch { raw = []; scannedCities = new Set(); }
  }

  // Gather raw leads from all 3 sources in parallel per city
  // We scan in small batches (e.g., 5 cities) then process, to keep movement steady
  let citiesScannedThisRun = 0;
  for (const loc of config.CITIES) {
    const cityKey = `${loc.city},${loc.state}`;
    if (scannedCities.has(cityKey)) continue;  // skip already-scanned cities
    
    const SQ_GM = (config.SOURCE_QUOTAS || {}).google_maps ?? Infinity;
    const SQ_FB = (config.SOURCE_QUOTAS || {}).facebook    ?? Infinity;
    const SQ_IG = (config.SOURCE_QUOTAS || {}).instagram   ?? Infinity;

    const [gm, fb, ig] = await Promise.all([
      SQ_GM > 0 ? fetchCity(state, loc.city, loc.state, loc.stateFull) : Promise.resolve([]),
      SQ_FB > 0 ? fetchCityFacebook(state, loc.city, loc.state, loc.stateFull, config.INDUSTRY_NAME) : Promise.resolve([]),
      SQ_IG > 0 ? fetchCityInstagram(state, loc.city, loc.state, loc.stateFull, config.INDUSTRY_NAME) : Promise.resolve([]),
    ]);
    gm.forEach(l => { if (!l.source) l.source = 'google_maps'; });
    raw = raw.concat(gm, fb, ig);
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
    console.log(`\nAll ${config.CITIES.length} cities scanned. Resetting scan list for fresh cycle...`);
    try { fs.unlinkSync(P1_CHECKPOINT); } catch {}
  }

  const src = { google_maps: 0, facebook: 0, instagram: 0 };
  raw.forEach(l => { src[l.source || 'google_maps']++; });
  console.log(`\nSources — Maps: ${src.google_maps} | FB: ${src.facebook} | IG: ${src.instagram}`);
  console.log(`Raw collected: ${raw.length}`);

  // Phone enrichment for leads with no phone (cap configurable — Instagram-only runs need higher)
  const PHONE_ENRICH_CAP = config.PHONE_ENRICH_CAP ?? (raw.filter(l => !l.phone).length || 30);
  let phoneEnrichCount = 0;
  for (const lead of raw) {
    if (phoneEnrichCount >= PHONE_ENRICH_CAP) break;
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

  console.log(`â”â”â” STEP 2: Find owner names (13-layer waterfall) â”â”â”\n`);

  const { leads: resumed, done: alreadyDone } = loadProgress(config);
  const namedLeads = [...resumed];
  const noNameLeads = [];
  let dropped = 0;

  if (resumed.length > 0) {
    console.log(`â–¶ Resuming â€” ${resumed.length} leads already saved.\n`);
    state.progress.resumed = resumed.length;
  } else {
    initProgressFile(config);
  }

  // 5x Parallel Processing for owner extraction (using built-in state limit)
  const tasks = unique.map((lead, i) => state.leadLimit(async () => {
    if (namedLeads.length >= config.HOT_COUNT + config.ALL_COUNT) return;

    const key = (lead.company_name || '').toLowerCase().trim();
    if (alreadyDone.has(key) || state.seenCompanies.has(key)) {
      console.log(`[${i+1}/${unique.length}] â© ${lead.company_name}`);
      return;
    }
    if (!lead.company_domain && !lead.company_name) { dropped++; return; }

    const mCountCheck = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const vCountCheck = namedLeads.filter(l => l.phone_type === 'voip').length;
    const lCountCheck = namedLeads.filter(l => l.phone_type === 'landline').length;
    if ((QM === 0 || mCountCheck >= QM) && (QV === 0 || vCountCheck >= QV) && (QL === 0 || lCountCheck >= QL)) return;

    const gmCheck = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const fbCheck = namedLeads.filter(l => l.source === 'facebook').length;
    const igCheck = namedLeads.filter(l => l.source === 'instagram').length;
    const leadSrcCheck = lead.source || 'google_maps';
    if (leadSrcCheck === 'google_maps' && gmCheck >= SQ_GM) { return; }
    if (leadSrcCheck === 'facebook'    && fbCheck >= SQ_FB) { return; }
    if (leadSrcCheck === 'instagram'   && igCheck >= SQ_IG) { return; }

    process.stdout.write(`[${i+1}/${unique.length}] ${lead.company_name} (${lead.location_city}) ... `);

    let { name: extractedName, email: extractedEmail, linkedin_url: extractedLinkedin, nameLayer } = await findOwner(state, lead);

    // Instagram enrichment
    const igProfile = await enrichInstagram(state, lead.company_name);
    if (igProfile) {
      lead.instagram_handle = igProfile.handle;
      lead.instagram_followers = igProfile.followers;
      lead.instagram_bio = igProfile.bio;
      lead.instagram_posts = igProfile.posts;
      console.log(`    📸 [Instagram]      @${igProfile.handle} (${igProfile.followers} followers)`);

      // If name not found by waterfall, try to extract from Instagram Bio or Profile Name
      if (!extractedName) {
        let n = null;
        if (igProfile.fullName) n = extractName(`Owner: ${igProfile.fullName}`);
        if (!n && igProfile.bio) n = extractName(igProfile.bio);
        if (n) {
          extractedName = n;
          nameLayer = 'L2f:InstagramBio';
          console.log(`    📸 [Instagram Bio]  ${n.fullName}`);
        }
      }
    }

    // Instagram follower filter — only applies when follower count is known (>0)
    // Serper snippets often omit follower counts; don't drop leads with unknown counts
    if (lead.instagram_handle) {
      const followers = lead.instagram_followers || 0;
      const minIG = config.INSTAGRAM_MIN_FOLLOWERS ?? 0;
      const maxIG = config.INSTAGRAM_MAX_FOLLOWERS ?? Infinity;
      if (followers > 0 && (followers < minIG || followers > maxIG)) {
        process.stdout.write(`⚠️  IG followers (${followers}) outside range [${minIG}, ${maxIG}] — skipped\n`);
        dropped++;
        return;
      }
    }

    if (!extractedName) {
      if (config.REQUIRE_FIELDS && config.REQUIRE_FIELDS.includes('name')) {
        process.stdout.write('⚠️  no name — skipped\n');
        dropped++;
        if (lead.phone) noNameLeads.push({ ...lead, status: 'no_name' });
        return;
      }
      extractedName = { firstName: '', lastName: '', fullName: '' };
    }

    if (extractedEmail) lead.email = extractedEmail;
    if (extractedLinkedin) lead.linkedin_url = extractedLinkedin;

    // Phone type verification — null means Veriphone API unavailable; allow lead through as 'unknown'
    const phoneType = await verifyPhone(state, lead.phone) || 'unknown';

    const curM = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const curV = namedLeads.filter(l => l.phone_type === 'voip').length;
    const curL = namedLeads.filter(l => l.phone_type === 'landline').length;

    if (phoneType === 'mobile' && curM >= QM) { process.stdout.write('âš ï¸  mobile quota full\n'); dropped++; return; }
    if (phoneType === 'mobile' && curM >= QM) { process.stdout.write('⚠️  mobile quota full\n'); dropped++; return; }
    if (phoneType === 'voip' && curV >= QV) { process.stdout.write('⚠️  voip quota full\n'); dropped++; return; }
    if (phoneType === 'landline' && curL >= QL) { process.stdout.write('⚠️  landline quota full\n'); dropped++; return; }

    const curGM = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const curFB = namedLeads.filter(l => l.source === 'facebook').length;
    const curIG = namedLeads.filter(l => l.source === 'instagram').length;
    const leadSrc = lead.source || 'google_maps';
    if (leadSrc === 'google_maps' && curGM >= SQ_GM) { process.stdout.write('⚠️  GM quota full\n'); dropped++; return; }
    if (leadSrc === 'facebook'    && curFB >= SQ_FB) { process.stdout.write('⚠️  FB quota full\n'); dropped++; return; }
    if (leadSrc === 'instagram'   && curIG >= SQ_IG) { process.stdout.write('⚠️  IG quota full\n'); dropped++; return; }

    lead.phone_type = phoneType;
    if (phoneType) await sleep(200);

    lead.first_name   = extractedName.firstName;
    lead.last_name    = extractedName.lastName;
    lead.full_name    = extractedName.fullName;
    lead.job_title    = 'Owner';
    if (extractedEmail)        lead.email        = extractedEmail;
    if (extractedLinkedin) lead.linkedin_url = extractedLinkedin;
    lead.name_source  = nameLayer || '';

    // FB followers enrichment
    const fbFollowers = await getFbFollowers(state, lead.company_name, lead.location_city);
    if (fbFollowers !== null) lead.facebook_followers = fbFollowers;
    await sleep(300);

    // Hard field filter — skip leads missing required fields (configured per industry)
    const REQUIRE = config.REQUIRE_FIELDS || [];
    if (REQUIRE.includes('phone')     && !lead.phone)                         { process.stdout.write('⚠️  no phone — skipped\n');    dropped++; return; }
    if (REQUIRE.includes('email')     && !lead.email)                         { process.stdout.write('⚠️  no email — skipped\n');    dropped++; return; }
    if (REQUIRE.includes('facebook')  && lead.facebook_followers == null)     { process.stdout.write('⚠️  no facebook — skipped\n'); dropped++; return; }
    if (REQUIRE.includes('instagram') && !lead.instagram_handle)             { process.stdout.write('⚠️  no instagram — skipped\n'); dropped++; return; }

    // LinkedIn URL enrichment (if not already found)
    if (!lead.linkedin_url) {
      const liUrl = await getLinkedInUrl(state, lead.company_name, lead.location_city);
      if (liUrl) lead.linkedin_url = liUrl;
      await sleep(300);
    }

    lead.scraped_date = new Date().toLocaleDateString('en-US');

    // Signal 1 â€” trigger detection
    const domainAgeDays = await getDomainAge(lead.company_domain);
    const triggerSignal = classifyTrigger(domainAgeDays, parseInt(lead.review_count) || 0);
    lead.domain_age_days = domainAgeDays;
    lead.trigger_signal  = triggerSignal;
    if (triggerSignal) await sleep(200);

    // Signal 2 â€” review velocity (reviews/year)
    const rv = (domainAgeDays && domainAgeDays > 30)
      ? parseFloat(((parseInt(lead.review_count) || 0) / (domainAgeDays / 365)).toFixed(1))
      : null;
    lead.review_velocity = rv;

    // Signal 3 â€” completeness (6 outreach-critical fields)
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
    process.stdout.write(`âœ… [${phoneType.toUpperCase()}] Saved.\n`);

    const finalM = namedLeads.filter(l => l.phone_type === 'mobile').length;
    const finalV = namedLeads.filter(l => l.phone_type === 'voip').length;
    const finalL = namedLeads.filter(l => l.phone_type === 'landline').length;
    if (finalM >= QM && finalV >= QV && finalL >= QL) console.log(`\nðŸŽ¯ EXACT QUOTA REACHED! (${QM} M / ${QV} V / ${QL} L)`);
    const finalGM = namedLeads.filter(l => l.source === 'google_maps' || !l.source).length;
    const finalFB = namedLeads.filter(l => l.source === 'facebook').length;
    const finalIG = namedLeads.filter(l => l.source === 'instagram').length;
    if (finalGM >= SQ_GM && finalFB >= SQ_FB && finalIG >= SQ_IG) console.log(`\n🎯 SOURCE QUOTA REACHED! (GM: ${finalGM} / FB: ${finalFB} / IG: ${finalIG})`);
  }));

  await Promise.all(tasks);

  console.log(`\nâ”â”â” STEP 3: Split & Save â”â”â”`);
  console.log(`Named leads: ${namedLeads.length} | Dropped: ${dropped}`);

  namedLeads.sort((a, b) => b.lead_score - a.lead_score);

  // max review_count = 100 (corrected from 120/200 â€” see tasks/lessons.md)
  const hotLeads = namedLeads.filter(l => parseInt(l.review_count) <= 100).slice(0, config.HOT_COUNT);
  const hotIds   = new Set(hotLeads.map(l => l.lead_id));
  const allLeads = namedLeads.filter(l => !hotIds.has(l.lead_id) && parseInt(l.review_count) <= 100).slice(0, config.ALL_COUNT);

  const sheetName = await askSheetName(config);
  saveExcel(config, allLeads, hotLeads, sheetName);
  
  // Also save manual review for those with no name but have phone
  if (noNameLeads.length) saveManualReview(config, noNameLeads);
}

async function run(industryConfig) {
  const { loadLeadsProgress } = require('../db');
  const target = (industryConfig.HOT_COUNT || 100) + (industryConfig.ALL_COUNT ?? 300);
  while (true) {
    const { leads } = loadLeadsProgress(industryConfig.INDUSTRY_ID);

    if (leads.length >= target) {
      console.log(`\nTarget reached: ${leads.length} leads collected. Done.`);
      break;
    }

    console.log(`\n[Loop] ${leads.length}/${target} leads. Starting next batch...`);
    await runInternal(industryConfig);
    await new Promise(r => setTimeout(r, 2000));
  }
}

module.exports = { run, verifyPhone, findOwner };

