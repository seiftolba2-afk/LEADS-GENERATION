'use strict';
/**
 * verify_outlook.js — Log into Outlook web, find Serper verification email, click link, save API key.
 */
const puppeteer = require('rebrowser-puppeteer');
const fs   = require('fs');
const path = require('path');

const CHROME_PATH = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(p => fs.existsSync(p));

const ROOT          = __dirname;
const ACCOUNTS_FILE = path.join(ROOT, 'outlook_accounts.json');
const KEYS_FILE     = path.join(ROOT, 'serper_keys.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Link extraction: scans all frames + inline reading pane HTML ─────────────
async function findLinkInFrames(page) {
  for (const frame of page.frames()) {
    try {
      const link = await frame.evaluate(() => {
        const a = document.querySelector('a[href*="serper.dev/verify"]');
        if (a) return a.href;
        const m = document.documentElement.innerHTML
          .match(/https?:\/\/serper\.dev\/verify-email\?token=[^\s'"<>&\r\n]+/);
        return m ? m[0].replace(/=[\r\n]+/g, '') : null;
      });
      if (link) return link;
    } catch {}
  }
  return null;
}

// ── Click a Serper/verify email row using Outlook-specific selectors ──────────
async function clickSerperEmail(page) {
  // Outlook renders email list rows as [role="option"] inside [role="listbox"]
  // Each row contains divs with subject/sender/preview text
  const clicked = await page.evaluate(() => {
    const keywords = ['serper', 'verify your email', 'please verify'];

    // Strategy 1: role="option" rows (Outlook new UI)
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    for (const opt of options) {
      const text = opt.textContent.toLowerCase();
      if (keywords.some(k => text.includes(k))) {
        opt.click();
        return 'option:' + opt.textContent.slice(0, 80);
      }
    }

    // Strategy 2: role="listitem" rows
    const items = Array.from(document.querySelectorAll('[role="listitem"]'));
    for (const item of items) {
      const text = item.textContent.toLowerCase();
      if (keywords.some(k => text.includes(k))) {
        item.click();
        return 'listitem:' + item.textContent.slice(0, 80);
      }
    }

    // Strategy 3: any div with data-convid (Outlook conversation items)
    const convs = Array.from(document.querySelectorAll('[data-convid]'));
    for (const c of convs) {
      const text = c.textContent.toLowerCase();
      if (keywords.some(k => text.includes(k))) {
        c.click();
        return 'convid:' + c.textContent.slice(0, 80);
      }
    }

    // Strategy 4: broadest fallback — any element with matching text, smallest wins
    const all = Array.from(document.querySelectorAll('*'));
    const candidates = all.filter(el => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
      const text = el.textContent.toLowerCase();
      return keywords.some(k => text.includes(k)) && el.getBoundingClientRect().width > 50;
    });
    if (candidates.length) {
      candidates.sort((a, b) => a.textContent.length - b.textContent.length);
      candidates[0].click();
      return 'fallback:' + candidates[0].textContent.slice(0, 80);
    }
    return false;
  }).catch(() => false);

  if (clicked) console.log(`[Verify] Clicked email: "${String(clicked).trim().slice(0, 70)}"`);
  return !!clicked;
}

// ── Outlook search via URL (OWA deep-link) ───────────────────────────────────
async function trySearchUrl(page) {
  // Outlook live search — the q= param triggers a search
  await page.goto(
    'https://outlook.live.com/mail/0/?search=serper',
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  ).catch(() => {});
  await sleep(6000);
  const clicked = await clickSerperEmail(page);
  if (clicked) {
    await sleep(8000); // reading pane needs time to render
    return findLinkInFrames(page);
  }
  return null;
}

// ── Outlook search via keyboard shortcut ─────────────────────────────────────
async function trySearchBox(page) {
  await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(3000);

  // Try clicking the search box directly
  const searchClicked = await page.evaluate(() => {
    const box = document.querySelector('input[aria-label*="Search"], input[placeholder*="Search"], [role="search"] input');
    if (box) { box.focus(); return true; }
    return false;
  }).catch(() => false);

  if (!searchClicked) {
    // Ctrl+E is Outlook's search shortcut
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyE');
    await page.keyboard.up('Control');
    await sleep(800);
  }
  await sleep(500);
  await page.keyboard.type('serper', { delay: 80 });
  await page.keyboard.press('Enter');
  await sleep(6000);

  const clicked = await clickSerperEmail(page);
  if (clicked) {
    await sleep(8000);
    return findLinkInFrames(page);
  }
  return null;
}

// ── Check a specific folder ───────────────────────────────────────────────────
async function tryFolder(page, url) {
  console.log(`[Verify] Checking ${url}...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await sleep(5000);

  // Wait for message list to appear
  await page.waitForFunction(() =>
    document.querySelector('[role="option"], [role="listitem"], [data-convid]') !== null,
    { timeout: 10000 }
  ).catch(() => {});

  const clicked = await clickSerperEmail(page);
  if (clicked) {
    await sleep(8000);
    return findLinkInFrames(page);
  }
  return null;
}

async function main() {
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  const acct = accounts.find(a => !a.used) || accounts[accounts.length - 1];
  console.log(`[Verify] Account: ${acct.email}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: null,
  });
  const page = await browser.newPage();

  try {
    // ── 1. Login ─────────────────────────────────────────────────────────────
    console.log('[Verify] Opening Outlook...');
    await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(3000);

    const needsLogin = page.url().includes('login') ||
      await page.$('input[name="loginfmt"]').then(el => !!el).catch(() => false);

    if (needsLogin) {
      console.log('[Verify] Logging in...');
      await page.type('input[name="loginfmt"]', acct.email, { delay: 80 });
      await page.click('#idSIButton9').catch(() => page.keyboard.press('Enter'));
      await sleep(2500);
      await page.waitForSelector('input[name="passwd"]', { timeout: 15000 });
      await page.type('input[name="passwd"]', acct.password, { delay: 80 });
      await page.click('#idSIButton9').catch(() => page.keyboard.press('Enter'));
      await sleep(3000);
      const stay = await page.$('#idSIButton9').catch(() => null);
      if (stay) { await stay.click(); await sleep(2000); }
    } else {
      console.log('[Verify] Already logged in.');
    }

    // ── 2. Try search URL ─────────────────────────────────────────────────────
    console.log('[Verify] Trying search URL...');
    let verifyLink = await trySearchUrl(page);

    // ── 3. Try Ctrl+E search box ──────────────────────────────────────────────
    if (!verifyLink) {
      console.log('[Verify] Trying search box...');
      verifyLink = await trySearchBox(page);
    }

    // ── 4. Check inbox + junk ─────────────────────────────────────────────────
    if (!verifyLink) {
      for (const url of [
        'https://outlook.live.com/mail/0/inbox',
        'https://outlook.live.com/mail/0/junkemail',
      ]) {
        verifyLink = await tryFolder(page, url);
        if (verifyLink) break;
      }
    }

    // ── 5. Manual fallback — poll for 5 minutes ───────────────────────────────
    if (!verifyLink) {
      console.log('[Verify] ❌ Auto-click failed. Browser is open — click the Serper email manually.');
      console.log('[Verify]    Script will auto-detect the link once the reading pane loads.');
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        verifyLink = await findLinkInFrames(page);
        if (verifyLink) { console.log('[Verify] ✅ Link detected!'); break; }
        if (i % 6 === 5) process.stdout.write(`[Verify] Still waiting... (${(i + 1) * 5}s)\n`);
      }
    }

    if (!verifyLink) {
      console.log('[Verify] ❌ Timed out after 5 minutes.');
      await browser.close(); return;
    }

    console.log(`[Verify] ✅ Link: ${verifyLink.slice(0, 90)}...`);

    // ── 6. Click verification link ────────────────────────────────────────────
    await page.goto(verifyLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // ── 7. Extract API key from dashboard ────────────────────────────────────
    console.log('[Verify] Getting API key from dashboard...');
    await page.goto('https://serper.dev/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    const apiKey = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('input, code, pre, [class*="api"], [class*="key"], [class*="token"]'));
      for (const el of els) {
        const val = (el.value || el.textContent || '').trim();
        if (/^[a-f0-9]{40}$/i.test(val)) return val;
      }
      const m = document.body.innerText.match(/\b([a-f0-9]{40})\b/i);
      return m ? m[1] : null;
    });

    if (apiKey) {
      console.log(`[Verify] ✅ API Key: ${apiKey}`);
      const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (!keys.find(k => k.key === apiKey)) {
        keys.push({ key: apiKey, addedAt: Date.now(), status: 'active', lastChecked: Date.now() });
        fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
        console.log('[Verify] ✅ Saved to serper_keys.json');
      } else {
        console.log('[Verify] Key already in serper_keys.json');
      }
    } else {
      console.log('[Verify] ⚠️  Key not found — copy it from the Brave window (serper.dev/dashboard).');
      await sleep(120000);
    }

    await sleep(2000);
    await browser.close();
    console.log('[Verify] Done.');

  } catch (e) {
    console.error('[Verify] Error:', e.message);
    await sleep(30000);
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
