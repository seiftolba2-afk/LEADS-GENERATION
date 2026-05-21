# Serper Automation — Full Technical Reference

Everything about how the system auto-generates Serper.dev API keys with zero human input.

---

## What It Does

Serper.dev gives 2,500 free search credits per account per month. This system:
1. Opens a browser, navigates to serper.dev/signup
2. Fills the form with a real email address
3. Handles CAPTCHA automatically (Turnstile auto-verify + reCAPTCHA audio bypass)
4. Polls the inbox for the verification email via IMAP
5. Clicks the verification link
6. Extracts the API key from the dashboard
7. Saves the key to `serper_keys.json` with status `"ok"`

The lead aggregator picks up fresh keys automatically on next run.

---

## File Map

| File | Role |
|------|------|
| `agents/key_generator.js` | Main automation — browser, form, CAPTCHA, email, key extraction |
| `agents/windscribe_manager.js` | Windscribe VPN CLI wrapper — IP rotation |
| `key_manager.js` | Key pool — add, validate, rotate, recheck |
| `serper_keys.json` | Persistent key store — all keys + status |
| `monitor.js` | Background loop — spawns keygen when keys run low |
| `.env` | Credentials — IMAP passwords, Gmail pool, API tokens |
| `.keygen.lock` | Lock file — prevents two keygen instances at once |
| `.keygen_strikes.json` | Duplicate strike counter — pauses after 3 dups in a row |
| `.serper_profiles/` | Browser user profiles — cookies, fingerprint, history (pool of 5) |

---

## Architecture Flow

```
monitor.js (loop every N min)
  └─ checks serper_keys.json — how many "ok" keys remain?
  └─ if below threshold → spawns key_generator.js

key_generator.js
  ├─ preflightCheck()        — verify browser exe, email provider, VPN
  ├─ acquireLock()           — prevent parallel runs
  ├─ getTempEmail()          — pick email provider (priority order)
  ├─ windscribe.connect()    — connect VPN before browser launch (if enabled)
  ├─ pickProfile()           — select least-recently-used browser profile
  ├─ launch Brave/Chrome     — rebrowser-puppeteer + fingerprint
  ├─ windscribe.rotate()     — rotate IP after browser is up
  ├─ warmup: Google → HN     — build legit browser history
  ├─ goto serper.dev/signup  — navigate to signup
  ├─ fillForm()              — inject name + email + password
  ├─ Turnstile wait          — auto-verified by Cloudflare (30s wait)
  ├─ solveRecaptchaV2()      — audio bypass via wit.ai if reCAPTCHA appears
  ├─ submit form
  ├─ classifySignupError()   — route errors: email_blocked/ip_block/service_down/fingerprint
  ├─ poll inbox              — waitForImapEmail() or checkEmails()
  ├─ click verification link
  ├─ extractKey()            — scrape API key from dashboard
  ├─ KeyManager.addKey()     — validate + save to serper_keys.json
  └─ releaseLock()
```

---

## Email Providers (Priority Order)

The system tries providers in this order, falling back when one is blocked:

| Priority | Provider | How It Works | Config Required |
|----------|----------|-------------|----------------|
| 0 | **Gmail Pool** | Real Gmail inbox, IMAP polling at imap.gmail.com | `GMAIL_POOL=email@gmail.com:apppassword` in `.env` |
| 1 | **Neo / Titan** | Catch-all custom domain `@t-automation.co.site` | `NEO_IMAP_USER` + `NEO_IMAP_PASS` in `.env` |
| 2 | **cock.li** | Private inbox with `+alias` subaddressing | `COCKLI_IMAP_USER` + `COCKLI_IMAP_PASS` in `.env` |
| 3 | **Firefox Relay** | Mozilla alias → forwards to real inbox | `FIREFOX_RELAY_TOKEN` in `.env` |
| 4 | **SimpleLogin** | Alias service → forwards to real inbox | `SIMPLELOGIN_API_KEY` in `.env` |
| 5 | **getedumail** | `.edu` address opened in browser tab | none |
| 6 | **Guerrillamail** | Free temp mail (blocked by Serper) | none |
| 7 | **mail.tm** | Free temp mail (blocked by Serper) | none |
| 8 | **mailnesia** | HTML inbox, no JS | none |
| 9 | **mohmal** | Obscure temp mail | none |
| 10 | **dispostable** | Obscure temp mail | none |
| 11 | **yopmail** | Last resort (blocked by Serper) | none |

