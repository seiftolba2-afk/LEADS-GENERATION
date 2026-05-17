'use strict';
/**
 * key_generator.js — Automated Serper.dev account creator
 * Free + zero-human stack:
 *   1. puppeteer-extra + stealth plugin
 *   2. fingerprint-generator + fingerprint-injector (real browser fingerprints)
 *   3. ghost-cursor (Bezier-curve human mouse paths)
 *   4. Audio CAPTCHA bypass via wit.ai STT (free)
 *   5. Turnstile auto-click
 */

const puppeteer      = require('rebrowser-puppeteer');
const { createCursor } = require('ghost-cursor');
const FingerprintInjector  = require('fingerprint-injector');
const FingerprintGenerator = require('fingerprint-generator');

const axios = require('axios');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const ws    = require('./windscribe_manager');

// Temp-email providers use certs Node.js can't verify from its bundled CAs
const axiosNoVerify = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) });

const ROOT        = 'D:\\LEADS GENERATION';
const LOCK_FILE   = path.join(ROOT, '.keygen.lock');
const PROFILE_DIR = path.join(ROOT, '.serper_profile');
const CHROME_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
const WIT_API_KEY = 'QHOSR47F2SBIRITIV5MCK4NLYMZFFREK';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(min, max) { return sleep(min + Math.floor(Math.random() * (max - min))); }

// Consecutive-duplicate tracking — 3 dups in a row pauses keygen for 2 hours
// Persisted to disk so monitor.js (which spawns fresh Node processes) sees the counter
const STRIKE_FILE = path.join(ROOT, '.keygen_strikes.json');
let _consecutiveDups  = 0;
let _pausedUntil      = 0;

function loadStrikes() {
  try {
    const s = JSON.parse(fs.readFileSync(STRIKE_FILE, 'utf8'));
    _consecutiveDups = s.dups || 0;
    _pausedUntil     = s.pausedUntil || 0;
  } catch {
    _consecutiveDups = 0;
    _pausedUntil     = 0;
  }
}
function saveStrikes() {
  try {
    fs.writeFileSync(STRIKE_FILE, JSON.stringify({
      dups: _consecutiveDups, pausedUntil: _pausedUntil,
    }));
  } catch {}
}

function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const age = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (age < 120000) return false;
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch {} }

// ── Multi-provider temp email ─────────────────────────────────────────────────
let activeProvider = '';
let activeEmail    = '';
let activeLogin    = '';
let mailTmToken    = '';
let gmSidToken     = '';
let geteduTab      = null;

const GM_DOMAINS = [
  'sharklasers.com', 'spam4.me', 'grr.la',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamail.de',
  'guerrillamail.net', 'guerrillamailblock.com',
];
let gmDomainIdx   = 0;
let gmBlocked     = false; // set true when ANY guerrillamail domain hits "not possible to register"
let mailTmBlocked = false; // set true when mail.tm (wshu.net) hits "not possible to register"

// Less-known fallback providers — not yet on Serper's blocklist
// mailnesia has no API but exposes inbox via simple HTML (no JS needed)
let mailnesiaBlocked  = false;
let mohmalBlocked     = false;
let dispostableBlocked = false;
let yopmailBlocked    = false; // set true when yopmail also hits "not possible to register"
let dropmailBlocked   = false;
let maildropBlocked   = false;
let dropmailSessionId = '';

let getuduDomainIdx     = 0;  // which domain index to use in the getedumail <select>
let geteduDomainOptions = []; // populated on first openGetedumail call

