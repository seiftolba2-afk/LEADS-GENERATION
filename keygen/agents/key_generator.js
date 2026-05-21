'use strict';
/**
 * key_generator.js — Automated Serper.dev account creator
 * Stack:
 *   1. Playwright (Chromium) — browser automation
 *   2. Audio CAPTCHA bypass via wit.ai STT (free)
 *   3. Turnstile auto-click
 */

// CloakBrowser loaded dynamically (ESM) inside generateSerperKey()
const { signupOutlookOnPage } = require('./outlook_creator');

const axios = require('axios');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

// Temp-email providers use certs Node.js can't verify from its bundled CAs
const axiosNoVerify = axios.create({ httpsAgent: new https.Agent({ rejectUnauthorized: false }) });

const ROOT         = path.join(__dirname, '..');
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LOCK_FILE    = path.join(ROOT, '.keygen.lock');
const PROFILE_DIR  = path.join(ROOT, '.serper_profile');
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

// ── Ghost-cursor click (human Bezier path to element) ────────────────────────
async function ghostClick(cursor, page, selector) {
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    await page.click(selector);
    return true;
  } catch { return false; }
}

// ── Human-like type into an ElementHandle ────────────────────────────────────
async function humanType(element, text) {
  await element.click({ clickCount: 3 }); // select all
  await jitter(100, 200);
  for (const char of text) {
    await element.pressSequentially(char, { delay: 45 + Math.random() * 85 });
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
  const count = await page.evaluate((email) => {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    function fill(el, val) {
      if (!el) return false;
      el.focus();
      if (nativeSet) nativeSet.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true }));
      return true;
    }
    function vis(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
    function find(selectors) {
      for (const s of selectors) { const el = document.querySelector(s); if (el && vis(el)) return el; }
      return null;
    }

    let n = 0;
    // Email — by type first, then name/placeholder
    const emailEl = find(['input[type="email"]','input[name*="email" i]','input[placeholder*="email" i]','input[autocomplete*="email" i]']);
    if (fill(emailEl, email)) n++;

    // Password(s)
    for (const el of document.querySelectorAll('input[type="password"]')) {
      if (vis(el) && fill(el, 'Solarsales123!')) n++;
    }

    // First name
    const first = find(['input[name*="first" i]','input[placeholder*="first" i]','input[id*="first" i]','input[autocomplete="given-name"]']);
    if (first && first !== emailEl && fill(first, 'Mark')) n++;

    // Last name
    const last = find(['input[name*="last" i]','input[placeholder*="last" i]','input[id*="last" i]','input[autocomplete="family-name"]']);
    if (last && last !== emailEl && last !== first && fill(last, 'Wilson')) n++;

    // Fallback: if nothing matched, try visible inputs by index (old behaviour)
    if (n === 0) {
      const visible = [...document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')].filter(vis);
      if (visible.length >= 2) {
        fill(visible[0], email); fill(visible[1], 'Solarsales123!'); n = 2;
      }
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

// ── 2captcha reCAPTCHA v2 solver ─────────────────────────────────────────────
// Set TWOCAPTCHA_API_KEY env var. $0.001/solve — deposit $3 at 2captcha.com.
async function solve2captcha(page, apiKey) {
  try {
    const sitekey = await page.evaluate(() => {
      const el = document.querySelector('[data-sitekey]');
      return el?.getAttribute('data-sitekey') || null;
    }).catch(() => null);

    if (!sitekey) { console.log('   [2captcha] No sitekey on page — skipping'); return false; }

    const pageUrl = page.url();
    console.log(`   [2captcha] Submitting task (sitekey: ${sitekey.slice(0, 20)}...)...`);

    const sub = await axiosNoVerify.post('https://2captcha.com/in.php', null, {
      params: { key: apiKey, method: 'userrecaptcha', googlekey: sitekey, pageurl: pageUrl, json: 1 },
      timeout: 10000,
    });
    if (sub.data.status !== 1) { console.log(`   [2captcha] Submit failed: ${sub.data.request}`); return false; }

    const taskId = sub.data.request;
    console.log(`   [2captcha] Task ${taskId} — polling...`);

    for (let p = 0; p < 30; p++) {
      await sleep(5000);
      const poll = await axiosNoVerify.get('https://2captcha.com/res.php', {
        params: { key: apiKey, action: 'get', id: taskId, json: 1 }, timeout: 10000,
      });
      if (poll.data.request === 'CAPCHA_NOT_READY') { if (p % 3 === 0) process.stdout.write('.'); continue; }
      if (poll.data.status !== 1) { console.log(`\n   [2captcha] Error: ${poll.data.request}`); return false; }

      const token = poll.data.request;
      console.log(`\n   [2captcha] Got token — injecting...`);

      await page.evaluate((t) => {
        // Inject into hidden textarea that reCAPTCHA reads
        const ta = document.querySelector('[name="g-recaptcha-response"]') ||
                   document.querySelector('#g-recaptcha-response');
        if (ta) {
          ta.style.display = 'block';
          const nset = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nset) nset.call(ta, t); else ta.value = t;
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          ta.dispatchEvent(new Event('input',  { bubbles: true }));
        }
        // Fire data-callback if present (e.g. custom reCAPTCHA submit handler)
        const widget = document.querySelector('[data-callback]');
        if (widget) {
          const cb = widget.getAttribute('data-callback');
          if (cb && typeof window[cb] === 'function') window[cb](t);
        }
      }, token).catch(() => {});

      await sleep(1000);
      return true;
    }
    console.log('\n   [2captcha] Timed out (150s)');
    return false;
  } catch (e) {
    console.log(`   [2captcha] Error: ${e.message}`);
    return false;
  }
}


// ── Auto email verification ───────────────────────────────────────────────────
// Navigates outlookTab (already logged in) to inbox, waits for Serper email,
// extracts the verification link, and navigates to it.
// The main monitoring loop's api-keys watcher then fires automatically.
async function clickVerificationEmail(outlookTab, email) {
  console.log('[Verify] Checking Outlook inbox for Serper verification email...');
  try {
    // Ensure we're at the correct account's inbox.
    // The persistent profile may have a different primary account, so we scan slots 0-5
    // to find which one has the new email (same logic as _signupOnPage in outlook_creator.js).
    const emailPrefix = (email || '').split('@')[0].toLowerCase();
    const currentUrl  = outlookTab.url();
    const alreadyOnCorrectSlot = currentUrl.includes('outlook.live.com/mail') &&
      (await outlookTab.evaluate(pfx =>
        (document.title + document.body?.innerText || '').toLowerCase().includes(pfx),
        emailPrefix).catch(() => false));

    if (!alreadyOnCorrectSlot) {
      let foundSlot = -1;
      for (let slot = 0; slot < 6; slot++) {
        try {
          await outlookTab.goto(`https://outlook.live.com/mail/${slot}/inbox`, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await sleep(1500);
          const titleBody = await outlookTab.evaluate(() =>
            (document.title + ' ' + (document.body?.innerText || '')).toLowerCase()
          ).catch(() => '');
          if (titleBody.includes(emailPrefix)) {
            console.log(`[Verify] Found inbox at slot ${slot}`);
            foundSlot = slot;
            break;
          }
        } catch {}
      }
      if (foundSlot === -1) {
        console.log('[Verify] ⚠️  Could not locate new account slot — trying /mail/0/');
        await outlookTab.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await sleep(3000);
      }
    }

    // Switch to the correct account in the sidebar (multi-account profiles)
    // emailPrefix already declared above in slot-scan block
    if (emailPrefix) {
      const switched = await outlookTab.evaluate((pfx) => {
        const allItems = [...document.querySelectorAll('[role="treeitem"], li, a, button, span')];
        for (const item of allItems) {
          const text = (item.textContent || item.title || item.getAttribute('aria-label') || '').toLowerCase();
          if (text.includes(pfx)) {
            const parent = item.closest('li, [role="group"]') || item.parentElement?.parentElement;
            const inboxLink = parent
              ? (parent.querySelector('[aria-label*="Inbox"], [title*="Inbox"]') ||
                 [...parent.querySelectorAll('a,button')].find(el => el.textContent.trim() === 'Inbox'))
              : null;
            if (inboxLink) { inboxLink.click(); return 'inbox_clicked'; }
            item.click();
            return 'account_clicked';
          }
        }
        return false;
      }, emailPrefix).catch(() => false);
      if (switched) { console.log(`[Verify] Switched to ${email} inbox (${switched})`); await sleep(2000); }
    }

    const deadline = Date.now() + 3 * 60 * 1000; // wait up to 3 min for email to arrive
    while (Date.now() < deadline) {
      // Reload inbox to surface new emails
      await outlookTab.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await sleep(3000);

      // Re-switch after reload (Outlook web may reset view on reload)
      if (emailPrefix) {
        await outlookTab.evaluate((pfx) => {
          const allItems = [...document.querySelectorAll('[role="treeitem"], li, a, button, span')];
          for (const item of allItems) {
            const text = (item.textContent || item.title || item.getAttribute('aria-label') || '').toLowerCase();
            if (text.includes(pfx)) {
              const parent = item.closest('li, [role="group"]') || item.parentElement?.parentElement;
              const inboxLink = parent
                ? (parent.querySelector('[aria-label*="Inbox"], [title*="Inbox"]') ||
                   [...parent.querySelectorAll('a,button')].find(el => el.textContent.trim() === 'Inbox'))
                : null;
              if (inboxLink) { inboxLink.click(); return true; }
            }
          }
          return false;
        }, emailPrefix).catch(() => {});
        await sleep(1500);
      }

      // Find the first email item — fresh account means first/only email is from Serper
      const strategy = await outlookTab.evaluate(() => {
        const opts = [...document.querySelectorAll('[role="option"],[data-convid]')];
        if (!opts.length) return null;
        // Prefer an item that mentions Serper
        const serperItem = opts.find(el => el.textContent.toLowerCase().includes('serper'));
        const target = serperItem || opts[0];
        const convid = target.getAttribute('data-convid');
        return convid ? { convid } : { click: true };
      }).catch(() => null);

      if (strategy) {
        if (strategy.convid) {
          await outlookTab.click(`[data-convid="${strategy.convid}"]`).catch(() => {});
        } else {
          const first = await outlookTab.$('[role="option"],[data-convid]').catch(() => null);
          if (first) await first.click().catch(() => {});
        }
        await sleep(2500);

        // Extract verification link from email body
        const verifyUrl = await outlookTab.evaluate(() => {
          return [...document.querySelectorAll('a[href]')]
            .map(a => a.href)
            .find(h => h.includes('serper.dev') &&
              (h.includes('verify') || h.includes('confirm') || h.includes('activate') || h.includes('email')));
        }).catch(() => null);

        if (verifyUrl) {
          console.log('[Verify] ✅ Found link — navigating to verify...');
          await outlookTab.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          return true;
        }
      }

      console.log('[Verify] Email not found yet — retrying in 10s...');
      await sleep(7000);
    }

    console.log('[Verify] ⚠️  Verification email not found within 3 minutes — check manually');
    return false;
  } catch(e) {
    console.log('[Verify] Error:', e.message);
    return false;
  }
}

// ── CroxyProxy navigation ─────────────────────────────────────────────────────
// Navigates to croxyproxy.com, enters the target URL, submits, and waits for load.
// CroxyProxy proxies through their servers so Serper sees a different IP.
async function navigateViaCroxyProxy(page, targetUrl) {
  console.log(`[CroxyProxy] Opening proxy page for ${targetUrl}...`);
  await page.goto('https://www.croxyproxy.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await jitter(1500, 2500);

  // Find the URL input — try common selectors
  const urlInputSelector = await page.evaluate(() => {
    const candidates = ['#url', 'input[name="url"]', 'input[type="url"]'];
    for (const sel of candidates) {
      if (document.querySelector(sel)) return sel;
    }
    // Fallback: first visible text input
    const inp = [...document.querySelectorAll('input[type="text"], input:not([type])')]
      .find(el => el.offsetParent !== null);
    return inp?.id ? `#${inp.id}` : (inp?.name ? `input[name="${inp.name}"]` : null);
  });
  if (!urlInputSelector) throw new Error('[CroxyProxy] URL input not found');

  // Fill via Playwright's fill (triggers real input events that React/Vue listen for)
  await page.fill(urlInputSelector, targetUrl);
  await jitter(500, 1000);

  // Submit by pressing Enter in URL field (avoids clicking the wrong button —
  // CroxyProxy has a "Premium" button right next to "Go!" with similar attributes)
  await page.focus(urlInputSelector);
  await page.press(urlInputSelector, 'Enter');

  // Wait for navigation to leave the croxyproxy.com domain
  try {
    await page.waitForURL(u => !u.includes('croxyproxy.com/'), { timeout: 30000 });
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
  }

  // CroxyProxy shows a "Proxy is launching..." intermediate page (__cpi.php) before
  // the real target loads. Wait for the title to change away from that.
  console.log('[CroxyProxy] Waiting for proxy to finish launching...');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await sleep(1500);
    const title = await page.title().catch(() => '');
    const url   = page.url();
    // Done when title no longer says "launching" AND URL is past the __cpi loading page
    if (!/launching|croxyproxy/i.test(title) && !url.includes('__cpi.php')) break;
  }
  await jitter(2000, 3500);
  console.log(`[CroxyProxy] Loaded — URL: ${page.url().slice(0, 120)}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function generateSerperKey() {
  if (!acquireLock()) {
    console.log('[Auto-Key] Already running.');
    return null;
  }

  loadStrikes(); // pull persisted dup-counter + pause state from disk

  if (Date.now() < _pausedUntil) {
    const mins = Math.ceil((_pausedUntil - Date.now()) / 60000);
    console.log(`[Keygen] ⏸  Paused — ${mins}m remaining. Skipping.`);
    releaseLock();
    return null;
  }

  console.log('\n[Auto-Key] Starting...');

  // Kill any stale CloakBrowser/Brave process still holding the .serper_profile lock
  const { execSync } = require('child_process');
  try {
    // PowerShell (Get-CimInstance) — reliable on Windows 10/11. wmic is deprecated and
    // often returns empty results on Win11. Filter by command-line containing serper_profile.
    const psCmd = `Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe' OR Name='brave.exe'\\" | ` +
                  `Where-Object { $_.CommandLine -like '*serper_profile*' } | ` +
                  `ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
    const killed = execSync(`powershell.exe -NoProfile -Command "${psCmd}"`, {
      encoding: 'utf8', timeout: 10000, windowsHide: true
    }).trim();
    if (killed) console.log(`[Auto-Key] Killed stale browser PIDs: ${killed.replace(/\s+/g, ', ')}`);
  } catch (e) {
    // Fallback to wmic for systems without PowerShell or where it failed
    try {
      const wmicOut = execSync(
        'wmic process where "name=\'chrome.exe\' or name=\'brave.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: 'utf8', timeout: 8000 }
      );
      for (const line of wmicOut.split('\n')) {
        if (line.includes('serper_profile') && line.includes(',')) {
          const pid = line.split(',')[1]?.trim();
          if (pid && /^\d+$/.test(pid)) {
            execSync(`taskkill /F /PID ${pid}`, { timeout: 3000 });
            console.log(`[Auto-Key] Killed stale browser PID ${pid} (wmic fallback)`);
          }
        }
      }
    } catch {}
  }
  // Give Windows time to release file handles before launchPersistentContext touches the profile
  await sleep(2000);

  // Clear stale profile locks and session restore (prevent Chrome reopening old audio challenge page)
  for (const f of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
  }
  for (const f of ['Current Session', 'Last Session', 'Current Tabs', 'Last Tabs']) {
    try { fs.unlinkSync(path.join(PROFILE_DIR, 'Default', f)); } catch {}
  }

  const NOPECHA_EXT = path.join(PROJECT_ROOT, '.nopecha_ext');
  const hasNopecha = fs.existsSync(NOPECHA_EXT);
  if (hasNopecha) console.log('🤖 [Auto-Key] NopeCHA extension loaded — CAPTCHA will be auto-solved.');

  // Randomize fingerprint seed each run so Microsoft doesn't serve the same
  // stale FunCAPTCHA session_id across consecutive signups.
  const fpSeed = Math.floor(Math.random() * 90000) + 10000;
  console.log(`[Auto-Key] Fingerprint seed: ${fpSeed}`);

  const { launchPersistentContext } = await import('cloakbrowser');
  const context = await launchPersistentContext({
    userDataDir:  PROFILE_DIR,
    headless:     false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--fingerprint=${fpSeed}`,
      '--fingerprint-platform=windows',
      '--window-size=1280,800',
      '--start-maximized',
      '--disable-infobars',
      '--disable-notifications',
      '--disable-features=IsolateOrigins,site-per-process',
      ...(hasNopecha ? [
        `--disable-extensions-except=${NOPECHA_EXT}`,
        `--load-extension=${NOPECHA_EXT}`,
      ] : []),
    ],
    viewport: null,
    timeout: 120000,
  });

  // Close any restored/stale tabs from previous runs — keep only the first one
  const initialPages = context.pages();
  for (let i = 1; i < initialPages.length; i++) {
    try { await initialPages[i].close(); } catch {}
  }
  let page = initialPages[0] || await context.newPage();

  // Additional webdriver hiding
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  const cursor = null; // ghost-cursor removed; retained in function signatures for API compat

  try {
    // Step 1: Sign up Outlook on the FIRST tab — DIRECTLY (no proxy).
    // Microsoft doesn't IP-block us; CroxyProxy free tier gates signup.live.com.
    console.log('[Auto-Key] Step 1: Signing up Outlook on tab #1 (direct, no proxy)...');
    const outlookResult = await signupOutlookOnPage(page);
    if (!outlookResult) {
      console.log('[Auto-Key] ❌ Outlook creation failed — aborting');
      await context.close().catch(() => {});
      releaseLock();
      return null;
    }
    const email    = outlookResult.email;
    const password = outlookResult.password; // needed for Microsoft OAuth step
    const outlookTab = page; // keep reference — verification link gets clicked from here
    console.log(`[Auto-Key] Outlook ready: ${email} — Tab #1 stays open at inbox`);

    // Step 2: Open a NEW tab for Serper signup — via CroxyProxy for a fresh IP.
    // NopeCHA extension handles any CAPTCHA that appears.
    console.log('[Auto-Key] Step 2: Opening new tab for Serper signup via CroxyProxy...');
    page = await context.newPage();
    await page.bringToFront();
    await navigateViaCroxyProxy(page, 'https://serper.dev/signup');

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
    let _verifyAttempted = false;
    let _oauthHandled    = false;

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
        console.log('🔴 [Auto-Key] IP hard-blocked (Try again later) — reloading for fresh CroxyProxy exit IP...');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await sleep(4000);
        continue;
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
      // With 2captcha key: wait 60s then fire solver. Without: wait 300s for manual/NopeCHA.
      const twoCaptchaKey  = process.env.TWOCAPTCHA_API_KEY;
      const extWaitMs      = twoCaptchaKey ? 60000 : 300000;
      const extWaitDone    = (Date.now() - lastSubmitTime) > extWaitMs;
      if (url.includes('signup') && i % 3 === 0 && !extWaitDone) {
        const token = await page.evaluate(() => {
          const el = document.querySelector('[name="g-recaptcha-response"]');
          return el?.value || '';
        }).catch(() => '');
        if (token.length > 20) {
          console.log('🤖 [Extension] reCAPTCHA solved! Submitting form...');
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

        // Domain blocked — Outlook is the only provider, nothing to rotate to
        const errText = await Promise.race([
          page.evaluate(() => document.body?.innerText || ''),
          sleep(3000).then(() => '')
        ]).catch(() => '');
        if (errText.includes('not possible to register')) {
          console.log(`[Serper] "not possible to register" seen on ${url.slice(0,50)}`);
          console.log(`[Serper] page text: ${errText.slice(0, 300).replace(/\s+/g, ' ')}`);
          console.log(`[Serper] Email domain blocked (${email}) — hotmail.com may be on Serper blocklist`);
          // Nothing to rotate to — abort this run
          break;
        }

        // reCAPTCHA solving chain: 2captcha → audio bypass → IP rotate
        if (i % 6 === 0 && !extWaitDone && !twoCaptchaKey) {
          process.stdout.write('\x07');
          console.log('🚨 [MANUAL ASSIST] No 2captcha key — solve the image puzzle manually, or set TWOCAPTCHA_API_KEY.');
        }

        if (url.includes('signup') && i % 3 === 0 && extWaitDone) {
          // Step 1: 2captcha (fast, reliable, ~$0.001/solve)
          if (twoCaptchaKey) {
            const solved = await solve2captcha(page, twoCaptchaKey);
            if (solved) {
              console.log('   [2captcha] Injected — submitting form...');
              await clickButton(page, cursor, 'Create account');
              lastSubmitTime = Date.now();
              await sleep(3000);
              continue;
            }
            console.log('   [2captcha] Failed — falling back to audio bypass...');
          }

          // Step 2: wit.ai audio bypass
          const captchaResult = await solveRecaptchaV2(page);
          if (captchaResult === 'ROTATE_IP' || captchaResult === false) {
            console.log('[reCAPTCHA] Failed — reloading for fresh CroxyProxy exit IP...');
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
          console.log('[Turnstile] Image challenge — reloading page...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await sleep(4000);
          continue;
        }
      }

      // Auto-verify: when Serper shows verify-email page, go get the link from Outlook inbox
      if (!_verifyAttempted && (url.includes('verify-email') ||
          (pageText && pageText.toLowerCase().includes('verify your email')))) {
        _verifyAttempted = true;
        console.log('[Auto-Key] Serper wants email verification — auto-checking Outlook inbox...');
        await clickVerificationEmail(outlookTab, email);
      }

      // Microsoft OAuth: Serper verifies hotmail.com via login.live.com OAuth flow.
      // The OAuth page may load in the same Serper tab or a popup — scan all pages.
      // Only handle once per run (_oauthHandled flag) to avoid re-triggering on each loop tick.
      if (!_oauthHandled) {
        let oauthPage = null;
        if (url.includes('login.live.com') &&
            (url.includes('oauth20_authorize') || url.includes('login.srf') || url.includes('repost'))) {
          oauthPage = page;
        } else {
          for (const p of context.pages()) {
            try {
              const pu = p.url();
              if (pu.includes('login.live.com') &&
                  (pu.includes('oauth20_authorize') || pu.includes('login.srf') || pu.includes('repost'))) {
                oauthPage = p;
                break;
              }
            } catch {}
          }
        }

        if (oauthPage) {
          _oauthHandled = true;
          console.log('[Auto-Key] Microsoft OAuth detected — handling (stage-loop)...');
          await sleep(2000);

          const emailPrefix = email.toLowerCase().split('@')[0];

          // Stage-loop: re-detect the page state after each action. The real chain is
          // password(wrong) → "different account" → picker → tile-click → password(right) → stay.
          for (let step = 0; step < 8; step++) {
            // Detect current stage
            const stage = await oauthPage.evaluate((prefix) => {
              const txt = (document.body?.innerText || '').toLowerCase();
              if (txt.includes('stay signed in')) return 'stay';
              const pwd = document.querySelector('input[type="password"], input[name="passwd"]');
              if (pwd && pwd.offsetParent !== null) {
                // Is the pre-filled account the one we want?
                const right = txt.includes(prefix);
                return right ? 'password-right' : 'password-wrong';
              }
              const em = document.querySelector('input[type="email"], input[name="loginfmt"]');
              if (em && em.offsetParent !== null) return 'email';
              // Account picker: tiles of existing accounts + "different account"
              if (txt.includes('choose an account') || txt.includes('pick an account') ||
                  document.querySelector('#otherTile, [data-test-id="accountTile"], .table')) return 'picker';
              return 'unknown';
            }, emailPrefix).catch(() => 'unknown');

            const curUrl = oauthPage.url();
            console.log(`[OAuth] step ${step}: stage=${stage} | ${curUrl.slice(0, 55)}`);

            // Left login.live.com → OAuth complete
            if (!curUrl.includes('login.live.com')) { console.log('[OAuth] Redirected off login — done'); break; }

            if (stage === 'password-right') {
              await oauthPage.locator('input[type="password"], input[name="passwd"]').first().fill(password);
              await oauthPage.keyboard.press('Enter');
              console.log('[OAuth] Password entered for correct account');
              await sleep(3500);
            } else if (stage === 'password-wrong') {
              await oauthPage.evaluate(() => {
                const link = [...document.querySelectorAll('a, button, [role="button"]')].find(el =>
                  (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().includes('different'));
                if (link) link.click();
              }).catch(() => {});
              console.log('[OAuth] Wrong account — clicked "different account"');
              await sleep(3000);
            } else if (stage === 'picker') {
              const picked = await oauthPage.evaluate((prefix) => {
                const tiles = [...document.querySelectorAll('[role="button"], button, a, div[data-test-id], .table, .row')];
                const match = tiles.find(el => (el.textContent || '').toLowerCase().includes(prefix));
                if (match) { match.click(); return 'tile'; }
                const diff = [...document.querySelectorAll('a, button, [role="button"], #otherTile')].find(el =>
                  (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().includes('different'));
                if (diff) { diff.click(); return 'different'; }
                return false;
              }, emailPrefix).catch(() => false);
              console.log(`[OAuth] Picker action: ${picked}`);
              await sleep(3000);
            } else if (stage === 'email') {
              await oauthPage.locator('input[type="email"], input[name="loginfmt"]').first().fill(email);
              await oauthPage.keyboard.press('Enter');
              console.log(`[OAuth] Email entered: ${email}`);
              await sleep(3000);
            } else if (stage === 'stay') {
              const noBtn = await oauthPage.$('#idBtn_Back, [value="No"]').catch(() => null);
              if (noBtn) await noBtn.click(); else await oauthPage.keyboard.press('Enter');
              console.log('[OAuth] "Stay signed in?" dismissed');
              await sleep(2500);
              break;
            } else {
              console.log('[OAuth] Unknown stage — waiting...');
              await sleep(3000);
            }
          }

          console.log('[OAuth] Stage-loop done — monitoring for Serper redirect...');
        }
      }

      // Watch ALL context pages for api-keys URL (fires when user clicks verification link)
      for (const p of context.pages()) {
        try {
          const pu = p.url();
          if (pu.includes('api-keys') || (pu.includes('serper') && pu.includes('dashboard'))) {
            await sleep(2000);
            const html = await p.content().catch(() => '');
            const km = html.match(/[a-f0-9]{40}/);
            if (km) { newKey = km[0]; break; }
          }
        } catch {}
      }
      if (newKey) break;

      await sleep(5000);
    }

    if (newKey) {
      const KeyManager = require('../../key_manager');
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
        try { await context.close(); } catch {}
  
          releaseLock();
        return null;
      }

      _consecutiveDups = 0;
      saveStrikes();
      console.log(`\n[Auto-Key] SUCCESS — New key: ${newKey}\n`);

      // Persist {email, password, serperKey} so aggregator can rotate to it automatically
      const CREDS_FILE = path.join(ROOT, 'serper_credentials.json');
      try {
        const existing = fs.existsSync(CREDS_FILE)
          ? JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
          : [];
        existing.push({
          email:     outlookResult.email,
          password:  outlookResult.password,
          serperKey: newKey,
          createdAt: new Date().toISOString(),
          active:    true,
        });
        const tmp = CREDS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(existing, null, 2));
        fs.renameSync(tmp, CREDS_FILE);
        console.log(`[Auto-Key] Credentials saved → serper_credentials.json`);
      } catch (e) {
        console.log(`[Auto-Key] Warning: failed to save credentials: ${e.message}`);
      }

      try { await context.close(); } catch {}
      releaseLock();
      return newKey;
    }
    console.log('[Auto-Key] Timed out.');
  } catch (err) {
    console.error(`[Auto-Key] Error: ${err.message}`);
    console.error(err.stack);
  }

  try { await context.close(); } catch {}
  releaseLock();
  return null;
}

if (require.main === module) generateSerperKey().catch(console.error);
module.exports = { generateSerperKey };
