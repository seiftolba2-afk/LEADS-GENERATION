# Review Log
2026-04-29

---

## Hostile Code Review

Read in scope: `aggregator_core.js`, `leads.js`, `best15.js`, `best20.js`, 8 industry wrappers (`local_aggregator.js`, `solar_aggregator.js`, `hvac_aggregator.js`, `plumbing_aggregator.js`, `electrical_aggregator.js`, `landscaping_aggregator.js`, `painting_aggregator.js`, `general_contracting_aggregator.js`). I would reject this PR. Findings below by severity.

### CRITICAL — would block merge

1. **Runtime ReferenceError in `leads.js`** — line 1029: `dropped++; return;` references an undeclared `dropped` variable. The `for (const { lead, r, idx } of results)` block is inside an async function, so the ReferenceError throws and `return` exits `run()` entirely. This path triggers when AbstractAPI marks all candidate phones as landline. **Real bomb sitting in production code.**

2. **Dead `extractFromReviews` layer in `leads.js`** — `lead._reviews` is initialized to `[]` (line 481) and never populated. Layer 4 of the waterfall is dead code that costs nothing but hides a missing feature.

3. **Race conditions on shared module state in `aggregator_core.js`** — `serperKeyIdx`, `scrapeCache`, and `CONFIG` are module-level. If `run()` is invoked twice in the same Node process (or if a caller imports both `local_aggregator.js` and `solar_aggregator.js`), they trample each other's state. The `scrapeCache.clear()` at the top of `run()` will wipe an in-flight cache from a parallel run.

4. **Hardcoded API keys in source files** — Serper, ScrapingBee, AbstractAPI keys are committed in `aggregator_core.js`, `leads.js`, `best15.js`, `best20.js`. Anyone with file access has free use of paid quotas. Treated more thoroughly under Security Scan.

5. **Filter / scoring inconsistency in `aggregator_core.js`** — `passesFilter()` accepts review_count 0–250, but the hot/all split slices at ≤120 and ≤200. CLAUDE.md says max=100. Three sources of truth, all different. Leads with 121–200 reviews are admitted into the pipeline, paid for in Serper credits, then silently discarded at the end.

6. **CSV resume is brittle** — `loadProgress()` reads CSV but does not verify `HEADERS` order matches the on-disk file. If `HEADERS` changes between runs, columns silently misalign and old rows poison the new run. Made worse by no schema version tag in the file.

7. **Two parallel runs corrupt `seen_companies*.json`** — `loadSeen()` then `saveSeen()` is read-merge-write with no locking. Concurrent processes overwrite each other.

8. **CSV injection vector in `csvRow()`** — escapes quotes but not the leading `=`, `+`, `-`, `@`. A scraped company name beginning with `=cmd|...` writes a live formula. Excel auto-executes on open. Real exploit when scraping arbitrary text from the open web.

### MEDIUM — should fix before declaring system "complete"

9. **Massive code duplication across `aggregator_core.js` and `leads.js`** — both implement `extractDomain`, `emailPrefix`, `STOP_WORDS`/`STOPS`, name validation, license-DB scraping, Facebook search, and Excel writers. Two implementations have already drifted (different return shapes for `emailPrefix`: `{fullName}` vs `{name}`). Future bug fixes will only land in one place.

10. **`leads.js` ignores `cities.js`** — has its own 175-line inline `CITY_POOL` (~140 cities) while aggregators use `cities.js` (203 cities). Identical concept, divergent data.

11. **`best15.js` and `best20.js` are 90% identical** — already flagged in Part 2 of the user's plan. Different sheet names, slightly different scoring split, otherwise the same script.

12. **`serperPost` falls through to `undefined`** when all keys fail in the `catch` branch (lines 67-71). Callers happen to handle `!res` correctly, but the function should explicitly `return null`.

13. **Waterfall is 100% sequential** — `findOwner()` runs 13 layers in series with `sleep(300)` between each. Many layers (BBB, OpenCorporates, Yelp, Manta) are independent and could run in parallel. Current minimum cost per lead = ~13s of layer latency + 12 × 300ms sleep ≈ 17s.

14. **`createLimit(8)` concurrency is set on `findOwner()` calls but each call internally fires up to 4 Serper queries in parallel** (line 234). Effective concurrency = 32 simultaneous Serper requests. Not what the comment implies.

15. **Levenshtein dedup is O(N²·m·n)** — `dedupe()` (lines 739–760) compares every new lead against every prior lead's normalized name. With 5,000 raw leads × ~15-char average, ~12.5M Levenshtein cell evaluations. Acceptable today, will become a bottleneck.

16. **`fetchSafe` swallows all errors silently** — no log on network failure, no log on non-2xx outside 429. A permanently-broken site costs 3 retries × 15s timeout = 45s of dead time per lead, invisible.

