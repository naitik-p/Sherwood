---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: Catan Rules Alignment
status: executing
last_updated: "2026-04-15"
last_activity: 2026-04-15 -- Phase 1 complete (BOARD-01 verified)
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 1
  completed_plans: 1
  percent: 25
---

# STATE — Shorewood Catan Rules Alignment

## Project Reference

See: .planning/PROJECT.md

**Core value:** Players get a faithful Catan experience under Shorewood's custom skin — same board, same robber, same setup rules.
**Current focus:** Phase 2 — Setup Resources

## Current Position

Phase: 2 of 4 (Setup Resources) — Ready to plan
Status: Phase 1 complete, Phase 2 next
Last activity: 2026-04-15 — Phase 1 (Port Layout) complete, BOARD-01 verified

Progress: [██░░░░░░░░] 25%

## Completed Phases

### Phase 1: Port Layout ✅ (2026-04-15)
- Requirement: BOARD-01 — satisfied
- `FIXED_STALL_COORDS` (9 clockwise [x,y] pairs at hexSize=84) in constants.js
- `BAZAAR_STALLS_ORDERED` (wool, generic, timber, generic, harvest, iron, generic, clay, generic) in constants.js
- `chooseStallIntersections()` deterministic — rng removed
- `shuffle(BAZAAR_STALLS, rng)` removed from `createBoard()`
- New derivation script: `packages/core/scripts/derive-stall-coords.mjs`
- 13/13 tests pass | build green | determinism probe confirms identical positions across calls

## What Remains

| Phase | Status | Next Action |
|-------|--------|-------------|
| 2 — Setup Resources | Not started | Auto-generate context → plan → execute |
| 3 — Robber State | Not started | After Phase 2 completes |
| 4 — Roll 7 Sequence | Not started | After Phase 3 completes |

## Accumulated Context

### Decisions

- Fixed port layout: `FIXED_STALL_COORDS` derived at hexSize=84, evenly-spaced clockwise ring (30 coastal nodes, indices 0,3,7,10,13,17,20,23,27)
- Frost mechanic (roll 2) kept alongside robber — user preference
- No Longest Road / Largest Army — user explicitly excluded
- Yolo autonomous mode — all implementation choices at Claude's discretion
- JS/ESM only, no new runtime dependencies

### Blockers/Concerns

None.
