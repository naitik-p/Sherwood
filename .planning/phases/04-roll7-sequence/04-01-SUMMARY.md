---
phase: 04-roll7-sequence
plan: 04-01
status: complete
completed: "2026-04-15"
commits:
  red: e11ad55
  green: f611ef8
requirements_addressed: ROLL7-01, ROLL7-02, ROLL7-03
files_modified:
  - packages/core/src/engine.js
  - packages/core/test/engine.test.js
---

# Phase 4 Summary — Roll 7 Sequence (ROLL7-01, ROLL7-02, ROLL7-03)

## What Was Done

Six targeted changes to `packages/core/src/engine.js` implement the full Roll 7 sequence.
Three new exported functions handle each step. Twelve new tests verify all three requirements.

### Changes to `engine.js`

**1. `startMainPhase` — 3 new null fields on `state.turn`**
```javascript
pendingDiscards: null,
pendingRobberMove: null,
pendingSteal: null
```

**2. `rollDice` — roll=7 branch (inserted before roll=2 frost check)**

When a 7 is rolled:
- Players with 7+ cards → `state.turn.pendingDiscards = { required, submitted: {} }`
- No players with 7+ cards → `state.turn.pendingRobberMove = true`
- Returns `{ roll, gains: {} }` immediately (no production)

**3. `endTurn` — 3 pending-state guards**

Throws before advancing the turn if any pending field is non-null:
- `"Discards must be resolved before ending your turn"`
- `"Robber must be moved before ending your turn"`
- `"Steal must be resolved before ending your turn"`

**4. `endTurn` reset block** — nulls all three fields after advancing turn

**5. `getLegalActions` — pending-discards escape hatch**

Non-active players owed a discard now get `["submitDiscard"]` before the `activeId !== playerId` guard.

**6. Three new exported functions**

- `submitDiscard(state, playerId, discardBag, ts)` — validates count and ownership, subtracts cards, sets `pendingRobberMove` when all required players have submitted
- `moveRobber(state, playerId, hexId, ts)` — rejects wild_heath and current hex, updates `state.robberHexId`, sets `pendingSteal` if eligible players exist on new hex
- `resolveSteal(state, playerId, ts, rng)` — picks random victim and random card server-side, transfers 1 card, clears `pendingSteal`

### Two pre-existing tests updated

- "frost lasts exactly two turns" — changed `rngForDice(3, 4)` (sum=7) to `rngForDice(4, 4)` (sum=8)
- "dice rolls vary over turns" — added inline Roll 7 drain in the loop (submitDiscard + moveRobber + resolveSteal) so the endTurn gate doesn't throw when a 7 comes up naturally

## Key Decisions

- `submitDiscard` uses custom guards instead of `ensureMainActionTurn` — non-active players must be able to submit discards simultaneously during a Roll 7
- Steal victim and card are chosen by server-side `rng`, not by client input — `resolveSteal` accepts `rng` as last param for deterministic tests
- `pendingSteal` is set to null immediately when no eligible players exist — no extra action required from active player
- Steal log says "stole a card" without naming the resource — avoids information leakage

## Verification

- 27/27 tests pass (15 pre-existing + 12 new Roll 7 tests)
- `npm run build` green (vite client 87ms)
- RED commit: `e11ad55` | GREEN commit: `f611ef8`
- `submitDiscard`, `moveRobber`, `resolveSteal` all exported via `packages/core/src/index.js`
