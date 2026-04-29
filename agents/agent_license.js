'use strict';
// Agent License — 30-state contractor license DB searches (L4)

const { serperPost, extractName, splitSafe } = require('./agent_serper');

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

async function stateLicenseSearch(state, companyName, stateStr) {
  const clean   = companyName.replace(/,?\s*(Inc|LLC|Co|Corp|Ltd|Inc\.)\.?/gi, '').trim();
  const encoded = encodeURIComponent(clean);

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

  const directUrl = directUrls[stateStr];
  if (directUrl) {
    try {
      const html = await fetchSafe(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      if (!html) return null;
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (stateStr === 'Florida') {
        const m = text.match(/[Qq]ualifier[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
        if (m) return splitSafe(m[1].trim());
      }
      const m2 = text.match(/(?:Principal|Registrant|Qualifier|License Holder|Licensee|Owner|Applicant)[:\s]+([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
      if (m2) return splitSafe(m2[1].trim());
      return extractName(text);
    } catch { return null; }
  }

  const siteQuery = serperStates[stateStr];
  if (siteQuery) {
    try {
      const res = await state.serperLimit(() => serperPost(state, 'search', { q: `${siteQuery} "${clean}" contractor license`, gl: 'us', hl: 'en', num: 3 }));
      if (!res || !res.ok) return null;
      const data = await res.json();
      for (const r of (data.organic || [])) {
        const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
      }
    } catch { }
  }
  return null;
}

module.exports = { stateLicenseSearch };
