# Shorewood

Shorewood is a real-time multiplayer, cottagecore medieval web strategy game for 2 to 4 players.

It includes:
- Host-admit lobby (no accounts)
- 19-hex board with precomputed intersections/edges
- Snake-draft setup, 2d6 production, and roll-2 Frost disruption
- Trails, Cottages, Manors, Bazaar stall trade ratios, trade offers, and development cards
- Two win modes (vote): first to 10 points or highest at 60 minutes
- Reconnect by session token in `localStorage`

## Project Layout

- `packages/core`: Authoritative rules engine and tests
- `apps/server`: WebSocket + room lifecycle + snapshot persistence
- `apps/client`: Browser UI (Vite + vanilla JS + SVG board)

## Local Development

Prereqs:
- Node.js 20+

Install:

```bash
npm install
```

Run app (client + server):

```bash
npm run dev
```

Endpoints:
- Client: `http://localhost:5173`
- WS server: `ws://localhost:8080/ws`

## Environment Variables

Copy `.env.example` and set values:

```bash
cp .env.example .env
```

Used by server:
- `PORT`
- `CLIENT_ORIGIN`
- `DATABASE_URL` (optional; memory fallback if omitted)
- `ROOM_TTL_HOURS` (defaults to `24`)

Used by client:
- `VITE_WS_URL` (for deployed frontend)

## Database (Supabase/Postgres)

Schema SQL is in:
- `apps/server/sql/001_init.sql`

Tables:
- `rooms`
- `players`
- `match_snapshots`

The server stores:
- room expiry metadata (24h)
- player profile/heartbeat metadata
- match snapshots for crash recovery

## Testing

Run required rules tests:

```bash
npm test
```

Run lint:

```bash
npm run lint
```

Build all packages:

```bash
npm run build
```

Current unit coverage includes:
- placement legality
- production distribution
- frost timing
- charter claim exclusivity
- trade atomicity

## WebSocket Protocol

Client -> server actions implemented:
- `requestJoin`, `hostAdmit`, `hostDeny`, `setProfile`, `readyUp`, `startMatch`
- `voteWinCondition`, `rollDice`, `proposeTrade`, `acceptTrade`, `declineTrade`, `bankTrade`
- `buildTrail`, `buildCottage`, `upgradeManor`, `buyDevCard`, `playDevCard`, `endTurn`
- `reconnect`, `chooseTimedWinner`

Server -> client events implemented:
- `roomState`, `gameState`, `prompt`, `error`, `logEntry`, `tradeOffer`, `tradeResolved`, `playerStatus`

## Deployment

### Frontend (Vercel)

Deploy `apps/client` as a Vercel project.

Set env:
- `VITE_WS_URL=wss://YOUR-WS-SERVER/ws`

Embed support:
- `apps/client/vercel.json` includes SPA rewrites and CSP `frame-ancestors` for Squarespace.
- `/embed` path uses the same SPA and hides top chrome.

### WebSocket Server (Render/Fly/etc.)

Deploy `apps/server` as an always-on Node service.

Set env:
- `PORT`
- `CLIENT_ORIGIN=https://YOUR-VERCEL-DOMAIN`
- `DATABASE_URL`
- `ROOM_TTL_HOURS=24`

### Supabase

- Create DB and run `apps/server/sql/001_init.sql`
- Use direct Postgres connection string for `DATABASE_URL`

## Squarespace Embed

In Squarespace page editor, add an Embed block:

```html
<iframe
  src="https://YOUR-VERCEL-DOMAIN/embed?room=YOUR_ROOM_ID"
  style="width:100%;height:900px;border:0;"
  allow="clipboard-write"
></iframe>
```

If you want players to start in lobby without pre-filled room:

```html
<iframe
  src="https://YOUR-VERCEL-DOMAIN/embed"
  style="width:100%;height:900px;border:0;"
  allow="clipboard-write"
></iframe>
```

## Notes

- The server is authoritative for all legality checks.
- Non-host players only see opponent resource card counts, not card details.
- Trade execution is atomic and re-validated at accept time.
