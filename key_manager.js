'use strict';
// KeyManager — persistent Serper key pool with validation, dedup, and auto-recovery
const fs   = require('fs');
const path = require('path');

const KEYS_FILE = path.join(__dirname, 'serper_keys.json');

class KeyManager {
  constructor() {
    this._keys = [];
    this._idx  = 0;
    this._load();
    // Recheck dead/quota keys every 6 hours
    setInterval(() => this.recheckAll().catch(() => {}), 6 * 60 * 60 * 1000);
  }

  _load() {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        this._keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      }
    } catch { this._keys = []; }
  }

  _save() {
    try {
      // Atomic write: write to temp file first, then rename. Prevents corruption if process crashes mid-write.
      const tmpFile = KEYS_FILE + '.tmp';
      fs.writeFileSync(tmpFile, JSON.stringify(this._keys, null, 2));
      fs.renameSync(tmpFile, KEYS_FILE);
    } catch {}
  }

  async _testKey(key) {
    try {
      const res = await fetch('https://google.serper.dev/search', {
        method:  'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: 'test', num: 1 }),
        signal:  AbortSignal.timeout(10000),
      });
      if (res.ok)                                   return 'ok';
      if (res.status === 429 || res.status === 400 || res.status === 402) return 'quota';
      if (res.status === 401 || res.status === 403) return 'dead';
      return 'error';
    } catch { return 'error'; }
  }

  // Returns: 'ok' | 'duplicate' | 'dead' | 'quota' | 'error'
  async validateKey(key) {
    if (!key) return 'dead';
    if (this._keys.some(k => k.key === key)) return 'duplicate';
    return this._testKey(key);
  }

  // Validates and saves. Returns the status string.
  async addKey(key) {
    const status = await this.validateKey(key);
    const entry  = { key, addedAt: Date.now(), status, lastChecked: Date.now() };

    if (status === 'duplicate') {
      console.log(`[KeyManager] DUPLICATE key ${key.slice(0, 8)}... → skipped`);
    } else if (status === 'dead' || status === 'error') {
      console.log(`[KeyManager] ${status.toUpperCase()} key ${key.slice(0, 8)}... → rejected`);
    } else {
      // 'ok' or 'quota' — keep it (quota keys may recover after monthly reset)
      this._keys.push(entry);
      this._save();
      if (status === 'ok') {
        console.log(`[KeyManager] NEW key ${key.slice(0, 8)}... → ok ✓`);
        this._appendKeyTxt(key);
      }
      if (status === 'quota') console.log(`[KeyManager] QUOTA key ${key.slice(0, 8)}... → saved (may recover)`);
    }
    return status;
  }

  _appendKeyTxt(key) {
    try {
      const txtFile = path.join(__dirname, 'keys.txt');
      let existing = '';
      try { existing = fs.readFileSync(txtFile, 'utf8'); } catch {}
      if (!existing.split('\n').map(l => l.trim()).includes(key)) {
        fs.appendFileSync(txtFile, key + '\n');
      }
    } catch {}
  }

  // Returns the next live key, cycling through the pool. Returns null if none.
  getNextLiveKey() {
    this._load();
    const live = this._keys.filter(k => k.status === 'ok');
    if (!live.length) return null;
    const entry = live[this._idx % live.length];
    this._idx++;
    return entry.key;
  }

  markDead(key) {
    const e = this._keys.find(k => k.key === key);
    if (e) { e.status = 'dead'; e.lastChecked = Date.now(); this._save(); }
  }

  markQuota(key) {
    const e = this._keys.find(k => k.key === key);
    if (e) { e.status = 'quota'; e.lastChecked = Date.now(); this._save(); }
  }

  // Re-validates all non-ok keys. Returns number of recovered keys.
  async recheckAll() {
    this._load();
    let recovered = 0;
    for (const entry of this._keys.filter(k => k.status !== 'ok')) {
      const status = await this._testKey(entry.key);
      if (status !== 'error') { entry.status = status; entry.lastChecked = Date.now(); }
      if (status === 'ok') recovered++;
    }
    if (recovered) console.log(`[KeyManager] ✅ ${recovered} key(s) recovered`);
    this._save(); // always persist updated statuses
    return recovered;
  }

  getAllKeys() { return [...this._keys]; }
  liveCount()  { return this._keys.filter(k => k.status === 'ok').length; }
}

module.exports = new KeyManager();
