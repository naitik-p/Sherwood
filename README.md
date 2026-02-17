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
- `CLIENT_ORIGIN` (required in deployment; comma-separated allowlist supported)
- `DATABASE_URL` (optional; memory fallback if omitted)
- `ROOM_TTL_HOURS` (defaults to `24`)
- `SNAPSHOT_LIMIT` (defaults to `50`)
- `MAX_WS_MESSAGE_BYTES` (defaults to `16384`)
- `MESSAGE_RATE_LIMIT_WINDOW_MS` (defaults to `5000`)
- `MESSAGE_RATE_LIMIT_MAX` (defaults to `80`)
- `CONNECTION_RATE_WINDOW_MS` (defaults to `60000`)
- `CONNECTION_RATE_MAX` (defaults to `80`)

Used by client:
- `VITE_WS_URL` (for deployed frontend)

## Database (Supabase/Postgres)

Schema SQL is in:
- `apps/server/sql/001_init.sql`

Tables:
- `shorewood_rooms`
- `shorewood_players`
- `shorewood_match_snapshots`

The server stores:
- room expiry metadata (24h)
- player profile/heartbeat metadata
- match snapshots for crash recovery

Important:
- Shorewood does not require Supabase Auth or user profiles.
- Do not add foreign keys from player records to `auth.users` or profile tables.
- The server validates schema shape on startup and exits with a clear error if an auth-bound schema is detected.
- Session tokens and reconnect secrets are private credentials; they are never exposed in shared room payloads.

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
- `SNAPSHOT_LIMIT=50`

### Supabase

- Create DB and run `apps/server/sql/001_init.sql`
- Use direct Postgres connection string for `DATABASE_URL`
- If this database already has a different game schema, keep it as-is; Shorewood uses dedicated `shorewood_*` tables to avoid collisions.

Connection notes:
- If `db.<project-ref>.supabase.co` fails to resolve on your network, use Supabase pooler instead.
- Example pooler format:
  - `postgresql://postgres.<project-ref>:<password>@aws-1-us-east-1.pooler.supabase.com:6543/postgres`
- For Supabase pooler, set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` if your runtime reports certificate chain errors.

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
