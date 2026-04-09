# External Integrations

**Analysis Date:** 2026-04-08

## APIs & External Services

**Fonts:**
- Google Fonts - Loads `Fraunces` and `Nunito` typefaces at runtime
  - Loaded via `<link>` tags in `apps/client/index.html`
  - No API key required
  - Requires client internet access; no self-hosted fallback

## Data Storage

**Databases:**
- PostgreSQL (any provider, with first-class Supabase support)
  - Connection: `DATABASE_URL` env var
  - Client: `pg` (node-postgres) `Pool` — raw SQL, no ORM
  - Implementation: `apps/server/src/db.js` (`RoomStore` class)
  - Tables: `shorewood_rooms`, `shorewood_players`, `shorewood_match_snapshots`
  - Schema init: `apps/server/sql/001_init.sql`
  - SSL: auto-inferred from hostname (Supabase direct vs. pooler) or overridden via `DATABASE_SSL_REJECT_UNAUTHORIZED`

**In-Memory Fallback:**
- `RoomStore` falls back to `Map`-based in-memory storage when `DATABASE_URL` is not set
  - All store methods branch on `this.usePg`
  - State is lost on server restart in memory mode
  - Suitable for local development only

**File Storage:**
- None — no file uploads or object storage

**Caching:**
- None — no Redis or cache layer

## Authentication & Identity

**Auth Provider:**
- Custom — no third-party auth (Supabase Auth is explicitly NOT used)
  - Server validates this at startup: schema validator rejects any foreign key to a Supabase Auth profiles table (`apps/server/src/db.js`, `validateSchema`)
  - Identity is session-based: tokens generated server-side with `uuid` + `crypto.randomBytes`

**Token formats:**
- Room ID: `r_[a-z0-9]{8}` — short prefix + UUID slice
- Session token: `sess_[uuid-v4]` — used as player map key, stored in DB
- Player ID: `ply_[uuid-v4-no-hyphens]` — surfaced to game engine
- Reconnect secret: 24-byte base64url — server-only credential for session resumption

**Storage:**
- Client stores session credentials in `sessionStorage` (inferred from reconnect flow)
- Server stores all tokens in PostgreSQL or in-memory `Map`

## Real-Time Communication

**Protocol:**
- WebSocket (native `ws` library)
- Single endpoint: `ws[s]://host/ws`
- All game events sent as JSON `{ type, payload }`
- Server enforces message size cap (`MAX_WS_MESSAGE_BYTES`) and per-socket rate limits

**Message types (server → client):**
- `playerStatus`, `roomState`, `gameState`, `logEntry`, `prompt`, `error`, `tradeOffer`, `tradeResolved`, `devCardReveal`

**Message types (client → server):**
- `createRoom`, `requestJoin`, `reconnect`, `hostAdmit`, `hostDeny`, `setProfile`, `readyUp`, `startMatch`
- Game actions: `rollDice`, `buildTrail`, `buildCottage`, `upgradeManor`, `buyDevCard`, `playDevCard`, `proposeTrade`, `acceptTrade`, `declineTrade`, `bankTrade`, `endTurn`, `voteWinCondition`, `chooseTimedWinner`

## Monitoring & Observability

**Error Tracking:**
- None — no Sentry, Datadog, or equivalent

**Health Endpoint:**
- `GET /health` on Express server
  - Returns `{ ok, now, persistence, restoredRooms, restoredPlayers, restoredSnapshots }`
  - Reports whether server is using postgres or memory mode

**Logs:**
- `console.log` / `console.error` only — no structured logging framework

## CI/CD & Deployment

**Client Hosting:**
- Vercel — `apps/client/vercel.json` configures SPA rewrites and `Content-Security-Policy` headers
  - CSP `frame-ancestors` allows embedding in Squarespace sites (placeholder domain present in config)

**Server Hosting:**
- Any Node.js platform (no platform-specific config committed)

**CI Pipeline:**
- None detected — no GitHub Actions, CircleCI, or similar

## Database Tooling

**Verification Script:**
- `apps/server/scripts/verify_db.mjs` — smoke-tests full persistence round-trip
  - Creates room + players + snapshot, reads back across two separate `RoomStore` instances, then cleans up
  - Run via: `npm --workspace @shorewood/server run db:verify`
  - Requires `DATABASE_URL` to be set

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None

## Environment Configuration

**Required env vars (production):**
- `DATABASE_URL` — PostgreSQL connection string
- `CLIENT_ORIGIN` — Allowed CORS origin(s) for the deployed client URL
- `VITE_WS_URL` — WebSocket URL baked into the client build

**Optional env vars:**
- `PORT`, `ROOM_TTL_HOURS`, `SNAPSHOT_LIMIT`, `DATABASE_SSL_REJECT_UNAUTHORIZED`
- Rate limit vars: `MAX_WS_MESSAGE_BYTES`, `MESSAGE_RATE_LIMIT_WINDOW_MS`, `MESSAGE_RATE_LIMIT_MAX`, `CONNECTION_RATE_WINDOW_MS`, `CONNECTION_RATE_MAX`

**Secrets location:**
- `.env` file at repo root (not committed; `.env.example` committed as template)

---

*Integration audit: 2026-04-08*
