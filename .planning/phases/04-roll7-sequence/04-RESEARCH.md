# Phase 4: Roll 7 Sequence - Research

**Researched:** 2026-04-15
**Domain:** Game engine state machine — sequential pending actions on a 7-roll
**Confidence:** HIGH

## Summary

Phase 3 (complete, commit 845b0ed) already added `state.robberHexId` to the engine and the
`produceFromRoll` guard. Phase 4 builds the full Roll 7 sequence on top of that foundation:
discard half, move robber, steal.

The engine uses a flat `state.turn` object for per-turn ephemeral state. The frost mechanic
(roll 2) is the reference model for post-roll pending actions — it resolves inline inside
`rollDice` because it requires no player input. Roll 7 is different: it requires input from
one or more players before the turn can proceed. This means the pending state must live on
`state.turn`, be checked in `endTurn`, and be advanced by three new exported action functions.

No new files are needed. Every change touches `packages/core/src/engine.js` and
`packages/core/test/engine.test.js`. `packages/core/src/index.js` exports via `export * from
"./engine.js"` so new exports are picked up automatically.

**Primary recommendation:** Add three nullable sub-objects to `state.turn`
(`pendingDiscards`, `pendingRobberMove`, `pendingSteal`). Set them in `rollDice` when roll
equals 7. Clear them in order as each step completes. Gate `endTurn` on all three being null.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROLL7-01 | Any player holding 7+ cards when a 7 is rolled must discard exactly half (rounded down) before play continues | `pendingDiscards` map; `submitDiscard` action; count validation via `bagCount` |
| ROLL7-02 | After discards, active player must move the robber to a non-wild_heath hex; moving to wild_heath is rejected | `pendingRobberMove` flag; `moveRobber` action; `terrainId === "wild_heath"` guard |
| ROLL7-03 | After robber placement, active player may steal one random card from an eligible player on the new hex; if none eligible, steal is skipped automatically | `pendingSteal` object; `resolveSteal` action; eligible-player scan; rng card pick |
</phase_requirements>

---

## 1. Current `rollDice` Flow — Exact Line Numbers

All line numbers reference the current file after Phase 3 changes (845b0ed).

| Line range | Branch | What happens |
|------------|--------|-------------|
| 574 | Entry | `ensureMainActionTurn` — enforces main phase and active player |
| 578-580 | Guard | `state.turn.rolled` already true → throw |
| 582-584 | Roll | Two dice, sum to `roll` |
| 586-588 | State | `turn.rolled = true`, `turn.lastRoll = roll`, `player.hasRolledThisTurn = true` |
| 591-612 | roll === 2 branch | Frost logic; calls `pickFrostHex`, pushes frostEffects; **returns early** with `{ roll, gains: {} }` |
| 615-628 | Normal production | `produceFromRoll(state, roll)` — skips wild_heath and robber hex; logs gains |
| 628-629 | Win check | `maybeEndFirstToTen`; return `{ roll, gains }` |

**roll === 7 today:** Falls through to `produceFromRoll`. Token 7 never appears on any hex
(`DEFAULT_NUMBER_TOKENS` at constants.js line 29 — no 7 in the list), so `produceFromRoll`
returns an empty gains object. No discard, robber move, or steal is triggered.
[VERIFIED: codebase read — `DEFAULT_NUMBER_TOKENS = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12]`]

The frost branch is the only branch that returns early. All other rolls fall through to
`produceFromRoll`. The new roll === 7 branch must also return early (after setting pending
state) to avoid calling `produceFromRoll` unnecessarily (though it would be a no-op).

---

## 2. `state.turn` Shape — Every Field

Initialized in `startMainPhase` (lines 321-333):

```js
state.turn = {
  order: [...state.playerOrder],   // array of player ids in turn order
  index: 0,                        // pointer into order[]
  number: 1,                       // increments every endTurn
  rolled: false,                   // true after rollDice completes
  lastRoll: null,                  // numeric value of last roll
  freeTrailBuilds: 0               // remaining free trail placements (Trailblazer dev card)
};
```

