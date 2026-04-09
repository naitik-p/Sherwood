# Requirements: Shorewood — Catan Rules Alignment

**Defined:** 2026-04-09
**Core Value:** Players get a faithful Catan experience under Shorewood's custom skin — same board, same robber, same setup rules.

## v1 Requirements

### Board Setup

- [ ] **BOARD-01**: Game board uses fixed Catan-standard port layout — 9 ports at predetermined coastal positions (5 specific 2:1 ports, one per resource; 4 generic 3:1 ports), not randomly assigned
- [ ] **BOARD-02**: Second setup cottage placement grants resources — player receives one resource card for each producing hex adjacent to their second placed cottage (matching standard Catan)

### Robber State

- [ ] **ROBBER-01**: Game state tracks robber position — robber starts on the wild_heath (desert) hex at game start
- [ ] **ROBBER-02**: Robber blocks production — any hex occupied by the robber produces nothing for any player on future rolls

### Roll 7 Sequence

- [ ] **ROLL7-01**: Any player holding 7 or more resource cards when a 7 is rolled must discard half their hand (rounded down) before the robber is moved
- [ ] **ROLL7-02**: After discards, active player must move the robber to any non-desert hex
- [ ] **ROLL7-03**: After robber is placed, active player may steal one random resource card from any player with a cottage or manor adjacent to the new robber hex

## v2 Requirements

*(None — all Catan alignment features are in v1)*

## Out of Scope

| Feature | Reason |
|---------|--------|
| Longest Road award | User explicitly excluded |
| Largest Army award | User explicitly excluded |
| Dev card deck changes | Keep current deck — user preference |
| Theme rename | Keep trails/cottages/manors/timber/clay — user preference |
| Roll 2 frost removal | Frost mechanic kept alongside robber — user preference |
| Knight card robber move | Not in current dev card set; charter claim is the equivalent |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOARD-01 | Phase 1 | Pending |
| BOARD-02 | Phase 2 | Pending |
| ROBBER-01 | Phase 3 | Pending |
| ROBBER-02 | Phase 3 | Pending |
| ROLL7-01 | Phase 4 | Pending |
| ROLL7-02 | Phase 4 | Pending |
| ROLL7-03 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 7 total
- Mapped to phases: 7
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-04-09 after initial definition*
