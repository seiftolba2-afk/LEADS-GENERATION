# Lead Generation System — Full Improvement History
Last updated: 2026-04-29

---

## 1. Project Overview (What This Is)

A Node.js lead generation system that scrapes Google Maps (via Serper /maps) for contractors across 200+ US cities, enriches each lead with an owner name via a multi-layer waterfall, scores them, and outputs Excel files.

**Stack:** Node.js (CommonJS) — `xlsx`, `axios`, `cheerio`, `csv-parser`, native `dns`, native `fetch`

---

## 2. Architecture: Before vs. After

### Original Architecture (3 monolithic scripts)
- `local_aggregator.js` — full self-contained roofing script (~800 lines)
- `solar_aggregator.js` — full self-contained solar script (~800 lines)
- `hvac_aggregator.js` — full self-contained HVAC script (~800 lines)
- Each had its own copy of the waterfall, dedup, scoring, and Excel writer
- Changes had to be made 3 times (once per script)

### Current Architecture (shared engine + thin wrappers)
- `aggregator_core.js` — single shared engine (~700 lines), all improvements live here
- `cities.js` — shared city pool module (203 cities)
- **8 thin industry wrappers** (10–15 lines each): `local_aggregator.js`, `solar_aggregator.js`, `hvac_aggregator.js`, `plumbing_aggregator.js`, `electrical_aggregator.js`, `landscaping_aggregator.js`, `painting_aggregator.js`, `general_contracting_aggregator.js`
- Each wrapper calls `require('./aggregator_core').run(config)` — nothing more
- Changes to the engine automatically apply to all 8 industries

---

## 3. New Scripts Added

| Script | Purpose |
|--------|---------|
| `leads.js` | On-demand generator: `node leads.js 300 roofing` — 7-layer waterfall, targets named+scored leads |
| `app.js` | Express server with HTML UI — drives `leads.js`, shows progress bar, live log |
| `best15.js` | Curated top-15: pulls all xlsx files, deduplicates by phone, picks best 8 micro-biz + 7 overall |
| `best20.js` | Same as best15 but top-20 split |
| `fix_excel.js` | Batch cleanup: repairs all xlsx files in folder (phone format, fake emails, toll-free filter) |
| `run_all.bat` | Runs all 8 industry scrapers sequentially, logs to `tasks/run_log.txt` |
| `schedule_overnight.bat` | Registers a Windows Task Scheduler job at 2 AM daily |

---

## 4. Waterfall: Before vs. After

### Original (12 layers)
1. Serper Google Search (4 parallel queries, first win)
2. ScrapingBee website scrape (/contact, /, /about, /our-team)
3. Email prefix parse
4. Phone number Google search
5. State contractor license DB (TX, FL, GA, NC, IL, AZ, CO, TN — 8 states)
6. BBB direct scrape
7. Angi profile (Serper site: query)
8. Houzz profile (Serper site: query)
9. Yelp business page
10. Secretary of State registry
11. TripAdvisor
12. Facebook business page

### Current (13 layers + DDG fallback)
1. **Serper Google Search + DuckDuckGo fallback** — 4 Serper queries fire in parallel; if all miss, DDG fires for free (no credits burned)
2. **Website scrape** — direct fetch, no ScrapingBee credits (paths: /contact, /contact-us, /, /about, /about-us, /our-team, /team)
3. **Manta.com** — business directory via Serper site: query + direct scrape
4. **Porch.com** — contractor directory
5. **Email prefix parse** — extracts name from non-generic email prefix
6. **Phone number Google search** — searches formatted phone for owner mentions
7. **State contractor license DB** — expanded: 8 → 30 states (direct scrape + Serper site: for JS-rendered pages)
8. **BBB direct scrape** — finds Principal name
9. **Angi profile**
10. **Houzz profile**
11. **Yelp business page**
12. **OpenCorporates** — free API, covers all 50 states, no auth needed
13. **Facebook business page** — About section + review response signatures

**Thumbtack** — owner name found in Serper snippets (wired as a snippet-only check, no full scrape)

---

## 5. Name Waterfall Improvements

### STOPS Set Expanded
Added industry-specific noise words to prevent false positives:
- Social platforms: Instagram, Facebook, Twitter, YouTube, LinkedIn, TikTok, Yelp, Pinterest, Snapchat, etc.
- All US state names
- Industry names: Roofing, Solar, Hvac, Plumbing, Electrical, Landscaping, Painting
- Job titles: Manager, President, Owner, Principal, Director, Specialist, Consultant, etc.

