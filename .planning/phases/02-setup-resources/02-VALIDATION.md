---
phase: 2
slug: setup-resources
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.1.8 |
| **Config file** | none — vitest default discovery |
| **Quick run command** | `cd packages/core && npm test` |
| **Full suite command** | `cd packages/core && npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/core && npm test`
- **After wave merge:** Run `cd packages/core && npm test`
- **Phase gate:** All tests green before verification

---

## Requirements Coverage

| Req ID | Behavior Under Test | Test Type | Command | Status |
|--------|---------------------|-----------|---------|--------|
| BOARD-02 | First cottage placement grants no resources | unit | `cd packages/core && npm test` | Missing — must add |
| BOARD-02 | Second cottage placement grants one card per adjacent producing hex | unit | `cd packages/core && npm test` | Partial — existing test must be updated |
| BOARD-02 | wild_heath adjacency grants nothing | unit | `cd packages/core && npm test` | Covered by helper (no change needed) |

---

## Wave 0 Gaps

- [ ] Update conflicting test at engine.test.js line ~202 to assert round-1 grants nothing and round-2 grants correctly
- [ ] Add explicit test for first-placement-no-grant behavior

---

## Phase Gate Criteria

All of the following must be true before phase is complete:
1. `cd packages/core && npm test` exits 0 with 13+ tests passing
2. `npm run build` exits 0
3. Round 1 setup cottage placement produces no resource gain
4. Round 2 setup cottage placement produces gains matching adjacent producing hexes
5. wild_heath adjacency produces no gain