[VERIFIED: engine.js lines 324-332]

Reset in `endTurn` (lines 995-999):

```js
state.turn.index = (state.turn.index + 1) % state.turn.order.length;
state.turn.number += 1;
state.turn.rolled = false;
state.turn.lastRoll = null;
state.turn.freeTrailBuilds = 0;
```

[VERIFIED: engine.js lines 995-999]

`getPublicGameState` spreads the entire turn object with an added `activePlayerId` field
(lines 1172-1176). New turn fields are automatically included in the public state.

---

## 3. Proposed State Additions

Add three nullable fields to `state.turn` inside `startMainPhase`:

```js
state.turn = {
  order: [...state.playerOrder],
  index: 0,
  number: 1,
  rolled: false,
  lastRoll: null,
  freeTrailBuilds: 0,
  // Roll 7 sequence — all null except during active 7-roll resolution
  pendingDiscards: null,   // object | null
  pendingRobberMove: null, // true | null
  pendingSteal: null       // object | null
};
```

Also reset all three in `endTurn` (they must be null before endTurn is allowed — see §7).

### `pendingDiscards` shape

```js
// Set in rollDice when roll === 7
state.turn.pendingDiscards = {
  required: {
    // playerId → exact count they must discard (Math.floor(total / 2))
    // Only players with 7+ cards appear here
    "p1": 3,
    "p2": 4
  },
  submitted: {
    // playerId → their submitted discard bag (initially absent)
  }
};
// Cleared (set to null) when Object.keys(required).every(id => id in submitted)
```

`pendingDiscards` is cleared (set to null) once every required player has submitted. At that
point `pendingRobberMove` is set to true.

### `pendingRobberMove` shape

```js
state.turn.pendingRobberMove = true;
// Cleared (set to null) by moveRobber after updating state.robberHexId
// At that point pendingSteal is set (or skipped if no eligible players)
```

A boolean is sufficient; no additional data is needed.

### `pendingSteal` shape

```js
state.turn.pendingSteal = {
  eligiblePlayerIds: ["p2"],  // players on new hex with ≥1 card, not active player
  // Cleared by resolveSteal or by active player calling resolveSteal when they choose to proceed
};
// If eligiblePlayerIds is empty at the time moveRobber resolves, set pendingSteal = null immediately (auto-skip)
```

The active player calls `resolveSteal(state, playerId)` to execute the steal (random pick from
random eligible player) or skip if none eligible. No additional choice data is needed from the
client since the steal is fully random.

---

## 4. Discard Mechanics

### Who must discard

In `rollDice`, after confirming roll === 7, iterate `state.playerOrder` and collect players
where `bagCount(player.resources) >= 7`. For each, compute `Math.floor(bagCount / 2)`.

```js
const required = {};
for (const pid of state.playerOrder) {
  const count = bagCount(state.players[pid].resources);
  if (count >= 7) {
    required[pid] = Math.floor(count / 2);
  }
}
```

If `required` is empty (no one has 7+ cards), skip `pendingDiscards` entirely and proceed
directly to `pendingRobberMove = true`.

### New action: `submitDiscard(state, playerId, discardBag, ts)`

1. Guard: `state.turn.pendingDiscards` must be non-null.
2. Guard: `playerId` must be in `required` and not yet in `submitted`.
3. Validate `discardBag`: normalize with `ensureResourceBag`, call `bagCount` — must equal
   `required[playerId]` exactly.
4. Validate player has the cards: `bagAtLeast(player.resources, discardBag)`.
5. Apply: `bagSubtractInPlace(player.resources, discardBag)`.
6. Record: `state.turn.pendingDiscards.submitted[playerId] = discardBag`.
7. Check completion: if every key in `required` is now in `submitted`, clear
   `pendingDiscards` and set `pendingRobberMove = true`.

Utility functions available: `bagCount`, `bagAtLeast`, `bagSubtractInPlace`,
`ensureResourceBag` — all imported from `utils.js` already at line 11-22.
[VERIFIED: engine.js lines 11-22]

