'use strict';
// ============================================================
// AGGREGATOR CORE v4 — shared engine for all industries
// All improvements: new layers, fuzzy dedup, email verify,
// expanded license DBs, toll-free filter, Excel upgrades.
// Industry scripts call: require('./aggregator_core').run(config)
// ============================================================
const xlsx = require('xlsx');
const fs   = require('fs');
const dns  = require('dns').promises;
const lev  = require('fast-levenshtein');

// ─────────────────────────────────────────────────────────────
// MODULE-LEVEL STATE (reset per run() call)
// ─────────────────────────────────────────────────────────────
let CONFIG        = {};
let serperKeyIdx  = 0;
const scrapeCache = new Map();

// ─────────────────────────────────────────────────────────────
// CONCURRENCY LIMITER
// ─────────────────────────────────────────────────────────────
function createLimit(n) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= n || !queue.length) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve).catch(reject).finally(() => { running--; next(); });
  };
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractDomain(url) {
  if (!url) return '';
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

// ─────────────────────────────────────────────────────────────
// SERPER (dual-key failover)
// ─────────────────────────────────────────────────────────────
async function serperPost(endpoint, body, timeoutMs = 10000) {
  const keys = CONFIG.SERPER_API_KEYS;
  for (let i = serperKeyIdx; i < keys.length; i++) {
    try {
      const res = await fetch(`https://google.serper.dev/${endpoint}`, {
        method:  'POST',
        headers: { 'X-API-KEY': keys[i], 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res;
      if ((res.status === 401 || res.status === 403 || res.status === 429) && i < keys.length - 1) {
        console.warn(`[Serper] Key ${i} → ${res.status}, switching to backup`);
        serperKeyIdx = i + 1;
        continue;
      }
      return res;
    } catch (e) {
      if (i === keys.length - 1) throw e;
      serperKeyIdx = i + 1;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SAFE HTTP (3 retries, 429 backoff)
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

// ─────────────────────────────────────────────────────────────
// FREE EMAIL DOMAIN VERIFY (DNS MX lookup — no API needed)
// ─────────────────────────────────────────────────────────────
async function verifyEmailDomain(email) {
  if (!email) return false;
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return records && records.length > 0;
  } catch { return false; }
}

// ─────────────────────────────────────────────────────────────
// DUCKDUCKGO FREE SEARCH
// ─────────────────────────────────────────────────────────────
async function duckSearch(query) {
  const url  = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!html) return [];
  const results   = [];
  const titleRe   = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g;
  const titles    = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const snippets  = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  for (let i = 0; i < Math.min(titles.length, 5); i++) results.push({ title: titles[i] || '', snippet: snippets[i] || '' });
  return results;
}

// ─────────────────────────────────────────────────────────────
// BRAVE SEARCH (paid fallback, optional — set BRAVE_API_KEY in config)
// Falls back to DuckDuckGo if key is absent.
// ─────────────────────────────────────────────────────────────
async function braveSearch(query) {
  if (!CONFIG.BRAVE_API_KEY) return [];
  const url  = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  const html = await fetchSafe(url, {
    headers: {
      'Accept':               'application/json',
      'Accept-Encoding':      'gzip',
      'X-Subscription-Token': CONFIG.BRAVE_API_KEY,
    },
  });
  if (!html) return [];
  try {
    const data = JSON.parse(html);
    return (data.web?.results || []).map(r => ({ title: r.title || '', snippet: r.description || '' }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────
// NAME EXTRACTION UTILITIES
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
    /(?:[Oo]wner|[Ff]ounder|[Cc][Ee][Oo]|[Pp]resident|[Pp]rincipal|[Oo]perator|[Pp]roprietor|[Cc]o-owner|[Mm]anaging [Pp]artner)[\s\-:]+(?:[Mm]r\.?\s*|[Mm]rs\.?\s*|[Mm]s\.?\s*)?([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})/g,
    /([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})[,\s\-|]+(?:[Oo]wner|[Ff]ounder|[Cc][Ee][Oo]|[Pp]resident|[Pp]rincipal)/g,
    /(?:[Ff]ounded|[Oo]wned|[Ss]tarted|[Oo]perated|[Ll]ed|[Ee]stablished)\s+by\s+([A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){1,2})/g,
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

const FAKE_DOMAINS  = new Set(['godaddy.com','email.com','example.com','test.com','placeholder.com','domain.com','yourcompany.com','website.com','sample.com','tempmail.com','mailinator.com']);
const GENERIC_PFXS  = new Set(['info','hello','contact','admin','support','office','sales','service','quotes','estimate','billing','inquiry','help','mail','team','staff','noreply','no-reply','roofing','roof','solar','hvac','construction','quote','request','jobs','careers','hr','plumbing','electrical','landscaping','painting']);

function extractEmail(text) {
  const cands = [];
  const mailtoRe = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const plainRe  = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  let m;
  while ((m = mailtoRe.exec(text)) !== null) cands.push(m[1].toLowerCase());
  while ((m = plainRe.exec(text))   !== null) cands.push(m[1].toLowerCase());
  for (const email of cands) {
    const [pfx, dom] = email.split('@');
    if (!FAKE_DOMAINS.has(dom) && !GENERIC_PFXS.has(pfx)) return email;
  }
  return null;
}

function okName(s) {
  if (!s || s.length < 2 || s.length > 20 || /\d/.test(s)) return false;
  return !['roofing','solar','hvac','construction','service','company','group','team','home','sales','info','admin','contact','plumbing','electrical','landscaping','painting'].includes(s.toLowerCase());
}

function emailPrefix(email) {
  if (!email || !email.includes('@')) return null;
  const pre = email.split('@')[0].toLowerCase();
  if (GENERIC_PFXS.has(pre)) return null;
  const parts = pre.split(/[._-]/);
  if (parts.length >= 2) {
    const f = cap(parts[0]), l = cap(parts.slice(1).join(' '));
    if (okName(f) && okName(l)) return { firstName: f, lastName: l, fullName: `${f} ${l}` };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// WATERFALL LAYERS
// ─────────────────────────────────────────────────────────────

// Layer 1 — Serper Google Search (parallel queries, DDG fallback)
async function serperSearch(companyName, city) {
  const industry = CONFIG.INDUSTRY_NAME || '';
  const clean    = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  const queries  = [
    `"${clean}" "${city}" (owner OR founder OR president) ${industry} -jobs -careers`,
    `site:bbb.org "${clean}" ${city} principal`,
    `"${clean}" ${city} ${industry} (owner OR founder) -job`,
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

  const results = await Promise.all(queries.map(async q => {
    try {
      const res = await serperPost('search', { q, gl: 'us', hl: 'en', num: 5 });
      if (!res || !res.ok) return null;
      return parseResult(await res.json());
    } catch { return null; }
  }));

  const found = results.find(n => n !== null) || null;
  if (found) return found;

  // Fallback — Brave Search if key set, else DuckDuckGo (both free-tier friendly)
  const fallbackResults = CONFIG.BRAVE_API_KEY
    ? await braveSearch(`"${clean}" ${city} owner ${industry}`)
    : await duckSearch(`"${clean}" ${city} owner ${industry}`);
  await sleep(300);
  for (const r of fallbackResults) {
    const n = extractName(`${r.title} ${r.snippet}`); if (n) return n;
  }
  return null;
}

// Layer 2a — Direct website scrape (name + email)
async function scrapeSite(domain) {
  if (scrapeCache.has(domain)) return scrapeCache.get(domain);
  let foundName = null, foundEmail = null;
  const paths = ['/contact', '/contact-us', '/', '/about', '/about-us', '/our-team', '/team'];
  for (const path of paths) {
    if (foundName && foundEmail) break;
    const html = await fetchSafe(`https://${domain}${path}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,*/*;q=0.8' },
    });
    if (!html || html.length < 100) continue;
    if (!foundEmail) foundEmail = extractEmail(html);
    const text = html.replace(/<(script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!foundEmail) foundEmail = extractEmail(text);
    if (!foundName)  foundName  = extractName(text);
  }
  const result = { name: foundName, email: foundEmail };
  scrapeCache.set(domain, result);
  return result;
}

// Layer 2b — Manta.com business directory
async function mantaSearch(companyName, city) {
  try {
    const res = await serperPost('search', { q: `site:manta.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('manta.com')) continue;
      // First try snippet (fast, no extra credit)
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`);
      if (n) return n;
      // Scrape the profile page
      const html = await fetchSafe(r.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!html) continue;
      const ownerMatch = html.match(/(?:Owner|Principal|Contact|President)[:\s]*(?:<[^>]*>)*([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
      if (ownerMatch) { const n2 = splitSafe(ownerMatch[1]); if (n2) return n2; }
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const n3 = extractName(text); if (n3) return n3;
    }
  } catch { }
  return null;
}

// Layer 2c — Porch.com contractor directory
async function porchSearch(companyName, city) {
  try {
    const res = await serperPost('search', { q: `site:porch.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('porch.com')) continue;
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
      const html = await fetchSafe(r.link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!html) continue;
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      const n2 = extractName(text); if (n2) return n2;
    }
  } catch { }
  return null;
}

// Layer 3 — Phone number Google search
async function phoneSearch(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const fmt = `(${digits.substr(0,3)}) ${digits.substr(3,3)}-${digits.substr(6,4)}`;
  try {
    const res = await serperPost('search', { q: `"${fmt}" (owner OR founder OR president) -jobs`, gl: 'us', hl: 'en', num: 5 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

// Layer 4 — State contractor license DB (30 states)
async function stateLicenseSearch(companyName, state) {
  const clean   = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd|Inc\.)\.?/gi, '').trim();
  const encoded = encodeURIComponent(clean);

  // States with scrapable direct URLs
  const directUrls = {
    'Texas':          `https://www.tdlr.texas.gov/LicenseSearch/licfile.asp?searchstring=${encoded}&searchtype=name&stype=all&tdsic=`,
    'Florida':        `https://www.myfloridalicense.com/wl11.asp?sid=&SID=&brd=0&typ=All&SunBiz=N&id=0&RS=1&RAD=0&nm=${encoded}&ck=&bc=&SIC=`,
    'Georgia':        `https://ecorp.sos.ga.gov/BusinessSearch/BusinessInformation?searchName=${encoded}&searchType=Contains&listType=0`,
    'North Carolina': `https://nclbgc.org/verify-a-licensee?searchBy=name&name=${encoded}`,
    'Illinois':       `https://online-dfpr.micropact.com/lookup/licenselookup.aspx?SearchBy=BusinessName&SearchText=${encoded}`,
    'Arizona':        `https://roc.az.gov/search-licensees?name=${encoded}&type=C`,
    'Colorado':       `https://apps2.colorado.gov/dora/licensing/Lookup/LicenseLookup.aspx?lastname=${encoded}`,
    'Tennessee':      `https://verify.tn.gov/verification/Search.aspx?facility=Y&fname=&lname=${encoded}&license=&lictype=CON&county=0&zip=&vtype=LastName&bt=Search`,
    'Nevada':         `https://nscb.nv.gov/Contractors/Search?name=${encoded}`,
    'Oregon':         `https://www.oregon.gov/ccb/Pages/contractor-search.aspx?name=${encoded}`,
  };

  // States where we use Serper site: search (JS-rendered or POST-only sites)
  const serperStates = {
    'California':     'site:cslb.ca.gov',
    'Virginia':       'site:dpor.virginia.gov',
    'Ohio':           'site:elicense.ohio.gov',
    'Michigan':       'site:michigan.gov/lara',
    'Pennsylvania':   'site:pals.pa.gov',
    'Washington':     'site:lni.wa.gov',
    'Minnesota':      'site:dli.mn.gov',
    'Missouri':       'site:sos.mo.gov',
    'Indiana':        'site:in.gov/pla',
    'Maryland':       'site:dllr.state.md.us',
    'Louisiana':      'site:lslbc.louisiana.gov',
    'Oklahoma':       'site:ok.gov',
    'South Carolina': 'site:llr.sc.gov',
    'Utah':           'site:dopl.utah.gov',
    'Alabama':        'site:asl.alabama.gov',
    'Kentucky':       'site:klrc.ky.gov',
    'Arkansas':       'site:contractors.arkansas.gov',
    'Idaho':          'site:dbs.idaho.gov',
    'New Mexico':     'site:rld.state.nm.us',
  };

  const directUrl = directUrls[state];
  if (directUrl) {
    try {
      const html = await fetchSafe(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (!html) return null;
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (state === 'Florida') {
        const m = text.match(/[Qq]ualifier[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
        if (m) return splitSafe(m[1].trim());
      }
      const m2 = text.match(/(?:Principal|Registrant|Qualifier|License Holder|Licensee|Owner|Applicant)[:\s]+([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
      if (m2) return splitSafe(m2[1].trim());
      return extractName(text);
    } catch { return null; }
  }

  const siteQuery = serperStates[state];
  if (siteQuery) {
    try {
      const res = await serperPost('search', { q: `${siteQuery} "${clean}" contractor license`, gl: 'us', hl: 'en', num: 3 });
      if (!res || !res.ok) return null;
      const data = await res.json();
      for (const r of (data.organic || [])) {
        const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
      }
    } catch { }
  }
  return null;
}

// Layer 5 — BBB direct scrape
async function bbbSearch(companyName, city) {
  const q   = encodeURIComponent(`${companyName} ${city}`);
  const url = `https://www.bbb.org/search?find_text=${q}&find_loc=${encodeURIComponent(city)}`;
  try {
    const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!html) return null;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m    = text.match(/(?:Principal|Owner|Contact)[:\s]+([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
    if (m) return splitSafe(m[1].trim());
    return extractName(text);
  } catch { return null; }
}

// Layer 6 — OpenCorporates (free API, covers all 50 states)
async function openCorporatesSearch(companyName, state) {
  const stateMap = {
    'Texas':'tx','Florida':'fl','Georgia':'ga','North Carolina':'nc','Illinois':'il',
    'Arizona':'az','Colorado':'co','Tennessee':'tn','California':'ca','Virginia':'va',
    'Ohio':'oh','Michigan':'mi','Pennsylvania':'pa','Nevada':'nv','Washington':'wa',
    'Minnesota':'mn','Missouri':'mo','Indiana':'in','Maryland':'md','Oregon':'or',
    'Louisiana':'la','Oklahoma':'ok','Kentucky':'ky','Alabama':'al','South Carolina':'sc',
    'Utah':'ut','New Mexico':'nm','Idaho':'id','Arkansas':'ar','Mississippi':'ms',
    'Iowa':'ia','Kansas':'ks','Nebraska':'ne','Wisconsin':'wi',
  };
  const code = stateMap[state];
  if (!code) return null;
  const clean = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim();
  try {
    const url  = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(clean)}&jurisdiction_code=us_${code}&fields=officers&per_page=5`;
    const html = await fetchSafe(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    if (!html) return null;
    const data = JSON.parse(html);
    for (const { company } of (data?.results?.companies || [])) {
      for (const off of (company.officers || [])) {
        if (off.officer && /director|president|secretary|manager|owner|partner/i.test(off.officer.position || '')) {
          const n = splitSafe(off.officer.name); if (n) return n;
        }
      }
    }
  } catch { }
  return null;
}

// Layer 7 — Angi profile via Serper
async function angiSearch(companyName, city) {
  try {
    const res = await serperPost('search', { q: `site:angi.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

// Layer 8 — Houzz profile via Serper
async function houzzSearch(companyName, city) {
  try {
    const res = await serperPost('search', { q: `site:houzz.com "${companyName}" ${city} owner`, gl: 'us', hl: 'en', num: 3 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

// Layer 9 — Thumbtack (often shows owner first name in snippet)
async function thumbtackSearch(companyName, city) {
  try {
    const res = await serperPost('search', { q: `site:thumbtack.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 });
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

// Layer 10 — Yelp business page
async function yelpSearch(companyName, city) {
  const q   = encodeURIComponent(`${companyName} ${city}`);
  const url = `https://www.yelp.com/search?find_desc=${q}&find_loc=${encodeURIComponent(city)}`;
  try {
    const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!html) return null;
    return extractName(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  } catch { return null; }
}

// Layer 11 — Secretary of State registry
async function sosSearch(companyName, state) {
  const clean = encodeURIComponent(companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim());
  const urls  = {
    'Florida':        `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&searchNameOrder=&masterDataTopmostValue=&searchTerm=${clean}`,
    'Georgia':        `https://ecorp.sos.ga.gov/BusinessSearch/BusinessInformation?searchName=${clean}&searchType=Contains&listType=0`,
    'North Carolina': `https://www.sosnc.gov/online_services/search/by_name/#/?searchStr=${clean}`,
    'Ohio':           `https://businesssearch.ohiosos.gov/?=businessDetails/${clean}`,
    'Colorado':       `https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do?nameTyp=ENT&entityName=${clean}`,
    'Arizona':        `https://ecorp.azcc.gov/CommonHelper/GetAnonymousToken?entityName=${clean}`,
  };
  const url = urls[state];
  if (!url) return null;
  try {
    const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!html) return null;
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m    = text.match(/(?:Registered Agent|Agent Name|Officer|Principal)[:\s]+([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
    if (m) return splitSafe(m[1].trim());
  } catch { }
  return null;
}

// Layer 12 — TripAdvisor via DuckDuckGo (free)
async function tripAdvisorSearch(companyName, city) {
  try {
    const results = await duckSearch(`tripadvisor.com "${companyName}" ${city} owner`);
    for (const r of results) { const n = extractName(`${r.title} ${r.snippet}`); if (n) return n; }
  } catch { }
  return null;
}

// Layer 13 — Facebook via DuckDuckGo (free)
async function facebookSearch(companyName, city) {
  try {
    const results = await duckSearch(`site:facebook.com "${companyName}" ${city} owner OR founder`);
    for (const r of results) { const n = extractName(`${r.title} ${r.snippet}`); if (n) return n; }
  } catch { }
  return null;
}

// Email search (runs in parallel with name waterfall for non-blocked leads)
async function serperEmailSearch(companyName, city, domain) {
  const queries = [
    `"${companyName}" ${city} email`,
    domain ? `site:${domain} email contact` : null,
  ].filter(Boolean);
  for (const q of queries) {
    try {
      const res = await serperPost('search', { q, gl: 'us', hl: 'en', num: 5 });
      if (!res || !res.ok) continue;
      const data = await res.json();
      for (const r of (data.organic || [])) {
        const email = extractEmail(`${r.title || ''} ${r.snippet || ''}`);
        if (email) return email;
      }
      await sleep(300);
    } catch { }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// MASTER WATERFALL
// ─────────────────────────────────────────────────────────────
async function findOwner(lead) {
  let name = null, email = null, linkedinUrl = null, nameLayer = null;

  // L1 — Serper (+ optional parallel Brave) + DDG fallback
  if (lead.company_name) {
    name = await serperSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L1:Google'; if (name.linkedin_url) linkedinUrl = name.linkedin_url; console.log(`    ✅ [Google]        ${name.fullName}`); }
    await sleep(400);
  }

  // L2a — Website scrape
  if (lead.company_domain) {
    const { name: wn, email: we } = await scrapeSite(lead.company_domain);
    if (!name && wn) { name = wn; nameLayer = 'L2a:Website'; console.log(`    ✅ [Website]       ${wn.fullName}`); }
    if (we) email = we;
    if (!name && we) { const n = emailPrefix(we); if (n) { name = n; nameLayer = 'L2b:EmailPrefix'; console.log(`    ✅ [Email prefix]  ${n.fullName}`); } }
  }

  if (name && email) return { name, email, linkedin_url: linkedinUrl, nameLayer };

  // L2c — Manta
  if (!name && lead.company_name) {
    name = await mantaSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L2c:Manta'; console.log(`    ✅ [Manta]         ${name.fullName}`); }
    await sleep(300);
  }

  // L2d — Porch
  if (!name && lead.company_name) {
    name = await porchSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L2d:Porch'; console.log(`    ✅ [Porch]         ${name.fullName}`); }
    await sleep(300);
  }

  // L3 — Phone search
  if (!name && lead.phone) {
    name = await phoneSearch(lead.phone);
    if (name) { nameLayer = 'L3:Phone'; console.log(`    ✅ [Phone]         ${name.fullName}`); }
    await sleep(300);
  }

  // L4 — State license DB (30 states)
  if (!name && lead.company_name) {
    name = await stateLicenseSearch(lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L4:LicenseDB'; console.log(`    ✅ [License DB]    ${name.fullName}`); }
    await sleep(300);
  }

  // L5 — BBB
  if (!name && lead.company_name) {
    name = await bbbSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L5:BBB'; console.log(`    ✅ [BBB]           ${name.fullName}`); }
    await sleep(300);
  }

  // L6 — OpenCorporates (free API)
  if (!name && lead.company_name) {
    name = await openCorporatesSearch(lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L6:OpenCorp'; console.log(`    ✅ [OpenCorp]      ${name.fullName}`); }
    await sleep(300);
  }

  // L7 — Angi
  if (!name && lead.company_name) {
    name = await angiSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L7:Angi'; console.log(`    ✅ [Angi]          ${name.fullName}`); }
    await sleep(300);
  }

  // L8 — Houzz
  if (!name && lead.company_name) {
    name = await houzzSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L8:Houzz'; console.log(`    ✅ [Houzz]         ${name.fullName}`); }
    await sleep(300);
  }

  // L9 — Thumbtack
  if (!name && lead.company_name) {
    name = await thumbtackSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L9:Thumbtack'; console.log(`    ✅ [Thumbtack]     ${name.fullName}`); }
    await sleep(300);
  }

  // L10 — Yelp
  if (!name && lead.company_name) {
    name = await yelpSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L10:Yelp'; console.log(`    ✅ [Yelp]          ${name.fullName}`); }
    await sleep(300);
  }

  // L11 — Secretary of State
  if (!name && lead.company_name) {
    name = await sosSearch(lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L11:SOS'; console.log(`    ✅ [SOS]           ${name.fullName}`); }
    await sleep(300);
  }

  // L12 — TripAdvisor
  if (!name && lead.company_name) {
    name = await tripAdvisorSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L12:TripAdvisor'; console.log(`    ✅ [TripAdvisor]   ${name.fullName}`); }
    await sleep(300);
  }

  // L13 — Facebook
  if (!name && lead.company_name) {
    name = await facebookSearch(lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L13:Facebook'; console.log(`    ✅ [Facebook]      ${name.fullName}`); }
    await sleep(300);
  }

  // Email search (if still missing)
  if (!email && lead.company_name) {
    email = await serperEmailSearch(lead.company_name, lead.location_city, lead.company_domain);
    if (email) console.log(`    📧 [Email search]  ${email}`);
  }

  return { name, email, linkedin_url: linkedinUrl, nameLayer };
}

// ─────────────────────────────────────────────────────────────
// SCORING
// High-confidence layers (license DB, OpenCorporates, Website) get +2
// Low-confidence (Facebook only) gets -1
// Verified email gets +3 instead of +5 flat bonus
// ─────────────────────────────────────────────────────────────
function scoreLead(lead, nameLayer, emailVerified) {
  let score = 10;
  const reasons = ['Owner name', 'Has phone'];

  if (lead.email) {
    if (emailVerified) { score += 4; reasons.push('Verified email'); }
    else               { score += 2; reasons.push('Email found'); }
  }
  if (parseFloat(lead.google_rating) >= 4.5) { score += 1; reasons.push('Top rated'); }
  if (lead.review_count >= 20 && lead.review_count <= 100) { score += 1; reasons.push('Active reviews'); }
  if (lead.company_domain) { score += 1; reasons.push('Has website'); }
  if (lead.review_count >= 50 && lead.review_count <= 100) { score += 1; reasons.push('Sweet spot'); }

  if (nameLayer) {
    const hiConf = ['L4:LicenseDB','L6:OpenCorp','L2a:Website','L2b:EmailPrefix'];
    const loConf = ['L13:Facebook'];
    if (hiConf.includes(nameLayer))  { score += 2; reasons.push('High-conf name'); }
    else if (loConf.includes(nameLayer)) { score -= 1; }
  }
  return { score, reason: reasons.join(', ') };
}

// ─────────────────────────────────────────────────────────────
// FILTER — phone required, no toll-free, review 0–250
// ─────────────────────────────────────────────────────────────
const TOLL_FREE = /^(800|888|877|866|855|844|833)/;
function passesFilter(lead) {
  const digits    = (lead.phone || '').replace(/\D/g, '');
  const hasPhone  = digits.length >= 7;
  const isTF      = TOLL_FREE.test(digits);
  const rc        = lead.review_count;
  return hasPhone && !isTF && rc >= 0 && rc <= 250;
}

// ─────────────────────────────────────────────────────────────
// DEDUP — domain + fuzzy name (Levenshtein ≤ 2) + phone
// ─────────────────────────────────────────────────────────────

function normalizeCo(name) {
  return (name || '').toLowerCase().replace(/,?\s*(inc|llc|co|corp|ltd|company|services|group|roofing|solar|hvac|plumbing|electrical|landscaping|painting|contracting)\.?/gi, '').replace(/[^a-z]/g, '').trim();
}

function dedupe(leads) {
  const seenD = new Set(), seenP = new Set();
  const seenC = [];
  const result = [];
  for (const l of leads) {
    const d = (l.company_domain || '').toLowerCase().trim();
    const c = normalizeCo(l.company_name);
    const p = (l.phone || '').replace(/\D/g, '');
    if (d && seenD.has(d)) continue;
    if (p && p.length >= 10 && seenP.has(p)) continue;
    let fuzzyDup = false;
    for (const ec of seenC) {
      if (c.length > 4 && ec.length > 4 && lev.get(c, ec) <= 2) { fuzzyDup = true; break; }
    }
    if (fuzzyDup) continue;
    if (d) seenD.add(d);
    if (p && p.length >= 10) seenP.add(p);
    if (c) seenC.push(c);
    result.push(l);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// CROSS-RUN DEDUP
// ─────────────────────────────────────────────────────────────
function loadSeen() {
  try { return new Set(JSON.parse(fs.readFileSync(CONFIG.SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function saveSeen(seenSet, newKeys) {
  newKeys.forEach(k => seenSet.add(k));
  fs.writeFileSync(CONFIG.SEEN_FILE, JSON.stringify([...seenSet]), 'utf8');
}

// ─────────────────────────────────────────────────────────────
// CSV PROGRESS (resume)
// ─────────────────────────────────────────────────────────────
const HEADERS = [
  'lead_id','source','first_name','last_name','full_name',
  'email','phone','job_title','company_name','company_domain',
  'location_city','location_state','linkedin_url',
  'google_rating','review_count','lead_score','score_reason','name_source','status',
];

function csvRow(lead) { return HEADERS.map(h => `"${String(lead[h] ?? '').replace(/"/g,'""')}"`).join(','); }
function initProgressFile() { fs.writeFileSync(CONFIG.PROGRESS_FILE, HEADERS.join(',') + '\n', 'utf8'); }
function appendToProgress(lead) {
  try { fs.appendFileSync(CONFIG.PROGRESS_FILE, csvRow(lead) + '\n', 'utf8'); }
  catch (e) { console.log(`  ⚠️  CSV write error: ${e.message}`); }
}

function loadProgress() {
  if (!fs.existsSync(CONFIG.PROGRESS_FILE)) return { leads: [], done: new Set() };
  const lines = fs.readFileSync(CONFIG.PROGRESS_FILE, 'utf8').trim().split('\n');
  if (lines.length <= 1) return { leads: [], done: new Set() };
  const hdrs  = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
  const leads = lines.slice(1).map(line => {
    const row = {}; let inQ = false, val = '', col = 0;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { row[hdrs[col]] = val; val = ''; col++; }
      else val += ch;
    }
    row[hdrs[col]] = val;
    return row;
  });
  return { leads, done: new Set(leads.map(l => (l.company_name || '').toLowerCase().trim())) };
}

// ─────────────────────────────────────────────────────────────
// EXCEL OUTPUT — hyperlinks on domain, auto-filter, stats tab
// ─────────────────────────────────────────────────────────────
function toSheet(rows) {
  const ws = xlsx.utils.json_to_sheet(rows, { header: HEADERS });
  if (!ws['!ref']) return ws;
  const range = xlsx.utils.decode_range(ws['!ref']);

  // Column widths
  ws['!cols'] = HEADERS.map(h => {
    const widths = { company_name: 30, full_name: 22, email: 28, company_domain: 28, score_reason: 40, name_source: 18 };
    return { wch: widths[h] || 14 };
  });

  // Auto-filter on header row
  ws['!autofilter'] = { ref: ws['!ref'] };

  // Force phone column to text + add hyperlinks to company_domain
  let pCol = -1, dCol = -1;
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[xlsx.utils.encode_cell({ r: 0, c: C })];
    if (cell?.v === 'phone')          pCol = C;
    if (cell?.v === 'company_domain') dCol = C;
  }
  for (let R = 1; R <= range.e.r; R++) {
    if (pCol !== -1) {
      const a = xlsx.utils.encode_cell({ r: R, c: pCol });
      if (ws[a]) { ws[a].t = 's'; ws[a].v = String(ws[a].v); ws[a].z = '@'; }
    }
    if (dCol !== -1) {
      const a = xlsx.utils.encode_cell({ r: R, c: dCol });
      if (ws[a] && ws[a].v) ws[a].l = { Target: `https://${ws[a].v}`, Tooltip: ws[a].v };
    }
  }
  return ws;
}

function buildStatsSheet(allLeads, hotLeads, industry) {
  const all    = [...allLeads, ...hotLeads];
  const named  = all.filter(l => l.full_name).length;
  const emailed = all.filter(l => l.email).length;
  const avgScore = all.length ? (all.reduce((s, l) => s + (parseFloat(l.lead_score) || 0), 0) / all.length).toFixed(1) : 0;
  const byCities = {};
  all.forEach(l => { byCities[l.location_city] = (byCities[l.location_city] || 0) + 1; });
  const topCities = Object.entries(byCities).sort((a,b) => b[1]-a[1]).slice(0,10);

  const rows = [
    { Metric: `${industry} Lead Run`, Value: new Date().toLocaleDateString() },
    { Metric: 'Hot Leads',            Value: hotLeads.length },
    { Metric: 'All Leads',            Value: allLeads.length },
    { Metric: 'Total',                Value: all.length },
    { Metric: 'With Owner Name',      Value: named },
    { Metric: 'Name Hit Rate',        Value: all.length ? `${Math.round(named/all.length*100)}%` : '0%' },
    { Metric: 'With Email',           Value: emailed },
    { Metric: 'Email Rate',           Value: all.length ? `${Math.round(emailed/all.length*100)}%` : '0%' },
    { Metric: 'Avg Lead Score',       Value: avgScore },
    { Metric: '', Value: '' },
    { Metric: 'Top Cities', Value: 'Count' },
    ...topCities.map(([c, n]) => ({ Metric: c, Value: n })),
  ];
  return xlsx.utils.json_to_sheet(rows, { header: ['Metric','Value'] });
}

function saveExcel(allLeads, hotLeads) {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, toSheet(hotLeads), 'Hot Leads');
  xlsx.utils.book_append_sheet(wb, toSheet(allLeads), 'All Leads');
  xlsx.utils.book_append_sheet(wb, buildStatsSheet(allLeads, hotLeads, CONFIG.INDUSTRY_NAME), 'Stats');
  try {
    xlsx.writeFile(wb, CONFIG.OUTPUT_FILE);
    console.log(`\n✅ Saved → ${CONFIG.OUTPUT_FILE}`);
    console.log(`   Hot Leads : ${hotLeads.length} | All Leads : ${allLeads.length} | Total : ${hotLeads.length + allLeads.length}`);
  } catch (e) {
    if (e.code === 'EBUSY') console.error(`\n❌ Close the Excel file first, then run again.`);
    else console.error(`\n❌ Save error: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// COLLECT FROM GOOGLE MAPS
// ─────────────────────────────────────────────────────────────
async function fetchCity(city, state, stateFull) {
  const baseQueries = CONFIG.QUERIES || ['contractor'];
  const queries     = baseQueries.map(q => `${q} ${city} ${state}`);
  const seenTitles  = new Set();
  const all         = [];

  for (const q of queries) {
    try {
      const res = await serperPost('maps', { q, gl: 'us', hl: 'en', num: 20 }, 15000);
      if (!res || !res.ok) { console.log(`  ⚠️  ${city} [${q}]: HTTP ${res?.status}`); await sleep(400); continue; }
      const data = await res.json();
      for (const p of (data.places || [])) {
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
  console.log(`  ${city}, ${state}: ${all.length} unique (${queries.length} queries)`);
  return all;
}

// ─────────────────────────────────────────────────────────────
// MAIN RUN — called by each industry wrapper
// ─────────────────────────────────────────────────────────────
async function run(industryConfig) {
  // Reset module state for this run
  CONFIG       = {
    SERPER_API_KEYS:     ['ac3ba31464ca33e206915f63702be12c05123834', '6a7afb68c82beebd2dea190244c386e2bc09c296'],
    SCRAPINGBEE_API_KEY: 'CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB',
    BRAVE_API_KEY:       '',
    HOT_COUNT:           100,
    ALL_COUNT:           300,
    CITIES:              require('./cities'),
    ...industryConfig,
  };
  serperKeyIdx = 0;
  scrapeCache.clear();

  const ID = CONFIG.INDUSTRY_ID;
  console.log(`\n🚀 ${CONFIG.INDUSTRY_NAME} Lead Aggregator v4\n`);
  console.log(`━━━ STEP 1: Collect from Google Maps ━━━\n`);

  let raw = [];
  for (const loc of CONFIG.CITIES) {
    const leads = await fetchCity(loc.city, loc.state, loc.stateFull);
    raw = raw.concat(leads);
    await sleep(800);
  }
  console.log(`\nRaw collected: ${raw.length}`);

  const filtered = raw.filter(passesFilter);
  console.log(`After filter (phone + no toll-free + reviews ≤250): ${filtered.length}`);

  const unique = dedupe(filtered);
  console.log(`After dedup (domain + fuzzy name + phone): ${unique.length}\n`);

  // Leads with a domain go first — easier to find names
  unique.sort((a, b) => (b.company_domain ? 1 : 0) - (a.company_domain ? 1 : 0));

  console.log(`━━━ STEP 2: Find owner names (${CONFIG.INDUSTRY_NAME} waterfall — 13 layers) ━━━\n`);

  const seenSet              = loadSeen();
  const { leads: resumed, done: alreadyDone } = loadProgress();
  const namedLeads           = [...resumed];
  let dropped                = 0;
  const limit                = createLimit(8);

  if (resumed.length > 0) {
    console.log(`▶ Resuming — ${resumed.length} leads already saved.\n`);
  } else {
    initProgressFile();
  }

  const tasks = unique.map((lead, i) => limit(async () => {
    if (namedLeads.length >= CONFIG.HOT_COUNT + CONFIG.ALL_COUNT) return;

    const key = (lead.company_name || '').toLowerCase().trim();
    if (alreadyDone.has(key) || seenSet.has(key)) {
      console.log(`[${i+1}/${unique.length}] ⏩ ${lead.company_name}`);
      return;
    }
    if (!lead.company_domain && !lead.company_name) { dropped++; return; }

    process.stdout.write(`[${i+1}/${unique.length}] ${lead.company_name} (${lead.location_city}) ... `);

    const { name, email, linkedin_url, nameLayer } = await findOwner(lead);
    if (!name) { process.stdout.write('⚠️  no name — skipped\n'); dropped++; return; }

    // Email domain verify (async, doesn't block)
    const emailVerified = email ? await verifyEmailDomain(email) : false;

    lead.first_name   = name.firstName;
    lead.last_name    = name.lastName;
    lead.full_name    = name.fullName;
    lead.job_title    = 'Owner';
    if (email)        lead.email        = email;
    if (linkedin_url) lead.linkedin_url = linkedin_url;
    lead.name_source  = nameLayer || '';

    const { score, reason } = scoreLead(lead, nameLayer, emailVerified);
    lead.lead_score   = score;
    lead.score_reason = reason;
    lead.lead_id      = `${ID}-${Date.now()}-${Math.random().toString(36).substr(2,5).toUpperCase()}`;
    lead.status       = 'new';
    delete lead._website;

    appendToProgress(lead);
    namedLeads.push(lead);
    if (namedLeads.length >= CONFIG.HOT_COUNT + CONFIG.ALL_COUNT) console.log(`\n🎯 ${CONFIG.HOT_COUNT + CONFIG.ALL_COUNT} leads reached!`);
  }));

  await Promise.all(tasks);

  console.log(`\n━━━ STEP 3: Split & Save ━━━`);
  console.log(`Named leads: ${namedLeads.length} | Dropped (no name): ${dropped}`);

  namedLeads.sort((a, b) => b.lead_score - a.lead_score);

  const hotLeads = namedLeads.filter(l => parseInt(l.review_count) <= 120).slice(0, CONFIG.HOT_COUNT);
  const hotIds   = new Set(hotLeads.map(l => l.lead_id));
  const allLeads = namedLeads.filter(l => !hotIds.has(l.lead_id) && parseInt(l.review_count) <= 200).slice(0, CONFIG.ALL_COUNT);

  saveExcel(allLeads, hotLeads);

  const newKeys = namedLeads.map(l => (l.company_name || '').toLowerCase().trim()).filter(Boolean);
  saveSeen(seenSet, newKeys);
  console.log(`Cross-run dedup updated: ${seenSet.size} total seen.\n`);
}

module.exports = { run };
