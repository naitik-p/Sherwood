# Phase 2: Setup Resources - Research

**Researched:** 2026-04-15
**Domain:** Game engine — setup phase resource grant logic (JS/ESM)
**Confidence:** HIGH

## Summary

The bug is a single-line condition in `buildCottage()`. The function currently calls `grantSetupPlacementResources()` unconditionally on every setup cottage placement. The fix is to gate that call on `step.round === 2`. The `round` field is already present on every queue entry produced by `queueForSnakeSetup()` — no new state is required.

`grantSetupPlacementResources()` already handles wild_heath correctly: it iterates `node.hexIds`, reads `hex.resource`, and skips any hex where `hex.resource` is falsy. `TERRAINS.wild_heath.resource` is `null`, so desert adjacency already produces nothing. No changes needed inside that helper.

The existing test at line 202 ("grants one starting resource per producing hex for each setup cottage") must be updated: it currently accepts gains from both rounds. The replacement test must assert zero gain on round 1 and non-zero gain only from round 2. One net-new test (or the updated existing test) must cover the corrected behavior.

**Primary recommendation:** Add a `step.round === 2` guard in `buildCottage()` around the `grantSetupPlacementResources()` call. No other files need changes.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices at Claude's discretion (yolo autonomous mode).

Key constraints:
- The fix is purely in `packages/core/src/engine.js` — the setup grant logic
- The `setup.queue` in engine state tracks snake-draft order and placement round
- Wild_heath adjacency must give nothing (non-producing terrain)
- All 13 existing tests must continue to pass after the fix
- One or more new tests covering the corrected behavior must be added

### Claude's Discretion
All implementation choices.

### Deferred Ideas (OUT OF SCOPE)
None — scope is fully contained in the setup grant logic.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOARD-02 | Second setup cottage placement grants resources — player receives one resource card for each producing hex adjacent to their second placed cottage | `step.round` field on queue entries enables round discrimination; `hex.resource` check already excludes wild_heath |
</phase_requirements>

---

## Standard Stack

No new dependencies. Pure JS/ESM edits inside the existing codebase.

| File | Role | Change Needed |
|------|------|---------------|
| `packages/core/src/engine.js` | Game engine — contains `buildCottage()` and `grantSetupPlacementResources()` | Add `step.round === 2` guard |
| `packages/core/test/engine.test.js` | Vitest test suite (13 tests) | Replace/update existing setup grant test; add round-1 no-grant assertion |

**Installation:** None required.

---

## Architecture Patterns

### Current Setup Queue Shape

`queueForSnakeSetup(playerOrder)` produces entries of the form:

```js
// Source: packages/core/src/engine.js line 233-246
{ playerId: "p1", type: "cottage", round: 1 }
{ playerId: "p1", type: "trail",   round: 1 }
// ... all players round 1 ...
{ playerId: "p2", type: "cottage", round: 2 }
{ playerId: "p2", type: "trail",   round: 2 }
// ... all players reversed round 2 ...
```

`round` is 1 or 2. It is already on every entry — no schema change needed.

### Current `buildCottage()` Setup Path (lines 670-673)

```js
// Source: packages/core/src/engine.js line 670-673 [VERIFIED: Read tool]
if (state.phase === "setup") {
  state.setup.mustTrailFrom = intersectionId;
  grantSetupPlacementResources(state, player, intersectionId, ts); // <-- runs on BOTH rounds
  advanceSetupPointer(state, ts);
}
```

### Fix Pattern

```js
// After fix:
if (state.phase === "setup") {
  state.setup.mustTrailFrom = intersectionId;
  const step = state.setup.queue[state.setup.index];
  if (step.round === 2) {
    grantSetupPlacementResources(state, player, intersectionId, ts);
  }
  advanceSetupPointer(state, ts);
}
```