---

## 5. Robber Move Mechanics

### New action: `moveRobber(state, playerId, hexId, ts)`

1. Guard: `ensureMainActionTurn(state, playerId)` — only the active player can move.
2. Guard: `state.turn.pendingRobberMove` must be `true`.
3. Look up hex: `const hex = getHex(state.board, hexId)` — throws if not found (existing
   `getHex` helper, board.js).
4. Guard: `hex.terrainId === "wild_heath"` → throw `"Robber cannot be placed on Wild Heath"`.
5. Guard: `hexId === state.robberHexId` → throw `"Robber is already on that hex"` (standard
   Catan rule — must move to a different hex).
6. Update: `state.robberHexId = hexId`.
7. Clear: `state.turn.pendingRobberMove = null`.
8. Compute eligible players for steal (see §6).
9. If eligible players exist: set `state.turn.pendingSteal = { eligiblePlayerIds }`.
10. If none: set `state.turn.pendingSteal = null` (auto-skip), log the skip.

### Wild heath guard

```js
const hex = getHex(state.board, hexId);
if (hex.terrainId === "wild_heath") {
  throw new Error("Robber cannot be placed on Wild Heath");
}
```

`getHex` is already imported at engine.js line 9. `terrainId` is a first-class field on every
hex object. [VERIFIED: board.js lines 175, engine.js line 483]

---

## 6. Steal Mechanics

### Finding eligible players

After `state.robberHexId = hexId`:

```js
const newHex = getHex(state.board, hexId);
const activePlayerId = getActivePlayerId(state);
const onHex = new Set();

for (const intersectionId of newHex.intersectionIds) {
  const structure = state.structures.intersections[intersectionId];
  if (structure && structure.ownerId !== activePlayerId) {
    const candidate = state.players[structure.ownerId];
    if (bagCount(candidate.resources) > 0) {
      onHex.add(structure.ownerId);
    }
  }
}
const eligiblePlayerIds = [...onHex];
```

Criteria: has a cottage or manor on the new hex, is not the active player, has at least 1
card. [ASSUMED — Catan standard: must have cards to be stealable from]

### New action: `resolveSteal(state, playerId, ts)`

1. Guard: `ensureMainActionTurn(state, playerId)`.
2. Guard: `state.turn.pendingSteal` must be non-null.
3. If `eligiblePlayerIds` is empty (defensive): clear `pendingSteal`, return.
4. Pick random victim: `const victimId = eligiblePlayerIds[randomInt(eligiblePlayerIds.length, rng)]`.
5. Pick random card from victim: collect all resource types with count > 0, pick one using
   `rng`, subtract 1 from victim, add 1 to active player.
6. Log the steal (resource type hidden from non-participants in public state if desired — see
   pitfall §9.3).
7. Clear `state.turn.pendingSteal = null`.

`randomInt` is already imported from utils.js (line 20). The `rng` parameter must be threaded
through from the caller, matching how frost uses `rng` in `rollDice`.

**Important:** `resolveSteal` needs an `rng` parameter. All new action functions should accept
`rng = Math.random` as their last parameter (matching existing `rollDice` signature) to remain
deterministically testable.

---

## 7. `endTurn` Gate

Current guard in `endTurn` (lines 976-980):

```js
export function endTurn(state, playerId, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.rolled) {
    throw new Error("You must roll before ending your turn");
  }
```

Add immediately after the `rolled` check:

```js
if (state.turn.pendingDiscards !== null) {
  throw new Error("Discards must be resolved before ending your turn");
}
if (state.turn.pendingRobberMove !== null) {
  throw new Error("Robber must be moved before ending your turn");
}
if (state.turn.pendingSteal !== null) {
  throw new Error("Steal must be resolved before ending your turn");
}
```

The order matches the sequence: discards → robber move → steal. A player cannot end their
turn while any of these are pending.

Also update `endTurn`'s reset block to explicitly null out all three fields (defensive, they
should already be null if the gate passed):

