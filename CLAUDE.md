# CLAUDE.md — Egypt Lead Generation Project

> Permanent project config. Every session inherits all rules below.

---

## Response Style

- Skip pleasantries. No "great question!" or "I'd be happy to help."
- Start with the answer. End when it's done.
- High-level summary at each step — not a novel.
- One focused question if blocked — then proceed.
- Show before/after diffs when changing logic, not just the new code.

---

## Token Rules

- Never re-explain what you already did. Pick up where you left off.
- When the conversation grows long: summarize state into 5–7 bullet points and continue in a fresh context. Don't let token bloat silently degrade quality.
- Use the right model for the right job:
  - **Sonnet** — 95% of tasks: edits, debugging, adding features, everyday work
  - **Opus** — only for complex architectural decisions or deep reasoning
  - **Haiku** — quick lookups, one-liners, throwaway checks

---

## Project Overview

**What this is:** A Node.js lead generation system that scrapes Instagram (via Serper) for interior design companies in Egypt, enriches each lead with owner name + phone, scores them, and outputs an Excel file for the client.

**Stack:** Node.js (CommonJS) — `xlsx`, `axios`, `cheerio`, `puppeteer`

**Entry point:**

| Script | Targets | Output file |
|--------|---------|-------------|
| `interior_design_aggregator.js` | Interior design companies on Instagram (Egypt) | `out/Kareem Tolba.xlsx` |

**Target per run:** 100 leads from Instagram with 5K–10K followers. All leads must have owner name + phone.

**Country context:** Egypt (+20). All Serper queries use `gl: 'eg'`. Veriphone validates Egyptian numbers.

---

## File Map

| File | Role |
|------|------|
| `interior_design_aggregator.js` | Entry point — passes config to orchestrator |
| `agents/agent_orchestrator.js` | Core engine — city loop, dedup, scoring, output |
| `agents/agent_instagram.js` | Instagram scraper — main lead source |
| `agents/agent_facebook.js` | Facebook enrichment layer |
| `agents/agent_directory.js` | Directory search + Facebook follower fetch |
| `agents/agent_scraper.js` | Website scraper — finds owner name + email |
| `agents/agent_serper.js` | Serper API wrapper — maps + search |
| `agents/agent_linkedin.js` | LinkedIn profile lookup |
| `agents/agent_output.js` | Excel writer + manual review sheet |
| `agents/key_generator.js` | Auto-generates Serper accounts via Outlook |
| `agents/outlook_creator.js` | Creates Outlook email accounts (for keygen) |
| `agents/windscribe_manager.js` | VPN manager for IP rotation |
| `agents/shared_state.js` | Shared concurrency limiter + state across agents |
| `cities.js` | Egypt cities list (Cairo, Alexandria, etc.) |
| `db.js` | Lead progress CSV helpers |
| `key_manager.js` | Serper key pool — reads/validates `serper_keys.json` |
| `monitor.js` | Run health monitor |
| `search_router.js` | Routes search queries across active Serper keys |
| `serper_keys.json` | Live Serper API key pool (managed by keygen) |
| `leads_ID.json` | Interior design lead database |
| `seen_companies_id.json` | Cross-run dedup list for interior design |
| `leads_id_progress.csv` | Resume file — one row per confirmed lead |
| `out/Kareem Tolba.xlsx` | Main output Excel |
| `out/InteriorDesign.xlsx` | Alternate output (manual review included) |
| `enrich_existing_leads.js` | Enriches + cleanses the leads_ID.json database |
| `quick_fix_db.js` | One-off DB fixes (recalculate scores etc.) |
| `regen_excel.js` | Regenerates Excel from leads_ID.json without re-scraping |
| `fix_singles.js` | Removes single-word (unresolved) names from DB |
| `test_normalize.js` | Tests company name normalization (Arabic + English) |
| `setup_keys.js` | One-time: validate hardcoded Serper keys into pool |
| `tasks/todo.md` | Active plan with checkable items |
| `tasks/lessons.md` | Patterns learned from corrections |
| `tasks/review.md` | Post-run results and notes |

---

## API Keys

| Key | Service | Note |
|-----|---------|------|
| `serper_keys.json` pool | Serper — Google Maps + Search + Instagram | Auto-rotated by key_manager; replenished by keygen |
| `VERIPHONE_KEY` (in .env) | Phone validation | Egyptian numbers (`+20`) |
| `SCRAPINGBEE_API_KEY` (in .env) | Website scraper | Per-credit — early-exit when name+email found |

**Never waste Serper credits on queries unlikely to return names. Always test on 5–10 leads before running the full city list.**

---

## Architecture: Name Waterfall

Each lead runs through layers in order, stopping the moment a name is found.
Egypt-specific layers are active; USA-only layers are skipped via `SKIP_LAYERS` in the config.

