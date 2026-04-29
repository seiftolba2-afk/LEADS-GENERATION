'use strict';
// Agent Scraper — website scrape (L2a/2b) + full findOwner orchestration
// Calls all layer agents in sequence and returns { name, email, linkedin_url, nameLayer }

const dns = require('dns').promises;
const { getCached, setCached, recordAttempt, recordHit } = require('./shared_state');
const { serperNameSearch, phoneSearch, serperEmailSearch, splitSafe, extractName } = require('./agent_serper');
const { mantaSearch, porchSearch }    = require('./agent_directory');
const { stateLicenseSearch }          = require('./agent_license');
const { bbbSearch, angiSearch, houzzSearch, thumbtackSearch, yelpSearch, tripAdvisorSearch, facebookSearch } = require('./agent_directory');
const { openCorporatesSearch, sosSearch } = require('./agent_enrichment');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────
// EMAIL UTILITIES
// ─────────────────────────────────────────────────────────────
const FAKE_DOMAINS = new Set(['godaddy.com','email.com','example.com','test.com','placeholder.com','domain.com','yourcompany.com','website.com','sample.com','tempmail.com','mailinator.com']);
const GENERIC_PFXS = new Set(['info','hello','contact','admin','support','office','sales','service','quotes','estimate','billing','inquiry','help','mail','team','staff','noreply','no-reply','roofing','roof','solar','hvac','construction','quote','request','jobs','careers','hr','plumbing','electrical','landscaping','painting']);

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
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

async function verifyEmailDomain(email) {
  if (!email) return false;
  const domain = email.split('@')[1];
  if (!domain) return false;
  try { const r = await dns.resolveMx(domain); return r && r.length > 0; }
  catch { return false; }
}

// ─────────────────────────────────────────────────────────────
// L2a — WEBSITE SCRAPE
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

