---
phase: 01-port-layout
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/src/constants.js
  - packages/core/src/board.js
  - packages/core/test/engine.test.js
  - packages/core/scripts/derive-stall-coords.mjs
autonomous: true
requirements:
  - BOARD-01
must_haves:
  truths:
    - "Every new game places exactly 9 stalls at the same (x,y) coastal intersections"
    - "The 5 specific 2:1 ports each cover a unique resource (timber, clay, wool, harvest, iron)"
    - "The 4 generic 3:1 ports fill the remaining selected coastal intersections"
    - "Two createBoard({ hexSize: 84 }) calls in the same process produce identical stall positions and identical resource-to-position mapping"
    - "All 12 existing engine tests plus the new determinism test pass"
  artifacts:
    - path: "packages/core/scripts/derive-stall-coords.mjs"
      provides: "One-shot script that computes and prints the 9 clockwise coastal (x,y) coordinate pairs"
      contains: "createBoard"
    - path: "packages/core/src/constants.js"
      provides: "FIXED_STALL_COORDS constant (9 [x,y] pairs) and BAZAAR_STALLS_ORDERED constant (clockwise: wool, generic, timber, generic, harvest, iron, generic, clay, generic)"
      contains: "FIXED_STALL_COORDS"
    - path: "packages/core/src/board.js"
      provides: "Deterministic chooseStallIntersections() using coordKey lookup; shuffle of BAZAAR_STALLS removed"
      contains: "FIXED_STALL_COORDS"
    - path: "packages/core/test/engine.test.js"
      provides: "New test: 'port positions are identical across two game instances' covering BOARD-01 positional determinism and resource-to-position determinism"
      contains: "port positions are identical across two game instances"
  key_links:
    - from: "packages/core/src/board.js chooseStallIntersections"
      to: "packages/core/src/constants.js FIXED_STALL_COORDS"
      via: "import"
      pattern: "FIXED_STALL_COORDS"
    - from: "packages/core/src/board.js createBoard stall assignment loop"
      to: "packages/core/src/constants.js BAZAAR_STALLS_ORDERED"
      via: "import (replacing shuffle(BAZAAR_STALLS))"
      pattern: "BAZAAR_STALLS_ORDERED"
    - from: "packages/core/test/engine.test.js"
      to: "packages/core/src/board.js createBoard"
      via: "two createBoard() calls with identical hexSize, compare sorted stall positions and resource mapping"
      pattern: "port positions are identical"
---

<objective>
Replace the randomized port assignment in `packages/core/src/board.js` with a fixed Catan-standard layout. Every new game will produce exactly 9 stalls at the same coastal intersections, with resources mapped in the locked clockwise order from CONTEXT.md.

Purpose: Satisfy BOARD-01 — players see the standard Catan port layout every game, deterministic across sessions and page reloads.
Output: Updated `board.js` (deterministic `chooseStallIntersections`), `constants.js` (`FIXED_STALL_COORDS` + `BAZAAR_STALLS_ORDERED`), a one-shot derivation script under `packages/core/scripts/`, and a new positional determinism test in `engine.test.js`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-port-layout/01-CONTEXT.md
@.planning/phases/01-port-layout/01-RESEARCH.md
@.planning/phases/01-port-layout/01-VALIDATION.md
@packages/core/src/board.js
@packages/core/src/constants.js
@packages/core/test/engine.test.js

<interfaces>
<!-- Key contracts and signatures the executor needs. Extracted from the codebase. -->
<!-- Executor MUST use these directly — no additional codebase exploration needed. -->

From packages/core/src/board.js (existing):
```javascript
// Pixel math (deterministic given hexSize)
function axialToPixel(q, r, size) {
  return { x: size * SQRT3 * (q + r / 2), y: size * (3 / 2) * r };
}

function cornerPoint(centerX, centerY, size, i) {
  const angleDeg = 60 * i - 30;
  const angleRad = (Math.PI / 180) * angleDeg;
  return {
    x: centerX + size * Math.cos(angleRad),
    y: centerY + size * Math.sin(angleRad)
  };
}

// Rounds to 3 decimal places — MUST be used for both sides of any (x,y) comparison
function coordKey(x, y) {
  return `${Math.round(x * 1000) / 1000},${Math.round(y * 1000) / 1000}`;
}

// Current (to be replaced) — signature includes rng
function chooseStallIntersections(intersections, rng) { /* random */ }

// Call site in createBoard (line ~274, MUST be updated)
const stallNodes = chooseStallIntersections(intersections, rng);
const stallDefs = shuffle(BAZAAR_STALLS, rng);
for (let i = 0; i < 9; i += 1) {
  stallNodes[i].stall = { id: `stall_${i + 1}`, ...stallDefs[i] };
}

// Intersection node shape
// { id, x, y, hexIds, edgeIds, adjacentIntersectionIds, coastal, stall }
// coastal === (hexIds.length < 3)
```

