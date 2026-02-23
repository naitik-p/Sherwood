# Configuration Reference

This project uses environment variables for client/server runtime behavior.

## Client Variables (`apps/client`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_WS_URL` | No (local), Yes (deployed) | derived from current host + `:8080/ws` | WebSocket URL used by browser client |

## Server Variables (`apps/server`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP/WS server port |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Allowed browser origin(s); comma-separated or `*` |
| `DATABASE_URL` | No | unset | Enables Postgres persistence; unset uses memory mode |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No | inferred | SSL verification override for Postgres |
| `ROOM_TTL_HOURS` | No | `24` | Room expiration horizon |
| `SNAPSHOT_LIMIT` | No | `50` | Max saved snapshots per room |
| `MAX_WS_MESSAGE_BYTES` | No | `16384` | Max message size for inbound WS payload |
| `MESSAGE_RATE_LIMIT_WINDOW_MS` | No | `5000` | Per-socket rate limit window |
| `MESSAGE_RATE_LIMIT_MAX` | No | `80` | Max WS messages per socket per window |
| `CONNECTION_RATE_WINDOW_MS` | No | `60000` | Per-IP connection window |
| `CONNECTION_RATE_MAX` | No | `80` | Max WS connects per IP per window |

## Example Setup

Use the template:

```bash
cp .env.example .env
```

Template file:
- `.env.example`

## Dotenv Loading Caveat

The server imports `dotenv/config`, which resolves `.env` from process current working directory.

Implications:
- Running from repo root (`npm run dev`) picks up root `.env`.
- Running from `apps/server` does **not** automatically load root `.env`.

Server-only fix:

```bash
DOTENV_CONFIG_PATH=../../.env node src/index.js
```

## Supabase Connection Notes

- Prefer pooler URL for IPv4-only environments.
- Use direct host only when runtime can reach it (often IPv6 required).
- If `DATABASE_URL` is set but connectivity fails, server exits at startup after persistence init error.

## Verification

After startup, check:

```bash
curl http://localhost:8080/health
```

`persistence` should be:
- `postgres` when `DATABASE_URL` is set
- `memory` when unset
