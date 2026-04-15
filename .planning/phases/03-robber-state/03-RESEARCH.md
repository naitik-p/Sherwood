# Phase 3: Robber State - Research

**Researched:** 2026-04-15
**Domain:** Game state mutation, production logic, board initialization
**Confidence:** HIGH

## Summary

The robber mechanic requires two targeted changes: adding `robberHexId` to the state object returned by `createGameState`, and adding a single guard inside `produceFromRoll` that skips any hex whose `id` matches `state.robberHexId`. No new files are required. The wild_heath hex is already the only hex with `token: null`, which means it can never produce on its own — but the robber field gives future phases a canonical way to move the robber to any hex. The frost mechanic (roll === 2 branch) is entirely independent and runs before `produceFromRoll` is ever called.

**Primary recommendation:** Add `robberHexId` to `createGameState`'s state literal by finding the wild_heath hex at init time; add one `continue` guard at the top of the per-hex loop in `produceFromRoll`.

## Exact Findings

### 1. `createInitializedGameState` location and state shape

`createInitializedGameState` is at **line 1201** of `packages/core/src/engine.js`. It is a thin wrapper:

```js
export function createInitializedGameState(opts) {
  const state = createGameState(opts);
  initializeDeck(state);
  return state;
}
```

The actual state object is built inside `createGameState` at **line 431**. The literal returned by that function (lines 453-483) is:

```
roomId, seed, config, createdAt, hostPlayerId, board, players,
playerOrder, phase, vote, winMode, setup, turn, structures,
pendingTrades, charterClaim, log, matchStartedAt, endedAt,
winner, pendingHostTieBreak, rngStateCalls
```

`robberHexId` does not exist yet. It must be added here as a new top-level field. The board is already built before the state literal is assembled (`const board = createBoard({ rng })` at line 445), so the wild_heath hex is available at insertion time.

### 2. `produceFromRoll` — exact production loop

Function `produceFromRoll` is at **lines 172-208** of `packages/core/src/engine.js`.

The per-hex loop body starts at line 175:

```js
for (const hex of state.board.hexes) {
  if (!hex.token || hex.token !== roll || !hex.resource) {
    continue;
  }
  // iterates hex.intersectionIds, grants resources
}
```

The robber guard must be added as the first condition inside this loop — before the existing `!hex.token` check — or folded into it:

```
if (!hex.token || hex.token !== roll || !hex.resource || hex.id === state.robberHexId) {
  continue;
}
```

No other production path exists. `grantSetupPlacementResources` (lines 411-429) is setup-phase only and is independent — do not touch it.

### 3. How to find wild_heath at init time

`board.hexes` is an array. After `createBoard` returns, the expression is:

```js
const wildHeathHex = board.hexes.find(h => h.terrainId === "wild_heath");
```

This is guaranteed to find exactly one hex because `DEFAULT_TERRAIN_DISTRIBUTION` has `wild_heath: 1` (constants.js line 26) and `createBoard` asserts that `terrainPool.length === 19` (board.js line 164). The wild_heath hex always has `token: null` — confirmed by `assignTokensWithGuardrails` (board.js line 143): `hex.token = hex.terrainId === "wild_heath" ? null : tokensByHex.get(hex.id)`.

Use `wildHeathHex.id` as the initial value for `robberHexId`.

### 4. Frost mechanic coexistence

The frost path in `rollDice` (lines 590-612) executes when `roll === 2` and returns early:

```js
if (roll === 2) {
  // frost logic
  return { roll, gains: {} };
}
```

`produceFromRoll` is only called on lines 614+ for rolls that are NOT 2. Frost and robber are completely orthogonal — there is no interaction to handle.

Note: wild_heath has `token: null`, so `roll === 2` could never match it anyway. The robber guard in `produceFromRoll` is belt-and-suspenders for the current state, but becomes meaningful once robber movement is added in a future phase.

### 5. Minimal change surface

| File | Change |
|------|--------|
| `packages/core/src/engine.js` | In `createGameState` state literal (around line 453): add `robberHexId: board.hexes.find(h => h.terrainId === "wild_heath").id` |
| `packages/core/src/engine.js` | In `produceFromRoll` loop guard (line 176): add `|| hex.id === state.robberHexId` to the existing `continue` condition |
| `packages/core/test/engine.test.js` | Add two tests: (a) initial state has `robberHexId` pointing to wild_heath hex; (b) rolling the token of a hex matching `robberHexId` produces nothing for players on it |

No other files require changes. The robber field does not need to be surfaced in `getPublicGameState` for this phase unless the UI already consumes it — verify that function's include list separately if needed.

## Common Pitfalls

### Pitfall 1: wild_heath has `token: null` — the existing guard already prevents production

