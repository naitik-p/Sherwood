# STATE — Shorewood Catan Rules Alignment

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-09)

**Core value:** Players get a faithful Catan experience under Shorewood's custom skin — same board, same robber, same setup rules.
**Current focus:** Milestone v1.0 — not started

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-09 — Milestone v1.0 started

## Accumulated Context

- Existing codebase fully functional: lobby, setup, main game loop, trading, dev cards, WebSocket multiplayer
- All game rules in `packages/core/src/engine.js` and `packages/core/src/board.js`
- 12 passing unit tests in `packages/core/test/engine.test.js`
- Port layout: currently random via `chooseStallIntersections()` in board.js
- No robber state exists anywhere in the codebase
- Frost mechanic (roll 2) is the only hex-blocking mechanic currently
- Client uses vanilla JS + Vite in `apps/client/src/main.js`
- Server uses Express + WS in `apps/server/src/index.js`
