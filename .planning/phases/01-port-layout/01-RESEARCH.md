# Phase 1: Port Layout - Research

**Researched:** 2026-04-09
**Domain:** Board generation — fixed port placement in a radius-2 hex grid (JS/ESM)
**Confidence:** HIGH

## Summary

The current `chooseStallIntersections()` in `packages/core/src/board.js` picks 9 ports via randomized angular sampling over the sorted coastal intersections. This phase replaces that function with a deterministic array of 9 fixed intersection coordinates mapped to the standard Catan port layout.

The board geometry is fully deterministic given `hexSize`. Intersections are identified by their pixel coordinates (`x`, `y`) computed from `cornerPoint()` with `hexSize = 84` (the default). The correct approach is to hard-code 9 `(x, y)` coordinate pairs derived from the known axial hex positions and corner offsets, then look up those coordinates against the live intersection list using `coordKey()` rounding (3 decimal places).

All 12 existing tests pass today against the randomized placement. The one test that checks port geometry (`builds exactly 9 coastal markets...`) only validates counts, coastal flag, and resource coverage — not position identity — so a fixed-position replacement will keep all tests green without modification.

**Primary recommendation:** Replace `chooseStallIntersections()` with a function that returns intersections looked up by pre-computed fixed coordinates; assign stalls in the clockwise order from CONTEXT.md (wool, generic, timber, generic, harvest, iron, generic, clay, generic).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Replace `chooseStallIntersections()` entirely with a fixed array — no randomization
- Port resource order (clockwise from top): wool(2:1), generic(3:1), timber(2:1), generic(3:1), harvest(2:1), iron(2:1), generic(3:1), clay(2:1), generic(3:1)
- Maintain the existing stall data structure shape so downstream code (engine, client) requires no changes

### Claude's Discretion
All implementation details at Claude's discretion (yolo mode).

### Deferred Ideas (OUT OF SCOPE)
- Visual port labels on the client (orientation arrows)
- Port position configurability
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOARD-01 | 9 ports at fixed coastal positions: 5 specific 2:1 (one per resource), 4 generic 3:1, same every game | Fixed coordinate array derived from board geometry; stall assignment from CONTEXT.md order |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^2.1.8 | Test runner | Already in use; `packages/core` devDep [VERIFIED: packages/core/package.json] |

No new dependencies. This is a pure JS/ESM change inside `packages/core/src/board.js`. [VERIFIED: CONTEXT.md — "JS/ESM only, no new runtime dependencies"]

**Installation:** None required.

## Architecture Patterns

### How Intersection Coordinates Are Generated

Intersections are built in `createBoard()` by iterating over all 19 hexes and calling `cornerPoint(hex.x, hex.y, hexSize, i)` for `i = 0..5`. The pixel center of each hex comes from `axialToPixel(q, r, hexSize)`. [VERIFIED: packages/core/src/board.js lines 19-32, 197-218]

With default `hexSize = 84` and axial hex construction at radius 2, every intersection coordinate is deterministic. The board never changes shape — only terrain and tokens shuffle.

### Coastal Intersection Definition

A node is `coastal` when `node.hexIds.length < 3`. There are 30 coastal intersections in a radius-2 hex grid (the outer ring). [VERIFIED: packages/core/src/board.js line 271]

### Recommended Replacement Pattern

```javascript
// Source: board.js geometry — coordKey rounds to 3 decimal places
const FIXED_STALL_COORDS = [
  // [x, y] pairs for 9 clockwise coastal intersections at hexSize=84
  // computed from cornerPoint(axialToPixel(q, r, 84), 84, i)
  // order: wool, generic, timber, generic, harvest, iron, generic, clay, generic
];

function chooseStallIntersections(intersections) {
  const byCoord = new Map(
    intersections.map((node) => [coordKey(node.x, node.y), node])
  );
  return FIXED_STALL_COORDS.map(([x, y]) => {
    const node = byCoord.get(coordKey(x, y));
    assert(node, `Fixed stall coord ${x},${y} not found in intersection list`);
    assert(node.coastal, `Fixed stall coord ${x},${y} is not coastal`);
    return node;
  });
}
```

