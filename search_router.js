'use strict';
// search_router.js — Multi-provider search fallback chain with health logging
// Provider order: Serper → DuckDuckGo → ScrapingBee
// Never throws. Returns [] and logs on total failure.

const fs      = require('fs');
const path    = require('path');
const cheerio = require('cheerio');

const HEALTH_LOG  = path.join(__dirname, 'search_health.log');
const SEARCH_DOWN = path.join(__dirname, 'SEARCH_DOWN.flag');

function ts() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function healthLog(type, query, chain, status) {
  const line = `[${ts()}] ${type.padEnd(5)} | "${query.slice(0, 50).padEnd(50)}" | ${chain} → ${status}\n`;
  try { fs.appendFileSync(HEALTH_LOG, line); } catch {}
}

// ── Result normalizers ─────────────────────────────────────────────────────

function normalizeOrganic(results) {
  return results.map(r => ({ title: r.title || '', snippet: r.snippet || r.description || '', link: r.link || r.url || '' }));
}

function mapsMapsFromOrganic(organic) {
  return organic.slice(0, 10).map(r => {
    const text        = `${r.title} ${r.snippet}`;
    const phoneMatch  = text.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/);
    const ratingMatch = text.match(/(\d\.\d)\s*(?:stars?|rating)/i);
    return {
      title:       r.title.replace(/\s*[-–|].*$/, '').trim(),
      phoneNumber: phoneMatch  ? phoneMatch[0]          : '',
      website:     r.link      || '',
      rating:      ratingMatch ? parseFloat(ratingMatch[1]) : '',
      ratingCount: 0,
    };
  }).filter(p => p.title.length > 2);
}

// ── Provider 1: Serper ─────────────────────────────────────────────────────

async function trySerper(query, type, config, num) {
  const KeyManager = require('./key_manager');

  // Combine KeyManager live keys with any config keys not yet in KeyManager
  const kmLive   = KeyManager.getAllKeys().filter(k => k.status === 'ok').map(k => k.key);
  const cfgKeys  = (config.SERPER_API_KEYS || []).filter(k => !kmLive.includes(k));
  const allKeys  = [...kmLive, ...cfgKeys];
  if (!allKeys.length) return null;

  const startIdx = config._serperKeyIdx || 0;

  for (let i = startIdx; i < allKeys.length; i++) {
    const key      = allKeys[i];
    const endpoint = type === 'maps' ? 'maps' : 'search';
    try {
      const res = await fetch(`https://google.serper.dev/${endpoint}`, {
        method:  'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: query, gl: 'us', hl: 'en', num }),
        signal:  AbortSignal.timeout(12000),
      });
      if (res.ok) {
        config._serperKeyIdx = i;
        const data = await res.json();
        if (type === 'maps') return { organic: [], places: data.places || [] };
        return { organic: normalizeOrganic(data.organic || []), places: [] };
      }
      if (res.status === 429 || res.status === 402)  { KeyManager.markQuota(key); config._serperKeyIdx = i + 1; continue; }
      if (res.status === 401 || res.status === 403)  { KeyManager.markDead(key);  config._serperKeyIdx = i + 1; continue; }
    } catch { config._serperKeyIdx = i + 1; }
  }
  return null;
}

// ── Provider 2: DuckDuckGo ─────────────────────────────────────────────────

async function tryDDG(query, type) {
  try {
    await sleep(1000 + Math.random() * 2000);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal:  AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html      = await res.text();
    const titleRe   = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/span>/g;
    const linkRe    = /class="result__url"[^>]*>([\s\S]*?)<\/a>/g;
    const titles    = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const snippets  = [...html.matchAll(snippetRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const links     = [...html.matchAll(linkRe)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    const organic   = titles.slice(0, 8).map((t, i) => ({ title: t, snippet: snippets[i] || '', link: links[i] || '' }));
    const places    = type === 'maps' ? mapsMapsFromOrganic(organic) : [];
    return { organic, places };
  } catch { return null; }
}

// ── Provider 3: ScrapingBee (maps only) ───────────────────────────────────

async function tryScrapingBee(query, type, sbKey) {
  if (!sbKey || type !== 'maps') return null;
  try {
    const sbUrl = `https://app.scrapingbee.com/api/v1/google/?api_key=${sbKey}&q=${encodeURIComponent(query)}&gl=us&hl=en&nb_results=20&search_type=place`;
    const res   = await fetch(sbUrl, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return null;
    const data   = await res.json();
    const places = (data.local_results || data.organic_results || []).map(p => ({
      title:       p.title || p.name || '',
      phoneNumber: p.phone || '',
      website:     p.website || p.url || '',
      rating:      p.rating || '',
      ratingCount: p.reviews || p.review_count || 0,
    })).filter(p => p.title);
    return { organic: [], places };
  } catch { return null; }
}

// ── Main router ────────────────────────────────────────────────────────────

async function search(query, type, config = {}, num = 10) {
  const sbKey    = config.SCRAPINGBEE_API_KEY || '';
  const tried    = [];

  let data = await trySerper(query, type, config, num);
  if (data) { healthLog(type, query, `Serper(key#${config._serperKeyIdx ?? 0})`, '200 ✓'); return { ok: true, source: 'serper', data }; }
  tried.push('Serper → dead/quota');

  data = await tryDDG(query, type);
  if (data) { healthLog(type, query, tried.join(' | ') + ' | DDG', '200 ✓'); return { ok: true, source: 'ddg', data }; }
  tried.push('DDG → fail');

  data = await tryScrapingBee(query, type, sbKey);
  if (data) { healthLog(type, query, tried.join(' | ') + ' | ScrapingBee', '200 ✓'); return { ok: true, source: 'scrapingbee', data }; }

  const failLine = tried.join(' | ') + ' | ScrapingBee → fail';
  healthLog(type, query, failLine, 'ALL FAILED → empty []');
  console.log(`[Search] ⚠️  All providers failed for: ${query} — returning empty, continuing run`);
  return { ok: false, source: 'none', data: { organic: [], places: [] } };
}

// Check last N health log entries for all-fail pattern
function isSearchDown(lastN = 10) {
  try {
    const lines = fs.readFileSync(HEALTH_LOG, 'utf8').trim().split('\n').slice(-lastN);
    return lines.length >= lastN && lines.every(l => l.includes('ALL FAILED'));
  } catch { return false; }
}

function setDownFlag(down) {
  try {
    if (down) fs.writeFileSync(SEARCH_DOWN, `Search down at ${ts()}\n`);
    else if (fs.existsSync(SEARCH_DOWN)) fs.unlinkSync(SEARCH_DOWN);
  } catch {}
}

module.exports = { search, isSearchDown, setDownFlag, HEALTH_LOG };
