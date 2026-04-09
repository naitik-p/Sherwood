# Shorewood — Catan Rules Alignment

## What This Is

Shorewood is a browser-based multiplayer board game in the style of Settlers of Catan. It uses a hex grid, custom resource/structure theming (trails, cottages, manors, timber, clay, etc.), and real-time WebSocket play. This initiative aligns the core gameplay rules and board layout with the standard Catan ruleset.

## Core Value

Players get a faithful Catan experience under Shorewood's custom skin — same board, same robber, same setup rules.

## Requirements

### Validated

- ✓ Hex grid board (radius-2, 19 tiles, 6 terrain types including desert) — existing
- ✓ Standard resource types (timber/clay/wool/harvest/iron → wood/brick/sheep/wheat/ore equivalents) — existing
- ✓ Standard build costs (trail/cottage/manor/dev card match Catan) — existing
- ✓ Standard piece limits (15 trails, 5 cottages, 4 manors) — existing
- ✓ Standard number token distribution (2–12, 18 tokens) — existing
- ✓ Snake-draft setup phase (1-2-3-4-4-3-2-1 order) — existing
- ✓ Dev card deck (trailblazer, bountiful basket, hearth ward, heritage deed, charter claim) — existing
- ✓ Real-time WebSocket multiplayer (2–4 players) — existing

### Active

- [ ] Fixed Catan-standard port layout — 9 ports at predetermined coastal positions (4 generic 3:1, 5 specific 2:1 one per resource), replacing the current random placement
- [ ] Second setup placement grants resources — player collects one resource from each hex adjacent to their second cottage, matching standard Catan setup rules
- [ ] Robber state added to game — robber token starts on wild_heath (desert), tracked in game state
- [ ] Roll 7 triggers robber sequence — any player holding 7+ cards must discard half (rounded down), then active player moves the robber to any non-desert hex
- [ ] Robber move action — active player selects a hex; robber moves there and blocks production for that hex on future rolls
- [ ] Steal action after robber move — active player steals one random resource from a player with a cottage or manor adjacent to the new robber hex (if any eligible player exists)

### Out of Scope

- Longest Road award — not implementing; user explicitly excluded
- Largest Army award — not implementing; user explicitly excluded
- Dev card type/count changes — keep current deck (trailblazer × 6, bountiful basket × 6, hearth ward × 5, heritage deed × 5, charter claim × 2)
- Custom theme rename — keep trails/cottages/manors/timber/clay/etc.
- Roll 2 frost mechanic — keep as-is alongside the new robber

## Context

- Monorepo: `packages/core` (pure game engine, zero deps), `apps/server` (Express + WS), `apps/client` (vanilla JS + Vite)
- All game rules live in `packages/core/src/engine.js` and `board.js`
- Board generation is in `packages/core/src/board.js` — port assignment currently uses `chooseStallIntersections()` which picks random coastal intersection indices, not fixed Catan positions
- Setup resource grant is in `engine.js` — current code grants resources only at second placement round but logic needs verification; the `setup.queue` tracks snake-draft order
- No robber state exists anywhere in the codebase; frost (roll=2) is the only hex-blocking mechanic

## Constraints

- **Tech Stack**: JavaScript/ESM only — no TypeScript, no new runtime dependencies
- **Scope**: Engine changes only — server and client will need updates to support new actions/state but no architectural changes
- **Compatibility**: All existing tests must pass; new mechanics need new test coverage in `packages/core`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep custom theme (trails/cottages etc.) | User preference — rules alignment, not reskin | — Pending |
| Keep frost mechanic alongside robber | User preference — frost on roll 2 stays | — Pending |
| Fixed port layout over random | Matches standard Catan board; reproducible across games | — Pending |
| No Longest Road / Largest Army | User explicitly excluded | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-08 after initialization*