### Name Validation Rules Added
- Minimum 3 chars, must have vowels
- No state abbreviations as names ("MI", "On")
- **All-caps names (3+ chars) are blocked** — not real person names
- Parts must be 2–3 words (no solo first names, no 4-word strings)
- No digits in name parts

### Name Confidence Scoring (new)
Each found name gets a confidence source tag:
- `license` / `bbb` / `website` = high confidence (+2 to score)
- `serper` / `facebook` = normal confidence
- `facebook` = slight penalty (-1) — FB bios are often team pages

---

## 6. Data Quality Rules (Corrections Applied)

| Rule | Before | After |
|------|--------|-------|
| Max review count | 150 | **100** |
| Phone minimum digits | 7 | **10** |
| Toll-free numbers | allowed | **blocked** (800/888/877/866/855/844/833) |
| Fake emails | basic check | **blocked**: domain.com, example.com, email@domain.com, user@domain.com |
| Email cross-domain | allowed | **blocked** — email domain must match company website domain |
| Email prefix mismatch | not checked | **blocked** — prefix must match owner name (jeffferguson@ on Chris Hohman = invalid) |
| All-caps names | allowed | **blocked** |
| Short names | 2+ chars | **3+ chars with vowels required** |

---

## 7. Deduplication: Before vs. After

### Before
- In-memory: dedup by `company_domain` then `company_name`
- `seen_companies.json`: persistent cross-run list (read-merge-write)
- `leads_progress.csv`: `loadProgress()` skips already-done companies

### After (3 layers + 2 new methods)
- **In-memory**: same as before
- **Fuzzy company name dedup**: Levenshtein edit distance ≤ 2 catches near-duplicates ("ABC Roofing" vs "ABC Roofings")
- **Phone dedup**: same phone number = same business, keep the record with the higher score
- `seen_companies.json`: each industry keeps its own separate file (never shared across industries)
- `loadProgress()`: guard changed from fatal error on old CSVs to non-fatal warning — preserves resume on schema changes

---

## 8. Scoring: Before vs. After

### Original Scoring
- Base: 10 (name=5, phone=5)
- +5 email found
- +1 rating ≥ 4.5
- +1 review count 20–100
- Max: 17

### Current Scoring (aggregator_core.js)
- Base: 10 (name=5, phone=5)
- +5 email found and domain-verified
- +2 name from license DB or website (high confidence)
- +1 rating ≥ 4.5
- +1 review count 20–100
- Max: ~20

### leads.js / best20.js Scoring (separate system)
- Base: 10 (name=5, phone=5)
- +5 email found
- +1 rating ≥ 4.5
- +1 review count 20–100
- **Facebook followers < 200: +2** ("owner answers direct")
- **Facebook followers 200–1000: +1**
- Over 1000 followers: no bonus (likely has staff/gatekeeper)
- Max: 12

---

## 9. Output Format: Before vs. After

### Headers (aggregators)
```
lead_id, source, first_name, last_name, full_name,
email, phone, job_title, company_name, company_domain,
location_city, location_state, linkedin_url,
google_rating, review_count, lead_score, score_reason, status
```

### Headers (leads.js / best20)
```
company_name, owner_name, first_name, last_name,
phone, email, linkedin_url, website,
city, state, review_count, rating,
confidence, lead_score, score_reason,
google_maps_url, industry, facebook_followers, status
```

### Columns Removed
- `email_guess` — removed entirely from all output (user decision)
- `phone_type` — removed (filtering already ensures wireless; redundant column)
- `phone_source` — optional, removed to reduce clutter

### Columns Added
- `facebook_followers` — small biz signal, kept in output
- `confidence` / `name_source` — shows where name came from
- `google_maps_url` — direct link to Maps listing

### Excel Formatting Improvements
- Phone column always forced to text (`t:'s'`, `z:'@'`) — prevents xlsx converting to number
- Auto-filter on all columns
- Column widths auto-sized
- `company_domain` column is a clickable hyperlink
- **Stats tab** added: name hit rate, email rate, avg score, top cities by lead count

---

## 10. Email Verification (New — Zero Cost)

Added DNS MX record check using Node.js built-in `dns.promises.resolveMx()`:
- Verifies the email domain actually has mail servers
- No external API needed, no credit cost
- Runs after extracting any email candidate
- Failed MX = email discarded

---

## 11. API Key Handling: Before vs. After

### Before
- Single Serper key hardcoded in each script

