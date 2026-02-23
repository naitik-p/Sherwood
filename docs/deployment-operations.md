# Deployment and Operations

## Recommended Topology

- Frontend: Vercel deploying `apps/client`
- Server: always-on Node.js service deploying `apps/server`
- Database: Supabase Postgres (or compatible Postgres)

## Frontend Deployment (Vercel)

Project root:
- `apps/client`

Required env:
- `VITE_WS_URL=wss://<your-server-host>/ws`

Notes:
- `apps/client/vercel.json` includes SPA rewrites.
- `/embed` route renders without top chrome.

## Server Deployment

Runtime:
- Node.js 20+

Expose:
- HTTP health endpoint at `/health`
- WebSocket endpoint at `/ws`

Required env:
- `PORT`
- `CLIENT_ORIGIN`

Recommended production env:
- `DATABASE_URL` (use Postgres persistence)

## Database Bootstrap

Apply schema:
- `apps/server/sql/001_init.sql`

Expected tables:
- `shorewood_rooms`
- `shorewood_players`
- `shorewood_match_snapshots`

Startup behavior:
- Server validates schema compatibility on startup.
- Incompatible schema causes startup failure.

## Post-Deploy Verification Checklist

1. `GET /health` returns `ok: true`.
2. `persistence` is expected mode:
   - `postgres` when `DATABASE_URL` is set
   - `memory` otherwise
3. Browser can connect and create a room.
4. Admission flow and match start work end-to-end.
5. One full setup pass and one post-roll action succeed.

## Supabase-Specific Guidance

Connection styles:
- direct host (`*.supabase.co`) often needs IPv6 support
- pooler host (`*.pooler.supabase.com`) is safer on IPv4-only environments

SSL behavior in server:
- inferred automatically for Supabase hosts
- override with `DATABASE_SSL_REJECT_UNAUTHORIZED`

Do not:
- add foreign keys from Shorewood tables to Supabase auth/profile tables

## Security Controls in Production

Validate these are configured and monitored:
- `CLIENT_ORIGIN` allowlist
- `MAX_WS_MESSAGE_BYTES`
- message rate limits (`MESSAGE_RATE_LIMIT_*`)
- connection rate limits (`CONNECTION_RATE_*`)

## Backups and Retention

Snapshot retention:
- bounded by `SNAPSHOT_LIMIT` per room

Room lifecycle:
- room TTL enforced by `ROOM_TTL_HOURS`
- expired rooms are disconnected and cleaned up

## Incident Triage Shortlist

When users report gameplay issues:
1. Confirm `/health` and persistence mode.
2. Inspect server logs for explicit rule errors.
3. Verify client is connected to intended `VITE_WS_URL`.
4. Reproduce with a deterministic `seed` if possible.
5. Run `output/turn_option_feedback_check.mjs` for action-option/feedback regressions.
