---
phase: 01-port-layout
reviewed: 2026-04-15T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/core/src/board.js
  - packages/core/src/constants.js
  - packages/core/test/engine.test.js
  - packages/core/scripts/derive-stall-coords.mjs
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 1 replaced randomized port assignment with a fixed Catan-standard layout. The core change is sound: `chooseStallIntersections` now does a coordKey Map lookup against `FIXED_STALL_COORDS`, the shuffle of stall definitions is gone, and two new constants (`FIXED_STALL_COORDS`, `BAZAAR_STALLS_ORDERED`) carry the deterministic layout. Runtime verification confirms all 9 stalls land on coastal intersections as expected.

Two warnings and two info items found. No critical issues.

---

## Warnings

### WR-01: Unused import `randomInt` left in board.js

**File:** `packages/core/src/board.js:8`
**Issue:** `randomInt` is imported from `./utils.js` but never called anywhere in the file. It was presumably used before this phase's rewrite of `chooseStallIntersections` and should have been removed when `rng` was dropped from that function.
**Fix:**
```js
// Before
import { assert, randomInt, shuffle } from "./utils.js";

// After
import { assert, shuffle } from "./utils.js";
```

---

### WR-02: Loop bound hardcodes `9` instead of deriving from array length

**File:** `packages/core/src/board.js:269`
**Issue:** The stall-assignment loop uses the literal `9` as its bound:
```js
for (let i = 0; i < 9; i += 1) {
  stallNodes[i].stall = { id: `stall_${i + 1}`, ...BAZAAR_STALLS_ORDERED[i] };
}
```
`stallNodes` is derived from `FIXED_STALL_COORDS.map(...)`, so `stallNodes.length === FIXED_STALL_COORDS.length`. If either array is ever edited to a different length (e.g., a future variant board), the literal `9` silently mismatches: it either skips the last stall or reads `undefined` from `BAZAAR_STALLS_ORDERED`. The `assert` on line 154 would catch a coord mismatch before this loop, but a length change to `BAZAAR_STALLS_ORDERED` alone would not be caught.
**Fix:**
```js
// Derive bound from the arrays to make any future length mismatch visible
assert(
  stallNodes.length === BAZAAR_STALLS_ORDERED.length,
  `Stall coord/definition count mismatch: ${stallNodes.length} vs ${BAZAAR_STALLS_ORDERED.length}`
);
for (let i = 0; i < stallNodes.length; i += 1) {
  stallNodes[i].stall = { id: `stall_${i + 1}`, ...BAZAAR_STALLS_ORDERED[i] };
}
```

---

## Info

### IN-01: Determinism test does not pin specific coord-to-resource mappings

**File:** `packages/core/test/engine.test.js:263`
**Issue:** The `port positions are identical across two game instances` test verifies that two `createBoard()` calls produce the same stall layout relative to each other, but it does not assert that a specific coordinate holds a specific resource. A rotation of the entire stall ring (all positions correct, every stall shifted one slot clockwise) would pass this test without any failure.

A snapshot assertion pinning at least one known coord-to-resource pair would catch that class of regression.

**Fix (additive, does not replace existing assertions):**
```js
// After the existing mapA/mapB equality check, add:
expect(mapA.get("0,-336")).toBe("specific:wool:2");
expect(mapA.get("-363.731,-42")).toBe("specific:clay:2");
```

---

### IN-02: `derive-stall-coords.mjs` does not assert the 30-coastal-node assumption

**File:** `packages/core/scripts/derive-stall-coords.mjs:26`
**Issue:** The index formula `Math.round(i * 30 / 9) % 30` embeds the assumption that `coastal.length === 30`. Verified at runtime this is true for `hexSize=84, radius=2`. But the script has no guard — if the count ever differs (e.g., a different board radius), the selection silently wraps or produces biased spacing with no error.

The script is one-shot and not run in production, so the risk is low. Adding one assert makes future re-runs self-checking.

**Fix:**
```js
// After line 4
assert(coastal.length === 30, `Expected 30 coastal nodes, got ${coastal.length}`);
// (import assert from "../src/utils.js" or throw manually)
```

---

_Reviewed: 2026-04-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