Note: `currentSetupStep()` is called earlier in `buildCottage()` at line 655 and stored as `step`. The planner may reuse that variable rather than calling `state.setup.queue[state.setup.index]` again — both are equivalent since `advanceSetupPointer` has not yet fired.

### `grantSetupPlacementResources()` — Already Correct for wild_heath

```js
// Source: packages/core/src/engine.js line 411-428 [VERIFIED: Read tool]
function grantSetupPlacementResources(state, player, intersectionId, ts) {
  const node = getIntersection(state.board, intersectionId);
  const gains = emptyResources();

  for (const hexId of node.hexIds) {
    const hex = getHex(state.board, hexId);
    if (!hex.resource) {   // <-- wild_heath has resource: null; skipped here
      continue;
    }
    gains[hex.resource] += 1;
    player.resources[hex.resource] += 1;
  }
  // ...
}
```

`TERRAINS.wild_heath.resource` is `null` [VERIFIED: Read tool, constants.js line 17]. The falsy check `!hex.resource` already covers it. No change to this helper is needed.

### Anti-Patterns to Avoid

- **Do not introduce a new state field** (e.g., `setup.cottagesPlaced`) to track placement count. The `round` field on queue entries already carries this information cleanly.
- **Do not move the round check into `grantSetupPlacementResources()`** — that helper has no knowledge of setup queue state; keep it a pure resource calculator.
- **Do not re-read `currentSetupStep()` a second time** — the `step` variable from line 655 is still in scope and unchanged at line 670.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Detecting second placement | Custom counter or extra state field | `step.round === 2` on the existing queue entry |
| Excluding desert from grant | Custom terrain type check | Existing `!hex.resource` falsy check in `grantSetupPlacementResources()` |

---

## Common Pitfalls

### Pitfall 1: Existing test expects gains on BOTH rounds

**What goes wrong:** Test at line 202 runs setup to completion and asserts `observedGain === expectedSetupPlacementGain` for every cottage placement, including round 1. After the fix, round-1 gain will be zero, breaking the test.

**How to avoid:** Replace that test with two explicit assertions: (a) round-1 cottage placement leaves resources unchanged; (b) round-2 cottage placement increases resources by exactly `expectedSetupPlacementGain`. Keep the overall totals assertions but update them to expect zero contribution from round 1.

**Warning signs:** Test failure message "expected {} to equal { wool: 1, ... }" on a round-1 cottage step.

### Pitfall 2: Accessing `step` after `advanceSetupPointer`

**What goes wrong:** If `grantSetupPlacementResources` were called after `advanceSetupPointer`, `state.setup.index` has already incremented and `step` no longer refers to the cottage just placed.

**How to avoid:** The fix preserves the existing order — grant before advance. This is already correct.

### Pitfall 3: Confusing queue index with round number

**What goes wrong:** Trying to infer round from `state.setup.index` arithmetic instead of reading `step.round`. In a 2-player game, round 2 starts at index 4 (after p1 cottage+trail, p2 cottage+trail). In a 4-player game, round 2 starts at index 8. The index boundary differs per player count.

**How to avoid:** Read `step.round` directly. It is set explicitly to `1` or `2` in `queueForSnakeSetup`.

---

## Code Examples

### Test Pattern — Round-1 No-Grant Assertion