**Active layers:**
1. **Serper Google Search** — 4 queries fire in parallel; first name found wins
2. **Website scrape** — /contact, /, /about (also captures email)
3. **Email prefix parse** — extracts name from non-generic email prefix
4. **Phone Google search** — searches formatted phone for owner mentions
5. **LinkedIn** — profile lookup via Serper
6. **Facebook** — About section + review response signatures
7. **Instagram** — bio text name extraction

**Skipped for Egypt** (USA-only, zero yield): Manta, Porch, LicenseDB, BBB, OpenCorp, Angi, Houzz, Thumbtack, Yelp, SOS, TripAdvisor

**Never skip or reorder active layers without measuring impact on name hit rate first.**

---

## Lead Scoring Logic

Scoring is handled in `agents/agent_output.js → scoreLead()`. Base score from completeness (name, phone, email, website, city, Facebook followers). Bonuses for Instagram follower count and verified phone.

**Instagram follower filter:** 5,000–10,000 followers (configured per run in `interior_design_aggregator.js`).

---

## Filter Criteria

A lead passes if:
- Phone number present (Egyptian format, +20)
- Instagram profile present (required field)
- Company not already in `seen_companies_id.json`

Do not change `REQUIRE_FIELDS` or follower bounds without updating the run config.

---

## Deduplication — 3 Layers

1. **In-memory** — dedupes by `company_domain` then `company_name` within a single run
2. **seen_companies_id.json** — persistent cross-run list. Always normalize to lowercase. Always read → merge → write. Never overwrite blindly.
3. **leads_id_progress.csv** — `loadProgress()` reads on startup; companies already in CSV skipped

---

## Output Format

Output headers (in `agents/agent_output.js → HEADERS`):
```
lead_id, source, first_name, last_name, full_name,
email, phone, job_title, company_name, company_domain,
location_city, location_state, linkedin_url, instagram_url,
facebook_followers, instagram_followers,
google_rating, review_count, lead_score, score_reason,
name_source, status, scraped_date
```

Phone column must always be forced to text format (`t:'s'`, `z:'@'`). Never let xlsx convert it to a number.

---

## Concurrency & Rate Limiting

- Concurrency limiter in `agents/shared_state.js`
- `sleep(800)` between city fetches
- `sleep(300–400)` between waterfall layer calls
- `fetchSafe()` — 3 retry attempts, 1.5s × attempt backoff on 429

When adding a new layer: always add `sleep(300)` after it. When adding a new Serper call: add `sleep(400)` before the next one.

---

## Common Bug Patterns — Check These First

- **Phone saved as number** — must set `ws[a].t='s'` and `ws[a].z='@'`
- **seen_companies_id.json wiped** — always read-merge-write, never overwrite
- **Resume broken** — CSV header row must match `HEADERS` exactly
- **ScrapingBee credits burned** — early exit `if (foundName && foundEmail) break` must stay inside paths loop
- **Name false positives** — check `STOPS` set before adding new patterns; social platforms already blocked
- **EBUSY on save** — output xlsx must be closed in Excel before running
- **Serper 429 on quota** — retries won't fix monthly exhaustion; surface it and stop
- **Arabic name garbling** — normalize with `fast-levenshtein` dedup; strip RTL/LTR marks before saving

---

## Workflow Rules

### Plan Mode
- Enter plan mode for any non-trivial task (3+ steps or architectural changes)
- Write plan to `tasks/todo.md` with checkable items before touching code
- If something goes sideways: stop, re-plan, update `tasks/todo.md`, then continue

### Self-Improvement Loop
- After any correction: update `tasks/lessons.md` with the pattern
- Write a rule that prevents the same mistake
- Review `tasks/lessons.md` at the start of each session

### Verification Before Done
- Never mark a task complete without proving it works
- Ask: "Would a senior developer approve this?"
- Run a small test batch, check output, then mark done

### Autonomous Bug Fixing
- Given a bug: just fix it. No hand-holding.
- Point at logs, errors, output anomalies — then resolve them

---

## Task Management

1. **Plan First** — write plan to `tasks/todo.md`
2. **Verify Plan** — confirm before implementing
3. **Track Progress** — check items off as you go
4. **Explain Changes** — one-line summary per step
5. **Document Results** — lead counts, hit rates, API usage → `tasks/review.md`
6. **Capture Lessons** — corrections → `tasks/lessons.md`

---

## Escalation Threshold

Pause and confirm before:
- Changing waterfall layer order or active/skipped sets
- Touching dedup logic
- Adding new API keys or services
- Changing any output file paths
- Any action affecting more than 2 files at once

---

## Core Principles

- **Don't burn credits** — test on 5–10 leads before full run
- **Preserve resume** — `leads_id_progress.csv` is the safety net; never delete mid-run
- **Minimal impact** — only touch what's necessary; no side effects
- **Own mistakes** — if a change drops name hit rate, say so, revert, log it in `tasks/lessons.md`