async function getTempEmail() {
  const login = 'usr' + Math.floor(Math.random() * 9999999);
  activeLogin = login;

  // Custom domain override — set KEYGEN_CUSTOM_EMAIL env var to bypass all temp-mail providers
  if (process.env.KEYGEN_CUSTOM_EMAIL) {
    activeEmail    = process.env.KEYGEN_CUSTOM_EMAIL;
    activeLogin    = activeEmail.split('@')[0];
    activeProvider = 'custom';
    console.log(`[TempMail] Custom email (env): ${activeEmail}`);
    return activeEmail;
  }

  // Guerrillamail first — reliable sid_token API (skip if already blocked by Serper)
  if (!gmBlocked) {
    const domain = GM_DOMAINS[gmDomainIdx++ % GM_DOMAINS.length];
    try {
      const r = await axiosNoVerify.get(
        `https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${login}&lang=en&site=${domain}`,
        { timeout: 8000 }
      );
      gmSidToken     = r.data.sid_token || '';
      activeProvider = 'guerrilla';
      activeEmail    = `${login}@${domain}`;
      console.log(`[TempMail] guerrilla (${domain}): ${activeEmail}`);
      return activeEmail;
    } catch {}
  }

  // mail.tm second — skip if already blocked by Serper
  if (!mailTmBlocked) {
    try {
      const domainsRes = await axiosNoVerify.get('https://api.mail.tm/domains', { timeout: 10000 });
      const domains = domainsRes.data['hydra:member'] || [];
      if (domains.length) {
        const tmDomain = domains[0].domain;
        const tmPass   = 'P@ss' + Math.floor(Math.random() * 999999) + '!';
        const tmAddr   = `${login}@${tmDomain}`;
        await axiosNoVerify.post('https://api.mail.tm/accounts', { address: tmAddr, password: tmPass }, { timeout: 10000 });
        const tok = await axiosNoVerify.post('https://api.mail.tm/token', { address: tmAddr, password: tmPass }, { timeout: 10000 });
        mailTmToken    = tok.data.token;
        activeProvider = 'mailtm';
        activeEmail    = tmAddr;
        console.log(`[TempMail] mail.tm: ${tmAddr}`);
        return tmAddr;
      }
    } catch {}
  }

  // mailnesia.com — no JS needed, URL-based inbox, not widely blocklisted
  if (!mailnesiaBlocked) {
    activeProvider = 'mailnesia';
    activeEmail    = `${login}@mailnesia.com`;
    console.log(`[TempMail] mailnesia: ${activeEmail}`);
    return activeEmail;
  }

  // mohmal.com — simple temp mail, not widely known
  if (!mohmalBlocked) {
    try {
      const r = await axiosNoVerify.get(`https://api.mohmal.com/en/email`, { timeout: 10000 });
      if (r.data && r.data.address) {
        activeProvider = 'mohmal';
        activeEmail    = r.data.address;
        activeLogin    = r.data.address.split('@')[0];
        console.log(`[TempMail] mohmal: ${activeEmail}`);
        return activeEmail;
      }
    } catch {}
    // Fallback: construct address manually
    activeProvider = 'mohmal';
    activeEmail    = `${login}@mohmal.com`;
    console.log(`[TempMail] mohmal (manual): ${activeEmail}`);
    return activeEmail;
  }

  // dispostable.com — another obscure provider
  if (!dispostableBlocked) {
    activeProvider = 'dispostable';
    activeEmail    = `${login}@dispostable.com`;
    console.log(`[TempMail] dispostable: ${activeEmail}`);
    return activeEmail;
  }

  // Yopmail — last resort (likely blocked, but delivery may still work for some accounts)
  if (!yopmailBlocked) {
    activeProvider = 'yopmail';
    activeEmail    = `${login}@yopmail.com`;
    console.log(`[TempMail] yopmail (last resort): ${activeEmail}`);
    return activeEmail;
  }

  // dropmail.me — anonymous GraphQL-based inbox, relatively obscure
  if (!dropmailBlocked) {
    try {
      const r = await axiosNoVerify.post(
        'https://dropmail.me/api/graphql/web-test-wGNPFj0p',
        { query: 'mutation { introduceSession { id, addresses { address } } }' },
        { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
      );
      const addr = r.data?.data?.introduceSession?.addresses?.[0]?.address;
      if (addr) {
        dropmailSessionId = r.data.data.introduceSession.id;
        activeProvider    = 'dropmail';
        activeEmail       = addr;
        activeLogin       = addr.split('@')[0];
        console.log(`[TempMail] dropmail.me: ${addr}`);
        return addr;
      }
    } catch {}
  }

  // maildrop.cc — username-based inbox, no signup, not widely blocklisted
  if (!maildropBlocked) {
    const mdLogin = 'serper' + Math.floor(Math.random() * 99999);
    activeProvider = 'maildrop';
    activeEmail    = `${mdLogin}@maildrop.cc`;
    activeLogin    = mdLogin;
    console.log(`[TempMail] maildrop.cc: ${activeEmail}`);
    return activeEmail;
  }

  // All providers exhausted
  console.log('[TempMail] ❌ ALL providers blocked — cannot get a temp email this run');
  return null;
}

async function checkEmails() {
  try {
    // Providers with no JSON API — signal caller to use browser-based check
    // getedumail is included because checkGetedumail() already polls its tab — no need to
    // double-poll via the mail.tm fall-through branch below.
    if (['yopmail', 'mailnesia', 'mohmal', 'dispostable', 'getedumail'].includes(activeProvider)) {
      return [];
    }
    if (activeProvider === 'inboxkitten') {
      const r = await axiosNoVerify.get(`https://inboxkitten.com/api/v1/inbox/list?recipient=${activeLogin}`, { timeout: 10000 });
      return Array.isArray(r.data) ? r.data : [];
    }
    if (activeProvider === 'guerrilla') {
      const r = await axiosNoVerify.get(
        `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${gmSidToken}`,
        { timeout: 10000 }
      );
      return r.data?.list || [];
    }
    if (activeProvider === 'dropmail') {
      if (!dropmailSessionId) return [];
      const r = await axiosNoVerify.post(
        'https://dropmail.me/api/graphql/web-test-wGNPFj0p',
        { query: `query { session(id: "${dropmailSessionId}") { mails { fromAddr, downloadUrl, text } } }` },
        { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
      );
      return r.data?.data?.session?.mails || [];
    }
    if (activeProvider === 'maildrop') {
      const r = await axiosNoVerify.get(`https://maildrop.cc/v2/mailbox/${activeLogin}`, { timeout: 10000 });
      return Array.isArray(r.data) ? r.data : [];
    }
    if (activeProvider === 'custom') return []; // custom: no API, browser check handles it
    const res = await axiosNoVerify.get('https://api.mail.tm/messages', {
      headers: { Authorization: `Bearer ${mailTmToken}` }, timeout: 10000,
    });
    return res.data['hydra:member'] || [];
  } catch (e) {
    if (e.response?.status === 429) await sleep(5000);
    return [];
  }
}

async function getEmailBody(msg) {
  try {
    if (activeProvider === 'inboxkitten') {
      const r = await axiosNoVerify.get(
        `https://inboxkitten.com/api/v1/inbox/get?recipient=${activeLogin}&uid=${msg.uid}`,
        { timeout: 10000 }
      );
      return r.data?.body || r.data?.text || JSON.stringify(r.data);
    }
    if (activeProvider === 'guerrilla') {
      const r = await axiosNoVerify.get(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${msg.mail_id}&sid_token=${gmSidToken}`,
        { timeout: 10000 }
      );
      const raw = r.data?.mail_body || r.data?.mail_excerpt || '';
      return raw.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }
    if (activeProvider === 'dropmail') {
      if (msg.text) return msg.text;
      if (!msg.downloadUrl) return '';
      const r = await axiosNoVerify.get(msg.downloadUrl, { timeout: 10000 });
      return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    }
    if (activeProvider === 'maildrop') {
      const r = await axiosNoVerify.get(
        `https://maildrop.cc/v2/mailbox/${activeLogin}/message/${msg.id}`,
        { timeout: 10000 }
      );
      return r.data?.body || r.data?.html || JSON.stringify(r.data);
    }
    const res = await axiosNoVerify.get(`https://api.mail.tm/messages/${msg.id}`, {
      headers: { Authorization: `Bearer ${mailTmToken}` }, timeout: 10000,
    });
    return res.data.text || res.data.html || '';
  } catch { return ''; }
}

// ── Ghost-cursor click (human Bezier path to element) ────────────────────────
async function ghostClick(cursor, page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    await cursor.click(selector);
    return true;
  } catch { return false; }
}

// ── Human-like type into an ElementHandle ────────────────────────────────────
async function humanType(element, text) {
  await element.click({ clickCount: 3 }); // select all
  await jitter(100, 200);
  for (const char of text) {
    await element.type(char, { delay: 45 + Math.random() * 85 });
  }
}

// ── Move cursor to element via bounding box coords ───────────────────────────
// ghost-cursor only accepts CSS selectors or ElementHandles, not {x,y} objects
// so we use page.mouse.move with steps to simulate the bezier-like path
async function cursorMoveTo(cursor, page, el) {
  try {
    const box = await el.boundingBox();
    if (!box) return;
    const x = box.x + box.width  / 2 + (Math.random() - 0.5) * 6;
    const y = box.y + box.height / 2 + (Math.random() - 0.5) * 6;
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
  } catch {}
}

// ── Fill signup form ──────────────────────────────────────────────────────────
async function fillForm(page, cursor, email) {
  // Single page.evaluate() call — avoids per-element CDP round-trips timing out under NopeCHA
  const count = await page.evaluate((email) => {
    const all = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')];
    const visible = all.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (visible.length < 2) return 0;
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    const fields = visible.length >= 4
      ? ['Mark', 'Wilson', email, 'Solarsales123!', visible[4] ? 'Solarsales123!' : null]
      : [email, 'Solarsales123!'];
    let n = 0;
    for (let i = 0; i < fields.length; i++) {
      const val = fields[i]; if (!val || !visible[i]) continue;
      visible[i].focus();
      if (nativeSet) nativeSet.call(visible[i], val); else visible[i].value = val;
      visible[i].dispatchEvent(new Event('input',  { bubbles: true }));
      visible[i].dispatchEvent(new Event('change', { bubbles: true }));
      visible[i].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      visible[i].dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true }));
      n++;
    }
    return n;
  }, email).catch(() => 0);

  console.log(`   [Form] Filled ${count} fields`);
  return count > 0;
}