```js
// Source: engine.test.js pattern [VERIFIED: Read tool]
test("second setup cottage grants resources; first grants nothing", () => {
  const state = createMatch();
  forceVoteToFirstToTen(state);

  // Round 1 cottage: p1
  const step1 = state.setup.queue[state.setup.index]; // round: 1
  const targets1 = getFastBuildTargets(state, step1.playerId);
  const before1 = { ...state.players[step1.playerId].resources };
  buildCottage(state, step1.playerId, targets1.cottages[0]);
  expect(state.players[step1.playerId].resources).toEqual(before1); // no grant

  // advance past round-1 trail
  const trailStep1 = state.setup.queue[state.setup.index];
  buildTrail(state, trailStep1.playerId, getFastBuildTargets(state, trailStep1.playerId).trails[0]);

  // Round 1 cottage: p2 (also no grant)
  const step2 = state.setup.queue[state.setup.index]; // round: 1
  const targets2 = getFastBuildTargets(state, step2.playerId);
  const before2 = { ...state.players[step2.playerId].resources };
  buildCottage(state, step2.playerId, targets2.cottages[0]);
  expect(state.players[step2.playerId].resources).toEqual(before2); // no grant

  // advance past p2 round-1 trail
  const trailStep2 = state.setup.queue[state.setup.index];
  buildTrail(state, trailStep2.playerId, getFastBuildTargets(state, trailStep2.playerId).trails[0]);

  // Round 2 cottage: p2 (reverse order) — SHOULD grant
  const step3 = state.setup.queue[state.setup.index]; // round: 2
  const chosen3 = getFastBuildTargets(state, step3.playerId).cottages[0];
  const expected3 = expectedSetupPlacementGain(state, chosen3);
  const before3 = { ...state.players[step3.playerId].resources };
  buildCottage(state, step3.playerId, chosen3);
  expect(deltaBag(before3, state.players[step3.playerId].resources)).toEqual(expected3);
});
```

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (version from package.json in packages/core) |
| Config file | `packages/core/package.json` (scripts.test) |
| Quick run command | `cd packages/core && npm test` |
| Full suite command | `cd packages/core && npm test` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| BOARD-02 | Round-1 cottage grants zero resources | unit | `cd packages/core && npm test` | Wave 0 — update/replace existing test |
| BOARD-02 | Round-2 cottage grants one resource per adjacent producing hex | unit | `cd packages/core && npm test` | Wave 0 — new assertion in updated test |
| BOARD-02 | wild_heath adjacency grants nothing regardless of round | unit | `cd packages/core && npm test` | Covered by round-2 test when placement is near wild_heath (seed-dependent; verify via `expectedSetupPlacementGain`) |

### Sampling Rate

- **Per task commit:** `cd packages/core && npm test`
- **Per wave merge:** `cd packages/core && npm test`
- **Phase gate:** 13+ tests green (13 existing + net-new setup grant test)

### Wave 0 Gaps

- [ ] Update or replace test "grants one starting resource per producing hex for each setup cottage (up to 6 total before first roll)" at line 202 — current assertions are incompatible with second-placement-only grant.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — pure JS/ESM code edit within existing repo).

---

## Security Domain

Step skipped — no authentication, sessions, input validation, or cryptography involved. Pure in-memory game state mutation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `step` variable from line 655 remains in scope and valid at the guard insertion point (line 670) | Architecture Patterns | Low — both are within the same `buildCottage` call frame; JS closure scope confirms this |

No other assumed claims. All other findings verified by direct file reads in this session.

---

## Sources

### Primary (HIGH confidence)

- `packages/core/src/engine.js` — Read tool, lines 233-246 (`queueForSnakeSetup`), 411-429 (`grantSetupPlacementResources`), 631-677 (`buildCottage` setup path), 335-340 (`advanceSetupPointer`) [VERIFIED: Read tool]
- `packages/core/src/constants.js` — `TERRAINS.wild_heath.resource === null` confirmed at line 17 [VERIFIED: Read tool]
- `packages/core/test/engine.test.js` — All 13 tests read; conflicting test identified at line 202 [VERIFIED: Read tool]
- `.planning/phases/02-setup-resources/02-CONTEXT.md` — Phase boundary and constraints [VERIFIED: Read tool]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; existing code read directly
- Architecture: HIGH — fix location identified precisely; round field confirmed on queue entries
- Pitfalls: HIGH — conflicting test identified by line number; scope of change confirmed minimal

**Research date:** 2026-04-15
**Valid until:** Stable — pure internal code; valid until engine.js setup flow is refactored
