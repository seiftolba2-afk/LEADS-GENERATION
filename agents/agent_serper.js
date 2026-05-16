'use strict';
// Agent Serper — Google Maps city fetch + L1 name search (4 queries + DDG/Brave fallback)

const cheerio = require('cheerio');
const { recordAttempt, recordHit } = require('./shared_state');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

// ─────────────────────────────────────────────────────────────
// SERPER POST — key cycling → router fallbacks (Brave→DDG→SB) → keygen
// ─────────────────────────────────────────────────────────────
async function serperPost(state, endpoint, body, timeoutMs = 10000) {
  const KeyManager = require('../key_manager');
  const router     = require('../search_router');
  const keys       = state.config.SERPER_API_KEYS || [];

  if (state._serperKeyIdx === undefined) state._serperKeyIdx = 0;

  // 1. Try each configured Serper key
  for (let i = state._serperKeyIdx; i < keys.length; i++) {
    try {
      const res = await fetch(`https://google.serper.dev/${endpoint}`, {
        method:  'POST',
        headers: { 'X-API-KEY': keys[i], 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return { ok: true, source: 'serper', json: async () => res.json() };
      if (res.status === 429)                       { KeyManager.markQuota(keys[i]); state._serperKeyIdx = i + 1; continue; }
      if (res.status === 401 || res.status === 403) { KeyManager.markDead(keys[i]);  state._serperKeyIdx = i + 1; continue; }
    } catch { state._serperKeyIdx = i + 1; }
  }

  // 2. Fallback chain: Brave → DDG → ScrapingBee (via router)
  const type     = endpoint === 'maps' ? 'maps' : 'web';
  const fallback = await router.search(body.q, type, { ...state.config, _serperKeyIdx: state._serperKeyIdx }, body.num || 10);
  if (fallback.ok) return { ok: true, source: 'serper', json: async () => fallback.data };

  // 3. Auto-keygen — only if not paused and all keys exhausted
  if (state._serperKeyIdx >= keys.length && (!state._keygenPausedUntil || Date.now() > state._keygenPausedUntil)) {
    console.log('🔄 [Serper] All keys exhausted — launching auto key generator...');
    try {
      const { generateSerperKey } = require('./key_generator');
      const newKey = await generateSerperKey();
      if (newKey) {
        const addResult = await KeyManager.addKey(newKey);
        if (addResult === 'duplicate') {
          state._keygenDups = (state._keygenDups || 0) + 1;
          console.log(`[Keygen] DUPLICATE KEY — signup failed silently, skipping (${state._keygenDups}/3)`);
          if (state._keygenDups >= 3) {
            console.log('[Keygen] 🛑 3 consecutive failures — pausing keygen for 2 hours');
            state._keygenPausedUntil = Date.now() + 2 * 60 * 60 * 1000;
            state._keygenDups = 0;
          }
        } else if (addResult === 'ok') {
          state._keygenDups = 0;
          state.config.SERPER_API_KEYS.push(newKey);
          state._serperKeyIdx = state.config.SERPER_API_KEYS.length - 1;
          return await serperPost(state, endpoint, body, timeoutMs);
        }
      }
    } catch {}
  }

  return { ok: false, status: 429 };
}

// ─────────────────────────────────────────────────────────────
// FREE SEARCH FALLBACKS
// ─────────────────────────────────────────────────────────────
async function fetchSafe(url, options = {}) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (res.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      return await res.text();
    } catch {
      if (attempt === 2) return null;
      await sleep(1000);
    }
  }
  return null;
}

async function duckSearch(query) {
  const url  = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!html) return [];
  const results = [], titleRe = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g, snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g;
  const titles  = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const snippets = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  for (let i = 0; i < Math.min(titles.length, 5); i++) results.push({ title: titles[i] || '', snippet: snippets[i] || '' });
  return results;
}

