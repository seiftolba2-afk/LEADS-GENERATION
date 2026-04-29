# CLAUDE.md — Lead Aggregator Project

> Drop into project root alongside local_aggregator.js. Every session inherits all rules below.

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

**What this is:** A Node.js lead generation system that scrapes Google Maps (via Serper /maps) for contractors across 50+ US cities, enriches each lead with an owner name via a 12-layer waterfall, scores them, and outputs a two-sheet Excel file.

**Stack:** Node.js (CommonJS) — `xlsx`, `axios`, `cheerio`, `csv-parser`

**Three scripts, three industries:**

| Script | Targets | Output file |
|--------|---------|-------------|
| `local_aggregator.js` | Roofing contractors | `SAMPLE.xlsx` |
| `solar_aggregator.js` | Solar panel installers | `SAMPLE_SOLAR.xlsx` |
| `hvac_aggregator.js` | HVAC contractors | `SAMPLE_HVAC.xlsx` |

**Target per run:** 400 leads — 100 Hot Leads + 300 All Leads — all with confirmed owner name + phone.

---

## File Map

| File | Role |
|------|------|
| `local_aggregator.js` | Roofing main script |
| `solar_aggregator.js` | Solar main script |
| `hvac_aggregator.js` | HVAC main script |
| `SAMPLE.xlsx` | Roofing output — 2 sheets: Hot Leads, All Leads |
| `SAMPLE_SOLAR.xlsx` | Solar output |
| `SAMPLE_HVAC.xlsx` | HVAC output |
| `leads_progress.csv` | Roofing live resume file — one row per confirmed lead |
| `leads_solar_progress.csv` | Solar resume file |
| `leads_hvac_progress.csv` | HVAC resume file |
| `seen_companies.json` | Roofing cross-run dedup list |
| `seen_companies_solar.json` | Solar cross-run dedup list |
| `seen_companies_hvac.json` | HVAC cross-run dedup list |
| `tasks/todo.md` | Active plan with checkable items |
| `tasks/lessons.md` | Patterns learned from corrections |
| `tasks/review.md` | Post-run results and notes |

---

## API Keys (inside CONFIG object)

| Key | Service | Note |
|-----|---------|------|
| `SERPER_API_KEY` | Serper — Google Maps + Search | Monthly free tier — use sparingly |
| `SCRAPINGBEE_API_KEY` | Website scraper | Per-credit — early-exit when name+email found |
| `FOURSQUARE_API_KEY` | Foursquare | Currently unused |

**Never waste Serper credits on queries unlikely to return names. Always test on 5–10 leads before running the full city list.**

---

## Architecture: The 12-Layer Name Waterfall

Each lead runs through layers in order, stopping the moment a name is found:

1. **Serper Google Search** — 4 queries fire in parallel; first name found wins
2. **ScrapingBee website scrape** — /contact, /, /about, /our-team (also captures email)
3. **Email prefix parse** — extracts name from non-generic email prefix (e.g. `john.smith@...`)
4. **Phone number Google search** — searches formatted phone for owner mentions
5. **State contractor license DB** — TX, FL, GA, NC, IL, AZ, CO, TN
6. **BBB direct scrape** — finds Principal name
7. **Angi profile** — via Serper site: query
8. **Houzz profile** — via Serper site: query
9. **Yelp business page** — direct scrape
10. **Secretary of State registry** — LLC registered agent = owner
11. **TripAdvisor** — owner review response signatures
12. **Facebook business page** — About section + review responses

**Never skip or reorder layers without measuring the impact on name hit rate first.**

---

## Lead Scoring Logic

All confirmed leads start at 10 (name=5, phone=5). Bonuses:
- `+5` — email found
- `+1` — Google rating ≥ 4.5
- `+1` — review count 20–100

Hot Leads = top 100 by score. All Leads = next 300. Zero overlap between sheets.

---

## Filter Criteria

A lead passes `passesFilter()` if:
- Phone number present (7+ digits)
- `review_count` between 0 and 120

Do not change these thresholds without also updating the scoring logic.

---

## Deduplication — 3 Layers

All three must be respected when editing:

1. **In-memory** — `dedupe()` dedupes by `company_domain` then `company_name` within a single run
2. **seen_companies.json** — persistent cross-run list. Always normalize to lowercase. Always read → merge → write. Never overwrite blindly.
3. **leads_progress.csv** — `loadProgress()` reads on startup; companies already in CSV skipped via `alreadyDone` Set

Each industry has its own separate dedup file. Never share them across industries.

---

## Output Format

Both sheets use the same `HEADERS` array:
```
lead_id, source, first_name, last_name, full_name,
email, phone, job_title, company_name, company_domain,
location_city, location_state, linkedin_url,
google_rating, review_count, lead_score, score_reason, status
```

Phone column must always be forced to text format (`t:'s'`, `z:'@'`). Never let xlsx convert it to a number.

---

## Concurrency & Rate Limiting

- `createLimit(8)` — 8 leads processed in parallel
- `sleep(800)` between city fetches
- `sleep(300–400)` between waterfall layer calls
- `fetchSafe()` — 3 retry attempts, 1.5s × attempt backoff on 429

When adding a new layer: always add `sleep(300)` after it. When adding a new Serper call: add `sleep(400)` before the next one.

---

## Common Bug Patterns — Check These First

- **Phone saved as number** — must set `ws[a].t='s'` and `ws[a].z='@'`
- **seen_companies.json wiped** — always read-merge-write, never overwrite
- **Resume broken** — CSV header row must match `HEADERS` exactly
- **ScrapingBee credits burned** — early exit `if (foundName && foundEmail) break` must stay inside the paths loop
- **Name false positives** — check `STOPS` set before adding new patterns; social platforms already blocked
- **EBUSY on save** — output xlsx must be closed in Excel before running
- **Serper 429 on quota** — retries won't fix monthly exhaustion; surface it and stop

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
- Changing `findOwner()` waterfall order
- Touching dedup logic
- Adding new API keys or services
- Changing any output file paths
- Any action affecting more than 2 files at once

---

## Core Principles

- **Don't burn credits** — test on 5–10 leads before full run
- **Preserve resume** — `leads_progress.csv` is the safety net; never delete mid-run
- **Minimal impact** — only touch what's necessary; no side effects
- **Own mistakes** — if a change drops name hit rate, say so, revert, log it in `tasks/lessons.md`

---

*Permanent project config. Not a one-off prompt.*