17. **`Promise.all([searchResult, licenseResult, fbResult])` in `leads.js`** (line 543) — runs all three even when the first one returns a name. Wastes 2 of 3 Serper credits per lead reaching that branch.

18. **State coverage drift** — OpenCorporates state map covers 35 states; license-DB direct + serper map covers 30 states; not all overlap. Indiana, Maryland, Mississippi, Iowa, Kansas, Nebraska, Wisconsin have OpenCorporates only.

19. **`scoreLead` reads `lead.google_rating` with `parseFloat(empty)`** = `NaN`. `NaN >= 4.5` is false, so it works by accident. Silent.

20. **Stats-tab "name hit rate"** counts `l.full_name` truthy, but lead.full_name is set during enrichment regardless of validation pass/fail. Metric is inflated.

21. **`emailMatchesOwner` defaults to `true` if either name part is blank** — allows any email through when the waterfall returned a single-name result. Too permissive.

22. **`stormFlag()` baked into rows on write** — never re-evaluated. Old CSV rows show `YES` long after the season ends.

23. **`__POOL__:N:M` / `__NAMED__:N` log markers** — fragile string coupling between `leads.js` and `app.js` HTML. A single newline change breaks the UI parser.

24. **Deduplication target ambiguity** — `aggregator_core.dedupe()` strips industry suffixes ("roofing", "solar", etc.) from company names before fuzzy-matching. So "ABC Roofing" and "ABC Solar" collapse to the same key in cross-industry contexts. Not used in cross-industry today, but a footgun for future best-of-X scripts.

25. **`Layer N` numbering inconsistent** — comments call Manta "Layer 2b" but `findOwner` logs it as `L2c`. Newcomers can't tell which layer is which from logs alone.

26. **No graceful shutdown** — Ctrl+C mid-run leaves checkpoint xlsx half-written; CSV is incremental so survives.

27. **No CLI argument validation in wrappers** — `local_aggregator.js` etc. accept no args, but if someone passes them they're silently ignored. `leads.js` validates target but not industry against the actual list.

28. **`scrapeFbPage` in `best15.js`** silently drops if `m.facebook.com` redirect happens — no diagnostic.

29. **AbstractAPI quota burn** — `best15.js` makes up to 60 phone-type calls per run; AbstractAPI free tier = 100/month. Two best15 runs ≈ exhausted quota. No counter, no warning.

30. **`top50.sort` after partial enrichment in `best20.js`** — top-50 chosen *before* Facebook enrichment. Leads ranked 51+ never get the chance to climb after FB bonus. Same shape in `best15.js` with top-60.

31. **`maxScore` is guessed from headers** — `normalize()` in best15/best20 detects "is this an aggregator file" by checking if `name_source` or `location_city` columns exist. Schema-sniffing is brittle; one renamed column breaks scoring normalization across files.

### LOW — nits and polish

32. All 8 wrappers are 17 lines of near-identical boilerplate. Replace with a single `industries.js` config + one CLI entrypoint that accepts `--industry`.
33. Hardcoded `D:\\LEADS GENERATION\\` paths everywhere. Not portable. No env-var override.
34. No `package.json` scripts (`npm run roofing`, `npm run best`, etc.).
35. No `.gitignore` for `*.xlsx`, `*.csv`, `seen_companies*.json`. If repo is ever pushed, output files leak.
36. No tests. CLAUDE.md mandates "test on 5–10 leads first" but there is zero automation for that.
37. No JSDoc / type hints on any function.
38. Console output uses emoji extensively — fine on UTF-8 terminals, prints `?` on default Windows CMD.
39. No retry/backoff for Serper Maps endpoint outside `fetchSafe` — `fetchGoogleMapsLeads` (in `leads.js`) just bails on any non-OK status.
40. `sleep(800)`, `sleep(400)`, `sleep(300)` are scattered magic numbers. Centralize as named constants.
41. Comment in `aggregator_core.js` says "13 layers + DDG fallback" — but DDG is *inside* Layer 1, not its own layer. Comment lies.
42. `extractDomain` is defined twice with slightly different behavior. Move to a `utils.js`.
43. `scoreLead` mixes magic numbers (+5, +2, +1) without constants or commentary on tuning rationale.
44. `loadProgress` parses CSV by hand instead of using `csv-parser` (which is already in dependencies). Inconsistent.
45. `appendToProgress` writes synchronously inside the hot loop. `fs.promises.appendFile` would be drop-in async.

---

## Security Scan

Reviewed: `aggregator_core.js`, `leads.js` (`best15.js`/`best20.js` reviewed for secrets only).

### CRITICAL