// ── Click button by text label ────────────────────────────────────────────────
async function clickButton(page, cursor, text) {
  // Use page.evaluate to click directly — avoids ElementHandle cross-context issues
  const clicked = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button,input[type="submit"]')]
      .find(b => (b.textContent || b.value || '').includes(t) && !b.disabled);
    if (!btn) return false;
    // Move cursor visually via cursor API isn't possible here, so just click
    btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true }));
    btn.click();
    return true;
  }, text).catch(() => false);
  return clicked;
}

// ── Log all frames (debug helper) ────────────────────────────────────────────
function logFrames(page) {
  const urls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
  console.log('   [Frames]', urls.join(' | ').slice(0, 300));
}

// ── Google reCAPTCHA v2 audio bypass via wit.ai ──────────────────────────────
// Returns: true (solved), false (failed), 'ROTATE_IP' (blocked exit, need new Tor circuit)
async function solveRecaptchaV2(page) {
  if (!WIT_API_KEY) return false;

  // For invisible reCAPTCHA (size=invisible): only trust the token.
  // Bframe disappears temporarily during reload-button navigation → false positive if we use bframe absence.
  const isSolvedInvisible = async () => {
    const token = await page.evaluate(() => {
      const el = document.querySelector('[name="g-recaptcha-response"]');
      return el?.value || '';
    }).catch(() => '');
    return token.length > 20;
  };

  // Step 0: Click the anchor checkbox if it hasn't been clicked yet.
  // Without this, the bframe (challenge) never appears and audio bypass has nothing to work with.
  const anchorFrame = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor'));
  if (anchorFrame) {
    const isChecked = await anchorFrame.evaluate(() => {
      const el = document.querySelector('#recaptcha-anchor');
      return el?.getAttribute('aria-checked') === 'true';
    }).catch(() => false);

    if (!isChecked) {
      console.log('   [reCAPTCHA] Clicking anchor checkbox...');
      await anchorFrame.evaluate(() => {
        document.querySelector('#recaptcha-anchor')?.click();
      }).catch(() => {});
      await sleep(4000);

      if (await isSolvedInvisible()) {
        console.log('   [reCAPTCHA] Auto-passed after checkbox click!');
        return true;
      }
      console.log('   [reCAPTCHA] Challenge appeared — proceeding to audio bypass...');
    }
  }

  let expiredCount = 0;
  let audioClickFails = 0; // bail if audio button click never loads audio
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // Fresh bframe lookup each attempt
      let bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));

      if (!bframe) {
        // No bframe — check if already solved (invisible reCAPTCHA token)
        if (await isSolvedInvisible()) { console.log('   [reCAPTCHA] Already solved.'); return true; }
        console.log('   [reCAPTCHA] No bframe — waiting up to 5s for challenge to appear...');
        for (let w = 0; w < 5; w++) {
          await sleep(1000);
          bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
          if (bframe) break;
        }
        if (!bframe) return false;
      }

      // Check for hard-block "Try again later" — need a different exit IP
      const hardBlocked = await bframe.evaluate(() =>
        document.body?.innerText?.includes('Try again later') || false
      ).catch(() => false);
      if (hardBlocked) {
        console.log('   [reCAPTCHA] Hard-blocked on this exit IP — requesting circuit rotation');
        return 'ROTATE_IP';
      }

      // bframe open — switch to audio if not already there
      const alreadyInAudio = await bframe.$('#audio-response').catch(() => null);
      if (!alreadyInAudio) {
        if (audioClickFails >= 3) {
          console.log('   [reCAPTCHA] Audio button not responding after 3 clicks — bailing');
          return false;
        }
        console.log('   [reCAPTCHA] bframe found — switching to audio...');
        // Use bframe.evaluate to dispatch events — avoids NopeCHA debugger intercepting CDP clicks
        const clicked = await bframe.evaluate(() => {
          const btn = document.querySelector('#recaptcha-audio-button') ||
                      document.querySelector('button[title*="audio" i]') ||
                      document.querySelector('.rc-button-audio');
          if (!btn) return false;
          btn.focus();
          btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
          btn.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
          return true;
        }).catch(() => false);
        if (!clicked) { console.log('   [reCAPTCHA] No audio button in bframe'); await sleep(1000); continue; }
        audioClickFails++;
        await sleep(3000);
        // Re-fetch bframe after click — may have refreshed
        bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
        if (!bframe) {
          if (await isSolvedInvisible()) { console.log('   [reCAPTCHA] Solved after audio click!'); return true; }
          await sleep(1500);
          continue;
        }
      } else {
        audioClickFails = 0; // reset — audio IS loading, button click worked
        console.log('   [reCAPTCHA] Already in audio challenge — proceeding...');
      }

      // Get MP3 URL
      const getAudioSrc = async (f) => {
        if (!f) return null;
        return f.evaluate(() => {
          const dl  = document.querySelector('.rc-audiochallenge-tdownload-link');
          const src = document.querySelector('#audio-source');
          return dl?.href || src?.src || null;
        }).catch(() => null);
      };
      let audioSrc = await getAudioSrc(bframe);
      if (!audioSrc) {
        console.log('   [reCAPTCHA] No audio src — waiting for challenge to load...');
        for (let w = 0; w < 6; w++) {
          await sleep(1500);
          bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
          audioSrc = await getAudioSrc(bframe);
          if (audioSrc) break;
        }
        if (!audioSrc) {
          const bframeText = bframe ? await bframe.evaluate(() => document.body?.innerText?.slice(0, 200) || '').catch(() => '') : '(no frame)';
          console.log(`   [reCAPTCHA] Still no audio src. bframe text: "${bframeText}"`);
          await sleep(1000); continue;
        }
      }

      console.log('   [reCAPTCHA Audio] Downloading MP3...');
      const audioRes = await axiosNoVerify.get(audioSrc, {
        responseType: 'arraybuffer', timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
          'Referer': 'https://www.google.com/',
        },
      });
      const audioBuf = Buffer.from(audioRes.data);
      console.log(`   [reCAPTCHA Audio] Downloaded ${audioBuf.length} bytes, header: ${audioBuf.slice(0,4).toString('hex')}`);

      console.log('   [reCAPTCHA Audio] Sending to wit.ai...');
      let witRes;
      try {
        witRes = await axiosNoVerify.post('https://api.wit.ai/speech?v=20220622', audioBuf, {
          headers: {
            Authorization: `Bearer ${WIT_API_KEY}`,
            'Content-Type': 'audio/mpeg',
            'Transfer-Encoding': 'chunked',
          },
          timeout: 20000,
        });
      } catch (witErr) {
        console.log(`   [reCAPTCHA Audio] wit.ai HTTP error: ${witErr.response?.status} ${JSON.stringify(witErr.response?.data || '').slice(0, 150)}`);
        await sleep(1000); continue;
      }

      const raw = typeof witRes.data === 'string' ? witRes.data : JSON.stringify(witRes.data);
      console.log(`   [reCAPTCHA Audio] wit.ai raw (100 chars): ${raw.slice(0, 100)}`);
      const matches = [...raw.matchAll(/"text"\s*:\s*"([^"]+)"/g)];
      const transcript = matches.length ? matches[matches.length - 1][1].trim().toLowerCase() : '';
      if (!transcript) {
        console.log('   [reCAPTCHA Audio] No transcript — reloading challenge for fresh audio...');
        bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
        if (bframe) {
          await bframe.evaluate(() => { document.querySelector('#recaptcha-reload-button')?.click(); }).catch(() => {});
          await sleep(3000);
        }
        continue;
      }
      console.log(`   [reCAPTCHA Audio] Transcript: "${transcript}"`);

      // Re-find bframe before typing (may have refreshed)
      bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
      if (!bframe) { console.log('   [reCAPTCHA] bframe gone before answer input'); await sleep(1000); continue; }

      // Use bframe.evaluate for all input/click ops — avoids CDP ElementHandle timeouts under NopeCHA
      const typed = await bframe.evaluate((t) => {
        const inp = document.querySelector('#audio-response');
        if (!inp) return false;
        inp.focus();
        inp.select();
        const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeSet) nativeSet.call(inp, t); else inp.value = t;
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }, transcript).catch(() => false);
      if (!typed) { await sleep(1000); continue; }
      await sleep(600);

      await bframe.evaluate(() => {
        const btn = document.querySelector('#recaptcha-verify-button');
        if (btn) btn.click();
      }).catch(() => {});
      await sleep(3000);

      // Solved check — invisible reCAPTCHA: token or bframe gone
      if (await isSolvedInvisible()) { console.log('   [reCAPTCHA] SOLVED!'); return true; }
      console.log(`   [reCAPTCHA] Not solved on attempt ${attempt + 1} — resetting via anchor for fresh challenge...`);
      // Reload button serves the same audio clip (cached) — same transcript → guaranteed failure.
      // Instead: uncheck then re-check the anchor so reCAPTCHA issues a brand-new challenge instance.
      try {
        const anchorReset = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('anchor'));
        if (anchorReset) {
          await anchorReset.evaluate(() => document.querySelector('#recaptcha-anchor')?.click()).catch(() => {});
          await sleep(1500);
          await anchorReset.evaluate(() => document.querySelector('#recaptcha-anchor')?.click()).catch(() => {});
          await sleep(3500);
        } else {
          // Anchor gone — fall back to reload button as last resort
          bframe = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
          if (bframe) {
            await bframe.evaluate(() => document.querySelector('#recaptcha-reload-button')?.click()).catch(() => {});
            await sleep(3500);
          }
        }
      } catch (_) {}
      await sleep(1000);
    } catch (e) {
      console.log(`   [reCAPTCHA] Error (attempt ${attempt + 1}): ${e.message}`);
      const is410 = e.response?.status === 410 || e.message?.includes('410');
      const isTimeout = e.message?.includes('timeout');
      if (is410 || isTimeout) {
        expiredCount++;
        console.log('   [reCAPTCHA] Audio URL expired/timeout — reloading challenge...');
        try {
          const bframeNow = page.frames().find(f => f.url().includes('recaptcha') && f.url().includes('bframe'));
          if (bframeNow) {
            const reloadBtn = await bframeNow.$('#recaptcha-reload-button').catch(() => null);
            if (reloadBtn) {
              await reloadBtn.click().catch(() => {});
              await sleep(3500);
            }
          }
        } catch (_) {}
      }
      await sleep(2000);
    }
  }
  if (expiredCount >= 3) return 'RELOAD';
  return false;
}

