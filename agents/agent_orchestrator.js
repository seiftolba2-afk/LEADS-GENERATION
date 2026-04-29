'use strict';
// Agent Orchestrator — drop-in replacement for aggregator_core.run(config)
// Industry wrappers call: require('./agents/agent_orchestrator').run(config)

const fs   = require('fs');
const path = require('path');

const {
  createSharedState,
  loadSeenCompanies,
  saveSeenCompanies,
  saveWaterfallCache,
  buildHitRateTable,
} = require('./shared_state');

const { fetchCity }    = require('./agent_serper');
const { findOwner }    = require('./agent_scraper');
const { scoreLead, saveExcel, initProgressFile, appendToProgress, loadProgress } = require('./agent_output');

// ─────────────────────────────────────────────────────────────
// FILTER — same thresholds as aggregator_core
// ─────────────────────────────────────────────────────────────
const TOLL_FREE = /^(800|888|877|866|855|844|833)/;
function passesFilter(lead) {
  const digits = (lead.phone || '').replace(/\D/g, '');
  return digits.length >= 7 && !TOLL_FREE.test(digits) && lead.review_count >= 0 && lead.review_count <= 250;
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
async function run(industryConfig) {
  const config = {
    SERPER_API_KEYS:     ['ac3ba31464ca33e206915f63702be12c05123834', '6a7afb68c82beebd2dea190244c386e2bc09c296'],
    SCRAPINGBEE_API_KEY: 'CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB',
    BRAVE_API_KEY:       '',
    HOT_COUNT:           100,
    ALL_COUNT:           300,
    CITIES:              require('../cities'),
    ...industryConfig,
  };

  const state = createSharedState(config);
  state.seenCompanies = loadSeenCompanies(config);

  const ID = config.INDUSTRY_ID;
  console.log(`\n🚀 ${config.INDUSTRY_NAME} Lead Aggregator (Agent Team)\n`);
  console.log(`━━━ STEP 1: Collect from Google Maps ━━━\n`);

  // Gather raw leads from Maps
  let raw = [];
  for (const loc of config.CITIES) {
    const leads = await fetchCity(state, loc.city, loc.state, loc.stateFull);
    raw = raw.concat(leads);
  }
  console.log(`\nRaw collected: ${raw.length}`);

  const filtered = raw.filter(passesFilter);
  console.log(`After filter: ${filtered.length}`);

  const unique = dedupe(filtered);
  console.log(`After dedup: ${unique.length}\n`);

  // Leads with a domain go first
  unique.sort((a, b) => (b.company_domain ? 1 : 0) - (a.company_domain ? 1 : 0));

  console.log(`━━━ STEP 2: Find owner names (13-layer waterfall) ━━━\n`);

  const { leads: resumed, done: alreadyDone } = loadProgress(config);
  const namedLeads = [...resumed];
  let dropped = 0;

  if (resumed.length > 0) {
    console.log(`▶ Resuming — ${resumed.length} leads already saved.\n`);
    state.progress.resumed = resumed.length;
  } else {
    initProgressFile(config);
  }

  const tasks = unique.map((lead, i) => state.leadLimit(async () => {
    if (namedLeads.length >= config.HOT_COUNT + config.ALL_COUNT) return;

    const key = (lead.company_name || '').toLowerCase().trim();
    if (alreadyDone.has(key) || state.seenCompanies.has(key)) {
      console.log(`[${i+1}/${unique.length}] ⏩ ${lead.company_name}`);
      return;
    }
    if (!lead.company_domain && !lead.company_name) { dropped++; return; }

    process.stdout.write(`[${i+1}/${unique.length}] ${lead.company_name} (${lead.location_city}) ... `);

    const { name, email, linkedin_url, nameLayer } = await findOwner(state, lead);
    if (!name) { process.stdout.write('⚠️  no name — skipped\n'); dropped++; return; }

    lead.first_name   = name.firstName;
    lead.last_name    = name.lastName;
    lead.full_name    = name.fullName;
    lead.job_title    = 'Owner';
    if (email)        lead.email        = email;
    if (linkedin_url) lead.linkedin_url = linkedin_url;
    lead.name_source  = nameLayer || '';

    const { score, reason } = scoreLead(lead, nameLayer);
    lead.lead_score   = score;
    lead.score_reason = reason;
    lead.lead_id      = `${ID}-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;
    lead.status       = 'new';
    delete lead._website;

    appendToProgress(config, lead);
    namedLeads.push(lead);
    if (namedLeads.length >= config.HOT_COUNT + config.ALL_COUNT) console.log(`\n🎯 ${config.HOT_COUNT + config.ALL_COUNT} leads reached!`);
  }));

  await Promise.all(tasks);

  console.log(`\n━━━ STEP 3: Split & Save ━━━`);
  console.log(`Named leads: ${namedLeads.length} | Dropped: ${dropped}`);

  namedLeads.sort((a, b) => b.lead_score - a.lead_score);

  const hotLeads = namedLeads.filter(l => parseInt(l.review_count) <= 120).slice(0, config.HOT_COUNT);
  const hotIds   = new Set(hotLeads.map(l => l.lead_id));
  const allLeads = namedLeads.filter(l => !hotIds.has(l.lead_id) && parseInt(l.review_count) <= 200).slice(0, config.ALL_COUNT);

  saveExcel(config, allLeads, hotLeads);

  const newKeys = namedLeads.map(l => (l.company_name || '').toLowerCase().trim()).filter(Boolean);
  saveSeenCompanies(config, state.seenCompanies, newKeys);
  saveWaterfallCache(state.waterfallCache);
  console.log(`Cross-run dedup updated: ${state.seenCompanies.size} total seen.\n`);

  const hitRateTable = buildHitRateTable(state.hitRates);
  if (hitRateTable) console.log(hitRateTable);
}

module.exports = { run };
