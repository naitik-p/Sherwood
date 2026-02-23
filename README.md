# Shorewood

Shorewood is a real-time multiplayer, Catan-inspired web game for 2 to 4 players.

It is implemented as a monorepo with:
- a server-authoritative rules engine (`packages/core`)
- a WebSocket game server (`apps/server`)
- a browser client (`apps/client`)

## Current Implementation Status

Implemented and verified in current codebase:
- Host-managed lobby (admit/deny), ready checks, and game start
- 19-hex board generation with terrain/token guardrails and 9 Bazaar stalls
- Full game phases: vote -> setup snake draft -> main -> ended
- Main-turn action menu for active player:
  - `Roll Dice`
  - `Build Road`
  - `Build Cottage`
  - `Build Manor`
  - `Buy Development Card`
  - `Post Trade Offer`
  - `Trade with Bazaar`
  - `End Turn`
- Invalid-action feedback (pre-checks + server validation) for out-of-rule actions
- Supabase-compatible Postgres persistence, with memory fallback when `DATABASE_URL` is unset

Important behavior:
- The **Your Options** list is expected to be blank when you are not the active player in main phase.

## Documentation Map

- Architecture: `docs/architecture.md`
- Gameplay + rules: `docs/gameplay-rules.md`
- WebSocket protocol: `docs/websocket-protocol.md`
- Configuration reference: `docs/configuration-reference.md`
- Development + testing: `docs/development-testing.md`
- Deployment + operations: `docs/deployment-operations.md`
- Troubleshooting: `docs/troubleshooting.md`

## Quick Start

Prerequisites:
- Node.js 20+
- npm

Install:

```bash
npm install
```

Run server + client from repository root:

```bash
npm run dev
```

Default local endpoints:
- Client: `http://localhost:5173`
- Server health: `http://localhost:8080/health`
- Server WebSocket: `ws://localhost:8080/ws`

## Environment Setup

Copy environment template:

```bash
cp .env.example .env
```

If you run server from root via `npm run dev`, root `.env` is loaded.

If you run server directly from `apps/server`, set dotenv path explicitly:

```bash
DOTENV_CONFIG_PATH=../../.env node src/index.js
```

Or place a dedicated `apps/server/.env`.

## Core Commands

```bash
npm run dev
npm test
npm run lint
npm run build
npm run db:verify
```

Targeted verification harnesses:

```bash
node output/turn_option_feedback_check.mjs
node output/four_player_comprehensive_pass.mjs
node output/four_player_6turn_full_retest.mjs
```

Artifacts are written to `output/web-game/`.

Database verification:
- `npm run db:verify` performs a full Postgres check using `DATABASE_URL`:
  - connectivity + schema validation
  - room/player/snapshot write-read
  - cross-process persistence check (new connection reads the same records)
  - cleanup of temporary verification data

## Security and Data Boundaries

- Shorewood does not depend on Supabase Auth for gameplay identities.
- Shorewood tables must not include foreign keys to `auth.users`.
- Session credentials (`sessionToken`, `reconnectSecret`) are private and never exposed in shared room state payloads.
- Trade acceptance is revalidated atomically at accept-time.

## License

Private project (no open-source license specified).
