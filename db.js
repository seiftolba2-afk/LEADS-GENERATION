'use strict';
// db.js — JSON-file backend replacing better-sqlite3 (no native compilation needed)
// Same public interface as the SQLite version.

const fs   = require('fs');
const path = require('path');

const DATA_DIR = __dirname;

function leadsFile(industry)  { return path.join(DATA_DIR, `leads_${industry}.json`); }
function seenFile(industry)   { return path.join(DATA_DIR, `seen_${industry}.json`); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Progress ─────────────────────────────────────────────────

function loadLeadsProgress(industry) {
  const leads = readJson(leadsFile(industry), []);
  const done  = new Set(leads.map(r => (r.company_name || '').toLowerCase().trim()));
  return { leads, done };
}

function appendLead(industry, lead) {
  const file  = leadsFile(industry);
  const leads = readJson(file, []);
  leads.push({ ...lead, industry });
  writeJson(file, leads);
}

function clearProgress(industry) {
  writeJson(leadsFile(industry), []);
}

// ── Seen companies ───────────────────────────────────────────

function loadSeenSet(industry) {
  const arr = readJson(seenFile(industry), []);
  return new Set(arr);
}

function saveSeenBatch(industry, names) {
  if (!names || !names.length) return;
  const file    = seenFile(industry);
  const existing = readJson(file, []);
  const merged   = [...new Set([...existing, ...names])];
  writeJson(file, merged);
}

// getDb kept for compatibility — returns a no-op object
function getDb() { return { pragma: () => {}, exec: () => {}, prepare: () => ({ all: () => [], run: () => {} }) }; }

module.exports = { getDb, loadLeadsProgress, appendLead, clearProgress, loadSeenSet, saveSeenBatch };
