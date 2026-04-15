---
phase: 02-setup-resources
plan: 02-01
status: complete
completed: "2026-04-15"
commit: 4561b26
---

# Phase 2 Summary — Setup Resources (BOARD-02)

## What Was Done

Added a round guard to `buildCottage()` in `packages/core/src/engine.js` so setup
resource grants only fire during the second snake-draft placement (round 2).

### Engine change (`packages/core/src/engine.js`)

Inside `buildCottage()`, the unconditional `grantSetupPlacementResources()` call was
replaced with a round check:

```javascript
if (state.phase === "setup") {
  state.setup.mustTrailFrom = intersectionId;
  const step = currentSetupStep(state);
  if (step.round === 2) {
    grantSetupPlacementResources(state, player, intersectionId, ts);
  }
  advanceSetupPointer(state, ts);
}
```

### Test change (`packages/core/test/engine.test.js`)

Replaced the unconditional "grants one starting resource per producing hex for each
setup cottage" test with a round-conditional test:

- Round 1 cottage: asserts `observedGain === emptyBag()`
- Round 2 cottage: asserts `observedGain === expectedSetupPlacementGain(state, chosen)`

## Requirements Satisfied

- **BOARD-02**: Second cottage placement grants adjacent hex resources; first does not.

## Verification

- 13/13 tests pass
- `npm run build` green (vite client build 102ms)
- Commit: `4561b26`