// ── Cloudflare Turnstile ──────────────────────────────────────────────────────
// Returns 'ROTATE_IP' if CF shows an image/interactive challenge we can't solve
async function handleTurnstile(page, cursor) {
  try {
    const cfFrame = page.frames().find(f => f.url().includes('challenges.cloudflare.com'));
    if (!cfFrame) return;

    const bodyText = await Promise.race([
      cfFrame.evaluate(() => document.body?.innerText || ''),
      sleep(3000).then(() => '')
    ]).catch(() => '');

    if (bodyText.includes('Verification failed')) {
      console.log('   [Turnstile] Verification failed — reloading widget...');
      await page.evaluate(() => { if (window.turnstile) window.turnstile.reset(); }).catch(() => {});
      await sleep(2000);
      return;
    }

    // Click the checkbox
    const cb = await cfFrame.$('input[type="checkbox"]');
    if (cb) {
      const box = await cb.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
        await jitter(200, 400);
        await cb.click();
        await sleep(3000);
      }
    }

    // After click — check if CF now shows an interactive image challenge (unsolvable)
    const afterText = await Promise.race([
      cfFrame.evaluate(() => document.body?.innerText || ''),
      sleep(3000).then(() => '')
    ]).catch(() => '');
    if (afterText.includes('challenge') || afterText.includes('select all') || afterText.includes('images')) {
      console.log('   [Turnstile] Interactive image challenge — need IP rotation');
      return 'ROTATE_IP';
    }
  } catch {}
}