async function scrapeSite(state, domain) {
  if (state.scrapeCache.has(domain)) return state.scrapeCache.get(domain);
  let foundName = null, foundEmail = null;
  const paths = ['/contact', '/contact-us', '/', '/about', '/about-us', '/our-team', '/team'];
  for (const p of paths) {
    if (foundName && foundEmail) break;
    const html = await state.scraperLimit(() => fetchSafe(`https://${domain}${p}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,*/*;q=0.8' },
    }));
    if (!html || html.length < 100) continue;
    if (!foundEmail) foundEmail = extractEmail(html);
    const text = html.replace(/<(script|style|nav|footer|header|aside)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!foundEmail) foundEmail = extractEmail(text);
    if (!foundName)  foundName  = extractName(text);
  }
  const result = { name: foundName, email: foundEmail };
  state.scrapeCache.set(domain, result);
  return result;
}

// ─────────────────────────────────────────────────────────────
// MASTER WATERFALL
// ─────────────────────────────────────────────────────────────
async function findOwner(state, lead) {
  let name = null, email = null, linkedinUrl = null, nameLayer = null;
  const hr = state.hitRates;

  // Domain cache check
  const cacheKey = lead.company_domain || null;
  if (cacheKey) {
    const cached = getCached(state, cacheKey);
    if (cached) {
      console.log(`    ♻️  [Cache]           ${cached.name?.fullName || '—'}`);
      return { name: cached.name, email: cached.email, linkedin_url: cached.linkedin_url, nameLayer: cached.nameLayer };
    }
  }

  // L1 — Serper
  if (lead.company_name) {
    recordAttempt(hr, 'L1:Google');
    name = await serperNameSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L1:Google'; recordHit(hr, 'L1:Google'); if (name.linkedin_url) linkedinUrl = name.linkedin_url; console.log(`    ✅ [Google]        ${name.fullName}`); }
    await sleep(400);
  }

  // L2a — Website scrape
  if (lead.company_domain) {
    recordAttempt(hr, 'L2a:Website');
    const { name: wn, email: we } = await scrapeSite(state, lead.company_domain);
    if (!name && wn) { name = wn; nameLayer = 'L2a:Website'; recordHit(hr, 'L2a:Website'); console.log(`    ✅ [Website]       ${wn.fullName}`); }
    if (we) email = we;
    if (!name && we) { const n = emailPrefix(we); if (n) { name = n; nameLayer = 'L2b:EmailPrefix'; recordHit(hr, 'L2b:EmailPrefix'); console.log(`    ✅ [Email prefix]  ${n.fullName}`); } }
  }

  if (name && email) { if (cacheKey) setCached(state, cacheKey, { name, email, linkedin_url: linkedinUrl, nameLayer }); return { name, email, linkedin_url: linkedinUrl, nameLayer }; }

  // L2c — Manta
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L2c:Manta');
    name = await mantaSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L2c:Manta'; recordHit(hr, 'L2c:Manta'); console.log(`    ✅ [Manta]         ${name.fullName}`); }
    await sleep(300);
  }

  // L2d — Porch
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L2d:Porch');
    name = await porchSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L2d:Porch'; recordHit(hr, 'L2d:Porch'); console.log(`    ✅ [Porch]         ${name.fullName}`); }
    await sleep(300);
  }

  // L3 — Phone search (Wave 2)
  if (!name && lead.phone) {
    recordAttempt(hr, 'L3:Phone');
    name = await phoneSearch(state, lead.phone);
    if (name) { nameLayer = 'L3:Phone'; recordHit(hr, 'L3:Phone'); console.log(`    ✅ [Phone]         ${name.fullName}`); }
    await sleep(300);
  }

  // L4 — State license DB
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L4:LicenseDB');
    name = await stateLicenseSearch(state, lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L4:LicenseDB'; recordHit(hr, 'L4:LicenseDB'); console.log(`    ✅ [License DB]    ${name.fullName}`); }
    await sleep(300);
  }

  // L5 — BBB
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L5:BBB');
    name = await bbbSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L5:BBB'; recordHit(hr, 'L5:BBB'); console.log(`    ✅ [BBB]           ${name.fullName}`); }
    await sleep(300);
  }

  // L6 — OpenCorporates
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L6:OpenCorp');
    name = await openCorporatesSearch(state, lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L6:OpenCorp'; recordHit(hr, 'L6:OpenCorp'); console.log(`    ✅ [OpenCorp]      ${name.fullName}`); }
    await sleep(300);
  }

  // L7 — Angi
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L7:Angi');
    name = await angiSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L7:Angi'; recordHit(hr, 'L7:Angi'); console.log(`    ✅ [Angi]          ${name.fullName}`); }
    await sleep(300);
  }

  // L8 — Houzz
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L8:Houzz');
    name = await houzzSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L8:Houzz'; recordHit(hr, 'L8:Houzz'); console.log(`    ✅ [Houzz]         ${name.fullName}`); }
    await sleep(300);
  }

  // L9 — Thumbtack
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L9:Thumbtack');
    name = await thumbtackSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L9:Thumbtack'; recordHit(hr, 'L9:Thumbtack'); console.log(`    ✅ [Thumbtack]     ${name.fullName}`); }
    await sleep(300);
  }

  // L10 — Yelp
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L10:Yelp');
    name = await yelpSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L10:Yelp'; recordHit(hr, 'L10:Yelp'); console.log(`    ✅ [Yelp]          ${name.fullName}`); }
    await sleep(300);
  }

  // L11 — Secretary of State
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L11:SOS');
    name = await sosSearch(state, lead.company_name, lead.location_state);
    if (name) { nameLayer = 'L11:SOS'; recordHit(hr, 'L11:SOS'); console.log(`    ✅ [SOS]           ${name.fullName}`); }
    await sleep(300);
  }

  // L12 — TripAdvisor
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L12:TripAdvisor');
    name = await tripAdvisorSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L12:TripAdvisor'; recordHit(hr, 'L12:TripAdvisor'); console.log(`    ✅ [TripAdvisor]   ${name.fullName}`); }
    await sleep(300);
  }

  // L13 — Facebook
  if (!name && lead.company_name) {
    recordAttempt(hr, 'L13:Facebook');
    name = await facebookSearch(state, lead.company_name, lead.location_city);
    if (name) { nameLayer = 'L13:Facebook'; recordHit(hr, 'L13:Facebook'); console.log(`    ✅ [Facebook]      ${name.fullName}`); }
    await sleep(300);
  }

  // Email search (if still missing)
  if (!email && lead.company_name) {
    email = await serperEmailSearch(state, lead.company_name, lead.location_city, lead.company_domain);
    if (email) console.log(`    📧 [Email search]  ${email}`);
  }

  if (cacheKey) setCached(state, cacheKey, { name, email, linkedin_url: linkedinUrl, nameLayer });
  return { name, email, linkedin_url: linkedinUrl, nameLayer };
}

module.exports = { findOwner, scrapeSite, verifyEmailDomain, extractEmail, emailPrefix };
