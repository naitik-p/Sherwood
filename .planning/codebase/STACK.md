# Technology Stack

**Analysis Date:** 2026-04-08

## Languages

**Primary:**
- JavaScript (ES2022+) - All packages: core game logic, server, client

**Secondary:**
- SQL - Database schema (`apps/server/sql/001_init.sql`)

## Runtime

**Environment:**
- Node.js (no version pinned — no `.nvmrc` or `.node-version` present)
- ESM-first: all packages use `"type": "module"` and import/export syntax

**Package Manager:**
- npm workspaces
- Lockfile: `package-lock.json` (lockfileVersion 3, present and committed)

## Frameworks

**Core:**
- Express 4.21.x - HTTP server and REST health endpoint (`apps/server/src/index.js`)
- Vite 5.4.x - Client dev server and production build (`apps/client/vite.config.js`)

**Testing:**
- Vitest 2.1.x - Unit test runner for `@shorewood/core` (`packages/core/package.json`)

**Build/Dev:**
- `node --watch` - Server hot reload in development (no transpilation step)
- `concurrently` 9.2.x - Runs server and client dev servers in parallel (root `package.json`)

## Key Dependencies

**Critical:**
- `ws` 8.18.x - WebSocket server (`apps/server/src/index.js`, path `/ws`)
- `pg` 8.13.x - PostgreSQL client via `pg.Pool` (`apps/server/src/db.js`)
- `@shorewood/core` 0.1.0 - Shared game engine (monorepo internal package)

**Infrastructure:**
- `cors` 2.8.x - Origin allowlist middleware on Express (`apps/server/src/index.js`)
- `dotenv` 16.4.x - Loads `.env` at server startup (`apps/server/src/index.js`)
- `uuid` 11.0.x - Generates room IDs, session tokens, player IDs (`apps/server/src/index.js`)

## Workspace Layout

```
shorewood/                    # npm workspace root
├── packages/core/            # @shorewood/core — pure game engine (source-only, no build)
├── apps/server/              # @shorewood/server — Express + WebSocket server
└── apps/client/              # @shorewood/client — Vanilla JS SPA built with Vite
```

`@shorewood/core` is consumed by both server and client as a local workspace dependency. It has no runtime dependencies of its own.

## Configuration

**Environment:**
- Configured via `.env` at repo root (example at `.env.example`)
- Server reads env at startup via `import "dotenv/config"`
- Client reads `VITE_WS_URL` at build time via `import.meta.env`

**Key server env vars:**
- `DATABASE_URL` — PostgreSQL connection string (optional; falls back to in-memory store)
- `PORT` — HTTP/WS listen port (default `8080`)
- `CLIENT_ORIGIN` — CORS allowlist, comma-separated (default `http://localhost:5173`)
- `ROOM_TTL_HOURS` — Room expiry window (default `24`)
- `SNAPSHOT_LIMIT` — Max snapshots per room retained in DB (default `50`)
- `DATABASE_SSL_REJECT_UNAUTHORIZED` — SSL mode override (auto-inferred from Supabase hostname)
- `MAX_WS_MESSAGE_BYTES` — Per-message size cap (default `16384`)
- `MESSAGE_RATE_LIMIT_WINDOW_MS` / `MESSAGE_RATE_LIMIT_MAX` — Per-socket rate limit
- `CONNECTION_RATE_WINDOW_MS` / `CONNECTION_RATE_MAX` — Per-IP connection rate limit

**Key client env vars:**
- `VITE_WS_URL` — WebSocket server URL (falls back to same-host port 8080 if unset)

**Build:**
- Client: `vite build` outputs to `apps/client/dist/`
- Server/Core: source-only, no compilation step
- Linting: `eslint.config.js` at repo root (flat config, ES latest, `no-unused-vars` enforced)

## Platform Requirements

**Development:**
- npm workspaces support (npm 7+)
- Runs server with `node --watch` (Node 18+)

**Production:**
- Client: Static hosting (Vercel — `apps/client/vercel.json` present with SPA rewrites)
- Server: Any Node.js host with outbound PostgreSQL access

---

*Stack analysis: 2026-04-08*
