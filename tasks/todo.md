# Lead Aggregator — Parts 1–3 Plan
Updated: 2026-04-29

## Status

### DONE ✅
- [x] Part 0 — Hostile code review + security scan → `tasks/review.md`
- [x] Part 1 — Claude Code best practices → `tasks/lessons.md`
- [x] Item 2-1 — `best.js` (merged best15+best20, --top flag, 40/60 split) + deleted best15.js/best20.js + updated run_all.bat
- [x] Item 2-2 — `leads.js` SEEN_FILE now industry-aware (roofing→seen_companies.json, solar→seen_companies_solar.json, etc.)
- [x] Item 2-3 — `run_all.js` cross-platform runner created
- [x] Item 2-4 — `aggregator_core.js` Brave Search fallback (replaces DDG when BRAVE_API_KEY set; DDG remains default)
- [x] Item 2-5 — `aggregator_core.js` inline Levenshtein replaced with fast-levenshtein

### DONE ✅ (this session)
- [x] Step 0 — Cleanup: deleted fix_excel.js, created agents/ folder
- [x] Step 1 — Reverted aggregator_core.js to clean 13-layer reference (removed yellowPages/nextdoor/mapquest/cache/counters/company_age_flag)
- [x] Step 2 — Built agents/shared_state.js (createSharedState, cache helpers, hit-rate utils, seen-company I/O)
- [x] Step 3 — Built agents/agent_orchestrator.js (run(config) drop-in replacement)
- [x] Step 4 — Built all 5 layer agents: agent_serper, agent_scraper, agent_directory, agent_license, agent_enrichment, agent_output
- [x] Step 5 — run_all.js Pushover notification (env-var gated, silent skip, native fetch)

### TODO — Next session
- [ ] Validate agent team: `node leads.js 5 roofing` targeting orchestrator → check log + xlsx output
- [ ] Switch industry wrappers from aggregator_core to agent_orchestrator after validation
- [ ] Item 3-9 — _manual_review.xlsx output (leads with phone but no name) — add to agent_output.js
- [ ] Item 3-14 — SQLite migration: migrate_to_sqlite.js + update agent_orchestrator + leads.js

### Post-completion
- [ ] Apply approved CLAUDE.md additions (from Part 0 Step B diff — already shown, awaiting user confirm)
- [ ] Final summary in tasks/review.md

---

## Verification commands (for each item above)
- 3-6: run `node leads.js 5 roofing` twice → 2nd run shows "cache hit"
- 3-7 through 3-13: `node leads.js 5 roofing` → check log for layer attempts
- 3-9: check `SAMPLE_manual_review.xlsx` exists after run
- 3-10: check `company_age_flag` column in output xlsx
- 3-11: check hit-rate table in `tasks/review.md` and Stats tab in xlsx
- 3-14: `node migrate_to_sqlite.js` → row counts printed; `leads.db` exists
- 3-15: `node run_all.js` without Pushover keys → no crash

## Next session startup sequence
1. `cd /d "D:\LEADS GENERATION"`
2. Read `tasks/todo.md` (this file)
3. Read `tasks/lessons.md`
4. Start with Item 3-6 in `aggregator_core.js`