The `rng` parameter is removed from the signature — callers in `createBoard()` must be updated to drop it.

### Stall Assignment (no change needed)

After `chooseStallIntersections()` returns the ordered array, the existing loop in `createBoard()` assigns stalls:

```javascript
// Current code (lines 274-280) — keep as-is but drop shuffle
const stallNodes = chooseStallIntersections(intersections);
const stallDefs = BAZAAR_STALLS_ORDERED; // new: pre-ordered, no shuffle
for (let i = 0; i < 9; i += 1) {
  stallNodes[i].stall = { id: `stall_${i + 1}`, ...stallDefs[i] };
}
```

Either pre-order `BAZAAR_STALLS` in `constants.js` to match the clockwise sequence, or define a separate ordered constant.

### Anti-Patterns to Avoid

- **Deriving coordinates at runtime from axial inputs only:** `cornerPoint` uses float arithmetic. Always use the same `coordKey` rounding the rest of the codebase uses — do not compare raw floats.
- **Using intersection array index instead of coordinate lookup:** Intersection IDs (`ix_1`..`ix_N`) are assigned in hex iteration order, not clockwise coastal order. Index is not stable for this purpose.
- **Shuffling stall definitions:** Drop the `shuffle(BAZAAR_STALLS, rng)` call. Fixed positions require fixed resource assignments.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coordinate comparison | Custom float equality | Existing `coordKey()` (3dp rounding) | Already used for deduplication throughout board.js |
| Port order validation | Custom geometry traversal | Pre-computed constant array | The board is fixed at radius 2; geometry won't change |

## Common Pitfalls

### Pitfall 1: Coordinate Precision Mismatch
**What goes wrong:** A hard-coded coordinate like `145.49` doesn't match the stored `145.490` because rounding differs.
**Why it happens:** `coordKey` rounds to `Math.round(x * 1000) / 1000`, storing three significant decimal places. Hand-typed coordinates may have fewer.
**How to avoid:** Generate the constant array programmatically using the same `axialToPixel` + `cornerPoint` math, then serialize to constants — or use `coordKey()` on both sides of the lookup.
**Warning signs:** `assert` fires at startup with "Fixed stall coord not found."

### Pitfall 2: Removing `rng` from Call Site
**What goes wrong:** `chooseStallIntersections(intersections, rng)` in `createBoard()` is not updated — JS ignores the extra arg, but if the new function signature drops `rng`, stale callers go unnoticed.
**How to avoid:** Update the call in `createBoard()` at line 274 in the same commit.

### Pitfall 3: Stall Definitions Still Shuffled
**What goes wrong:** Fixed intersection order is correct but `shuffle(BAZAAR_STALLS, rng)` at line 275 randomizes which resource lands at which port.
**How to avoid:** Remove the `shuffle` call; use the BAZAAR_STALLS array in the clockwise order from CONTEXT.md, or define a separate ordered constant.

### Pitfall 4: Coastal Assertion Missing
**What goes wrong:** A typo in a coordinate silently maps to an interior intersection.
**How to avoid:** Assert `node.coastal` on every resolved intersection, not just count at the end.

## Code Examples

### Computing Fixed Coordinates (reference derivation)

```javascript
// Source: board.js axialToPixel + cornerPoint at hexSize=84
// Run once to derive the 9 coordinate pairs; paste result as constant

import { createBoard } from "./board.js";
const board = createBoard({ hexSize: 84 });
const coastal = board.intersections.filter(n => n.hexIds.length < 3);
// Sort clockwise from "top" (min y, then angle) and pick 9 positions
// matching Catan layout
```

### Test Pattern for Fixed Positions