```js
state.turn.pendingDiscards = null;
state.turn.pendingRobberMove = null;
state.turn.pendingSteal = null;
```

---

## 8. Export Surface

`packages/core/src/index.js` uses `export * from "./engine.js"` — any new `export function`
in engine.js is automatically re-exported. No changes to index.js required.

New functions to add as named exports in engine.js:

| Function | Signature |
|----------|-----------|
| `submitDiscard` | `(state, playerId, discardBag, ts = Date.now())` |
| `moveRobber` | `(state, playerId, hexId, ts = Date.now())` |
| `resolveSteal` | `(state, playerId, ts = Date.now(), rng = Math.random)` |

`getLegalActions` also needs updating to return `"submitDiscard"`, `"moveRobber"`, and
`"resolveSteal"` in the appropriate pending states (for non-active players during
`pendingDiscards`, for the active player during `pendingRobberMove` and `pendingSteal`).

---

## 9. Common Pitfalls

### Pitfall 1: Non-active players cannot reach `ensureMainActionTurn`

`submitDiscard` must be callable by ANY player who owes discards, not just the active player.
Using `ensureMainActionTurn` in `submitDiscard` would break multiplayer discard — multiple
players may owe discards simultaneously. Use a custom guard instead:

```js
if (!state.turn.pendingDiscards) throw new Error("No discards pending");
if (!(playerId in state.turn.pendingDiscards.required)) throw new Error("You do not owe a discard");
if (playerId in state.turn.pendingDiscards.submitted) throw new Error("Already submitted discard");
```

### Pitfall 2: `endTurn` reset nulls fields that are already null

The three new turn fields are set to `null` in `startMainPhase` and reset in `endTurn`. If
`endTurn` does a spread reset (`state.turn = { ...state.turn, rolled: false, ... }`) it will
lose the fields unless they are explicitly included. The current `endTurn` mutates individual
properties (lines 995-999), not a spread — continue that pattern.

### Pitfall 3: `getLegalActions` does not surface Roll 7 pending actions

`getLegalActions` (lines 1060-1099) is the source of truth for what the client renders.
Forgetting to add `"submitDiscard"` for non-active players in pending-discards state means the
client will show no available actions. This is a silent failure — the game is not broken but
the player has no UI affordance. Add a guard block at the top of `getLegalActions`:

```js
// Inside getLegalActions, before the active-player checks:
if (state.turn?.pendingDiscards && playerId in state.turn.pendingDiscards.required
    && !(playerId in (state.turn.pendingDiscards.submitted ?? {}))) {
  return ["submitDiscard"];
}
```

### Pitfall 4: Steal card type leaking to non-participants in public state

`getPublicGameState` logs are visible to all players. The steal log message should hide the
stolen resource type from everyone except the two parties involved. The simplest approach:
log a generic message (`"p1 stole a card from p2"`) rather than revealing the resource. The
current frost and production log messages do reveal resources — steal is different because it
creates information asymmetry that is part of the game.

### Pitfall 5: `pendingSteal.eligiblePlayerIds` going stale

Eligible players are computed once when `moveRobber` executes. If the steal target discarded
all their cards during the discard phase (which always precedes the robber move), they will
correctly have 0 cards and not be included. But re-checking card count inside `resolveSteal`
is still worth doing as a defensive guard — a player's hand can only decrease from the discard
phase, never increase, so a zero-card player should be filtered out.

### Pitfall 6: Forgetting the `rng` parameter on `resolveSteal` breaks deterministic tests

Existing tests use `rngForDice(dieA, dieB)` to inject a seeded random function into
`rollDice`. `resolveSteal` similarly needs a seeded `rng` in tests. Follow the exact pattern
of `rollDice`: last parameter `rng = Math.random`. Tests must pass an explicit rng to control
which player is stolen from and which card is taken.

---

## 10. Minimal Change Surface

Every file that needs touching:

