# Shorewood Architecture

## Monorepo Layout

- `packages/core`
  - Rules engine, board generation, legal action computation, and public-state projection.
  - Single source of truth for gameplay behavior.
- `apps/server`
  - Express + WebSocket server.
  - Lobby orchestration, admission flow, reconnects, action routing, and persistence.
- `apps/client`
  - Vite browser app (vanilla JS + SVG board rendering).
  - UI, local interaction state, and toast/error presentation.
- `output`
  - Browser verification scripts and generated artifacts.

## Runtime Topology

1. Browser connects to `ws://<server>/ws`.
2. Server validates and routes action messages.
3. Server applies rule changes via `@shorewood/core`.
4. Server broadcasts viewer-specific `gameState` snapshots.
5. Server emits side-channel events (`tradeOffer`, `tradeResolved`, `prompt`, `error`) as needed.

Authoritative ownership:
- Server + core engine own all game state mutation.
- Client never mutates authoritative match state.

## Core State Model

Global state contains:
- phase (`vote`, `setup`, `main`, `ended`)
- board (hexes, intersections, edges, stalls)
- structures
- players (resources, pieces, dev cards, effects)
- pending trades
- turn context
- event log
- winner / tie-break state

Viewer-specific projection (`getPublicGameState`):
- own resource details are visible to self
- opponents expose resource count only
- legal actions and fast-build targets are per-viewer

## Security and Guardrails

Server-side controls:
- strict ID/session/avatar/name normalization
- origin allowlist (`CLIENT_ORIGIN`)
- max WS payload size
- per-socket message rate limit
- per-IP connection rate limit

Credential privacy:
- `sessionToken` and `reconnectSecret` are private credentials
- room/game payloads avoid leaking private session credentials to other players

## Persistence Architecture

Storage mode:
- Postgres when `DATABASE_URL` is set
- in-memory fallback when `DATABASE_URL` is unset

Tables:
- `shorewood_rooms`
- `shorewood_players`
- `shorewood_match_snapshots`

Schema safety:
- startup schema validation enforces expected columns and FK constraints
- mismatched schema causes startup failure (fail-fast)

## Operational Endpoints

- `GET /health`
  - returns `ok`, `now`, and `persistence` (`postgres` or `memory`)

## Related Docs

- Rules reference: `docs/gameplay-rules.md`
- WS protocol: `docs/websocket-protocol.md`
- Env reference: `docs/configuration-reference.md`
- Ops guide: `docs/deployment-operations.md`
