'use strict';
/**
 * outlook_creator.js — Automated Outlook/Hotmail account creator (Playwright)
 *
 * Exported:
 *   createOutlookAccount()           — standalone: own browser lifecycle
 *   createOutlookInBrowser(context)  — integrated: uses caller's BrowserContext, tab stays open at inbox
 *   getNextOutlookAccount()
 *   markOutlookAccountUsed(email)
 */

// CloakBrowser loaded dynamically (ESM) inside createOutlookAccount()
const fs   = require('fs');
const path = require('path');

const ROOT          = path.join(__dirname, '..');
const ACCOUNTS_FILE = path.join(ROOT, 'outlook_accounts.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(min, max) { return sleep(min + Math.floor(Math.random() * (max - min))); }

// ── Account store ─────────────────────────────────────────────────────────────
function loadAccounts() {
  try { if (fs.existsSync(ACCOUNTS_FILE)) return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); }
  catch {}
  return [];
}
function saveAccounts(list) {
  const tmp = ACCOUNTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, ACCOUNTS_FILE);
}
function appendAccount(entry) {
  const list = loadAccounts();
  list.push(entry);
  saveAccounts(list);
}

// ── Generators ────────────────────────────────────────────────────────────────
const FIRSTS = ['james','liam','noah','oliver','lucas','mason','ethan','aiden','logan','jacob',
                'emma','sophia','olivia','ava','isabella','mia','charlotte','amelia','harper','evelyn'];
const LASTS  = ['smith','jones','brown','taylor','williams','davis','miller','wilson','moore','anderson',
                'thomas','jackson','white','harris','martin','garcia','thompson','martinez','robinson','clark'];

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function randomName() {
  return { first: cap(FIRSTS[Math.floor(Math.random()*FIRSTS.length)]), last: cap(LASTS[Math.floor(Math.random()*LASTS.length)]) };
}
function randomUsername() {
  const f = FIRSTS[Math.floor(Math.random()*FIRSTS.length)];
  const l = LASTS[Math.floor(Math.random()*LASTS.length)];
  const n = Math.floor(Math.random()*90000)+10000;
  return `${f}.${l}${n}`;
}
function randomPassword() {
  const lc='abcdefghijklmnopqrstuvwxyz', uc='ABCDEFGHIJKLMNOPQRSTUVWXYZ', dg='0123456789', sy='!@#$%';
  const r=s=>s[Math.floor(Math.random()*s.length)];
  let p=r(uc)+r(dg)+r(sy);
  for(let i=0;i<11;i++) p+=r(lc+uc+dg);
  return p.split('').sort(()=>Math.random()-.5).join('');
}
function randomDOB() {
  const year=new Date().getFullYear()-22-Math.floor(Math.random()*18);
  return { year, month:Math.floor(Math.random()*12)+1, day:Math.floor(Math.random()*28)+1 };
}
function generateCreds() {
  const username = randomUsername(); // e.g. "emma.jones19551"
  // Derive first/last name from email prefix so they always match
  const parts = username.split('.');
  const first = cap(parts[0]);
  const last  = cap((parts[1] || '').replace(/\d+$/, '') || LASTS[0]);
  return { username, email: `${username}@hotmail.com`, password: randomPassword(), name: { first, last }, dob: randomDOB() };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function screenshot(page, label) {
  try { await page.screenshot({ path: path.join(ROOT, `outlook_${label}.png`) }); } catch {}
}

async function waitForAny(page, selectors, timeout=15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = await page.$(sel).catch(()=>null);
      if (el) return { sel, el };
    }
    await sleep(500);
  }
  return null;
}

async function clickNext(page) {
  const NEXT_SELS = [
    'input[type="submit"]',
    'button[type="submit"]',
    '#idSIButton9',
    '#iSignupAction',
    'input[value="Next"]',
  ];
  for (const sel of NEXT_SELS) {
    const el = await page.$(sel).catch(()=>null);
    if (el) { await jitter(300, 600); await el.click(); return true; }
  }
  const found = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.offsetParent !== null && b.textContent.trim() === 'Next');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(()=>false);
  if (found) return true;
  await page.keyboard.press('Enter');
  return false;
}