// ── Browser-based inbox check (fallback when API fails) ──────────────────────
async function checkEmailsInBrowser(browser, email, provider, sidToken, login) {
  let tab;
  try {
    tab = await browser.newPage();
    let inboxUrl;
    if (provider === 'guerrilla') {
      inboxUrl = `https://www.guerrillamail.com/inbox`;
    } else if (provider === 'yopmail') {
      inboxUrl = `https://yopmail.com/en/mail.php?login=${login}&p=1`;
    } else if (provider === 'mailnesia') {
      inboxUrl = `https://mailnesia.com/mailbox/${login}`;
    } else if (provider === 'mohmal') {
      inboxUrl = `https://www.mohmal.com/en/inbox`;
    } else if (provider === 'dispostable') {
      inboxUrl = `https://www.dispostable.com/inbox/${login}`;
    } else if (provider === 'dropmail') {
      inboxUrl = `https://dropmail.me/`;
    } else if (provider === 'maildrop') {
      inboxUrl = `https://maildrop.cc/inbox/${login}`;
    } else if (provider === 'custom') {
      try { await tab.close(); } catch {}
      return null;
    } else if (provider === 'mailtm') {
      // mail.tm web inbox requires login auth — skip browser fallback, the token API is the only path
      try { await tab.close(); } catch {}
      return null;
    } else {
      inboxUrl = `https://inboxkitten.com/ui/${login}/list`;
    }

    await tab.goto(inboxUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(3000);
    const html = await tab.content();
    // Look for Serper verification link directly in page HTML
    const linkMatch = html.match(/https:\/\/serper\.dev\/verify-email\?token=[a-zA-Z0-9_=-]+/);
    if (linkMatch) {
      console.log('[TempMail] Verification link found in browser inbox!');
      await tab.close().catch(() => {});
      return linkMatch[0];
    }

    // For guerrilla: use the sid_token API to get email body
    if (provider === 'guerrilla' && sidToken) {
      const r = await axiosNoVerify.get(
        `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${sidToken}`,
        { timeout: 10000 }
      ).catch(() => null);
      const list = r?.data?.list || [];
      for (const msg of list) {
        if (!String(msg.mail_subject || '').toLowerCase().includes('serper')) continue;
        const bodyRes = await axiosNoVerify.get(
          `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${msg.mail_id}&sid_token=${sidToken}`,
          { timeout: 10000 }
        ).catch(() => null);
        const body = bodyRes?.data?.mail_body || '';
        const lm = body.match(/https:\/\/serper\.dev\/verify-email\?token=[^\s'"<]+/);
        if (lm) { await tab.close().catch(() => {}); return lm[0]; }
      }
    }
  } catch (e) {
    console.log(`[TempMail] Browser inbox check error: ${e.message}`);
  }
  try { await tab?.close(); } catch {}
  return null;
}

// ── Getedumail: browser-based .edu temp email ────────────────────────────────
async function openGetedumail(browser) {
  try {
    geteduTab = await browser.newPage();

    // Clear getedumail session from previous runs so the creation form appears, not the cached dashboard
    await geteduTab.goto('https://getedumail.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await geteduTab.evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
    }).catch(() => {});
    const geCookies = await geteduTab.cookies().catch(() => []);
    if (geCookies.length) {
      await Promise.all(geCookies.map(c => geteduTab.deleteCookie(c))).catch(() => {});
    }
    console.log('[GeteduMail] Session cleared — reloading for fresh creation form...');
    await geteduTab.goto('https://getedumail.com', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2000);

    // Fill username — try name attr first, then placeholder, then first visible text input
    const username = 'usr' + Math.floor(Math.random() * 9999999);
    const filled = await geteduTab.evaluate((uname) => {
      const candidates = [
        document.querySelector('input[name="username"]'),
        document.querySelector('input[placeholder*="sername" i]'),
        document.querySelector('input[placeholder*="user" i]'),
        [...document.querySelectorAll('input[type="text"]')].find(el => el.offsetParent !== null),
      ];
      const inp = candidates.find(Boolean);
      if (!inp) return false;
      inp.focus();
      // nativeInputValueSetter triggers React/Vue state so the "Create" button enables
      const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSet) nativeSet.call(inp, uname); else inp.value = uname;
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true }));
      inp.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      return true;
    }, username);
    if (!filled) { console.log('[GeteduMail] Could not find username input'); await geteduTab.close().catch(() => {}); geteduTab = null; return null; }

    await sleep(500);

    // Enumerate domain options, then pick by getuduDomainIdx
    const domainOpts = await geteduTab.evaluate(() => {
      const sel = document.querySelector('select');
      if (!sel) return [];
      return [...sel.options].map(o => (o.value || o.text || '').trim()).filter(Boolean);
    }).catch(() => []);
    if (domainOpts.length) geteduDomainOptions = domainOpts;
    const domainIdx = getuduDomainIdx % Math.max(geteduDomainOptions.length || domainOpts.length, 1);
    await geteduTab.evaluate((idx) => {
      const sel = document.querySelector('select');
      if (sel && sel.options.length > idx) {
        sel.selectedIndex = idx;
        // Dispatch events so React/Vue state picks up the selection change
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input',  { bubbles: true }));
      }
    }, domainIdx).catch(() => {});
    if (domainOpts.length) {
      console.log(`[GeteduMail] Domains available: ${domainOpts.join(', ')} — using index ${domainIdx} (${domainOpts[domainIdx] || '?'})`);
    }

    // Wait up to 4s for "is available" confirmation to appear (React validates async)
    let available = false;
    for (let w = 0; w < 8; w++) {
      await sleep(500);
      available = await geteduTab.evaluate(() =>
        document.body.innerText.includes('is available')
      ).catch(() => false);
      if (available) break;
    }
    console.log(`[GeteduMail] Address available: ${available}`);

    // Click via coordinates — dispatchEvent doesn't fire React onClick
    const btnRect = await geteduTab.evaluate(() => {
      const btn = [...document.querySelectorAll('button, input[type="submit"]')]
        .find(b => /create|get|generate/i.test(b.textContent || b.value || ''));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }).catch(() => null);

    if (btnRect) {
      console.log(`[GeteduMail] Clicking button at (${Math.round(btnRect.x)}, ${Math.round(btnRect.y)})`);
      await geteduTab.mouse.click(btnRect.x, btnRect.y);
    } else {
      // Fallback: form submit
      await geteduTab.evaluate(() => { const f = document.querySelector('form'); if (f) f.submit(); });
    }

    // Wait up to 6s for the email to appear somewhere on the page
    let email = null;
    for (let w = 0; w < 6; w++) {
      await sleep(1000);
      email = await geteduTab.evaluate(() => {
        // Strategy 1: any input with full email+edu pattern
        for (const inp of document.querySelectorAll('input')) {
          if (inp.value && /\.edu/i.test(inp.value) && inp.value.includes('@')) return inp.value.trim();
        }
        // Strategy 2: page text scan — matches .edu.xx and plain .edu
        const m = document.body.innerText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.edu(?:\.[a-z]{2,})?/i);
        return m ? m[0].trim() : null;
      }).catch(() => null);
      if (email) break;
    }

    if (!email) {
      console.log('[GeteduMail] Could not extract email after form submit');
      return null;
    }

    activeProvider = 'getedumail';
    activeEmail    = email;
    console.log(`[GeteduMail] Got email: ${email}`);
    return email;
  } catch (e) {
    console.log(`[GeteduMail] Error: ${e.message}`);
    try { await geteduTab?.close(); } catch {}
    geteduTab = null;
    return null;
  }
}