### After
- `SERPER_API_KEYS` array — dual-key failover
- If key 0 returns 401/403/429, automatically switches to key 1
- Prevents full script stop on key exhaustion mid-run
- ScrapingBee replaced by direct `fetch()` on most layers (saving credits)
- DuckDuckGo wired as free fallback after Layer 1 Serper miss

---

## 12. City Pool: Before vs. After

| | Before | After |
|-|--------|-------|
| Cities | 57 | **203** |
| States | ~15 | **33** |
| Source | hardcoded per-script | `cities.js` shared module |

Cities sorted by population / market value (highest-ROI markets first).

---

## 13. State License DB: Before vs. After

| | Before | After |
|-|--------|-------|
| States covered | 8 (TX, FL, GA, NC, IL, AZ, CO, TN) | **30 states** |
| Method | direct scrape only | direct scrape + Serper site: for JS-rendered pages |

---

## 14. Concurrency & Rate Limiting

No changes to core limits:
- `createLimit(8)` — 8 leads processed in parallel
- `sleep(800)` between city fetches
- `sleep(300–400)` between waterfall layer calls
- `fetchSafe()` — 3 retry attempts, 1.5s × attempt backoff on 429

**Rule enforced:** Any new scraping layer added must include `await sleep(300)` after it.

---

## 15. Bugs Fixed

| Bug | Root Cause | Fix Applied |
|-----|-----------|------------|
| Phone saved as number in Excel | xlsx auto-converts numeric strings | Force `t:'s'` + `z:'@'` on phone cells |
| `seen_companies.json` wiped on write | Code was overwriting instead of merging | Changed to read → merge → write pattern everywhere |
| Resume broken after schema change | `loadProgress()` threw fatal error on old CSV | Changed to non-fatal warning, skips bad rows |
| ScrapingBee credits burning fast | No early exit in paths loop | `if (foundName && foundEmail) break` enforced inside loop |
| Name false positives ("MI", "General") | STOPS set was too small | Expanded STOPS with all state names + job titles + social platforms |
| `EBUSY` error on save | Output file open in Excel | User reminded to close Excel before running |
| Serper 429 quota exhausted | Retries tried to fix monthly limit | `fetchSafe()` surfaces quota errors; dual-key failover added |
| AbstractAPI wrong endpoint | `phonevalidation.abstractapi.com` used | Corrected to `phoneintelligence.abstractapi.com/v1/` |
| AbstractAPI wrong response field | `data.type.type` used | Corrected to `data.phone_carrier.line_type` |
| Best20 had duplicate leads in both groups | No cross-group dedup | Set-based deduplication added across both groups |
| Email cross-domain leak | Emails from unrelated companies passed through | Added domain-match check (email domain must match company domain) |
| Email prefix mismatch | `jeffferguson@` accepted on Chris Hohman's record | Added name-prefix cross-check |
| `guessEmails()` slow | DNS MX check adding 1.5s per lead | `guessEmails()` removed entirely |
| `fix_excel.js` resetting on old CSVs | Guard too aggressive | Made non-fatal with warning |
| `facebook_followers` missing when Serper returns nothing | No fallback | Falls back to cached xlsx value |

---

## 16. leads.js / app.js Specific Improvements

- `__POOL__:N:M` signal: `leads.js` sends pool size to `app.html` → banner shows "Best X from Y enriched"
- `__NAMED__:N` markers: hidden from log display, only update status bar counter
- Early-exit `if (named.length >= TARGET) break` was **removed** — full-pool enrichment: enrich all qualified leads, sort by score, cut at end
- Progress bar shows `[X/Y candidates]` processing progress
- Status bar shows "X named so far" live counter
- Done banner shows final pool size

---

## 17. Best15 / Best20 Logic

- Total: 20 leads (best20) or 15 leads (best15)
- Split: **8 micro-biz** (Facebook followers < 200) + **7 (or 12) best overall**, no overlap between groups
- Phone priority: Facebook phone → Website phone → Google Maps phone
- Phone type check via **AbstractAPI Phone Intelligence** (free 100/month)
  - Endpoint: `phoneintelligence.abstractapi.com/v1/`
  - Field: `data.phone_carrier.line_type`
  - Values: `"mobile"`, `"landline"`, `"voip"` (lowercase)
  - Landlines discarded entirely; if all sources landline → skip lead
- Reads from **all existing xlsx files** in the folder
- Deduplicates across files by phone number

---

## 18. Automation Added

