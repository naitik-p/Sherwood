# Phase 1: Port Layout - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning
**Mode:** Auto-generated (yolo mode — user requested full autonomous execution)

<domain>
## Phase Boundary

Replace the random port assignment in `packages/core/src/board.js` with a fixed Catan-standard layout. The current `chooseStallIntersections()` function picks random coastal intersection indices; this phase replaces that with predetermined positions matching the standard Catan board.

**Standard Catan port layout:**
- 9 ports total
- 5 specific 2:1 ports: one each for timber, clay, wool, harvest, iron
- 4 generic 3:1 ports
- Positions fixed at predetermined coastal intersections — same every game

The board is a radius-2 hex grid (19 hexes). The port positions map to the outer coastal edge intersections. The standard Catan layout places ports at the following approximate positions going clockwise around the board.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — yolo autonomous mode.

Key decisions:
- Use standard Catan board coastal positions mapped to the Shorewood intersection coordinate system
- Replace `chooseStallIntersections()` entirely with a fixed array — no randomization
- Port resource order should follow standard Catan (starting from top and going clockwise): wool(2:1), generic(3:1), timber(2:1), generic(3:1), harvest(2:1), iron(2:1), generic(3:1), clay(2:1), generic(3:1)
- Maintain the existing stall data structure shape so downstream code (engine, client) requires no changes

</decisions>

<code_context>
## Existing Code Insights

- `packages/core/src/board.js` — `chooseStallIntersections()` picks random coastal intersections
- `packages/core/src/constants.js` — stall definitions (ratios, resource types)
- Board intersection coordinates use the axial/offset grid system established in board.js
- Client `apps/client/src/main.js` renders stall markers at intersection positions — expects same data shape
- 12 existing tests in `packages/core/test/engine.test.js` include market ratio/count/coastal placement checks

</code_context>

<specifics>
## Specific Requirements

- BOARD-01: 9 ports, 5 specific 2:1 (one per resource), 4 generic 3:1, fixed positions every game
- Must not break existing tests (market count, ratio distribution checks)
- Port positions must be at valid coastal intersections in the board graph

</specifics>

<deferred>
## Deferred Ideas

- Visual port labels on the client (orientation arrows) — deferred, not in scope for this phase
- Port position configurability — explicitly out of scope, fixed is the requirement

</deferred>