---

## What Serper Blocks — Confirmed

| Email Type | Blocked | Notes |
|-----------|---------|-------|
| Guerrillamail / yopmail / mail.tm | YES | On Serper's disposable blocklist |
| Neo custom domain `t-automation.co.site` | YES | Was working, then got blocked |
| Gmail `+alias` (e.g. `name+tag@gmail.com`) | YES | Serper strips the `+tag` and checks the base address |
| cock.li domain | UNKNOWN | Not tested — may also be blocked |
| Plain Gmail (`name@gmail.com`) | NO | Accepted. One Gmail = one Serper account |
| Custom business domain (not on blocklist) | NO | Best long-term solution |

---

## The Gmail Problem

Each Gmail address can only create **one Serper account**. Serper rejects:
- Duplicate accounts (same base email used twice)
- Gmail `+alias` variants — Serper strips the `+tag` part before checking

### Using Gmail Pool
Add multiple Gmail accounts to `.env`. Each creates one Serper key (2,500 credits):
```
GMAIL_POOL=account1@gmail.com:apppass1,account2@gmail.com:apppass2
```

### Getting a Gmail App Password
1. Enable 2-Step Verification at `myaccount.google.com/security`
2. Go to `myaccount.google.com/apppasswords`
3. Create an app password — name it anything (e.g. "Serper")
4. Copy the 16-character password shown
5. Add to `.env` as above

---

## The Permanent Solution — Catch-All Domain

**Best long-term approach:** Buy a domain and set up email catch-all. Every signup uses a unique `random@yourdomain.com` address. All emails land in one inbox. One domain = unlimited Serper accounts.

| Provider | Cost | Email Routing |
|----------|------|--------------|
| Cloudflare Registrar | ~$8-10/year (at cost) | Free Cloudflare Email Routing catch-all |
| Namecheap | ~$10-15/year | Free forwarding via ImprovMX or similar |

Setup:
1. Buy domain (e.g. on Cloudflare)
2. Enable catch-all routing → forward to real inbox
3. Set up IMAP on that inbox
4. Add to `.env`:
   ```
   NEO_IMAP_USER=info@yourdomain.com
   NEO_IMAP_PASS=yourpassword
   NEO_IMAP_HOST=imap.yourmailhost.com
   ```

**Why Neo (`t-automation.co.site`) got blocked:** After generating many Serper accounts from that domain, Serper added it to their blocklist. A fresh domain buys months before this happens again.

---

## CAPTCHA Handling

### Cloudflare Turnstile
Serper uses Turnstile on the signup form. It has two modes:

**Invisible mode (most common):** Auto-verifies in ~5s for non-headless browsers with real fingerprints. No user action needed.

**Visual challenge (rare):** Shows image grid ("select all buses"). Requires human to solve OR a paid CAPTCHA service. The keygen takes a screenshot (`keygen_state.png`) when this happens so you can see what's on screen.

### Google reCAPTCHA v2 (Audio Bypass)
If reCAPTCHA appears, the keygen uses **wit.ai** speech-to-text (free, no account limits):
1. Clicks the audio challenge button
2. Downloads the MP3 audio file from Google's CDN
3. Sends it to `wit.ai/speech` API
4. Gets the spoken text back
5. Types it into the reCAPTCHA text box
6. Submits

wit.ai key: `QHOSR47F2SBIRITIV5MCK4NLYMZFFREK` (hardcoded in key_generator.js)

If audio is "too many requests" (IP blocked by Google reCAPTCHA), keygen returns `'ROTATE_IP'` and the VPN rotates before retrying.

---

## Error Classification System

After form submission, `classifySignupError()` reads the page text and routes to the right recovery:

| Error Class | Trigger Text | Recovery Action |
|-------------|-------------|----------------|
| `email_blocked` | "not possible to register", "email address is not allowed" | Set provider blocked flag → fall to next provider |
| `service_down` | "cannot register at the moment", "temporarily unavailable" | Rotate IP + clear cookies + wait 60s + retry (max 3×) |
| `ip_block` | "try again later", "automated queries", "unusual traffic" | Rotate VPN → reload page |
| `fingerprint` | "security check", "browser not supported", "access denied" | Retire browser profile → abort run |
| `captcha` | reCAPTCHA URL + "try again" | Rotate IP |