`produceFromRoll` checks `!hex.token` before checking token match, so wild_heath can never produce today even without the robber guard. This means the change is not observable on wild_heath in isolation — a test that only checks wild_heath will pass regardless. Tests must place the robber on a producing hex (token !== null, resource !== null) and verify that rolling that token yields nothing.

### Pitfall 2: `.find()` in `produceFromRoll` vs. storing the ID

If someone re-derives the robber hex inside `produceFromRoll` by doing `board.hexes.find(h => h.terrainId === "wild_heath")` each roll, it works but couples the blocking rule to terrain type instead of position. When the robber moves in a future phase, it will be on a non-wild_heath hex and this shortcut will silently fail. Store and compare the ID.

### Pitfall 3: `createGameState` vs. `createInitializedGameState` test coverage

Tests import and call `createInitializedGameState`, which delegates to `createGameState`. If a test inspects `state.robberHexId` it will correctly get the value, but if someone writes a test directly against `createGameState` the field must be there too. Both paths are fine because `createInitializedGameState` just calls `createGameState` and then adds `devDeck` — neither function re-creates the state literal.

### Pitfall 4: Token collision on roll === 2

`DEFAULT_NUMBER_TOKENS` (constants.js line 29) includes `2` exactly once. Only one hex gets token 2. Wild_heath gets no token. Rolling 2 triggers frost and early-returns before `produceFromRoll` — so placing the robber on a token-2 hex is safe, but that scenario will never be tested in this phase since roll === 2 bypasses `produceFromRoll` entirely.

### Pitfall 5: Test isolation — `resetPlayersAndStructures` does not reset `robberHexId`

The existing helper `resetPlayersAndStructures` (engine.test.js lines 83-99) clears structures and player resources but does not touch game-level state. If a future test mutates `state.robberHexId` in-place and a subsequent test in the same suite reuses a shared state object, the robber position will be stale. Each test that needs a specific robber position should set it explicitly or use a fresh `createMatch()` call.

## Architecture Patterns

### Existing conditional-skip pattern in `produceFromRoll`

Two existing skip conditions in the per-intersection loop (lines 188-194) demonstrate the established guard pattern:

```js
if (state.charterClaim && state.charterClaim.hexId === hex.id && ...) {
  continue;
}
const frosted = owner.frostEffects.some(...);
if (frosted) {
  continue;
}
```

The robber guard belongs one level up — at the hex loop, not the intersection loop — since it blocks all production from the hex regardless of who owns the structure. This is a different scope than charter/frost (both of which are per-player/per-intersection checks).

## State of the Art

| Current | After Phase 3 | Note |
|---------|--------------|------|
| No robber field | `robberHexId` on state | ID only; no movement logic yet |
| wild_heath never produces (token: null) | wild_heath + any future robber hex blocked | Guard is general-purpose |
| Frost is only roll-based production blocker | Robber adds hex-ID-based production block | Orthogonal |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | `packages/core/vitest.config.js` (or root vitest config — verify) |
| Quick run | `cd packages/core && npx vitest run` |
| Full suite | `npx vitest run` from repo root |

### Phase Requirements to Test Map
| ID | Behavior | Test Type | Automated Command |
|----|----------|-----------|-------------------|
| ROBBER-01 | `createInitializedGameState` returns state with `robberHexId` === wild_heath hex id | unit | `npx vitest run --reporter=verbose -t "robber"` |
| ROBBER-02 | Rolling a number matching robber hex produces nothing; non-robber hexes produce normally | unit | same |

### Wave 0 Gaps
- [ ] `packages/core/test/engine.test.js` — add describe block `"robber state"` with two tests (ROBBER-01 and ROBBER-02)

## Sources

### Primary (HIGH confidence — direct code reads)
- `packages/core/src/engine.js` lines 172-208 — `produceFromRoll` full implementation
- `packages/core/src/engine.js` lines 431-486 — `createGameState` state literal
- `packages/core/src/engine.js` lines 573-629 — `rollDice` with frost early-return
- `packages/core/src/engine.js` lines 1201-1205 — `createInitializedGameState`
- `packages/core/src/board.js` lines 113-145 — `assignTokensWithGuardrails`, wild_heath token assignment
- `packages/core/src/constants.js` lines 17-27 — `TERRAINS` map, `wild_heath: { resource: null }`, distribution count 1
- `packages/core/test/engine.test.js` lines 317-336 — existing production test pattern
- `packages/core/test/engine.test.js` lines 83-99 — `resetPlayersAndStructures` helper

## Metadata

**Confidence breakdown:**
- State shape location: HIGH — read directly from source
- Production loop: HIGH — read directly from source
- wild_heath find expression: HIGH — confirmed by both constants and board logic
- Frost coexistence: HIGH — early return path is unambiguous
- Pitfalls: HIGH — all derived from direct code inspection

**Research date:** 2026-04-15
**Valid until:** Stable until engine.js production loop is refactored