async function braveSearch(state, query) {
  if (!state.config.BRAVE_API_KEY) return [];
  const url  = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const html = await fetchSafe(url, { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': state.config.BRAVE_API_KEY } });
  if (!html) return [];
  try {
    const data = JSON.parse(html);
    return (data.web?.results || []).map(r => ({ title: r.title || '', snippet: r.description || '' }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
// NAME EXTRACTION (mirrors aggregator_core)
// ─────────────────────────────────────────────────────────────
const STOPS = new Set([
  'The','And','Of','For','With','Inc','Llc','Company','Construction','Brothers','Sons',
  'Contact','Us','Home','About','Services','Our','Team','Menu','Search','Review',
  'Free','Estimate','Quote','Request','Quality','Best','Call','Get','Real','Estate',
  'General','Manager','President','Owner','Principal','Executive','Sales','Division',
  'North','South','East','West','New','Click','Here','Learn','More','Read','View',
  'Open','Back','Next','When','Department','Member','Financial','Associate','Partner',
  'Director','Specialist','Consultant','Coordinator','Representative','Agent','Advisor',
  'Analyst','Engineer','Technician','Inspector','Contractor','Instagram','Facebook',
  'Twitter','YouTube','LinkedIn','TikTok','Yelp','Pinterest','Snapchat','Google',
  'WhatsApp','Telegram','Reddit','Nextdoor','Houzz','Follow','Subscribe','Like','Share',
  'Comment','Post','Story','Reel','Video','Photo','Texas','Florida','Georgia','Carolina',
  'Illinois','Arizona','Tennessee','Colorado','Nevada','Ohio','Virginia','Missouri',
  'California','Alabama','Mississippi','Louisiana','Oklahoma','Arkansas','Kansas',
  'Indiana','Michigan','Wisconsin','Minnesota','Iowa','Nebraska','Central','Greater',
  'Metro','Downtown','Uptown','Roofing','Solar','Hvac','Plumbing','Electrical',
  'Landscaping','Painting',
]);

function splitSafe(full) {
  if (!full) return null;
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(p => STOPS.has(p) || (p === p.toUpperCase() && p.length > 2) || /\d/.test(p))) return null;
  if (parts[0].length < 2 || parts[parts.length - 1].length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(' '), fullName: full.trim() };
}

function extractName(text) {
  if (!text) return null;
  const pats = [
    /(?:[Oo]wner|[Ff]ounder|[Cc][Ee][Oo]|[Pp]resident|[Pp]rincipal|[Oo]perator|[Pp]roprietor|[Cc]o-owner|[Mm]anaging [Pp]artner|[Mm]anaging [Mm]ember)[\s\-:]+(?:[Mm]r\.?\s*|[Mm]rs\.?\s*|[Mm]s\.?\s*)?([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})/g,
    /([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})[,\s\-|]+(?:[Oo]wner|[Ff]ounder|[Cc][Ee][Oo]|[Pp]resident|[Pp]rincipal)/g,
    /(?:[Ff]ounded|[Oo]wned|[Ss]tarted|[Oo]perated|[Ll]ed|[Ee]stablished|[Rr]un)\s+by\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})/g,
    /(?:I['']m|[Mm]y name is)\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})/g,
  ];
  for (const p of pats) {
    let m; p.lastIndex = 0;
    while ((m = p.exec(text)) !== null) {
      const n = splitSafe(m[1].trim()); if (n) return n;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// L1 — SERPER NAME SEARCH (4 queries, stop on first hit)
// ─────────────────────────────────────────────────────────────
async function serperNameSearch(state, companyName, city) {
  const industry = state.config.INDUSTRY_NAME || '';
  const clean    = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const queries  = [
    `"${clean}" "${city}" (owner OR founder OR president OR "managing member") ${industry} -jobs -hiring`,
    `site:bbb.org "${clean}" ${city} principal`,
    `"${clean}" "${city}" ("owned by" OR "founded by" OR "run by" OR "operated by")`,
    `site:linkedin.com "${clean}" ${city} owner`,
  ];

  function parseResult(data) {
    for (const [k, v] of Object.entries((data.knowledgeGraph || {}).attributes || {})) {
      if (/owner|founder|ceo|president/i.test(k) && typeof v === 'string') {
        const n = splitSafe(v); if (n) return n;
      }
    }
    for (const r of (data.organic || [])) {
      if (r.link && r.link.includes('linkedin.com/in/')) {
        const n2 = splitSafe((r.title || '').split(/[-–|]/)[0].trim());
        if (n2) return { ...n2, linkedin_url: r.link };
      }
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
    return null;
  }

  // Wave 1 — 4 Serper queries in parallel, stop on first hit
  const results = await Promise.all(queries.map(async q => {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q, gl: 'us', hl: 'en', num: 5 }));
      if (!res || !res.ok) return null;
      const data = await res.json();
      
      if (res.source === 'scrapingbee') {
        // SB format conversion
        const organic = (data.organic_results || []).map(r => ({ title: r.title, snippet: r.description, link: r.url }));
        return parseResult({ organic });
      }
      return parseResult(data);
    } catch { return null; }
  }));

  const found = results.find(n => n !== null) || null;
  if (found) return found;

  // Wave 3 — DDG or Brave fallback
  const fallback = state.config.BRAVE_API_KEY
    ? await braveSearch(state, `"${clean}" ${city} owner ${industry}`)
    : await duckSearch(`"${clean}" ${city} owner ${industry}`);
  await sleep(300);
  for (const r of fallback) {
    const n = extractName(`${r.title} ${r.snippet}`); if (n) return n;
  }
  return null;
}

// Wave 2 — phone Google search (conditional: only if L1 missed)
async function phoneSearch(state, phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const fmt = `(${digits.substr(0,3)}) ${digits.substr(3,3)}-${digits.substr(6,4)}`;
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `"${fmt}" (owner OR founder OR president OR "managing member") -jobs -"for sale" -"for rent"`, gl: 'us', hl: 'en', num: 5 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

// Email search (called from agent_scraper when email still missing)
async function serperEmailSearch(state, companyName, city, domain) {
  const queries = [
    `"${companyName}" "${city}" contact email -jobs -indeed -glassdoor`,
    domain ? `site:${domain} (email OR contact)` : null,
  ].filter(Boolean);
  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q, gl: 'us', hl: 'en', num: 5 }));
      if (!res || !res.ok) continue;
      const data = await res.json();
      const FAKE_DOMAINS = new Set(['godaddy.com','email.com','example.com','test.com','domain.com']);
      const GENERIC_PFXS = new Set(['info','hello','contact','admin','support','office','sales','service','quotes','estimate']);
      for (const r of (data.organic || [])) {
        const m = (`${r.title||''} ${r.snippet||''}`).match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
        if (m) {
          const [pfx, dom] = m[1].toLowerCase().split('@');
          if (!FAKE_DOMAINS.has(dom) && !GENERIC_PFXS.has(pfx)) return m[1].toLowerCase();
        }
      }
      await sleep(300);
    } catch { }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// SCRAPINGBEE MAPS FALLBACK — direct place search when Serper is dead