---

## VPN — Windscribe

**Why:** Serper rate-limits signups by IP. After multiple attempts, same IP gets "cannot register at the moment." Rotating IPs resets this.

**How it works (`agents/windscribe_manager.js`):**
- Uses Windscribe CLI (`windscribe-cli.exe`) to connect/disconnect
- Rotates through US/CA exits: US Central → US East → US West → CA Central → CA East → repeat
- `pollConnected(30s)` — waits for tunnel to stabilise before proceeding (prevents ERR_NAME_NOT_RESOLVED)
- 3s extra DNS settle delay after connection confirmed

**IMPORTANT — KEYGEN_NO_VPN=1:**
When running inside Claude Code, set `KEYGEN_NO_VPN=1` in `.env`. Windscribe does OS-level routing — it routes ALL system traffic through VPN, including Claude's API connection, which breaks it.

To use VPN: run keygen from a **separate terminal** (not Claude Code) with `KEYGEN_NO_VPN=0`.

**CLI path:** `C:\Program Files\Windscribe\windscribe-cli.exe`

---

## Browser Setup

**Auto-detected in order (Brave first, then Chrome):**
```
C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe
C:\Program Files\Google\Chrome\Application\chrome.exe
C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
```

**Anti-detection stack:**
| Layer | Library | What It Does |
|-------|---------|-------------|
| Browser patching | `rebrowser-puppeteer` | Removes automation flags from Chrome DevTools Protocol |
| Fingerprint | `fingerprint-generator` + `fingerprint-injector` | Injects real browser fingerprint (screen, WebGL, canvas, fonts, UA) |
| Mouse | `ghost-cursor` | Bezier-curve mouse paths — looks human |
| Webdriver flag | inline `evaluateOnNewDocument` | Sets `navigator.webdriver = undefined` |
| Profile | persistent user data dir | Cookies + history accumulate so Cloudflare sees a returning user |

**Profile pool:** Maintains up to 5 profiles in `.serper_profiles/`. Each profile used max 5 times then retired. `pickProfile()` always selects least-recently-used. Fresh profile created when all are exhausted.

---

## Key Storage — `serper_keys.json`

```json
[
  {
    "key": "abc123...",
    "addedAt": 1747483200000,
    "status": "ok",
    "lastChecked": 1779023285402
  }
]
```

**Status values:**
| Status | Meaning |
|--------|---------|
| `ok` | Valid, has credits, ready to use |
| `quota` | Monthly 2,500 credits exhausted |
| `dead` | Key rejected (401/403) — account deleted or key revoked |
| `error` | API unreachable during last check |

**Key Manager (`key_manager.js`) features:**
- `addKey(key)` — validates, deduplicates, saves
- `getNextKey()` — round-robin rotation through ok keys
- `markQuota(key)` — marks exhausted
- `recheckAll()` — re-tests all non-ok keys (runs every 6 hours automatically)
- Atomic writes (write to `.tmp` then rename) — no corruption on crash

---

## Running the Keygen

**Manual test run (from separate terminal, VPN enabled):**
```
cd "D:\LEADS GENERATION EGYPT"
node agents/key_generator.js
```

**Manual test run (inside Claude Code, VPN disabled):**
Make sure `.env` has `KEYGEN_NO_VPN=1`, then run as above.

Watch for:
- `[TempMail] Gmail pool: yourname@gmail.com` — email picked
- `[Windscribe] ✅ Connected — US Central` — VPN connected (if enabled)
- `[Auto-Key] Navigating to serper.dev/signup...` — browser opened
- `[Form] Filled 4 fields` — form filled
- `[Auto-Key] Waiting for Turnstile auto-verify...` — CAPTCHA handling
- `[IMAP] Found verification email` — email received
- `[Auto-Key] ✅ Key saved: abc123...` — SUCCESS

**Automated (monitor.js):**
```
node monitor.js
```
Runs in the background. Checks key count regularly. Spawns keygen when ok keys drop below threshold.

---

## Known Issues & Fixes

