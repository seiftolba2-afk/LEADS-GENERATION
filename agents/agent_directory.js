'use strict';
// Agent Directory — BBB, Manta, Porch, Angi, Houzz, Thumbtack, Yelp, TripAdvisor, Facebook

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

async function duckSearch(query) {
  const url  = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!html) return [];
  const results = [], titleRe = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g, snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g;
  const titles   = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  const snippets = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
  for (let i = 0; i < Math.min(titles.length, 5); i++) results.push({ title: titles[i] || '', snippet: snippets[i] || '' });
  return results;
}

async function mantaSearch(state, companyName, city) {
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `site:manta.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('manta.com')) continue;
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
      const html = await fetchSafe(r.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!html) continue;
      const m = html.match(/(?:Owner|Principal|Contact|President)[:\s]*(?:<[^>]*>)*([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+)/);
      if (m) { const n2 = splitSafe(m[1]); if (n2) return n2; }
      const n3 = extractName(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); if (n3) return n3;
    }
  } catch { }
  return null;
}

async function porchSearch(state, companyName, city) {
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `site:porch.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      if (!r.link?.includes('porch.com')) continue;
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
      const html = await fetchSafe(r.link, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!html) continue;
      const n2 = extractName(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); if (n2) return n2;
    }
  } catch { }
  return null;
}

async function bbbSearch(state, companyName, city) {
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

async function angiSearch(state, companyName, city) {
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `site:angi.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

async function houzzSearch(state, companyName, city) {
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `site:houzz.com "${companyName}" ${city} owner`, gl: 'us', hl: 'en', num: 3 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

async function thumbtackSearch(state, companyName, city) {
  try {
    const res = await state.serperLimit(() => serperPost(state, 'search', { q: `site:thumbtack.com "${companyName}" ${city}`, gl: 'us', hl: 'en', num: 3 }));
    if (!res || !res.ok) return null;
    const data = await res.json();
    for (const r of (data.organic || [])) {
      const n = extractName(`${r.title || ''} ${r.snippet || ''}`); if (n) return n;
    }
  } catch { }
  return null;
}

async function yelpSearch(state, companyName, city) {
  const q   = encodeURIComponent(`${companyName} ${city}`);
  const url = `https://www.yelp.com/search?find_desc=${q}&find_loc=${encodeURIComponent(city)}`;
  try {
    const html = await fetchSafe(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    if (!html) return null;
    return extractName(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  } catch { return null; }
}

async function tripAdvisorSearch(state, companyName, city) {
  try {
    const results = await duckSearch(`tripadvisor.com "${companyName}" ${city} owner`);
    for (const r of results) { const n = extractName(`${r.title} ${r.snippet}`); if (n) return n; }
  } catch { }
  return null;
}

async function facebookSearch(state, companyName, city) {
  try {
    const results = await duckSearch(`site:facebook.com "${companyName}" ${city} owner OR founder`);
    for (const r of results) { const n = extractName(`${r.title} ${r.snippet}`); if (n) return n; }
  } catch { }
  return null;
}

module.exports = {
  mantaSearch, porchSearch, bbbSearch,
  angiSearch, houzzSearch, thumbtackSearch,
  yelpSearch, tripAdvisorSearch, facebookSearch,
};