A. **Hardcoded API keys in committed source**
   - `aggregator_core.js:934` — Serper primary key
   - `aggregator_core.js:934` — Serper backup key
   - `aggregator_core.js:935` — ScrapingBee key
   - `leads.js:55` — Serper key (different from aggregator_core)
   - `leads.js:56` — AbstractAPI Phone Intelligence key
   - `best15.js:6-7` — AbstractAPI key + Serper key (third copy)
   - `best20.js:94` — Serper key (fourth copy)
   - **Impact:** anyone with file/repo access can drain paid quotas. If any output xlsx or this folder is ever shared (Slack, GitHub, screen-share), keys leak.
   - **Fix:** load from `.env` via `process.env.SERPER_API_KEY`. Add `.env.example` with key names. Add `.env` to `.gitignore`.

B. **CSV injection vector** — `csvRow()` (`aggregator_core.js:784`) wraps fields in quotes and escapes `"` to `""`, but does not prefix dangerous leading characters (`=`, `+`, `-`, `@`, tab, CR). A scraped company name like `=HYPERLINK("evil.com","click")` will execute as a formula when the CSV (or an Excel-imported version) is opened. Names come from arbitrary internet sources (Google Maps titles, BBB, Facebook). **Live exploit path.**
   - **Fix:** in `csvRow()`, prepend `'` to any field whose first char is in `[=+\-@\t\r]`.

C. **No daily/monthly Serper quota cap** — script will blast through whatever's left until 401/403/429. A bug in a loop could exhaust an entire month's quota in one run. There is no kill-switch other than the upstream API rejecting requests.
   - **Fix:** add a per-run request counter, configurable cap (default e.g. 2000 requests), abort with clear error if exceeded.

### MEDIUM

D. **Concurrent-write race on `seen_companies*.json`** — read-merge-write with no lock. If `run_all.bat` is updated to launch two industries in parallel, or if `leads.js` runs alongside an aggregator, the JSON is corrupted. Not an authentication issue, but a data-integrity attack-surface.
   - **Fix:** `proper-lockfile` or atomic write (`writeFile(tmp); rename(tmp, target)`).

E. **`JSON.parse` on arbitrary HTTP response bodies** — e.g., `aggregator_core.js:436` (`JSON.parse(html)` from OpenCorporates), `leads.js:418` (AbstractAPI). If the upstream returns an HTML error page, `JSON.parse` throws. Caught by enclosing try/catch in OpenCorporates, **but in `getPhoneType` the catch only wraps the fetch — `JSON.parse(res)` is inside try.** Verified safe, but the pattern is brittle. Validate `Content-Type` first.

F. **PII in stdout/log** — `console.log(name.fullName)` in every layer hit. If logs are captured (CI, screen recording, terminal scroll-back), real owner names + phones flow through. Aligns with GDPR/CCPA exposure if any of those leads are EU/CA residents.
   - **Fix:** log mode toggle (`LOG_LEVEL=quiet` redacts to first-initial-only). Default to verbose remains acceptable for personal-use single-developer setup.

G. **`fetchSafe` follows redirects implicitly** (Node's default `fetch`). HTTPS-to-HTTP downgrade redirects from a hostile origin would leak headers. Low-risk in practice (we send no auth headers to scraped sites), but worth `redirect: 'manual'` + an explicit allowlist when scraping unknown domains.

H. **DuckDuckGo HTML scraping** — `duckSearch` parses raw HTML with regex. If DDG ever serves modified markup (which they do periodically), the regex falls through silently. Not a security issue — a freshness issue. Same for Yelp/BBB scrapers.

### LOW

I. **No HTTP timeout on AbstractAPI in `best15.js`** — `signal: AbortSignal.timeout(6000)` is set, so this is actually OK. Skip.

J. **OpenCorporates rate limits aren't tracked** — free tier is 500 req/day. No counter.

K. **`process.exit(1)` only on explicit OUT_OF_CREDITS, not on generic Serper failure** — silent partial runs are possible. Minor reliability, not security.

L. **Phone-number format-string in `phoneSearch`** — `(${digits.substr(0,3)}) ${digits.substr(3,3)}-${digits.substr(6,4)}` is inserted into Serper query as a quoted string. Search-injection is moot (Serper sees it as a string literal). No issue.

M. **`scrapeSite` default User-Agent** identifies as Chrome/Mozilla. Most sites accept it. Not a security flaw, but TOS-questionable for some properties (Facebook, Yelp).

---

## Summary

- **2 runtime time-bombs:** the `dropped` ReferenceError in `leads.js:1029`, and the dead `extractFromReviews` layer.
- **1 stored-attack vector:** CSV injection from scraped company names.
- **1 secrets-leak:** four files contain live paid API keys.
- **1 data-integrity hazard:** concurrent runs corrupt `seen_companies*.json`.
- **1 budget hazard:** no Serper monthly cap; bugs can drain the quota.
- **Major architectural smells:** duplicated `extractDomain`/`emailPrefix`/`STOP_WORDS`/license-DB code in aggregator_core vs leads.js; near-identical best15/best20; 8 wrapper files that could be one CLI.

If you want me to proceed to **Step B (CLAUDE.md additions)** I will draft the diff next and wait for approval before writing.