### "It is not possible to register at this moment"
**Symptom:** Form submitted but Serper returns this message.
**Cause:** IP rate-limited — too many signup attempts from same IP in a short window.
**Fix:** Run with VPN enabled from a separate terminal (`KEYGEN_NO_VPN=0`). Windscribe gives a fresh US IP that Serper hasn't rate-limited.
**Wait option:** If no VPN available, wait 30–60 minutes for rate limit to clear.

### "Not possible to register with this email domain"
**Symptom:** Serper rejects the email domain.
**Cause:** Domain is on Serper's disposable-email blocklist.
**Fix:** Provider is automatically flagged and keygen falls to the next provider. If ALL providers are blocked, add a Gmail to `GMAIL_POOL` or buy a fresh catch-all domain.

### ERR_NAME_NOT_RESOLVED after VPN rotation
**Symptom:** Browser can't resolve `serper.dev` after Windscribe connects.
**Cause:** VPN takes 3–8s to update DNS. Browser navigates during this window.
**Fix:** `pollConnected(30s)` + 3s DNS settle delay added to `windscribe_manager.js`.

### Gmail `+alias` rejected by Serper
**Symptom:** `name+tag@gmail.com` gets "not possible to register."
**Cause:** Serper strips `+tag` and checks the base address. Looks like a duplicate or disposable trick.
**Fix:** Use plain Gmail address only. One Gmail = one Serper account.

### Turnstile visual challenge (image grid)
**Symptom:** Browser shows "select all squares with X" image puzzle. Keygen is stuck.
**Cause:** Cloudflare served a visual challenge instead of invisible auto-verify.
**Fix:** Check `keygen_state.png` to see the challenge. Solve manually in the open browser window, or add 2captcha key to `.env` (`TWOCAPTCHA_API_KEY`) for automatic solving.

### Browser lockfile busy (`.serper_profiles/profile_xxx/lockfile`)
**Symptom:** Previous keygen run crashed and left Brave holding the profile lock.
**Fix:**
```powershell
Stop-Process -Name brave -Force
# then delete the lockfile manually in the profile folder
```

### "3 consecutive duplicates — paused 2h"
**Symptom:** Keygen generates keys but they're already in the pool.
**Cause:** Same Serper account created 3 times in a row.
**Fix:** Add a new Gmail to `GMAIL_POOL` or wait 2 hours for the pause to lift.

### All keys show `status: "quota"`
**Symptom:** Lead run exits immediately — no credits.
**Cause:** All Serper accounts hit their 2,500/month limit.
**Fix:** Run keygen to add a fresh account. Monthly quota resets on the 1st.

---

## Pre-flight Check

`preflightCheck()` runs before every keygen attempt and validates:
1. Browser executable exists (Brave or Chrome)
2. At least one real email provider is configured
3. Windscribe CLI reachable (warning only — keygen still runs without VPN)

If browser or email provider is missing, keygen aborts immediately with a clear message.

---

## .env Configuration Reference

```env
# Gmail pool — real inboxes, never blocked by Serper (Priority 0)
# Multiple accounts: comma-separated email:apppassword pairs
GMAIL_POOL=account1@gmail.com:apppass1,account2@gmail.com:apppass2

# Neo catch-all domain (Priority 1) — t-automation.co.site is currently BLOCKED by Serper
NEO_IMAP_USER=info@t-automation.co.site
NEO_IMAP_PASS=yourpassword
NEO_IMAP_HOST=imap.titan.email

# cock.li private inbox (Priority 2) — status unknown, may be blocked
COCKLI_IMAP_USER=T-Automation@cock.li
COCKLI_IMAP_PASS=yourpassword
COCKLI_IMAP_HOST=mail.cock.li

# Firefox Relay (optional — 5 free masks)
FIREFOX_RELAY_TOKEN=yourtoken

# SimpleLogin (optional — 15 aliases/month free)
SIMPLELOGIN_API_KEY=yourkey

# 2captcha (optional — paid, ~$3/1000 solves — handles Turnstile image challenges)
TWOCAPTCHA_API_KEY=yourkey

# VPN control — MUST be 1 when running inside Claude Code
# Set to 0 when running from a separate terminal to enable IP rotation
KEYGEN_NO_VPN=1

# Custom one-off email override (bypasses all provider logic)
# KEYGEN_CUSTOM_EMAIL=specific@email.com
```

---

## Serper Credit Budget