async function checkGetedumail() {
  if (!geteduTab || geteduTab.isClosed()) return null;
  try {
    await geteduTab.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await sleep(1500);

    // Direct link scan
    let link = await geteduTab.evaluate(() => {
      const a = document.querySelector('a[href*="serper.dev/verify"]');
      if (a) return a.href;
      const m = document.body.innerHTML.match(/https:\/\/serper\.dev\/verify-email\?token=[^\s'"<>&]+/);
      return m ? m[0] : null;
    });
    if (link) return link;

    // Click on inbox row mentioning serper, then re-scan
    const clicked = await geteduTab.evaluate(() => {
      const rows = [...document.querySelectorAll('tr, li, [class*="row"], [class*="item"], [class*="mail"], [class*="message"]')];
      const row = rows.find(r => /serper/i.test(r.textContent || ''));
      if (!row) return false;
      row.click();
      return true;
    });
    if (clicked) {
      await sleep(2000);
      link = await geteduTab.evaluate(() => {
        const a = document.querySelector('a[href*="serper.dev/verify"]');
        if (a) return a.href;
        const m = document.body.innerHTML.match(/https:\/\/serper\.dev\/verify-email\?token=[^\s'"<>&]+/);
        return m ? m[0] : null;
      });
    }
    return link || null;
  } catch (e) {
    console.log(`[GeteduMail] Inbox check error: ${e.message}`);
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function generateSerperKey() {
  if (!acquireLock()) {
    console.log('[Auto-Key] Already running.');
    return null;
  }

  // Reset per-run block flags so each fresh run tries all providers again.
  // (module-level vars persist across monitor.js restarts via require() cache)
  gmBlocked          = false;
  mailTmBlocked      = false;
  mailnesiaBlocked   = false;
  mohmalBlocked      = false;
  dispostableBlocked = false;
  yopmailBlocked     = false;
  dropmailBlocked    = false;
  maildropBlocked    = false;
  dropmailSessionId  = '';
  gmDomainIdx        = 0;
  getuduDomainIdx    = 0;
  geteduDomainOptions = [];

  loadStrikes(); // pull persisted dup-counter + pause state from disk

  if (Date.now() < _pausedUntil) {
    const mins = Math.ceil((_pausedUntil - Date.now()) / 60000);
    console.log(`[Keygen] ⏸  Paused — ${mins}m remaining. Skipping.`);
    releaseLock();
    return null;
  }

  // Windscribe VPN — OS-level routing, Chrome gets VPN IP without --proxy-server
  // Only renewCircuit if we're already connected (previous run left it up) — otherwise
  // startTor already connects to a fresh location for us.
  let wasAlreadyConnected = false;
  try {
    const wsStatus = require('child_process').execSync(
      '"C:\\Program Files\\Windscribe\\windscribe-cli.exe" status',
      { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: 'pipe' }
    ).toString().toLowerCase();
    wasAlreadyConnected = wsStatus.includes('connect state: connected');
  } catch { /* CLI hung / missing / SSL error — proceed without rotation hint */ }
  await ws.startTor().catch(e => console.log('[Windscribe] Startup skipped:', e.message));
  if (wasAlreadyConnected) {
    await ws.renewCircuit().catch(() => {}); // already connected → rotate for fresh IP
  }

  console.log('\n[Auto-Key] Starting...');
  let email = await getTempEmail(); // fallback — overridden by getedumail if it succeeds
  console.log(`[Auto-Key] Fallback email ready: ${email}`);

  // Kill any stale Brave process still holding the profile lock (from a prior crashed session)
  const { execSync } = require('child_process');
  try {
    const wmicOut = execSync(
      'wmic process where "name=\'brave.exe\'" get ProcessId,CommandLine /format:csv 2>nul',
      { encoding: 'utf8', timeout: 8000 }
    );
    for (const line of wmicOut.split('\n')) {
      if (line.includes('serper_profile') && line.includes(',')) {
        const pid = line.split(',')[1]?.trim();
        if (pid && /^\d+$/.test(pid)) {
          execSync(`taskkill /F /PID ${pid} 2>nul`, { timeout: 3000 });
          console.log(`[Auto-Key] Killed stale Brave PID ${pid}`);
        }
      }
    }
  } catch {}

  // Clear stale profile locks and session restore (prevent Chrome reopening old audio challenge page)
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
  }
  for (const f of ['Current Session', 'Last Session', 'Current Tabs', 'Last Tabs']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, 'Default', f)); } catch {}
  }

  // Fingerprint injection disabled — native Chrome fingerprint is more consistent
  // Re-enable if stealth improves: const fingerprint = generator.getFingerprint()
  const fingerprint = null;

  const NOPECHA_EXT = path.join(ROOT, '.nopecha_ext');
  const hasNopecha = fs.existsSync(NOPECHA_EXT);
  if (hasNopecha) console.log('🤖 [Auto-Key] NopeCHA extension loaded — CAPTCHA will be auto-solved.');

  const browser = await puppeteer.launch({
    executablePath:   CHROME_PATH,
    userDataDir:      PROFILE_DIR,
    headless:         false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1280,800',
      '--start-maximized',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-features=IsolateOrigins,site-per-process',
      // Windscribe routes at OS level — no --proxy-server flag needed.
      // (proxy-gateway not available in CLI v2.21.7; ip rotate requires Pro)
      ...(hasNopecha ? [
        `--disable-extensions-except=${NOPECHA_EXT}`,
        `--load-extension=${NOPECHA_EXT}`,
      ] : []),
    ],
    defaultViewport: null,
    protocolTimeout: 120000,
  });

  const pages = await browser.pages();
  const page  = pages.length > 0 ? pages[0] : await browser.newPage();

  // Inject fingerprint
  if (fingerprint) {
    try {
      const injector = new FingerprintInjector.FingerprintInjector();
      await injector.attachFingerprintToPuppeteer(page, fingerprint);
      console.log('[Fingerprint] Injected into page');
    } catch (e) {
      console.log(`[Fingerprint] Injection skipped: ${e.message}`);
    }
  }

  // Additional webdriver hiding
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Ghost cursor for human-like mouse paths
  const cursor = createCursor(page);

  try {
    // Warm up profile with legit sites so CF sees real cookies
    console.log('[Auto-Key] Warming up profile (Google → HN)...');
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await jitter(3000, 5000);
    await page.mouse.move(300 + Math.random() * 400, 200 + Math.random() * 300, { steps: 15 });
    await jitter(1500, 3000);
    await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await jitter(2000, 3500);

    console.log('[Auto-Key] Navigating to serper.dev/signup...');
    await page.goto('https://serper.dev/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await jitter(4000, 6000); // Let Turnstile initialize and auto-verify

    // Try getedumail for a .edu address — overrides API fallback if successful (25s hard timeout)
    // Guard against side-effect leaks: if timeout wins, the background openGetedumail may still
    // overwrite activeProvider/activeEmail/geteduTab — we revert those changes if that happens.
    let eduDone = false;
    const fallbackEmail = email;
    const eduEmail = await Promise.race([
      openGetedumail(browser).then(e => { eduDone = true; return e; })
                              .catch(e => { eduDone = true; console.log('[GeteduMail] Failed:', e.message); return null; }),
      sleep(25000).then(() => null),
    ]);
    if (!eduDone) {
      console.log('[GeteduMail] Timeout — using fallback email, scheduling orphan tab cleanup');
      const orphan = geteduTab;
      geteduTab = null;
      // Revert provider state in case the in-flight openGetedumail later overwrites it
      if (activeProvider === 'getedumail') {
        activeProvider = '';
        activeEmail    = fallbackEmail;
      }
      setTimeout(() => { try { orphan?.close(); } catch {} }, 30000);
    } else if (eduEmail) {
      email = eduEmail;
    }
    console.log(`[Auto-Key] Using email: ${email} (provider: ${activeProvider})`);

    // Natural mouse warmup — move around before interacting
    await page.mouse.move(400 + Math.random() * 200, 200 + Math.random() * 100, { steps: 12 });
    await jitter(500, 1000);

    // Accept cookies if present
    await clickButton(page, cursor, 'Accept').catch(() => {});
    await jitter(600, 1200);

    const filled = await fillForm(page, cursor, email);
    if (filled) {
      // Log all hidden inputs to find the correct CF token field name
      const hiddenInputs = await page.evaluate(() =>
        [...document.querySelectorAll('input[type="hidden"],input[name*="turn"],input[name*="cf-"],input[name*="captcha"]')]
          .map(i => `${i.name}=${i.value?.slice(0,30)}`)
      ).catch(() => []);
      if (hiddenInputs.length) console.log('[Auto-Key] Hidden inputs:', hiddenInputs.join(', '));

      // Wait up to 30s for Turnstile to auto-verify
      console.log('[Auto-Key] Waiting for Turnstile auto-verify...');
      let turnstilePassed = false;
      for (let t = 0; t < 30; t++) {
        const token = await page.evaluate(() => {
          // Check all hidden inputs for any non-empty value (CF token can have different names)
          const all = [...document.querySelectorAll('input[type="hidden"]')];
          const cf  = all.find(i => i.name?.includes('turnstile') || i.name?.includes('cf-') || (i.value?.length > 20));
          return cf?.value || '';
        }).catch(() => '');
        if (token) {
          console.log(`[Auto-Key] Turnstile token received (${token.slice(0,20)}...) — submitting`);
          turnstilePassed = true;
          break;
        }
        await sleep(1000);
      }
      if (!turnstilePassed) console.log('[Auto-Key] Turnstile did not auto-verify after 30s — submitting anyway');

      // Simply submit — if invisible reCAPTCHA is triggered, the widget will pop up
      // and the NopeCHA extension will auto-solve the image challenge.
      await jitter(500, 1000);
      await clickButton(page, cursor, 'Create account');
      await jitter(2000, 3000);
    }

    console.log('[Auto-Key] Monitoring...');
    let newKey = '';
    let screenshotTaken = false;
    let lastSubmitTime = Date.now();

    for (let i = 0; i < 240; i++) {
      if (page.isClosed()) throw new Error('Browser closed.');
      const url   = page.url();
      const title = await page.title().catch(() => '');

      // Detect Google "Try again later" block — use timeout race to prevent CF freeze hang
      const pageText = await Promise.race([
        page.evaluate(() => document.body?.innerText || ''),
        sleep(3000).then(() => '')
      ]).catch(() => '');
      if (pageText.includes('Try again later') || pageText.includes('automated queries')) {
        console.log('🔴 [Auto-Key] Google blocked IP (Try again later). Rotating Windscribe — will restart via monitor...');
        await browser.close().catch(() => {});
        geteduTab = null;
        await ws.renewCircuit();
        // Return null — monitor.js will restart the full function cleanly (avoids stack overflow)
        releaseLock();
        return null;
      }

      if (i % 12 === 0) {
        console.log(`   [${i * 5}s] ${url.slice(0, 65)} | "${title || '(blank)'}"`);
        logFrames(page);
        if (i <= 12 && !screenshotTaken) {
          await page.screenshot({ path: path.join(ROOT, 'keygen_state.png') }).catch(() => {});
          console.log('   [Screenshot] keygen_state.png saved');
          screenshotTaken = true;
        }
      }

      // Cloudflare — only trigger on explicit CF title, not blank SPA title
      if (title.includes('Just a moment') || title.includes('Cloudflare')) {
        await handleTurnstile(page, cursor);
        await jitter(3000, 5000);
        continue;
      }

      // Extension solved detector — check every 3 ticks if reCAPTCHA token appeared.
      // If an extension (or human) solved the puzzle, a non-empty g-recaptcha-response appears.
      // We then click submit immediately to finish the signup.
      // Wait 5 mins (300000) for manual solve before falling back to audio bypass.
      const extWaitDone = (Date.now() - lastSubmitTime) > 300000;
      if (url.includes('signup') && i % 3 === 0 && !extWaitDone) {
        const token = await page.evaluate(() => {
          const el = document.querySelector('[name="g-recaptcha-response"]');
          return el?.value || '';
        }).catch(() => '');
        if (token.length > 20) {
          console.log('🤖 [NopeCHA] reCAPTCHA solved! Submitting form...');
          await clickButton(page, cursor, 'Create account');
          lastSubmitTime = Date.now();
          await jitter(2000, 3000);
        }
      }

      if (url.includes('signup')) {
        // Re-fill if form reset
        const empty = await page.evaluate(() => {
          const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent !== null && el.type !== 'hidden');
          return inputs.length > 0 && inputs.every(el => !el.value);
        }).catch(() => false);
        if (empty) {
          await fillForm(page, cursor, email);
          await jitter(800, 1500);
          await clickButton(page, cursor, 'Create account');
          lastSubmitTime = Date.now();
          await sleep(2000);
        }

        // Domain blocked — rotate email
        const errText = await Promise.race([
          page.evaluate(() => document.body?.innerText || ''),
          sleep(3000).then(() => '')
        ]).catch(() => '');
        if (errText.includes('not possible to register')) {
          if (activeProvider === 'guerrilla')   gmBlocked          = true;
          if (activeProvider === 'mailtm')      mailTmBlocked      = true;
          if (activeProvider === 'mailnesia')   mailnesiaBlocked   = true;
          if (activeProvider === 'mohmal')      mohmalBlocked      = true;
          if (activeProvider === 'dispostable') dispostableBlocked = true;
          if (activeProvider === 'yopmail')     yopmailBlocked     = true;
          if (activeProvider === 'dropmail')    dropmailBlocked    = true;
          if (activeProvider === 'maildrop')    maildropBlocked    = true;
          console.log(`[Serper] Domain blocked (${activeEmail}) — provider=${activeProvider}`);

          // If using getedumail, cycle to the next dropdown domain before falling back
          if (activeProvider === 'getedumail' && geteduDomainOptions.length > 1) {
            getuduDomainIdx++;
            if (getuduDomainIdx < geteduDomainOptions.length) {
              console.log(`[GeteduMail] Trying domain ${geteduDomainOptions[getuduDomainIdx]} (${getuduDomainIdx + 1}/${geteduDomainOptions.length})...`);
              try { await geteduTab?.close(); } catch {}
              geteduTab = null;
              const nextEduEmail = await Promise.race([
                openGetedumail(browser).catch(() => null),
                sleep(20000).then(() => null),
              ]);
              if (nextEduEmail) {
                email = nextEduEmail;
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
                await sleep(4000);
                await fillForm(page, cursor, email);
                await jitter(1000, 2000);
                await clickButton(page, cursor, 'Create account');
                lastSubmitTime = Date.now();
                continue;
              }
            }
            console.log('[GeteduMail] All domains blocked — falling back to API providers');
          }

          // Free the orphan getedumail tab before switching providers (was leaking memory)
          try { await geteduTab?.close(); } catch {}
          geteduTab = null;

          // Fall through: rotate IP + try next API-based provider
          await ws.renewCircuit();
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await sleep(4000);
          const newEmail = await getTempEmail().catch(() => null);
          if (newEmail) {
            email = newEmail; // persist for subsequent re-fill after any further reloads
            await fillForm(page, cursor, email);
            await jitter(1000, 2000);
            await clickButton(page, cursor, 'Create account');
            lastSubmitTime = Date.now();
          }
          continue;
        }

        // Google reCAPTCHA v2 handling:
        // Wait 5 minutes (300s) for manual solve.
        // We'll play a beep so the user knows it's ready.
        if (i % 6 === 0 && (Date.now() - lastSubmitTime) < 300000) {
           process.stdout.write('\x07'); // Terminal beep
           console.log('🚨 [MANUAL ASSIST] Please solve the image puzzle in the browser! Waiting...');
        }
        
        if (url.includes('signup') && i % 3 === 0 && extWaitDone) {
          const captchaResult = await solveRecaptchaV2(page);
          if (captchaResult === 'ROTATE_IP' || captchaResult === false) {
            console.log('[Windscribe] reCAPTCHA failed/hard-blocked — rotating IP...');
            await ws.renewCircuit();
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await sleep(4000);
            continue;
          } else if (captchaResult === 'RELOAD') {
            console.log('[reCAPTCHA] Session expired — reloading page for fresh challenge...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            await sleep(4000);
            await fillForm(page, cursor, email);
            await jitter(800, 1500);
            await clickButton(page, cursor, 'Create account');
            lastSubmitTime = Date.now();
            await sleep(2000);
            continue;
          }
        }

        // Cloudflare Turnstile (separate widget on signup form)
        const tsResult = await handleTurnstile(page, cursor);
        if (tsResult === 'ROTATE_IP') {
          console.log('[Windscribe] Turnstile image challenge — rotating IP...');
          await ws.renewCircuit();
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await sleep(4000);
          continue;
        }
      }

      // Success — also check on home page redirect after signup
      const isPostSignup = url.includes('verify-email') || url.includes('api-keys') ||
        (url === 'https://serper.dev/' || url === 'https://serper.dev');
      if (isPostSignup) {
        if (i % 3 === 0) {
          // Getedumail: browser-tab inbox check (primary when provider === 'getedumail')
          if (activeProvider === 'getedumail' && geteduTab) {
            const verifyLink = await checkGetedumail();
            if (verifyLink) {
              console.log('[Auto-Key] getedumail verification link found — clicking...');
              await page.goto(verifyLink);
              await jitter(4000, 6000);
              await page.goto('https://serper.dev/api-keys');
              await page.waitForSelector('text/API Key', { timeout: 10000 }).catch(() => {});
              const html = await page.content();
              const km   = html.match(/[a-f0-9]{40}/);
              if (km) { newKey = km[0]; break; }
            }
          }

          let emails = await checkEmails();
          // Browser-based fallback for guerrilla / inboxkitten if API returns nothing
          if (!emails.length && i > 3 && activeEmail && activeProvider !== 'getedumail') {
            const verifyLink = await checkEmailsInBrowser(browser, activeEmail, activeProvider, gmSidToken, activeLogin);
            if (verifyLink) {
              console.log('[Auto-Key] Verification link found (browser) — clicking...');
              await page.goto(verifyLink);
              await jitter(4000, 6000);
              await page.goto('https://serper.dev/api-keys');
              await page.waitForSelector('text/API Key', { timeout: 10000 }).catch(() => {});
              const html = await page.content();
              const km   = html.match(/[a-f0-9]{40}/);
              if (km) { newKey = km[0]; break; }
            }
          }
          console.log(`   [Email] ${emails.length} emails in inbox`);
          if (emails.length > 0) {
            const body = await getEmailBody(emails[0]);
            console.log('[Email] Body preview:', body.slice(0, 400));
            const link = body.match(/https:\/\/serper\.dev\/verify-email\?token=[^\s'"<>]+/);
            if (link) {
              console.log('[Auto-Key] Verification link found — clicking...');
              await page.goto(link[0]);
              await jitter(4000, 6000);
              await page.goto('https://serper.dev/api-keys');
              await page.waitForSelector('text/API Key', { timeout: 10000 }).catch(() => {});
              const html = await page.content();
              const km   = html.match(/[a-f0-9]{40}/);
              if (km) { newKey = km[0]; break; }
            }
          }
        }
      }

      await sleep(5000);
    }

    if (newKey) {
      const KeyManager = require('../key_manager');
      const addResult  = await KeyManager.addKey(newKey);

      if (addResult === 'duplicate') {
        _consecutiveDups++;
        console.log(`[Keygen] ⚠️  Signup failed silently — CAPTCHA blocked, got duplicate key (${_consecutiveDups}/3)`);
        if (_consecutiveDups >= 3) {
          _pausedUntil     = Date.now() + 2 * 60 * 60 * 1000;
          _consecutiveDups = 0;
          console.log('[Keygen] 🛑 3 consecutive failures — pausing keygen for 2 hours');
        }
        saveStrikes();
        try { await browser.close(); } catch {}
        geteduTab = null;
        try { await ws.stopTor(); } catch {}
        releaseLock();
        return null;
      }

      _consecutiveDups = 0;
      saveStrikes();
      console.log(`\n[Auto-Key] SUCCESS — New key: ${newKey}\n`);
      try { await browser.close(); } catch {}
      geteduTab = null;
      try { await ws.stopTor(); } catch {}
      releaseLock();
      return newKey;
    }
    console.log('[Auto-Key] Timed out.');
  } catch (err) {
    console.error(`[Auto-Key] Error: ${err.message}`);
    console.error(err.stack);
  }

  try { await browser.close(); } catch {}
  geteduTab = null;
  await ws.stopTor();
  releaseLock();
  return null;
}

if (require.main === module) generateSerperKey().catch(console.error);
module.exports = { generateSerperKey };
