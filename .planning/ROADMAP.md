# Roadmap: Shorewood — Catan Rules Alignment (v1.0)

## Overview

Four phases align Shorewood with standard Catan rules. Phase 1 fixes the board layout in isolation. Phase 2 fixes setup resource grants. Phase 3 establishes robber state and production blocking. Phase 4 implements the full Roll 7 sequence — discard, move, steal — which depends on robber state from Phase 3.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Port Layout** - Replace random port assignment with fixed Catan-standard layout (completed 2026-04-15)
- [ ] **Phase 2: Setup Resources** - Second cottage placement grants adjacent hex resources
- [ ] **Phase 3: Robber State** - Add robber to game state; robber blocks hex production
- [ ] **Phase 4: Roll 7 Sequence** - Full Roll 7 flow: discard, move robber, steal

## Phase Details

### Phase 1: Port Layout
**Goal**: The board always generates the standard Catan port layout — 9 ports at fixed coastal positions
**Depends on**: Nothing (first phase)
**Requirements**: BOARD-01
**Success Criteria** (what must be TRUE):
  1. Every new game shows exactly 9 ports at the same coastal positions
  2. Five specific 2:1 ports appear — one for each resource type (timber, clay, wool, harvest, iron)
  3. Four generic 3:1 ports appear at the remaining coastal positions
  4. Port positions do not change between game sessions or page reloads
**Plans**: 1 plan
Plans:
- [x] 01-01-PLAN.md — Replace random port assignment with fixed Catan layout (BOARD-01)

### Phase 2: Setup Resources
**Goal**: Players receive the correct resource grant after placing their second setup cottage
**Depends on**: Phase 1
**Requirements**: BOARD-02
**Success Criteria** (what must be TRUE):
  1. After the second cottage placement, player's hand increases by one card per adjacent producing hex
  2. Desert/wild_heath adjacency grants no resource (non-producing)
  3. First cottage placement grants no resources (unchanged behavior)
  4. All 12 existing engine tests continue to pass
**Plans**: TBD

### Phase 3: Robber State
**Goal**: Robber exists in game state from game start and blocks production on its hex
**Depends on**: Phase 2
**Requirements**: ROBBER-01, ROBBER-02
**Success Criteria** (what must be TRUE):
  1. New game state includes a robber position field pointing to the wild_heath hex
  2. Rolling a number that matches the robber's hex produces nothing for any player on that hex
  3. Non-robber hexes continue to produce resources normally
  4. Frost mechanic (roll 2) continues to work alongside robber blocking
**Plans**: TBD

### Phase 4: Roll 7 Sequence
**Goal**: Rolling a 7 triggers the full Catan sequence — discard, move robber, steal
**Depends on**: Phase 3
**Requirements**: ROLL7-01, ROLL7-02, ROLL7-03
**Success Criteria** (what must be TRUE):
  1. Any player holding 7 or more cards when a 7 is rolled must discard exactly half (rounded down) before play continues
  2. After all discards, the active player must move the robber to a non-desert hex
  3. Moving the robber to the desert is rejected by the engine
  4. After robber placement, active player may steal one random card from an eligible adjacent player
  5. If no eligible adjacent player exists, steal is skipped and play continues
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Port Layout | 1/1 | Complete   | 2026-04-15 |
| 2. Setup Resources | 0/? | Not started | - |
| 3. Robber State | 0/? | Not started | - |
| 4. Roll 7 Sequence | 0/? | Not started | - |
