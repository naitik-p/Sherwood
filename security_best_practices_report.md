# Shorewood Security Best Practices Report

Date: 2026-02-17
Scope: `apps/server`, `apps/client`, DB persistence, runtime config

## Executive Summary
All prioritized vulnerabilities from the previous audit were remediated in this pass. The session hijack path was closed by separating public player identity from private reconnect credentials, attribute injection paths were hardened, WebSocket abuse controls were added, and snapshot persistence is now capped.

## Fixed in This Pass

### SEC-001 (Critical) Session takeover / host impersonation
Status: Fixed

What changed:
- `roomState` no longer exposes session tokens or host session credentials.
- Public `playerId` is used in shared state; private `sessionToken` + `reconnectSecret` stay private.
- Reconnect now requires both credentials (proof-of-possession).
- `requestJoin` no longer allows token-only takeover of existing admitted sessions.

Key files:
- `apps/server/src/index.js`
- `apps/client/src/main.js`

### SEC-002 (High) DOM attribute injection/XSS via token values
Status: Fixed

What changed:
- Session tokens are no longer rendered into client HTML attributes.
- Host admit/deny now uses public `playerId` and attribute escaping (`escapeAttr`).
- Server-side token/avatar/name normalization and strict ID format checks reduce injection surface.

Key files:
- `apps/client/src/main.js`
- `apps/server/src/index.js`

### SEC-003 (Medium) Missing WS origin/rate controls
Status: Fixed

What changed:
- Added WebSocket origin allowlist checks.
- Added per-IP connection rate limits.
- Added per-socket message rate limits.
- Added max WebSocket message size checks.

Key files:
- `apps/server/src/index.js`
- `.env.example`

### SEC-004 (Medium) Unbounded snapshot persistence
Status: Fixed

What changed:
- Added `SNAPSHOT_LIMIT` and DB pruning after insert.
- Memory snapshot retention now uses configurable limit.

Key files:
- `apps/server/src/db.js`
- `.env.example`

### SEC-005 (Low) Weak input constraints
Status: Fixed

What changed:
- Added server-side normalization/validation for room IDs, session credentials, player IDs, names, and avatar IDs.

Key files:
- `apps/server/src/index.js`

## Verification Performed
- `npm test`: pass
- `npm run build`: pass
- `npm run lint`: pass
- Browser smoke flow (create room -> admit -> ready -> start match): pass
- Reconnect-abuse check (token only, no secret): rejected by server
- Credential leak check: `roomState` no longer contains session tokens

## Remaining Risk / Follow-ups
- Dependency vulnerability scan (`npm audit`) could not be completed in this environment due restricted access to npm registry.
- If you deploy behind proxies/CDNs, ensure forwarded headers are trusted only from your edge and keep `CLIENT_ORIGIN` strict (no `*` in production).