async function typeField(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 15000, state: 'visible' });
  await page.click(selector, { clickCount: 3 });
  await jitter(150, 300);
  await page.type(selector, text, { delay: 40 + Math.random()*40 });
}

// ── FunCAPTCHA press-and-hold ─────────────────────────────────────────────────
async function handleFunCaptcha(page) {
  try {
    console.log('[FunCAPTCHA] Handling challenge...');

    // Poll up to 15s for the Hold button to fully render inside the hsprotect iframe.
    // The iframe shows `px-captcha` first (loading state), then transitions to the
    // "Press & Hold" button. Acting too early hits the wrong coordinates.
    const holdSelectors = [
      '[aria-label*="Hold"]', '[aria-label*="hold"]', '[aria-label*="press and hold"]',
      '[label*="Press & Hold"]', '[class*="sjkX"]', '.challenge-answer',
      '[class*="hold"]', '[class*="press"]',
    ];
    let captchaReady = false;
    const captchaDeadline = Date.now() + 15000;
    while (Date.now() < captchaDeadline) {
      for (const f of page.frames()) {
        try {
          const ready = await f.evaluate((sels) => {
            for (const s of sels) {
              const el = document.querySelector(s);
              if (el && el.offsetParent !== null) return true;
            }
            // Also catch the specific label text
            return [...document.querySelectorAll('div,button')].some(el =>
              (el.getAttribute('aria-label') || el.getAttribute('label') || '').includes('Hold'));
          }, holdSelectors).catch(() => false);
          if (ready) { captchaReady = true; break; }
        } catch {}
      }
      if (captchaReady) break;
      await sleep(500);
    }
    console.log(`[FunCAPTCHA] Challenge ${captchaReady ? 'ready' : 'timed out — using fallback coords'}`);
    await screenshot(page, 'funcaptcha');

    const frames = page.frames();
    console.log(`[FunCAPTCHA] Total frames: ${frames.length}`);
    for (const f of frames) {
      try {
        const info = await f.evaluate(() => ({
          url: location.href.slice(0, 80),
          btns: Array.from(document.querySelectorAll('button,[role="button"],[role="checkbox"],div[tabindex],span[tabindex]'))
            .filter(el => el.offsetParent !== null)
            .map(el => ({ tag: el.tagName, id: el.id, class: el.className.slice(0,50),
              text: el.textContent.trim().slice(0,30), label: el.getAttribute('aria-label')||'' })),
        }));
        if (info.btns.length > 0) console.log(`[FunCAPTCHA] Frame ${info.url} btns:`, JSON.stringify(info.btns));
      } catch {}
    }

    const HOLD_SELS = [
      '[aria-label*="Hold"],[aria-label*="hold"],[aria-label*="press and hold"]',
      '.challenge-answer','[class*="hold"]','[class*="press"]','[class*="pah"]','button.ctp-btn',
    ];
    let btn = null, source = '', holdFrame = null;

    for (const f of frames) {
      for (const s of HOLD_SELS) {
        try {
          btn = await f.$(s);
          if (btn) {
            const vis = await btn.evaluate(el=>el.offsetParent!==null).catch(()=>false);
            if (vis) { source = f.url().slice(0,50)+' | '+s; holdFrame = f; break; }
            btn = null;
          }
        } catch {}
      }
      if (btn) break;
    }

    let cx, cy;
    if (btn) {
      const box = await btn.boundingBox().catch(()=>null);
      if (box) {
        cx = box.x + box.width / 2;
        cy = box.y + box.height / 2;
      } else {
        const iframePos = await page.evaluate(() => {
          const f = Array.from(document.querySelectorAll('iframe')).find(el => el.src.includes('hsprotect'));
          if (!f) return null;
          const r = f.getBoundingClientRect();
          return { x: r.left, y: r.top };
        }).catch(()=>null);
        const elPos = holdFrame ? await holdFrame.evaluate(() => {
          const el = document.querySelector('[aria-label*="Hold"],[aria-label*="hold"],.challenge-answer,[class*="hold"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }).catch(()=>null) : null;
        if (iframePos && elPos) {
          cx = iframePos.x + elPos.x;
          cy = iframePos.y + elPos.y;
        }
      }
    }

    if (!cx || !cy) {
      // True fallback: vertically centred (button is roughly in the middle of the iframe,
      // not at the bottom). Previous successful holds used ~(650, 506).
      const vp = page.viewportSize() || { width: 1280, height: 800 };
      cx = Math.round(vp.width / 2) + 10;
      cy = Math.round(vp.height * 0.63); // ~504px on 800-high viewport
    }

    console.log(`[FunCAPTCHA] Hold at (${Math.round(cx)},${Math.round(cy)}) — ${source||'coord'}`);
    await page.mouse.move(cx - 40, cy - 20, { steps: 6 });
    await jitter(200, 400);
    await page.mouse.move(cx, cy, { steps: 4 });
    await jitter(200, 300);

    const holdMs = 7000 + Math.floor(Math.random()*2000);
    console.log(`[FunCAPTCHA] Holding ${holdMs}ms with micro-jitter...`);
    await page.mouse.down();
    // Micro-jitter during hold — simulates hand tremor, more human-like
    const holdEnd = Date.now() + holdMs;
    while (Date.now() < holdEnd) {
      await sleep(180 + Math.random() * 120);
      await page.mouse.move(
        cx + (Math.random() - 0.5) * 3,
        cy + (Math.random() - 0.5) * 3,
        { steps: 1 }
      );
    }
    await page.mouse.up();
    await sleep(2500);
    console.log('[FunCAPTCHA] Released');
    return true;
  } catch(e) {
    console.log('[FunCAPTCHA] Error:', e.message);
    return false;
  }
}

// ── Core signup logic ─────────────────────────────────────────────────────────
// navigateFn (optional): async (page, url) => void. If provided, used to load
// signup.live.com (e.g. via CroxyProxy). Defaults to page.goto.
async function _signupOnPage(page, { username, email, password, name, dob }, navigateFn) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // Step 1: Email
  // Use ?lic=1 — bypasses existing-session redirect when persistent profile has prior logins.
  // Falls back to ?uiflavor=web if still redirected away from signup.live.com.
  console.log('[Outlook] Step 1: email');
  const SIGNUP_URLS = [
    'https://signup.live.com/?lic=1',
    'https://signup.live.com/?uiflavor=web&mkt=en-US',
    'https://signup.live.com',
  ];
  for (const signupUrl of SIGNUP_URLS) {
    if (navigateFn) {
      await navigateFn(page, signupUrl);
    } else {
      await page.goto(signupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await jitter(1500, 2500);
    if (page.url().includes('signup.live.com')) break;
    console.log(`[Outlook] Redirected → ${page.url().slice(0, 60)} — trying next signup URL...`);
  }
  await screenshot(page, 'step1_email');

  const emailFound = await waitForAny(page, ['#MemberName','input[name="MemberName"]','input[type="email"]']);
  if (!emailFound) {
    await screenshot(page, 'step1_fail');
    throw new Error(`Email input not found — URL: ${page.url().slice(0, 80)}`);
  }
  await typeField(page, emailFound.sel, email);

  const domainDrop = await page.$('#LiveDomainBoxList, select[name="LiveDomainBoxList"]').catch(()=>null);
  if (domainDrop) await page.selectOption('#LiveDomainBoxList', 'hotmail.com').catch(()=>{});

  await clickNext(page);
  await sleep(2000);

  // Step 2: Password
  console.log('[Outlook] Step 2: password');
  const pwdFound = await waitForAny(page, ['#PasswordInput','input[name="Password"]','input[type="password"]'], 20000);
  if (!pwdFound) {
    await screenshot(page, 'step2_fail');
    const txt = await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
    if (txt.toLowerCase().includes('already') || txt.toLowerCase().includes('taken'))
      throw new Error('Username already taken: ' + username);
    throw new Error('Password field not found. URL: ' + page.url());
  }
  await typeField(page, pwdFound.sel, password);
  await clickNext(page);
  await sleep(2000);

  // Step 3: Name pre-DOB (old UI only — 3s timeout, usually times out on new UI)
  console.log('[Outlook] Step 3: name check (pre-DOB)');
  const firstFoundPre = await waitForAny(page, ['#FirstName','input[name="FirstName"]'], 3000);
  if (firstFoundPre) {
    await typeField(page, firstFoundPre.sel, name.first);
    await jitter(300, 500);
    const lastFoundPre = await waitForAny(page, ['#LastName','input[name="LastName"]'], 5000);
    if (lastFoundPre) await typeField(page, lastFoundPre.sel, name.last);
    await clickNext(page);
    await sleep(2000);
  }

  // Step 4: DOB (Fluent UI dropdowns)
  console.log('[Outlook] Step 4: DOB');
  await screenshot(page, 'step4_dob');
  await page.waitForSelector('#BirthMonthDropdown', { timeout: 15000, state: 'visible' }).catch(() => {});
  await jitter(400, 700);

  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];

  async function clickFluentDropdown(btnSelector, targetValue) {
    const btn = await page.$(btnSelector).catch(() => null);
    if (!btn) { console.log(`[Outlook] Btn not found: ${btnSelector}`); return false; }
    // force: true bypasses Playwright's actionability check (Fluent UI label overlaps button)
    await btn.click({ force: true });

    // Wait for the listbox options to render
    try {
      await page.waitForSelector('[role="option"]', { timeout: 5000, state: 'visible' });
    } catch {
      console.log(`[Outlook] Dropdown options never appeared for ${btnSelector}`);
      return false;
    }

    // Determine target text: months by name (e.g. "March"), days by number (e.g. "15")
    const isMonth = /Month/i.test(btnSelector);
    const targetText = isMonth ? MONTH_NAMES[targetValue - 1] : String(targetValue);

    // Use Playwright's native click — dispatches real mouse events that Fluent UI/React listens for
    try {
      const opt = page.locator('[role="option"]').filter({ hasText: new RegExp(`^${targetText}$`) }).first();
      await opt.click({ timeout: 3000 });
      await sleep(400);
      return true;
    } catch (e) {
      console.log(`[Outlook] Option "${targetText}" not clickable: ${e.message.split('\n')[0]}`);
      await page.keyboard.press('Escape').catch(() => {});
      return false;
    }
  }

  await clickFluentDropdown('#BirthMonthDropdown', dob.month);
  await jitter(300, 500);
  await clickFluentDropdown('#BirthDayDropdown', dob.day);
  await jitter(300, 500);
  await typeField(page, 'input[name="BirthYear"]', String(dob.year));
  await jitter(200, 400);

  const mktEl = await page.$('#iOptIn, input[name="iOptIn"]').catch(()=>null);
  if (mktEl) {
    const checked = await mktEl.evaluate(el=>el.checked).catch(()=>false);
    if (checked) await mktEl.click();
  }
  await clickNext(page);
  await sleep(2500);

  // Step 4b: Name post-DOB (new UI)
  console.log('[Outlook] Step 4b: name check (post-DOB)');
  await screenshot(page, 'step4b_name');
  const NAME_SELS = [
    '#firstNameInput', 'input[name="firstNameInput"]',
    '#FirstName', 'input[name="FirstName"]',
    'input[aria-label="First name"]', 'input[aria-label="First Name"]',
  ];
  const firstFoundPost = await waitForAny(page, NAME_SELS, 8000);
  if (firstFoundPost) {
    await typeField(page, firstFoundPost.sel, name.first);
    await jitter(300, 500);
    const LAST_SELS = ['#lastNameInput','input[name="lastNameInput"]','#LastName','input[name="LastName"]',
                       'input[aria-label="Last name"]','input[aria-label="Last Name"]'];
    const lastFoundPost = await waitForAny(page, LAST_SELS, 5000);
    if (lastFoundPost) await typeField(page, lastFoundPost.sel, name.last);
    await jitter(300, 500);
    await clickNext(page);
    await sleep(2000);
  }

  // Step 5: FunCAPTCHA — prompt manual solve
  await sleep(1500);
  await screenshot(page, 'step5_captcha');
  const CAPTCHA_SEL = 'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], iframe[src*="hsprotect"], iframe[data-testid*="arkose"]';
  const hasCaptcha = await page.$(CAPTCHA_SEL).catch(()=>null);
  const captchaText = await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
  if (hasCaptcha || captchaText.toLowerCase().includes('prove you') || captchaText.toLowerCase().includes('press and hold')) {
    console.log('[Outlook] FunCAPTCHA detected — attempting auto-hold (CloakBrowser)...');
    let solved = false;

    // Returns true only when we've genuinely left the signup/captcha domain
    const captchaPassed = async () => {
      const u = page.url();
      if (u.includes('outlook.live.com') || u.includes('account.microsoft.com') || u.includes('office.com')) return true;
      if (u.includes('login.live.com')) {
        // Only count login.live.com as success when "Stay signed in?" is visible
        const txt = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
        return txt.includes('Stay signed in');
      }
      return false;
    };

    // Try automated hold up to 5 times
    for (let attempt = 1; attempt <= 5 && !solved; attempt++) {
      if (attempt > 1) { console.log(`[FunCAPTCHA] Retry ${attempt}/5...`); await sleep(3000); }
      await handleFunCaptcha(page);
      await sleep(2500);
      if (await captchaPassed()) { solved = true; break; }
      await sleep(2000);
      if (await captchaPassed()) { solved = true; break; }
    }

    // Handle "Stay signed in?" dialog that appears after a successful pass
    const _dismissStay = async () => {
      if (page.url().includes('login.live.com')) {
        const btn = await page.$('#idSIButton9').catch(() => null);
        if (btn) { await btn.click(); await sleep(2000); }
      }
    };
    await _dismissStay();

    if (!solved) {
      // Auto-hold failed — fall back to manual
      process.stdout.write('\n🔴 [Manual Action] Auto-hold failed — solve the CAPTCHA manually (5 min timeout).\n\n');
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(2000);
        if (await captchaPassed()) { solved = true; break; }
      }
      await _dismissStay();
    }

    if (!solved) console.log('[Outlook] ⚠️  CAPTCHA timed out (5min)');
    await sleep(2000);
  }

  // Phone wall check
  const bodyText = await page.evaluate(()=>document.body?.innerText||'').catch(()=>'');
  if (bodyText.toLowerCase().includes('phone') && bodyText.toLowerCase().includes('verif')) {
    console.log('[Outlook] ❌ Phone verification required');
    await screenshot(page, 'phone_wall');
    return null;
  }

  // Step 6: Wait for inbox/account confirmation
  console.log('[Outlook] Waiting for account confirmation...');
  let success = false;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const url = page.url();
    if (url.includes('outlook.live.com') || url.includes('account.microsoft.com') || url.includes('office.com')) {
      success = true; break;
    }
    for (const s of ['a[href*="outlook.live.com"]','[aria-label*="inbox"]','[data-testid*="inbox"]']) {
      if (await page.$(s).catch(()=>null)) { success = true; break; }
    }
    if (success) break;
    await sleep(1000);
  }

  await screenshot(page, 'final');

  if (!success) {
    console.log('[Outlook] ❌ Did not reach inbox. URL:', page.url().slice(0,80));
    console.log('[Outlook]    Text:', (await page.evaluate(()=>document.body?.innerText||'').catch(()=>'')).slice(0,200));
    return null;
  }

  // Navigate to inbox so Tab 1 is ready for auto-verification.
  // Problem: the persistent profile has an existing primary account (e.g. Ava Clark).
  // After signup, /mail/0/ always loads the PRIMARY, not the newly created account.
  // Fix: dismiss "Stay signed in?", then scan /mail/0/, /mail/1/, /mail/2/ … to find
  // which slot holds the new account's email prefix.
  if (page.url().includes('login.live.com')) {
    const stayBtn = await page.$('#idSIButton9').catch(() => null);
    if (stayBtn) {
      await stayBtn.click();
      await page.waitForURL('**/outlook.live.com/**', { timeout: 15000 }).catch(() => {});
      await sleep(2000);
    }
  }
  if (!page.url().includes('outlook.live.com')) {
    await page.goto('https://outlook.live.com/mail/0/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(3000);
  }

  // Scan account slots to find the one with the new email
  const emailPrefix = email.split('@')[0].toLowerCase();
  let foundSlot = -1;
  for (let slot = 0; slot < 6; slot++) {
    try {
      await page.goto(`https://outlook.live.com/mail/${slot}/inbox`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1500);
      const titleAndBody = await page.evaluate(() =>
        (document.title + ' ' + (document.body?.innerText || '')).toLowerCase()
      ).catch(() => '');
      if (titleAndBody.includes(emailPrefix)) {
        console.log(`[Outlook] New account at slot ${slot} — inbox ready`);
        foundSlot = slot;
        break;
      }
    } catch {}
  }
  if (foundSlot === -1) {
    console.log('[Outlook] ⚠️  Could not locate new account slot — staying on current tab');
  }
  console.log('[Outlook] Inbox loaded — ready for verification email');

  const entry = { email, password, createdAt: Date.now(), used: false };
  appendAccount(entry);
  console.log(`\n[Outlook] ✅ Created: ${email}`);
  console.log(`[Outlook]    Password: ${password}\n`);
  return entry;
}

// ── Standalone: own browser lifecycle ────────────────────────────────────────
async function createOutlookAccount() {
  const creds = generateCreds();
  console.log(`\n[Outlook] Creating: ${creds.email}`);

  const { launch } = await import('cloakbrowser');
  const browser = await launch({
    headless: false,
    args: ['--no-sandbox','--window-size=1280,800','--disable-infobars'],
  });

  try {
    const page = await browser.newPage();
    const entry = await _signupOnPage(page, creds);
    await browser.close();
    return entry;
  } catch(err) {
    console.error('[Outlook] Error:', err.message);
    try { await browser.close(); } catch {}
    return null;
  }
}

// ── Integrated: uses caller's BrowserContext, tab stays open at inbox ─────────
// Returns { email, password, createdAt, used, page } on success, null on failure.
// navigateFn (optional): async (page, url) => void. If provided, used to load
// signup.live.com (e.g. via CroxyProxy).
async function createOutlookInBrowser(context, navigateFn) {
  const creds = generateCreds();
  console.log(`\n[Outlook] Creating in shared browser: ${creds.email}`);

  const page = await context.newPage();
  try {
    const entry = await _signupOnPage(page, creds, navigateFn);
    if (!entry) { try { await page.close(); } catch {} return null; }
    return { ...entry, page };
  } catch(err) {
    console.error('[Outlook] Error:', err.message);
    try { await page.close(); } catch {}
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
function getNextOutlookAccount() { return loadAccounts().find(a=>!a.used) || null; }
function markOutlookAccountUsed(email) {
  const list = loadAccounts();
  const e = list.find(a=>a.email===email);
  if (e) { e.used=true; saveAccounts(list); console.log(`[Outlook] Marked ${email} as used`); }
}

// ── Sign up Outlook on an existing page ───────────────────────────────────────
// Use when the caller wants to use a specific tab (e.g. tab #1 for the Outlook inbox).
async function signupOutlookOnPage(page, navigateFn) {
  const creds = generateCreds();
  console.log(`\n[Outlook] Creating on existing page: ${creds.email}`);
  try {
    const entry = await _signupOnPage(page, creds, navigateFn);
    if (!entry) return null;
    return { ...entry, page };
  } catch(err) {
    console.error('[Outlook] Error:', err.message);
    return null;
  }
}

module.exports = { createOutlookAccount, createOutlookInBrowser, signupOutlookOnPage, getNextOutlookAccount, markOutlookAccountUsed };

if (require.main === module) {
  const countArg = process.argv.indexOf('--count');
  const count = countArg !== -1 ? parseInt(process.argv[countArg+1])||1 : 1;
  (async()=>{
    for (let i=0;i<count;i++) {
      console.log(`\n[Outlook] Run ${i+1}/${count}`);
      const r = await createOutlookAccount();
      if (!r) { console.log('[Outlook] Failed — stopping'); break; }
      if (i<count-1) await sleep(5000+Math.random()*5000);
    }
    process.exit(0);
  })();
}