// ─────────────────────────────────────────────────────────────
async function fetchCityViaSB(state, city, stateAbbr, stateFull, seenTitles) {
  const sbKey       = state.config.SCRAPINGBEE_API_KEY;
  const baseQueries = state.config.QUERIES || ['contractor'];
  const results     = [];

  for (const q of baseQueries.slice(0, 2)) {
    try {
      const query  = `${q} ${city} ${stateAbbr}`;
      const sbUrl  = `https://app.scrapingbee.com/api/v1/google/?api_key=${sbKey}&q=${encodeURIComponent(query)}&gl=us&hl=en&nb_results=20&search_type=place`;
      const res    = await fetch(sbUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) { await sleep(500); continue; }
      const data   = await res.json();
      const places = data.local_results || data.places || [];
      for (const p of places) {
        const key = (p.title || p.name || '').toLowerCase().trim();
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        results.push({
          source:         'google_maps',
          first_name: '', last_name: '', full_name: '',
          email:          '',
          phone:          p.phone || p.phoneNumber || '',
          job_title:      'Owner',
          company_name:   p.title || p.name || '',
          company_domain: extractDomain(p.website || p.url || ''),
          location_city:  city,
          location_state: stateFull,
          linkedin_url:   '',
          google_rating:  p.rating || '',
          review_count:   parseInt(p.reviews || p.ratingCount || 0) || 0,
          _website:       p.website || p.url || '',
        });
      }
    } catch {}
    await sleep(500);
  }
  if (results.length) console.log(`  [ScrapingBee Maps fallback] ${city}: ${results.length} found`);
  return results;
}

// ─────────────────────────────────────────────────────────────
// GOOGLE MAPS CITY FETCH
// ─────────────────────────────────────────────────────────────
async function fetchCity(state, city, stateAbbr, stateFull) {
  const baseQueries = state.config.QUERIES || ['contractor'];
  const queries     = baseQueries.map(q => `${q} ${city} ${stateAbbr}`);
  const seenTitles  = new Set();
  const all         = [];

  for (const q of queries) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'maps', { q, gl: 'us', hl: 'en', num: 20 }, 15000));
      if (!res || !res.ok) { await sleep(400); continue; }
      const data   = await res.json();
      const places = data.places || [];

      for (const p of places) {
        const key = (p.title || '').toLowerCase().trim();
        if (!key || seenTitles.has(key)) continue;
        seenTitles.add(key);
        all.push({
          source:         'google_maps',
          first_name: '', last_name: '', full_name: '',
          email:          '',
          phone:          p.phoneNumber || '',
          job_title:      'Owner',
          company_name:   p.title || '',
          company_domain: extractDomain(p.website || ''),
          location_city:  city,
          location_state: stateFull,
          linkedin_url:   '',
          google_rating:  p.rating || '',
          review_count:   typeof p.ratingCount === 'number' ? p.ratingCount : 0,
          _website:       p.website || '',
        });
      }
    } catch (e) { console.log(`  ⚠️  ${city}: ${e.message}`); }
    await sleep(400);
  }

  // ScrapingBee Maps fallback — fires when Serper returned 0 results for this city
  if (all.length === 0 && state.config.SCRAPINGBEE_API_KEY) {
    const sbResults = await fetchCityViaSB(state, city, stateAbbr, stateFull, seenTitles);
    all.push(...sbResults);
  }

  console.log(`  ${city}, ${stateAbbr}: ${all.length} unique (${queries.length} queries)`);
  return all;
}

module.exports = { fetchCity, serperNameSearch, phoneSearch, serperEmailSearch, serperPost, splitSafe, extractName };
