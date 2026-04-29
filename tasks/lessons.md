# Lessons Learned
2026-04-27

---

## Claude Code Best Practices
2026-04-29 — sourced from 10 GitHub repositories

### Context Budget Management
- **0–50%** context used: work freely, load files on demand
- **~70%** context used: run `/compact` to compress conversation
- **~92%** context used: run `/clear` and start a fresh context — do not try to continue
- Never front-load the entire codebase. Load only what the current task needs.
- For long scraper runs, spawn a fresh 200k-token context per major phase (collect → waterfall → output) rather than keeping everything in one growing session.

### Memory Hierarchy (4 layers, in order of permanence)
1. **Session** — active CLAUDE.md, current conversation
2. **Persistent** — git history, commit messages, `tasks/lessons.md`
3. **Shared** — CLAUDE.md itself (project-level rules)
4. **Archived** — quarterly snapshots, `tasks/review.md` post-run summaries
- When correcting a mistake: fix the code → log the pattern in `tasks/lessons.md` → do NOT forget to check lessons at session start.

### Model Routing by Task Complexity
- **Haiku** — URL routing, one-liner lookups, quick yes/no decisions
- **Sonnet** — builds, debugging, adding features, 95% of all work
- **Opus** — complex architectural decisions, deep waterfall redesigns
- Always start on Sonnet. Only escalate to Opus when you have genuinely complex reasoning to do.

### Hook Chain Pattern
For future CI/automation, chain events in order:
```
SessionStart → load context (CLAUDE.md, lessons.md)
PreToolUse   → guard: validate API calls, check quota, block secrets
PostToolUse  → validate output, check name hit rate vs baseline
SessionEnd   → extract learnings to lessons.md, checkpoint
```

### Wave Execution for Long Async Jobs
- Group independent work into waves. Run wave tasks in parallel, then collect before moving to next wave.
- Example: fetching 203 cities can be parallelized in batches (wave); enrichment waterfall per lead is sequential within `createLimit(8)`.
- A crash in one wave item should not lose progress from prior waves — this is why `leads_progress.csv` / SQLite incremental writes matter.

### Phase-Based Context Isolation
- For tasks with distinct phases (collect / enrich / output), consider a handoff pattern:
  - Phase 1 completes → write state to file → start fresh context for Phase 2
  - Prevents context rot from accumulating 13-layer waterfall verbose logs
- Use `tasks/todo.md` checkboxes as the lightweight handoff mechanism for this project.

### Load Knowledge On-Demand
- Do not paste full file contents into a prompt "just in case."
- Read only the function you're changing. Use Grep to find the call site, Read to see just those lines.
- The less context noise, the better the output.

### HANDOFF.json / Pause-Resume Pattern
- When stopping mid-task: write current state (what's done, what's next, open questions) to `tasks/todo.md`
- When resuming: read `tasks/lessons.md` first, then `tasks/todo.md`, then only the files needed for the next step
- Never re-read the entire codebase on resume — it burns context on things already known.

### Minimal Tool Access by Role
- Read-only tasks: only use `Read`, `Grep`, `Glob`
- Write tasks: add `Write`, `Edit`, `Bash`
- Never grant broader permissions than the task needs.

### Subagent Patterns Applicable to the Waterfall
- Parallel waterfall layers that are truly independent (BBB + OpenCorporates + Yelp) could be spawned as subagents if each layer starts taking >5s per lead
- The current `Promise.all` inside each lead's waterfall call is the right pattern at current scale
- If scale grows to 10k leads/run, consider a queue-based model: leads.db as queue, 8 worker processes pulling from it

### Cost Optimization Rules
- Test on 5–10 leads before any full run (saves 90%+ of Serper credits on broken changes)
- Brave Search API (free tier) supplements Serper — wire as fallback to reduce Serper burn
- AbsractAPI phone intelligence: 100 free/month — rate-limit awareness required
- ScrapingBee: per-credit — the early-exit `if (foundName && foundEmail) break` must always stay in scrape loops

---

## Prior Session Corrections
2026-04-27

(No entries yet — add as bugs are found and fixed)
