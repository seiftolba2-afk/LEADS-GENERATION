'use strict';
// Agent Enrichment — OpenCorporates (L6) + Secretary of State (L11)

const { splitSafe } = require('./agent_serper');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

const STATE_CODES = {
  'Texas':'tx','Florida':'fl','Georgia':'ga','North Carolina':'nc','Illinois':'il',
  'Arizona':'az','Colorado':'co','Tennessee':'tn','California':'ca','Virginia':'va',
  'Ohio':'oh','Michigan':'mi','Pennsylvania':'pa','Nevada':'nv','Washington':'wa',
  'Minnesota':'mn','Missouri':'mo','Indiana':'in','Maryland':'md','Oregon':'or',
  'Louisiana':'la','Oklahoma':'ok','Kentucky':'ky','Alabama':'al','South Carolina':'sc',
  'Utah':'ut','New Mexico':'nm','Idaho':'id','Arkansas':'ar','Mississippi':'ms',
  'Iowa':'ia','Kansas':'ks','Nebraska':'ne','Wisconsin':'wi',
};

async function openCorporatesSearch(state, companyName, stateStr) {
  const code = STATE_CODES[stateStr];
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

async function sosSearch(state, companyName, stateStr) {
  const clean = encodeURIComponent(companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd)\.?/gi, '').trim());
  const urls  = {
    'Florida':        `https://search.sunbiz.org/Inquiry/CorporationSearch/SearchResults?inquiryType=EntityName&searchNameOrder=&masterDataTopmostValue=&searchTerm=${clean}`,
    'Georgia':        `https://ecorp.sos.ga.gov/BusinessSearch/BusinessInformation?searchName=${clean}&searchType=Contains&listType=0`,
    'North Carolina': `https://www.sosnc.gov/online_services/search/by_name/#/?searchStr=${clean}`,
    'Ohio':           `https://businesssearch.ohiosos.gov/?=businessDetails/${clean}`,
    'Colorado':       `https://www.sos.state.co.us/biz/BusinessEntityCriteriaExt.do?nameTyp=ENT&entityName=${clean}`,
    'Arizona':        `https://ecorp.azcc.gov/CommonHelper/GetAnonymousToken?entityName=${clean}`,
  };
  const url = urls[stateStr];
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

module.exports = { openCorporatesSearch, sosSearch };
