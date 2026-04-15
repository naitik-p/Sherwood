# Testing Patterns

**Analysis Date:** 2026-04-08

## Test Framework

**Runner:**
- Vitest 2.1.8
- No config file detected — runs with defaults (ESM, no jsdom)
- Configured in `packages/core/package.json` as `"test": "vitest run"`

**Assertion Library:**
- Vitest built-ins (`expect`, `describe`, `test`)

**Run Commands:**
```bash
npm test                                      # Run all tests (delegates to core workspace)
npm --workspace @shorewood/core run test      # Run core tests directly
```

No watch mode script defined. No coverage script defined.

## Test File Organization

**Location:**
- Tests live in a dedicated `test/` directory alongside `src/`: `packages/core/test/`
- Not co-located with source files

**Naming:**
- Single test file: `packages/core/test/engine.test.js`

**Structure:**
```
packages/core/
├── src/
│   ├── board.js
│   ├── constants.js
│   ├── engine.js
│   ├── index.js
│   └── utils.js
└── test/
    └── engine.test.js
```

## Test Structure

**Suite Organization:**
```javascript
import { describe, expect, test } from "vitest";

describe("engine rules", () => {
  test("completes two-player snake setup and transitions to main phase", () => {
    // ...
  });

  test("rejects disconnected trail placements in main phase", () => {
    // ...
  });
});
```

All tests live in a single `describe("engine rules", ...)` block. No nested `describe` blocks.

**Patterns:**
- No `beforeEach` / `afterEach` hooks — each test creates its own state via helpers
- State is created fresh per test using `createMatch()` helper
- No shared mutable state between tests

## Mocking

**Framework:** None — no mocking library used.

**RNG Injection (primary isolation pattern):**
```javascript
function rngForDice(dieA, dieB) {
  const values = [
    (dieA - 0.2) / 6,
    (dieB - 0.2) / 6
  ];
  let i = 0;
  return () => {
    const value = values[i] ?? 0.2;
    i += 1;
    return value;
  };
}

// Usage:
const [d1, d2] = pickDiceForTotal(6);
rollDice(state, activePlayerId, 1_900, rngForDice(d1, d2));
```

The engine accepts `rng` as an injectable parameter on `rollDice` and board creation, making deterministic testing possible without any mock framework.

**Timestamp Injection:**
```javascript
// All engine functions accept ts as an explicit parameter:
rollDice(state, "p1", 3_000, rngForDice(1, 1));
endTurn(state, "p1", 3_001);
```

Timestamps are always passed as explicit integer values (milliseconds) in tests — no time-based mocking needed.

**What to Mock:**
- Pass `rngForDice(dieA, dieB)` when you need a specific dice outcome
- Pass explicit `ts` integers to all engine functions

**What NOT to Mock:**
- The engine state itself — always create it fresh with `createMatch()`
- Board generation — use the real board

## Fixtures and Factories

**Test Helper Functions (all defined at top of test file):**

```javascript
// Creates a 2-player game state
function createMatch() {
  return createInitializedGameState({
    roomId: "room_test",
    hostPlayerId: "p1",
    seed: "test_seed",
    players: [
      { id: "p1", name: "Ava", avatarId: "badge_1", isHost: true },
      { id: "p2", name: "Milo", avatarId: "badge_2", isHost: false }
    ],
    now: 1_000
  });
}

// Forces vote phase to resolve with FIRST_TO_10
function forceVoteToFirstToTen(state) {
  castWinVote(state, "p1", WIN_MODES.FIRST_TO_10, 1_010);
  castWinVote(state, "p2", WIN_MODES.FIRST_TO_10, 1_011);
}

// Advances through entire snake setup phase
function completeSnakeSetup(state) {
  while (state.phase === "setup") {
    const step = state.setup.queue[state.setup.index];
    const targets = getFastBuildTargets(state, step.playerId);
    if (step.type === "cottage") {
      buildCottage(state, step.playerId, targets.cottages[0], 1_100 + state.setup.index);
    } else {
      buildTrail(state, step.playerId, targets.trails[0], 1_100 + state.setup.index);
    }
  }
}

// Resets all player resources and structures to empty
function resetPlayersAndStructures(state) {
  state.structures.intersections = {};
  state.structures.edges = {};
  for (const playerId of state.playerOrder) {
    const player = state.players[playerId];
    player.cottages = [];
    player.manors = [];
    player.trails = [];
    player.resources = { timber: 0, clay: 0, wool: 0, harvest: 0, iron: 0 };
  }
}

// Returns an empty resource bag
function emptyBag() {
  return { timber: 0, clay: 0, wool: 0, harvest: 0, iron: 0 };
}
```

**Location:** All helpers are module-scope functions in `packages/core/test/engine.test.js` — no separate fixtures directory.

**Seeded Boards:**
- `seed: "test_seed"` used in `createMatch()` for deterministic board layout

## Coverage

**Requirements:** None enforced.

**No coverage script defined** in any `package.json`.

## Test Types

**Unit Tests:**
- `packages/core/test/engine.test.js` — 11 tests covering game engine rules
- Tests operate against pure in-memory state mutations
- No network, database, or DOM involved

**Integration Tests:**
- None present

**E2E Tests:**
- Playwright is installed as a root dev dependency (`playwright: ^1.58.2`) but no test files found
- No Playwright config or spec files detected

## Common Patterns

**Testing Illegal Actions (throws):**
```javascript
expect(() => buildTrail(state, activePlayerId, disconnected, 1_931))
  .toThrow(/Illegal trail placement/);

expect(() =>
  proposeTrade(state, "p1", { ... }, 5_000)
).toThrow(/Roll dice before posting a trade offer/);
```

**Testing State Transitions:**
```javascript
expect(state.phase).toBe("main");
expect(state.turn.order[state.turn.index]).toBe("p1");
expect(state.players.p1.cottages).toHaveLength(2);
```

**Testing Atomicity (failed operation leaves state unchanged):**
```javascript
const p1TimberBeforeFailedAccept = state.players.p1.resources.timber;
expect(() => acceptTrade(state, "p2", offer.id, 5_002)).toThrow(/Acceptor lacks resources/);
expect(state.players.p1.resources.timber).toBe(p1TimberBeforeFailedAccept);
```

**Testing Production Math:**
```javascript
const before = { ...state.players[step.playerId].resources };
buildCottage(state, step.playerId, chosen, 1_500 + state.setup.index);
const after = state.players[step.playerId].resources;
const observedGain = deltaBag(before, after);
expect(observedGain).toEqual(expectedGain);
```

**Advancing to a Known State:**
```javascript
// Standard test preamble to reach main phase:
const state = createMatch();
forceVoteToFirstToTen(state);
completeSnakeSetup(state);
// Now state.phase === "main"
```

---

*Testing analysis: 2026-04-08*