```javascript
// Vitest — add to engine.test.js
test("port positions are identical across two game instances", () => {
  const a = createBoard({ hexSize: 84 });
  const b = createBoard({ hexSize: 84 });
  const posA = a.intersections.filter(n => n.stall).map(n => `${n.x},${n.y}`).sort();
  const posB = b.intersections.filter(n => n.stall).map(n => `${n.x},${n.y}`).sort();
  expect(posA).toEqual(posB);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Random port sampling (angular step + offset) | Fixed coordinate array | Phase 1 | Deterministic layout every game |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 30 coastal intersections exist in a radius-2 hex grid | Architecture Patterns | Low — verifiable by running `board.intersections.filter(n => n.hexIds.length < 3).length` |
| A2 | Standard Catan clockwise port order starts at "top" (minimum y) | Architecture Patterns | Medium — if the canonical Catan order starts at a different compass point, port resources will be rotated. The CONTEXT.md order is locked, so the only question is which coastal intersection is "first." |

## Open Questions

1. **Which coastal intersection maps to "top" (wool port)?**
   - What we know: `axialToPixel` places `r=0` hexes on the horizontal axis; the topmost hex at radius 2 is `(0, -2)`, giving corner positions near `y = -252` at `hexSize=84`.
   - What's unclear: The exact `(x, y)` for each of the 9 chosen intersections must be computed before the constant array can be written.
   - Recommendation: The planner's Wave 0 task should compute and document the 9 coordinate pairs from a one-shot script before writing the constant.

## Environment Availability

Step 2.6: SKIPPED — no external dependencies. Pure code change inside `packages/core/src/board.js` with no CLI tools, databases, or services required.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 2.1.8 |
| Config file | none — vitest default discovery |
| Quick run command | `cd packages/core && npm test` |
| Full suite command | `cd packages/core && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOARD-01 | 9 stalls, 5 specific 2:1, 4 generic 3:1, all coastal | unit | `cd packages/core && npm test` | Partial — existing test covers counts; new test needed for positional determinism |

### Sampling Rate
- **Per task commit:** `cd packages/core && npm test`
- **Per wave merge:** `cd packages/core && npm test`
- **Phase gate:** All 12+ tests green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] New test: `port positions are identical across two game instances` — covers BOARD-01 positional determinism
- [ ] Coordinate derivation script (run once, then discard) to generate the 9 fixed `(x, y)` pairs

## Security Domain

Not applicable. No authentication, session, input validation, or cryptographic concerns in board geometry generation.

## Sources

### Primary (HIGH confidence)
- `packages/core/src/board.js` — full source read; geometry functions `axialToPixel`, `cornerPoint`, `coordKey`, `chooseStallIntersections`, `createBoard` analyzed directly
- `packages/core/src/constants.js` — `BAZAAR_STALLS` definition and resource names verified
- `packages/core/test/engine.test.js` — all 12 tests read; port-related test at line 243 identified
- `packages/core/package.json` — vitest version and test command verified
- `.planning/config.json` — `nyquist_validation: true` confirmed
- `.planning/phases/01-port-layout/01-CONTEXT.md` — locked decisions and port order read

### Secondary (MEDIUM confidence)
- `apps/client/src/main.js` — stall rendering verified; reads `node.stall.id`, `.kind`, `.ratio`, `.resource` — data shape unchanged by this phase [ASSUMED: no other client files exist that consume stall data]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — source files read directly, no external deps
- Architecture: HIGH — board.js geometry fully analyzed; coordinate derivation approach is deterministic
- Pitfalls: HIGH — derived from direct code inspection, not training data
- Port order: HIGH — locked in CONTEXT.md, no ambiguity on resource sequence
- "Top" intersection identity: MEDIUM — requires one runtime computation to confirm exact coordinates

**Research date:** 2026-04-09
**Valid until:** Stable indefinitely — pure geometry, no external dependencies