| File | Purpose |
|------|---------|
| `run_all.bat` | Runs all 8 industries sequentially, logs to `tasks/run_log.txt` |
| `schedule_overnight.bat` | Registers Windows Task Scheduler job at 2 AM daily |

Zero new paid APIs added for automation.

---

## 19. Filter Criteria (passesFilter)

A lead must pass all of these:
- Phone number present — **10+ digits** (was 7)
- Phone is **not toll-free** (800/888/877/866/855/844/833 blocked)
- `review_count` between 0 and **100** (was 150)
- Company name not in `seen_companies.json`
- Company not already in progress CSV

Do not change these thresholds without updating scoring logic to match.

---

## 20. Industry Wrappers (New Industries Added)

| Wrapper | Industry | ID | Output File |
|---------|---------|-----|------------|
| `local_aggregator.js` | Roofing | RF | `SAMPLE.xlsx` |
| `solar_aggregator.js` | Solar | SL | `SAMPLE_SOLAR.xlsx` |
| `hvac_aggregator.js` | HVAC | HV | `SAMPLE_HVAC.xlsx` |
| `plumbing_aggregator.js` | Plumbing | PL | `SAMPLE_PLUMBING.xlsx` |
| `electrical_aggregator.js` | Electrical | EL | `SAMPLE_ELECTRICAL.xlsx` |
| `landscaping_aggregator.js` | Landscaping | LS | `SAMPLE_LANDSCAPING.xlsx` |
| `painting_aggregator.js` | Painting | PT | `SAMPLE_PAINTING.xlsx` |
| `general_contracting_aggregator.js` | General Contracting | GC | `SAMPLE_GC.xlsx` |

---

## 21. Dedup Files Per Industry (Never Share)

| File | Industry |
|------|---------|
| `seen_companies.json` | Roofing |
| `seen_companies_solar.json` | Solar |
| `seen_companies_hvac.json` | HVAC |
| `seen_companies_plumbing.json` | Plumbing |
| `seen_companies_electrical.json` | Electrical |
| `seen_companies_landscaping.json` | Landscaping |
| `seen_companies_painting.json` | Painting |
| `seen_companies_gc.json` | General Contracting |

`leads.js` uses `seen_companies.json` (shared across all industries when run on-demand — note this difference from aggregator scripts).

---

## 22. Known Constraints & Workflow Rules

- **Never change `findOwner()` waterfall order** without measuring impact on name hit rate first
- **Never touch dedup logic** without confirming with user
- **Test on 5–10 leads first** before full city run — do not burn Serper monthly quota
- **Close Excel** before running any script that writes xlsx (EBUSY error otherwise)
- `leads_progress.csv` is the safety net — never delete mid-run
- Only touch what's necessary — no side effects on unrelated logic
- Serper 429 on monthly quota: retries will NOT fix it — surface the error and stop

---

## 23. API Keys Reference

| Key | Service | Free Tier | Note |
|-----|---------|-----------|------|
| `89d5c446b0914c18f36c2aa2ce459d30abb3377a` | Serper (primary) | Monthly limit | 4 parallel queries per lead |
| `ec069cd8c5fd07a1bb0dc9ab59e89d91c09a1d07` | Serper (backup / leads.js) | Monthly limit | Failover key |
| `CXBUX27L6I5GVSLD0VOCI2WY1X2KMN7UWYWO5HF3LZMILEOZFWDAWBMLM2LP39C254BD0YXBL9WX0EPB` | ScrapingBee | Per-credit | Now mostly replaced by direct fetch |
| `6fe0302d6fc642a8a26b8b2e4b31d416` | AbstractAPI Phone Intelligence | 100/month free | Only used in best15/best20 |

---

## 24. Summary Table: Before vs. After

| Metric | Before | After |
|--------|--------|-------|
| Industries | 3 | **8** |
| Cities | 57 | **203** |
| Waterfall layers | 12 | **13 + DDG fallback** |
| State license DBs | 8 | **30** |
| Dedup methods | domain + name | domain + fuzzy name + phone |
| Toll-free filter | no | **yes** |
| Email domain verify | no | **yes (DNS MX, free)** |
| Email cross-domain check | no | **yes** |
| Name confidence scoring | no | **yes** |
| Excel stats tab | no | **yes** |
| Clickable hyperlinks | no | **yes** |
| Phone format enforcement | partial | **always t:'s' + z:'@'** |
| New paid APIs | — | **0** |
| Automation | manual | **2 AM daily scheduler** |
| Script architecture | 3 monoliths | **1 engine + 8 wrappers** |
