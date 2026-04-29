'use strict';
const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// CONCURRENCY LIMITER (same impl as aggregator_core)
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
// WATERFALL CACHE — 30-day TTL, keyed by company_domain
// ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadWaterfallCache(config) {
  const file = path.join(path.dirname(config.OUTPUT_FILE || '.'), 'waterfall_cache.json');
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now();
    // Evict expired entries on load
    const pruned = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v.ts && now - v.ts < CACHE_TTL_MS) pruned[k] = v;
    }
    return { cache: pruned, file };
  } catch {
    return { cache: {}, file };
  }
}

function saveWaterfallCache({ cache, file }) {
  try { fs.writeFileSync(file, JSON.stringify(cache), 'utf8'); }
  catch (e) { console.warn(`[cache] save failed: ${e.message}`); }
}

function getCached(state, domain) {
  if (!domain || !state.waterfallCache.cache[domain]) return null;
  const entry = state.waterfallCache.cache[domain];
  if (Date.now() - entry.ts > CACHE_TTL_MS) { delete state.waterfallCache.cache[domain]; return null; }
  return entry;
}

function setCached(state, domain, data) {
  if (!domain) return;
  state.waterfallCache.cache[domain] = { ...data, ts: Date.now() };
}

// ─────────────────────────────────────────────────────────────
// SEEN COMPANIES (cross-run dedup)
// ─────────────────────────────────────────────────────────────
function loadSeenCompanies(config) {
  try { return new Set(JSON.parse(fs.readFileSync(config.SEEN_FILE, 'utf8'))); }
  catch { return new Set(); }
}

function saveSeenCompanies(config, seenSet, newKeys) {
  newKeys.forEach(k => seenSet.add(k));
  fs.writeFileSync(config.SEEN_FILE, JSON.stringify([...seenSet]), 'utf8');
}

// ─────────────────────────────────────────────────────────────
// HIT-RATE TRACKING
// ─────────────────────────────────────────────────────────────
function recordAttempt(hitRates, layer) {
  if (!hitRates[layer]) hitRates[layer] = { attempts: 0, hits: 0 };
  hitRates[layer].attempts++;
}

function recordHit(hitRates, layer) {
  if (!hitRates[layer]) hitRates[layer] = { attempts: 0, hits: 0 };
  hitRates[layer].hits++;
}

function buildHitRateTable(hitRates) {
  const rows = Object.entries(hitRates)
    .filter(([, v]) => v.attempts > 0)
    .map(([layer, v]) => {
      const pct = Math.round(v.hits / v.attempts * 100);
      return `  ${layer.padEnd(20)} ${String(v.hits).padStart(4)}/${String(v.attempts).padStart(4)}  (${pct}%)`;
    });
  return rows.length ? '\n=== Layer Hit Rates ===\n' + rows.join('\n') + '\n' : '';
}

// ─────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────
function createSharedState(config) {
  const waterfallCache = loadWaterfallCache(config);
  return {
    config,
    seenCompanies: new Set(),
    waterfallCache,              // { cache: {}, file: '...' }
    scrapeCache:   new Map(),    // in-run only
    progress:      { namedLeads: [], resumed: 0 },
    hitRates:      {},           // layerName → { attempts, hits }
    serperLimit:   createLimit(6),
    scraperLimit:  createLimit(4),
    leadLimit:     createLimit(8),
  };
}

module.exports = {
  createSharedState,
  loadSeenCompanies,
  saveSeenCompanies,
  loadWaterfallCache,
  saveWaterfallCache,
  getCached,
  setCached,
  recordAttempt,
  recordHit,
  buildHitRateTable,
};