| File | What changes |
|------|-------------|
| `packages/core/src/engine.js` | (1) Add 3 nullable fields to `startMainPhase` turn init; (2) Add roll === 7 branch in `rollDice`; (3) Add `submitDiscard` export; (4) Add `moveRobber` export; (5) Add `resolveSteal` export; (6) Add 3 pending-state guards in `endTurn`; (7) Add 3 null resets in `endTurn` reset block; (8) Update `getLegalActions` for pending-discard and pending-robber-move states |
| `packages/core/test/engine.test.js` | New `describe("roll 7 sequence")` block covering ROLL7-01, ROLL7-02, ROLL7-03 |

No other files require changes. `index.js` auto-re-exports via `export *`. `constants.js` and
`board.js` are read-only for this phase.

---

## Architecture Patterns

### Frost as reference for post-roll inline resolution

Frost (roll === 2) resolves entirely inside `rollDice` with no player input — it picks a hex
with `rng`, applies the effect, and returns. Roll 7 cannot follow this pattern because
`submitDiscard` requires responses from potentially multiple players.

### Sequential pending flags (not a queue)

Use three independent nullable fields rather than an array of pending steps. This keeps
`getPublicGameState`'s turn spread (`{ ...state.turn }`) simple and avoids needing a step
cursor. Each field is truthy only during its window.

### Pattern: guard → mutate → advance

Each action function follows: validate pending state exists → validate caller is eligible →
validate payload → mutate resources → clear current pending → set next pending (or null).

---

## Code Examples

### roll === 7 branch in `rollDice` (insert after line 589, before the roll === 2 check)

```js
if (roll === 7) {
  const required = {};
  for (const pid of state.playerOrder) {
    const count = bagCount(state.players[pid].resources);
    if (count >= 7) {
      required[pid] = Math.floor(count / 2);
    }
  }
  if (Object.keys(required).length > 0) {
    state.turn.pendingDiscards = { required, submitted: {} };
    pushLog(state, `${player.name} rolled 7. Players with 7+ cards must discard.`, ts);
  } else {
    state.turn.pendingRobberMove = true;
    pushLog(state, `${player.name} rolled 7. Move the robber.`, ts);
  }
  return { roll, gains: {} };
}
```

### `submitDiscard` skeleton

```js
export function submitDiscard(state, playerId, discardBag, ts = Date.now()) {
  if (state.phase !== "main") throw new Error("Match is not in main phase");
  const pending = state.turn?.pendingDiscards;
  if (!pending) throw new Error("No discard pending");
  if (!(playerId in pending.required)) throw new Error("You do not owe a discard");
  if (playerId in pending.submitted) throw new Error("Already submitted");

  const player = getPlayer(state, playerId);
  const bag = ensureResourceBag(discardBag);
  if (bagCount(bag) !== pending.required[playerId]) {
    throw new Error(`Must discard exactly ${pending.required[playerId]} cards`);
  }
  if (!bagAtLeast(player.resources, bag)) throw new Error("You do not have those cards");

  bagSubtractInPlace(player.resources, bag);
  pending.submitted[playerId] = bag;
  pushLog(state, `${player.name} discarded ${pending.required[playerId]} cards.`, ts);

  const allDone = Object.keys(pending.required).every(id => id in pending.submitted);
  if (allDone) {
    state.turn.pendingDiscards = null;
    state.turn.pendingRobberMove = true;
    pushLog(state, "All discards complete. Move the robber.", ts);
  }
}
```

### `moveRobber` skeleton

```js
export function moveRobber(state, playerId, hexId, ts = Date.now()) {
  ensureMainActionTurn(state, playerId);
  if (!state.turn.pendingRobberMove) throw new Error("No robber move pending");

  const hex = getHex(state.board, hexId);
  if (hex.terrainId === "wild_heath") throw new Error("Robber cannot be placed on Wild Heath");
  if (hexId === state.robberHexId) throw new Error("Robber is already on that hex");

  state.robberHexId = hexId;
  state.turn.pendingRobberMove = null;
  pushLog(state, `${state.players[playerId].name} moved the robber to ${hex.terrainName}.`, ts);

  // compute eligible targets
  const eligible = [];
  for (const ixId of hex.intersectionIds) {
    const structure = state.structures.intersections[ixId];
    if (structure && structure.ownerId !== playerId && bagCount(state.players[structure.ownerId].resources) > 0) {
      if (!eligible.includes(structure.ownerId)) eligible.push(structure.ownerId);
    }
  }

  if (eligible.length > 0) {
    state.turn.pendingSteal = { eligiblePlayerIds: eligible };
  } else {
    state.turn.pendingSteal = null;
    pushLog(state, "No eligible players to steal from.", ts);
  }
}
```

