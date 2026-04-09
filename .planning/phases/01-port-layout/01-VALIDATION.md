---
phase: 1
slug: port-layout
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-09
---

# Phase 1 — Validation Strategy

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
| BOARD-01 | 9 stalls, 5 specific 2:1, 4 generic 3:1, all coastal | unit | `cd packages/core && npm test` | Partial — existing test covers counts; new test needed |
| BOARD-01 | Port positions identical across two game instances | unit | `cd packages/core && npm test` | Missing — Wave 0 must add |

---

## Wave 0 Gaps

- [ ] New test: `port positions are identical across two game instances` — covers BOARD-01 positional determinism
- [ ] Coordinate derivation script (run once, then discard) to generate the 9 fixed (x, y) pairs

---

## Phase Gate Criteria

All of the following must be true before phase is complete:
1. `cd packages/core && npm test` exits 0 with 13+ tests passing (12 existing + 1 new positional test)
2. `npm run build` exits 0
3. Two `createBoard({ hexSize: 84 })` calls produce identical stall positions
4. Exactly 9 stalls: 5 specific 2:1, 4 generic 3:1
