---
phase: 03-robber-state
plan: 03-01
status: complete
completed: "2026-04-15"
commits:
  red: 7181eaf
  green: 845b0ed
requirements_addressed: ROBBER-01, ROBBER-02
files_modified:
  - packages/core/src/engine.js
  - packages/core/test/engine.test.js
---

# Phase 3 Summary — Robber State (ROBBER-01, ROBBER-02)

## What Was Done

Two minimal changes to `packages/core/src/engine.js` establish robber state and
production blocking. Two new vitest tests verify both requirements.

### Change A — ROBBER-01: `robberHexId` in `createGameState` (`engine.js` ~line 482)

Added one field to the state literal:

```javascript
rngStateCalls: 0,
robberHexId: board.hexes.find((h) => h.terrainId === "wild_heath").id
```

The board is already in scope at that point. No helper function needed.

### Change B — ROBBER-02: production guard in `produceFromRoll` (`engine.js` ~line 176)

Extended the existing `continue` condition:

```javascript
// before:
if (!hex.token || hex.token !== roll || !hex.resource) {
// after:
if (!hex.token || hex.token !== roll || !hex.resource || hex.id === state.robberHexId) {
```

### Tests (`packages/core/test/engine.test.js`)

New `describe("robber state")` block with two tests:

- **ROBBER-01**: Asserts `state.robberHexId === wildHeathHex.id` on a freshly created match.
- **ROBBER-02**: Parks the robber on a producing hex, rolls that token, asserts zero yield. Then moves the robber away and rolls again — asserts the same player receives 1 resource.

## Decisions

- Stored hex id (not terrain lookup) in state — Phase 4 (Roll 7) needs to move the robber to arbitrary hexes, so the field must hold any hex id.
- Frost mechanic (roll 2) untouched — it returns early before `produceFromRoll` is called; zero interaction.
- wild_heath has `token: null` so the robber guard on wild_heath is not observable without moving the robber. ROBBER-02 test deliberately uses a non-wild_heath producing hex to exercise the new guard.

## Verification

- 15/15 tests pass (13 pre-existing + 2 new robber tests)
- `npm run build` green (vite client 99ms)
- RED commit: `7181eaf` | GREEN commit: `845b0ed`