### `resolveSteal` skeleton

```js
export function resolveSteal(state, playerId, ts = Date.now(), rng = Math.random) {
  ensureMainActionTurn(state, playerId);
  if (state.turn.pendingSteal === null) throw new Error("No steal pending");

  const { eligiblePlayerIds } = state.turn.pendingSteal;
  if (eligiblePlayerIds.length === 0) {
    state.turn.pendingSteal = null;
    return;
  }

  const victimId = eligiblePlayerIds[randomInt(eligiblePlayerIds.length, rng)];
  const victim = state.players[victimId];
  const cards = Object.entries(victim.resources)
    .flatMap(([res, count]) => Array(count).fill(res));
  const stolen = cards[randomInt(cards.length, rng)];

  victim.resources[stolen] -= 1;
  state.players[playerId].resources[stolen] += 1;
  state.turn.pendingSteal = null;

  pushLog(state, `${state.players[playerId].name} stole a card from ${victim.name}.`, ts);
}
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (inferred from existing test file imports) |
| Config file | none detected — inferred from package.json |
| Quick run command | `npm test --workspace packages/core` |
| Full suite command | `npm test --workspace packages/core` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | File |
|--------|----------|-----------|------|
| ROLL7-01 | Player with 7+ cards must submit exact floor(total/2) discard | unit | engine.test.js — new describe block |
| ROLL7-01 | `endTurn` blocked while discards pending | unit | engine.test.js |
| ROLL7-01 | Player with fewer than 7 cards not required to discard | unit | engine.test.js |
| ROLL7-02 | `moveRobber` to wild_heath throws | unit | engine.test.js |
| ROLL7-02 | `moveRobber` to valid hex updates `state.robberHexId` | unit | engine.test.js |
| ROLL7-02 | `endTurn` blocked while `pendingRobberMove` true | unit | engine.test.js |
| ROLL7-03 | Steal transfers 1 card from victim to active player | unit | engine.test.js |
| ROLL7-03 | No eligible players → steal auto-skipped, `pendingSteal` null | unit | engine.test.js |
| ROLL7-03 | `endTurn` blocked while `pendingSteal` non-null | unit | engine.test.js |

### Wave 0 Gaps
None — existing test infrastructure covers all phase requirements. No new files or fixtures needed.

---

## Sources

### Primary (HIGH confidence)
- `packages/core/src/engine.js` — read in full (lines 1-1206, post Phase 3 state)
- `packages/core/src/constants.js` — read in full; confirmed no token 7 in DEFAULT_NUMBER_TOKENS
- `packages/core/src/board.js` — lines 160-220; confirmed hex shape including terrainId
- `packages/core/test/engine.test.js` — read lines 1-450; confirmed helper functions available
- `packages/core/src/index.js` — confirmed `export *` pattern
- `.planning/phases/03-robber-state/03-01-SUMMARY.md` — confirmed robberHexId already in state

### Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Steal victim must have ≥1 card to be eligible (Catan standard) | §6 | Could allow stealing from empty-handed player; trivially testable |
| A2 | Steal log hides resource type from non-participants | §9 pitfall 4 | Minor UX issue only; no rules impact |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; uses existing engine utilities
- Architecture: HIGH — all patterns derived directly from codebase read
- Pitfalls: HIGH — derived from code paths, not from general knowledge

**Research date:** 2026-04-15
**Valid until:** Indefinite (internal codebase, no external dependencies)