Each account: **2,500 requests/month**, resets on the 1st.

Typical cost per lead run (100 leads, Cairo):
| Step | Requests |
|------|----------|
| Instagram collection (3 queries × 1 city) | 3 |
| Phone enrichment (~50 leads) | 50 |
| L1 Google name search (~46 new leads, 4 queries) | 184 |
| LinkedIn URL lookup (~46 leads) | 46 |
| Instagram handle search (~46 leads, 2 queries each) | 92 |
| **Total** | **~375** |

With 3 active keys (7,500 credits/month): roughly **20 full runs per month**.

---

## All Issues Encountered & Their Status

| # | Issue | Status | Fix |
|---|-------|--------|-----|
| 1 | Neo domain blocked by Serper | Fixed | `neoBlocked = true` set on rejection |
| 2 | `neoBlocked` flag never set → infinite retry loop | Fixed | Added flag to `email_blocked` handler |
| 3 | `cockliBlocked` flag never set | Fixed | Added to same handler |
| 4 | ERR_NAME_NOT_RESOLVED after VPN rotation | Fixed | `pollConnected()` 30s wait + 3s DNS settle |
| 5 | Two keygen instances spawning at once | Fixed | Lock file check in `monitor.js` |
| 6 | "cannot register at the moment" → no retry | Fixed | `service_down` classifier → 3 retries, 60s delay |
| 7 | No preflight check → silent failures | Fixed | `preflightCheck()` before every run |
| 8 | No error classification → wrong recovery | Fixed | `classifySignupError()` routes each error type |
| 9 | Gmail `+alias` rejected by Serper | Fixed | Reverted to plain Gmail (no alias) |
| 10 | IP rate-limited from multiple attempts | Pending | Run with VPN from separate terminal |
| 11 | All 6 keys exhausted (quota) | Pending | Need fresh keygen run to generate new key |

---

## Potential Future Issues

| # | Issue | Likelihood | Prevention |
|---|-------|-----------|------------|
| 12 | cock.li domain blocked by Serper | High | Use Gmail pool instead |
| 13 | Gmail address already registered on Serper | Medium | Use fresh Gmail, add more to pool |
| 14 | wit.ai rate-limited → audio CAPTCHA fails | Medium | 2captcha fallback configured as backup |
| 15 | Turnstile visual challenge blocks run | Medium | Solve manually or add TWOCAPTCHA_API_KEY |
| 16 | Browser profile flagged by Cloudflare | Low | Auto-rotation retires profile after 5 uses |
| 17 | Fresh domain also gets blocklisted | Low (months) | Rotate to another domain |

---

## Issues Avoided by Design

| # | Issue | How It's Avoided |
|---|-------|----------------|
| 18 | VPN breaking Claude Code API | `KEYGEN_NO_VPN=1` env var disables OS routing |
| 19 | Stale lock file blocking next run | Lock >2 min old auto-deleted on startup |
| 20 | Duplicate keys saved as fresh | Consecutive dup counter → 2h pause after 3 dups |
| 21 | `serper_keys.json` corrupted on crash | Atomic write (temp file → rename) |
| 22 | Two parallel keygen instances | Lock file in both `key_generator.js` and `monitor.js` |
| 23 | Wrong profile reused too many times | Profile pool — max 5 uses per profile, then retired |

---

## Quick Diagnostics

```bash
# Check key statuses
node -e "console.log(require('./serper_keys.json').map(k=>k.key.slice(0,8)+'... '+k.status).join('\n'))"

# Test a specific key live
node -e "
fetch('https://google.serper.dev/search',{method:'POST',headers:{'X-API-KEY':'PASTE_KEY_HERE','Content-Type':'application/json'},body:JSON.stringify({q:'test',num:1})})
.then(r=>r.json()).then(d=>console.log(d.organic?'OK':'FAIL',d.message||''))
"

# Force-mark all quota keys as ok (for testing only)
node -e "
const fs=require('fs');
const k=JSON.parse(fs.readFileSync('serper_keys.json'));
k.forEach(x=>{ if(x.status==='quota') x.status='ok'; });
fs.writeFileSync('serper_keys.json',JSON.stringify(k,null,2));
console.log('done');
"

# Clear stale lock file
node -e "try{require('fs').unlinkSync('.keygen.lock')}catch{} console.log('done')"
```
