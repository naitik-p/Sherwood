---
phase: 01-port-layout
plan: 01
subsystem: board
tags: [board-geometry, catan, ports, determinism, vitest]

# Dependency graph
requires: []
provides:
  - FIXED_STALL_COORDS constant — 9 clockwise coastal [x,y] pairs at hexSize=84
  - BAZAAR_STALLS_ORDERED constant — 9 stall defs in clockwise port order (wool/generic/timber/generic/harvest/iron/generic/clay/generic)
  - Deterministic chooseStallIntersections() using coordKey lookup (rng removed)
  - Derivation script packages/core/scripts/derive-stall-coords.mjs
  - Positional determinism test in engine.test.js
affects: [02-setup-resources, 03-robber-state, 04-roll7-sequence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fixed coordinate array with coordKey lookup for deterministic board element placement
    - TDD red-green cycle for determinism requirements

key-files:
  created:
    - packages/core/scripts/derive-stall-coords.mjs
    - .planning/phases/01-port-layout/01-01-SUMMARY.md
  modified:
    - packages/core/src/constants.js
    - packages/core/src/board.js
    - packages/core/test/engine.test.js

key-decisions:
  - "FIXED_STALL_COORDS derived at hexSize=84 via one-shot script; evenly-spaced clockwise ring of 9 from 30 coastal nodes (indices 0,3,7,10,13,17,20,23,27)"
  - "BAZAAR_STALLS_ORDERED replaces shuffle(BAZAAR_STALLS, rng) — order locked: wool/generic/timber/generic/harvest/iron/generic/clay/generic"
  - "rng removed from chooseStallIntersections signature — caller in createBoard updated"
  - "BAZAAR_STALLS kept in constants.js for backward compatibility; no other file imports it post-change"

patterns-established:
  - "Fixed coordinate lookup pattern: store [x,y] pairs in constant, look up via coordKey(x,y) Map for deterministic board element placement"

requirements-completed: [BOARD-01]

# Metrics
duration: 10min
completed: 2026-04-15
---

# Phase 1 Plan 01: Port Layout Summary

**Fixed Catan-standard port layout — 9 ports at deterministic coastal positions via FIXED_STALL_COORDS constant, replacing random angular sampling with coordKey lookup**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-15T13:25:00Z
- **Completed:** 2026-04-15T13:35:45Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Replaced random `chooseStallIntersections(intersections, rng)` with deterministic fixed-coordinate lookup — same 9 ports every game
- Added `FIXED_STALL_COORDS` and `BAZAAR_STALLS_ORDERED` to `constants.js` — ports placed clockwise from top in standard Catan order
- All 13 tests pass (12 existing + 1 new positional determinism test); repo build green

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive fixed stall coordinates and add failing positional determinism test (RED)** - `2552674` (test)
2. **Task 2: Replace random port assignment with fixed layout (GREEN)** - `cd367d9` (feat)
3. **Task 3: Phase gate verification and summary** - (docs — this commit)

_Note: TDD tasks have separate test (RED) and feat (GREEN) commits_

## Files Created/Modified

- `packages/core/scripts/derive-stall-coords.mjs` - One-shot derivation script; computes 9 evenly-spaced clockwise coastal (x,y) pairs at hexSize=84
- `packages/core/src/constants.js` - Added `FIXED_STALL_COORDS` (9 [x,y] pairs) and `BAZAAR_STALLS_ORDERED` (9 stall defs in clockwise order)
- `packages/core/src/board.js` - Replaced random `chooseStallIntersections` with coordKey Map lookup; removed `shuffle(BAZAAR_STALLS, rng)`; updated import list
- `packages/core/test/engine.test.js` - Added `createBoard` import; added `port positions are identical across two game instances` test

## Decisions Made

- Used evenly-spaced index selection (`Math.round(i * 30 / 9) % 30`) over 30 coastal nodes to pick 9 well-spread clockwise positions — yielded indices 0, 3, 7, 10, 13, 17, 20, 23, 27
- Clockwise angle normalization: `((angle + Math.PI/2 + 2*Math.PI) % (2*Math.PI))` puts topmost node (min y) at index 0
- Kept `BAZAAR_STALLS` unchanged in constants.js for backward compatibility; new `BAZAAR_STALLS_ORDERED` is the ordered replacement used by board.js
- `coordKey` rounding (3dp: `Math.round(v * 1000) / 1000`) used on both sides of coordinate lookup to avoid float comparison errors

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Validation Gate Results

All phase gate criteria from `01-VALIDATION.md` met:

1. `cd packages/core && npm test` — 13 tests passing (12 existing + 1 new positional determinism test)
2. `npm run build` from repo root — exits 0
3. Two `createBoard({ hexSize: 84 })` calls produce identical stall positions — determinism probe prints `true`
4. Two `createBoard({ hexSize: 84 })` calls produce identical resource-to-position mapping — determinism probe prints `true`
5. Exactly 9 stalls: 5 specific 2:1 (timber, clay, wool, harvest, iron), 4 generic 3:1
6. All 9 stalls satisfy `node.coastal === true` and `node.hexIds.length < 3`

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- BOARD-01 complete. Fixed port layout ships in every new game.
- Phase 2 (Setup Resources) touches `engine.js` setup flow — does not depend on stall positions. No blockers.

---
*Phase: 01-port-layout*
*Completed: 2026-04-15*