From packages/core/src/constants.js (existing):
```javascript
export const BAZAAR_STALLS = [
  { kind: "specific", resource: "timber", ratio: 2 },
  { kind: "specific", resource: "clay", ratio: 2 },
  { kind: "specific", resource: "wool", ratio: 2 },
  { kind: "specific", resource: "harvest", ratio: 2 },
  { kind: "specific", resource: "iron", ratio: 2 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 },
  { kind: "generic", resource: null, ratio: 3 }
];
```

Locked clockwise port order (from CONTEXT.md, starting from top):
wool(2:1) -> generic(3:1) -> timber(2:1) -> generic(3:1) -> harvest(2:1) -> iron(2:1) -> generic(3:1) -> clay(2:1) -> generic(3:1)

Existing test invariants that MUST stay green (engine.test.js line ~243):
- Exactly 9 stall nodes
- All stall nodes are coastal (hexIds.length < 3)
- 5 specific 2:1 stalls covering {timber, clay, wool, harvest, iron}
- 4 generic 3:1 stalls
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Derive fixed stall coordinates and add failing positional determinism test (RED)</name>
  <files>
    - packages/core/scripts/derive-stall-coords.mjs
    - packages/core/test/engine.test.js
  </files>
  <read_first>
    - packages/core/src/board.js
    - packages/core/src/constants.js
    - packages/core/test/engine.test.js
    - .planning/phases/01-port-layout/01-RESEARCH.md
    - .planning/phases/01-port-layout/01-CONTEXT.md
  </read_first>
  <behavior>
    Test expectations (to be added to engine.test.js):
    - Two consecutive `createBoard({ hexSize: 84 })` calls produce identical stall positions when compared as a sorted list of `"x,y"` strings.
    - Two consecutive `createBoard({ hexSize: 84 })` calls produce an identical mapping from `"x,y"` to `{ kind, resource, ratio }` — the same resource lands on the same coordinate every time.
    - Exactly 9 stalls are placed.
    - All 9 stalls are coastal.
  </behavior>
  <action>
    Step 1 — Write a one-shot derivation script at `packages/core/scripts/derive-stall-coords.mjs`:

    - Import: `import { createBoard } from "../src/board.js";`
    - Build one board at `hexSize = 84` and gather coastal intersections: `const coastal = board.intersections.filter(n => n.hexIds.length < 3);`
    - Compute center of mass for coastal nodes: `cx = mean(coastal.x), cy = mean(coastal.y)` (should be ~0,0 but do not assume).
    - Compute angle for each coastal node relative to center: `angle = Math.atan2(n.y - cy, n.x - cx)` where angle `-Math.PI/2` is "top" (min y).
    - Normalize angles so that the topmost node is the 0 index, then sort clockwise. Concretely: sort by `((angle + Math.PI/2 + 2*Math.PI) % (2*Math.PI))` ascending. This orders coastal nodes starting from top, going clockwise.
    - There are 30 coastal intersections. Select 9 evenly spaced positions by index: for `i in 0..8`, pick `sorted[Math.round(i * 30 / 9) % 30]`. This yields a well-spread clockwise ring of 9 nodes (indices 0, 3, 7, 10, 13, 17, 20, 23, 27).
    - Print as a paste-ready constant:
      ```
      export const FIXED_STALL_COORDS = [
        [x0, y0], // 0 wool (2:1)
        [x1, y1], // 1 generic (3:1)
        [x2, y2], // 2 timber (2:1)
        [x3, y3], // 3 generic (3:1)
        [x4, y4], // 4 harvest (2:1)
        [x5, y5], // 5 iron (2:1)
        [x6, y6], // 6 generic (3:1)
        [x7, y7], // 7 clay (2:1)
        [x8, y8], // 8 generic (3:1)
      ];
      ```
      using 3-decimal-rounded values (match `coordKey` rounding — use `Math.round(v * 1000) / 1000`).
    - Also print `// coastal check:` and the boolean `coastal === true` for each selected node to prove coastal membership.
    - Run the script with `node packages/core/scripts/derive-stall-coords.mjs` and capture its output. Do NOT insert the values into `constants.js` yet — that happens in Task 2. The script is kept in the repo as a derivation record.

    Step 2 — Append a new failing test to `packages/core/test/engine.test.js` (place it after the existing "builds exactly 9 coastal markets..." test, line ~243). Use vitest's existing `test(...)` import pattern from that file:

    ```javascript
    test("port positions are identical across two game instances", () => {
      const a = createBoard({ hexSize: 84 });
      const b = createBoard({ hexSize: 84 });

      const posA = a.intersections
        .filter((n) => n.stall)
        .map((n) => `${n.x},${n.y}`)
        .sort();
      const posB = b.intersections
        .filter((n) => n.stall)
        .map((n) => `${n.x},${n.y}`)
        .sort();

      expect(posA).toHaveLength(9);
      expect(posA).toEqual(posB);

      const mapA = new Map(
        a.intersections
          .filter((n) => n.stall)
          .map((n) => [`${n.x},${n.y}`, `${n.stall.kind}:${n.stall.resource ?? "*"}:${n.stall.ratio}`])
      );
      const mapB = new Map(
        b.intersections
          .filter((n) => n.stall)
          .map((n) => [`${n.x},${n.y}`, `${n.stall.kind}:${n.stall.resource ?? "*"}:${n.stall.ratio}`])
      );

      expect([...mapA.entries()].sort()).toEqual([...mapB.entries()].sort());

      const coastalOnly = a.intersections.filter((n) => n.stall).every((n) => n.coastal);
      expect(coastalOnly).toBe(true);
    });
    ```

    Use the existing `createBoard` import already present in the test file — do not add new imports if they already exist.

    Step 3 — Run `cd packages/core && npm test` and confirm the new test FAILS (the current random implementation cannot produce identical positions or mappings across two calls). Capture the failure output in the commit message.

    Step 4 — Commit with message: `test(01-port-layout): add failing positional determinism test + derivation script`. Stage only `packages/core/scripts/derive-stall-coords.mjs` and `packages/core/test/engine.test.js`.
  </action>
  <verify>
    <automated>cd packages/core && node scripts/derive-stall-coords.mjs && npm test 2>&1 | grep -E "port positions are identical|FAIL|failing" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - File `packages/core/scripts/derive-stall-coords.mjs` exists.
    - Running `node packages/core/scripts/derive-stall-coords.mjs` exits 0 and prints exactly 9 `[x, y]` pairs labeled 0..8 with the clockwise resource order in comments (wool, generic, timber, generic, harvest, iron, generic, clay, generic).
    - `packages/core/test/engine.test.js` contains the literal string `port positions are identical across two game instances`.
    - `cd packages/core && npm test` currently exits non-zero with the new test failing (this is the RED step — the old random implementation must fail it).
    - The existing 12 tests continue to pass; only the new test fails.
  </acceptance_criteria>
  <done>
    New test file edit and derivation script committed. The test is failing against the current random implementation, proving it exercises the determinism requirement. Derived 9 coordinate pairs are printed and captured (saved in the script output, to be pasted into constants.js in Task 2).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Replace random port assignment with fixed layout (GREEN)</name>
  <files>
    - packages/core/src/constants.js
    - packages/core/src/board.js
  </files>
  <read_first>
    - packages/core/src/board.js
    - packages/core/src/constants.js
    - packages/core/scripts/derive-stall-coords.mjs
    - packages/core/test/engine.test.js
    - .planning/phases/01-port-layout/01-RESEARCH.md
  </read_first>
  <behavior>
    After this task:
    - `chooseStallIntersections(intersections)` takes ONE argument (rng removed), returns 9 intersection nodes in the locked clockwise order, looked up via `coordKey()` from `FIXED_STALL_COORDS`.
    - `BAZAAR_STALLS_ORDERED` exists in `constants.js` with 9 entries in clockwise order: wool(2:1), generic(3:1), timber(2:1), generic(3:1), harvest(2:1), iron(2:1), generic(3:1), clay(2:1), generic(3:1).
    - `createBoard()` no longer calls `shuffle(BAZAAR_STALLS, rng)` for stalls. It iterates `BAZAAR_STALLS_ORDERED` and pairs each with the fixed intersection at the same index.
    - The positional determinism test from Task 1 now passes.
    - All 12 existing tests still pass.
  </behavior>
  <action>
    Step 1 — Run the derivation script from Task 1 to obtain the 9 coordinate pairs:
    ```
    cd packages/core && node scripts/derive-stall-coords.mjs
    ```
    Copy the printed `FIXED_STALL_COORDS = [...]` block. Each value is rounded to 3 decimals to match `coordKey` (`Math.round(v * 1000) / 1000`).

    Step 2 — Edit `packages/core/src/constants.js`. Add two new exports at the bottom of the file (keep `BAZAAR_STALLS` unchanged for backward compatibility — nothing else imports it after this change but leaving it avoids unrelated churn):

    ```javascript
    // Fixed Catan-standard port layout. Derived once via scripts/derive-stall-coords.mjs
    // at hexSize=84. Do not hand-edit — re-run the script if hexSize changes.
    // Order is clockwise from "top" (min y), matching BAZAAR_STALLS_ORDERED.
    export const FIXED_STALL_COORDS = [
      // PASTE 9 [x, y] PAIRS FROM derive-stall-coords.mjs OUTPUT
      // index 0 -> wool (2:1)
      // index 1 -> generic (3:1)
      // index 2 -> timber (2:1)
      // index 3 -> generic (3:1)
      // index 4 -> harvest (2:1)
      // index 5 -> iron (2:1)
      // index 6 -> generic (3:1)
      // index 7 -> clay (2:1)
      // index 8 -> generic (3:1)
    ];

    export const BAZAAR_STALLS_ORDERED = [
      { kind: "specific", resource: "wool", ratio: 2 },
      { kind: "generic", resource: null, ratio: 3 },
      { kind: "specific", resource: "timber", ratio: 2 },
      { kind: "generic", resource: null, ratio: 3 },
      { kind: "specific", resource: "harvest", ratio: 2 },
      { kind: "specific", resource: "iron", ratio: 2 },
      { kind: "generic", resource: null, ratio: 3 },
      { kind: "specific", resource: "clay", ratio: 2 },
      { kind: "generic", resource: null, ratio: 3 }
    ];
    ```

    Replace the PASTE line with the actual 9 pairs from the script output.

    Step 3 — Edit `packages/core/src/board.js`:

    3a. Update the import at line 1-6 to include the new constants:
    ```javascript
    import {
      BAZAAR_STALLS_ORDERED,
      DEFAULT_NUMBER_TOKENS,
      DEFAULT_TERRAIN_DISTRIBUTION,
      FIXED_STALL_COORDS,
      TERRAINS
    } from "./constants.js";
    ```
    Remove `BAZAAR_STALLS` from the import list (no longer used in this file).

    3b. Replace the ENTIRE `chooseStallIntersections` function (lines 146-164) with:
    ```javascript
    function chooseStallIntersections(intersections) {
      const byCoord = new Map(
        intersections.map((node) => [coordKey(node.x, node.y), node])
      );
      return FIXED_STALL_COORDS.map(([x, y]) => {
        const key = coordKey(x, y);
        const node = byCoord.get(key);
        assert(node, `Fixed stall coord ${x},${y} not found in intersection list`);
        assert(node.coastal, `Fixed stall coord ${x},${y} is not coastal`);
        return node;
      });
    }
    ```
    Note: signature now takes only `intersections` — `rng` is removed.

    3c. Update the stall assignment block in `createBoard()` (lines 274-281). Replace:
    ```javascript
    const stallNodes = chooseStallIntersections(intersections, rng);
    const stallDefs = shuffle(BAZAAR_STALLS, rng);
    for (let i = 0; i < 9; i += 1) {
      stallNodes[i].stall = {
        id: `stall_${i + 1}`,
        ...stallDefs[i]
      };
    }
    ```
    With:
    ```javascript
    const stallNodes = chooseStallIntersections(intersections);
    for (let i = 0; i < 9; i += 1) {
      stallNodes[i].stall = {
        id: `stall_${i + 1}`,
        ...BAZAAR_STALLS_ORDERED[i]
      };
    }
    ```

    Step 4 — Run the full test suite:
    ```
    cd packages/core && npm test
    ```
    All 13 tests must pass (12 existing + the determinism test from Task 1).

    Step 5 — Run the repo build to confirm no downstream breakage:
    ```
    npm run build
    ```
    Must exit 0.

    Step 6 — Commit with message: `feat(01-port-layout): replace random port assignment with fixed Catan layout`. Stage `packages/core/src/constants.js` and `packages/core/src/board.js`.
  </action>
  <verify>
    <automated>cd packages/core && npm test && cd ../.. && npm run build</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "FIXED_STALL_COORDS" packages/core/src/constants.js` shows the export definition.
    - `grep -n "BAZAAR_STALLS_ORDERED" packages/core/src/constants.js` shows the ordered array with 9 entries.
    - The first entry of `BAZAAR_STALLS_ORDERED` in `constants.js` contains `resource: "wool"` and `ratio: 2`.
    - `grep -n "FIXED_STALL_COORDS" packages/core/src/board.js` shows the import is used.
    - `grep -n "shuffle(BAZAAR_STALLS" packages/core/src/board.js` returns NO matches (the shuffle is gone).
    - `grep -n "chooseStallIntersections(intersections, rng)" packages/core/src/board.js` returns NO matches (rng removed from call and signature).
    - `grep -n "chooseStallIntersections(intersections)" packages/core/src/board.js` shows exactly one call site and one definition.
    - `cd packages/core && npm test` exits 0 with at least 13 tests passing.
    - `npm run build` (from repo root) exits 0.
    - Running `node -e "import('./packages/core/src/board.js').then(m => { const a=m.createBoard({hexSize:84}); const b=m.createBoard({hexSize:84}); const pa=a.intersections.filter(n=>n.stall).map(n=>n.x+','+n.y).sort(); const pb=b.intersections.filter(n=>n.stall).map(n=>n.x+','+n.y).sort(); console.log(JSON.stringify(pa)===JSON.stringify(pb)); })"` prints `true`.
  </acceptance_criteria>
  <done>
    `chooseStallIntersections` is deterministic, all 13 tests green, build green, two `createBoard` calls produce identical stall positions and identical resource-to-position mapping. BOARD-01 is satisfied.
  </done>
</task>

<task type="auto">
  <name>Task 3: Phase gate verification and summary</name>
  <files>
    - .planning/phases/01-port-layout/01-01-SUMMARY.md
  </files>
  <read_first>
    - .planning/phases/01-port-layout/01-VALIDATION.md
    - packages/core/src/board.js
    - packages/core/src/constants.js
    - packages/core/test/engine.test.js
    - $HOME/.claude/get-shit-done/templates/summary.md
  </read_first>
  <action>
    Step 1 — Run every gate listed in `01-VALIDATION.md`:

    1a. `cd packages/core && npm test` — must exit 0 with 13+ tests passing.
    1b. From repo root: `npm run build` — must exit 0.
    1c. Run this determinism probe and confirm it prints `true` twice:
       ```
       node --input-type=module -e "import { createBoard } from './packages/core/src/board.js'; const a=createBoard({hexSize:84}); const b=createBoard({hexSize:84}); const pa=a.intersections.filter(n=>n.stall).map(n=>n.x+','+n.y).sort(); const pb=b.intersections.filter(n=>n.stall).map(n=>n.x+','+n.y).sort(); console.log(JSON.stringify(pa)===JSON.stringify(pb)); const ma=Object.fromEntries(a.intersections.filter(n=>n.stall).map(n=>[n.x+','+n.y,n.stall.resource||'*'])); const mb=Object.fromEntries(b.intersections.filter(n=>n.stall).map(n=>[n.x+','+n.y,n.stall.resource||'*'])); console.log(JSON.stringify(ma)===JSON.stringify(mb));" 2>&1 | tail -5
       ```
       (Adjust relative path if run from a different cwd; both lines must print `true`.)
    1d. Count stalls by kind/ratio from a fresh board — confirm 5 `kind:"specific",ratio:2` with resources `{timber, clay, wool, harvest, iron}` and 4 `kind:"generic",ratio:3`.

    Step 2 — Write `.planning/phases/01-port-layout/01-01-SUMMARY.md` following the template at `$HOME/.claude/get-shit-done/templates/summary.md`. Include:

    - Requirement: BOARD-01 — status: Complete
    - Files changed: `packages/core/src/constants.js`, `packages/core/src/board.js`, `packages/core/test/engine.test.js`, `packages/core/scripts/derive-stall-coords.mjs`
    - Decisions locked: Fixed `FIXED_STALL_COORDS` derived at hexSize=84; `BAZAAR_STALLS_ORDERED` in clockwise order from top (wool, generic, timber, generic, harvest, iron, generic, clay, generic); `rng` removed from `chooseStallIntersections` signature; `shuffle(BAZAAR_STALLS)` removed from `createBoard`.
    - Artifacts produced (exact export names, function signatures).
    - Test results: `{passed}/{total}` tests, exact count.
    - Nyquist sampling: all per-task and phase-gate criteria from `01-VALIDATION.md` met.
    - Handoff to Phase 2: Setup Resources — no blockers; Phase 2 touches `engine.js` setup flow, which does not depend on stall positions.

    Step 3 — Commit: `docs(01-port-layout): plan 01 summary — BOARD-01 complete`. Stage `.planning/phases/01-port-layout/01-01-SUMMARY.md`.
  </action>
  <verify>
    <automated>cd packages/core && npm test && cd ../.. && npm run build && test -f .planning/phases/01-port-layout/01-01-SUMMARY.md && grep -q "BOARD-01" .planning/phases/01-port-layout/01-01-SUMMARY.md</automated>
  </verify>
  <acceptance_criteria>
    - `cd packages/core && npm test` exits 0.
    - `npm run build` from repo root exits 0.
    - `.planning/phases/01-port-layout/01-01-SUMMARY.md` exists.
    - The summary file contains the literal string `BOARD-01` and the words `Complete` or `complete`.
    - The summary file lists all four changed/created files (`constants.js`, `board.js`, `engine.test.js`, `derive-stall-coords.mjs`).
    - Determinism probe (the node --input-type=module one-liner in step 1c) prints `true` on both of its output lines.
  </acceptance_criteria>
  <done>
    Phase gate criteria from `01-VALIDATION.md` are all green. Summary is written, committed, and references BOARD-01 as complete. Phase 1 is ready for `/gsd-verify-work`.
  </done>
</task>

</tasks>

<verification>
Phase-level verification (matches `01-VALIDATION.md` gate criteria):

1. `cd packages/core && npm test` exits 0 with 13+ tests passing (12 existing + 1 new positional determinism test).
2. `npm run build` from repo root exits 0.
3. Two `createBoard({ hexSize: 84 })` calls in the same process produce identical stall positions AND identical resource-to-position mapping.
4. Exactly 9 stalls placed: 5 with `kind:"specific",ratio:2` covering resources `{timber, clay, wool, harvest, iron}` and 4 with `kind:"generic",ratio:3`.
5. All 9 stalls satisfy `node.coastal === true` and `node.hexIds.length < 3`.
6. Resource-to-position mapping matches the locked clockwise order from CONTEXT.md: starting at the topmost selected coastal intersection and moving clockwise — wool, generic, timber, generic, harvest, iron, generic, clay, generic.
</verification>

<success_criteria>
- BOARD-01 satisfied: 9 ports at fixed coastal positions, same every game, correct ratio/resource distribution.
- `chooseStallIntersections()` is deterministic (no `rng` parameter).
- `shuffle(BAZAAR_STALLS, rng)` is removed from `createBoard()`.
- `FIXED_STALL_COORDS` and `BAZAAR_STALLS_ORDERED` are exported from `constants.js`.
- `packages/core/scripts/derive-stall-coords.mjs` exists as a one-shot derivation record.
- New test `port positions are identical across two game instances` passes.
- All 12 pre-existing engine tests still pass.
- `npm run build` green.
- Summary file at `.planning/phases/01-port-layout/01-01-SUMMARY.md` exists and marks BOARD-01 complete.
</success_criteria>

<output>
After completion, ensure `.planning/phases/01-port-layout/01-01-SUMMARY.md` exists and follows `$HOME/.claude/get-shit-done/templates/summary.md`.
</output>
