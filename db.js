'use strict';
// db.js — SQLite wrapper replacing CSV progress + seen_companies JSON
// Singleton DB; schema auto-created on first open.

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = path.join('D:\\LEADS GENERATION', 'leads.db');
let _db = null;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      industry        TEXT NOT NULL,
      lead_id         TEXT,
      source          TEXT,
      first_name      TEXT,
      last_name       TEXT,
      full_name       TEXT,
      email           TEXT,
      phone           TEXT,
      job_title       TEXT,
      company_name    TEXT,
      company_domain  TEXT,
      location_city   TEXT,
      location_state  TEXT,
      linkedin_url    TEXT,
      facebook_followers INTEGER,
      google_rating   REAL,
      review_count    INTEGER,
      lead_score      REAL,
      score_reason    TEXT,
      name_source     TEXT,
      status          TEXT,
      phone_type      TEXT,
      scraped_date    TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS seen_companies (
      name     TEXT NOT NULL,
      industry TEXT NOT NULL,
      PRIMARY KEY (name, industry)
    );
  `);
  // Migrate existing DBs that predate these columns
  try { _db.exec('ALTER TABLE leads ADD COLUMN phone_type TEXT'); } catch {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN scraped_date TEXT'); } catch {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN trigger_signal TEXT'); } catch {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN domain_age_days INTEGER'); } catch {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN review_velocity REAL'); } catch {}
  try { _db.exec('ALTER TABLE leads ADD COLUMN completeness_pct INTEGER'); } catch {}
  return _db;
}

// ── Progress (replaces CSV) ───────────────────────────────────

function loadLeadsProgress(industry) {
  const db    = getDb();
  const rows  = db.prepare('SELECT * FROM leads WHERE industry = ?').all(industry);
  const done  = new Set(rows.map(r => (r.company_name || '').toLowerCase().trim()));
  return { leads: rows, done };
}

function appendLead(industry, lead) {
  const db = getDb();
  db.prepare(`
    INSERT INTO leads (
      industry, lead_id, source, first_name, last_name, full_name,
      email, phone, job_title, company_name, company_domain,
      location_city, location_state, linkedin_url, facebook_followers,
      google_rating, review_count, lead_score, score_reason, name_source, status,
      phone_type, scraped_date, trigger_signal, domain_age_days, review_velocity, completeness_pct
    ) VALUES (
      @industry, @lead_id, @source, @first_name, @last_name, @full_name,
      @email, @phone, @job_title, @company_name, @company_domain,
      @location_city, @location_state, @linkedin_url, @facebook_followers,
      @google_rating, @review_count, @lead_score, @score_reason, @name_source, @status,
      @phone_type, @scraped_date, @trigger_signal, @domain_age_days, @review_velocity, @completeness_pct
    )
  `).run({
    industry,
    lead_id:            lead.lead_id         || '',
    source:             lead.source          || '',
    first_name:         lead.first_name      || '',
    last_name:          lead.last_name       || '',
    full_name:          lead.full_name       || '',
    email:              lead.email           || '',
    phone:              lead.phone           || '',
    job_title:          lead.job_title       || '',
    company_name:       lead.company_name    || '',
    company_domain:     lead.company_domain  || '',
    location_city:      lead.location_city   || '',
    location_state:     lead.location_state  || '',
    linkedin_url:       lead.linkedin_url    || '',
    facebook_followers: lead.facebook_followers ?? null,
    google_rating:      parseFloat(lead.google_rating) || null,
    review_count:       parseInt(lead.review_count)    || 0,
    lead_score:         parseFloat(lead.lead_score)    || 0,
    score_reason:       lead.score_reason    || '',
    name_source:        lead.name_source     || '',
    status:             lead.status          || 'new',
    phone_type:         lead.phone_type      || null,
    scraped_date:       lead.scraped_date    || null,
    trigger_signal:     lead.trigger_signal   || null,
    domain_age_days:    lead.domain_age_days  ?? null,
    review_velocity:    lead.review_velocity  ?? null,
    completeness_pct:   lead.completeness_pct ?? null,
  });
}

function clearProgress(industry) {
  getDb().prepare('DELETE FROM leads WHERE industry = ?').run(industry);
}

// ── Seen companies (replaces JSON) ───────────────────────────

function loadSeenSet(industry) {
  const rows = getDb().prepare('SELECT name FROM seen_companies WHERE industry = ?').all(industry);
  return new Set(rows.map(r => r.name));
}

function saveSeenBatch(industry, names) {
  if (!names || !names.length) return;
  const db   = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO seen_companies (name, industry) VALUES (?, ?)');
  const insertMany = db.transaction(ns => { for (const n of ns) stmt.run(n, industry); });
  insertMany(names);
}

module.exports = { getDb, loadLeadsProgress, appendLead, clearProgress, loadSeenSet, saveSeenBatch };
