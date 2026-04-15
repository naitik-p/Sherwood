# Phase 2: Setup Resources - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning
**Mode:** Auto-generated (yolo autonomous mode)

<domain>
## Phase Boundary

Fix the setup resource grant in `packages/core/src/engine.js` so that only the **second** cottage placement grants resources — matching standard Catan rules. Currently both placements grant resources; Catan only grants on the second placement.

**Standard Catan setup rule:** After placing their second cottage, the player collects one resource card for each terrain hex adjacent to that cottage. Desert (wild_heath) adjacency grants nothing.

The first cottage placement gives no resources in standard Catan.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion (yolo autonomous mode).

Key constraints:
- The fix is purely in `packages/core/src/engine.js` — the setup grant logic
- The `setup.queue` in engine state tracks snake-draft order and placement round
- Wild_heath adjacency must give nothing (non-producing terrain)
- All 13 existing tests must continue to pass after the fix
- One or more new tests covering the corrected behavior must be added

</decisions>

<code_context>
## Existing Code Insights

- `packages/core/src/engine.js` — `buildCottage()` contains the setup grant helper
- `packages/core/src/board.js` — board structure (hex terrain types, adjacency)
- `packages/core/src/constants.js` — TERRAINS constants, wild_heath definition
- `packages/core/test/engine.test.js` — existing setup resource grant tests (lines ~70-90)
- Setup queue tracks current placement round — second placement round is identifiable
- Prior session notes: "Updated setup resource rule to grant starting resources on both setup cottage placements" — this was the bug we're now correcting back to Catan standard

</code_context>

<specifics>
## Specific Requirements

- BOARD-02: Second cottage placement grants one resource per adjacent producing hex
- First cottage placement grants no resources (Catan standard)
- wild_heath (desert) adjacency grants nothing regardless of placement order
- All 13 existing tests must pass; new test(s) added for the corrected behavior

</specifics>

<deferred>
## Deferred Ideas

None — scope is fully contained in the setup grant logic.

</deferred>
