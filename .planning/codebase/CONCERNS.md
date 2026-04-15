# Codebase Concerns

**Analysis Date:** 2026-04-08

## Tech Debt

**Monolithic client file:**
- Issue: All client-side logic, rendering, state management, and SVG board drawing lives in one 1,752-line file
- Files: `apps/client/src/main.js`
- Impact: Hard to test, debug, or extend. Any new feature requires reading the entire file to understand side effects. No module boundaries means accidental coupling is trivial.
- Fix approach: Split into modules — board rendering, state management, WebSocket layer, UI components, action handlers. Vite already supports ES modules.

**Monolithic server file:**
- Issue: All WebSocket handling, room lifecycle, player admission, game action dispatch, and maintenance loops live in one 1,014-line file
- Files: `apps/server/src/index.js`
- Impact: Adding new game phases or lobby features requires modifying a file that also owns security-critical connection handling.
- Fix approach: Extract room management, game action dispatch, and WebSocket connection handling into separate modules.

**Inline SQL DDL in application boot:**
- Issue: `RoomStore.init()` runs `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS` DDL statements at startup on every boot
- Files: `apps/server/src/db.js` lines 70-127
- Impact: DDL execution on every cold start adds latency. The backfill `ALTER TABLE` statements exist to patch tables created before newer columns were added — a migration debt pattern that grows unbounded.
- Fix approach: Move to a proper migration tool (e.g., `node-postgres-migrate` or raw numbered SQL files with a migration runner). `apps/server/sql/001_init.sql` already exists but is not used programmatically.

**Reconnect secret stored in localStorage:**
- Issue: `reconnectSecret` is saved to `localStorage` as plaintext alongside `sessionToken` and `playerId`
- Files: `apps/client/src/main.js` lines 168-179
- Impact: Any XSS vulnerability — even from a browser extension — can exfiltrate the reconnect secret and fully impersonate a player.
- Fix approach: Use `sessionStorage` instead (cleared on tab close), or store only the session token and require the user to re-authenticate on page reload.

**No WebSocket reconnect retry logic:**
- Issue: The client connects once on load and handles `close` by setting `state.connected = false` and re-rendering. There is no automatic reconnect loop.
- Files: `apps/client/src/main.js` lines 203-233
- Impact: Any transient server restart or network hiccup permanently disconnects the player until they manually reload.
- Fix approach: Add exponential backoff reconnect in the `ws.close` handler, capping at ~30 seconds.

**`window.advanceTime` stub is a no-op:**
- Issue: `window.advanceTime` is exported as a global but only calls `render()`, ignoring its `_ms` parameter
- Files: `apps/client/src/main.js` lines 1747-1749
- Impact: Any test harness or automation script calling `window.advanceTime` to simulate timed win conditions gets no time advancement. The timed-win path is effectively untestable via automation.
- Fix approach: Either implement time offset tracking in client state or remove this export entirely.

**In-memory fallback silently loses data:**
- Issue: When `DATABASE_URL` is not set, `RoomStore` falls back to in-process Maps with no persistence
- Files: `apps/server/src/db.js` lines 58-63
- Impact: Server restart during a live game loses all state. No warning is shown to users. A room restored from memory after a crash silently has no state.
- Fix approach: Log a clear `console.warn` on startup when in-memory mode is active. Consider blocking game start if persistence is unavailable in production.

## Known Bugs

**`bountiful_basket` resource input uses `window.prompt`:**
- Symptoms: Playing a Bountiful Basket dev card opens a native browser `window.prompt` dialog asking for comma-separated resource names
- Files: `apps/client/src/main.js` lines 1621-1636
- Trigger: Any player clicks "Play" on a Bountiful Basket card
- Workaround: Player types resources manually; server validates format. But `window.prompt` is blocked in iframes and some browsers in strict mode, silently cancels on mobile.

**`pendingTrades` array grows without cleanup:**
- Issue: Declined and accepted trades remain in `state.pendingTrades` indefinitely — only `status` changes to `"declined"` or `"accepted"`
- Files: `packages/core/src/engine.js` lines 878-931
- Trigger: Any long game with many trades will accumulate resolved trades in every snapshot
- Impact: Snapshots grow in size over time. The entire `pendingTrades` array is serialized to the DB on every action. `getPublicGameState` broadcasts all trades including resolved ones to every client.
- Fix approach: Prune resolved trades from the array on `endTurn`, or cap the displayed list in `getPublicGameState`.

**`makeRoomId` collision risk:**
- Issue: Room IDs use only the first 8 characters of a UUID (`r_` + 8 hex chars = ~4 billion combinations), but no uniqueness check is performed before inserting into the DB
- Files: `apps/server/src/index.js` lines 175-177
- Trigger: Collision probability is low but the DB `INSERT` will throw an unhandled unique constraint error if a collision occurs
- Fix approach: Wrap room creation in a retry loop or use a longer ID segment.

## Security Considerations

**`x-forwarded-for` trusted without proxy verification:**
- Risk: `getSocketIp` reads `x-forwarded-for` directly from request headers. Any client can spoof this header to bypass per-IP connection rate limiting.
- Files: `apps/server/src/index.js` lines 200-206
- Current mitigation: Rate limiting still applies to actual socket IPs when the header is absent
- Recommendations: If deployed behind a known proxy (Render, Railway, Fly.io), configure a trusted proxy IP and only read `x-forwarded-for` from that source. Express `trust proxy` setting or manual IP allowlist.

**`CLIENT_ORIGIN = "*"` bypasses all WebSocket origin checks:**
- Risk: The `ALLOW_ALL_ORIGINS` flag disables origin enforcement entirely when `CLIENT_ORIGIN=*` is set
- Files: `apps/server/src/index.js` lines 54, 241-249
- Current mitigation: Documented in security report as a deployment concern
- Recommendations: Enforce a non-wildcard `CLIENT_ORIGIN` in production. Add a startup assertion that rejects `*` when `NODE_ENV=production`.

**No CSRF protection on HTTP endpoints:**
- Risk: The `/health` endpoint does not require authentication. If HTTP endpoints are added (e.g., REST API), they have no CSRF protection.
- Files: `apps/server/src/index.js` lines 78-87
- Current mitigation: Only one HTTP endpoint exists and it is read-only
- Recommendations: Low priority for current scope. Add if REST endpoints are introduced.

**`npm audit` not run:**
- Risk: Dependency vulnerability scan was explicitly noted as incomplete in the security report
- Files: `security_best_practices_report.md`
- Current mitigation: None
- Recommendations: Run `npm audit --audit-level=high` as part of CI before any deployment.

## Performance Bottlenecks

**Board lookup uses linear `Array.find` on every action:**
- Problem: `getIntersection`, `getEdge`, and `getHex` all use `Array.find` over the full board arrays on every call
- Files: `packages/core/src/board.js` lines 292-310, `packages/core/src/engine.js` passim
- Cause: Board data is stored as flat arrays, not indexed Maps
- Improvement path: Pre-build `Map<id, entity>` lookup tables at board creation time. Impacts every action that touches board topology (trail/cottage placement, production, frost).

**Full game state serialized to DB on every action:**
- Problem: `persistSnapshot` serializes the entire `room.matchState` object — including the full board topology, all player arrays, and the complete log — to JSONB on every single game action
- Files: `apps/server/src/index.js` lines 333-342, `apps/server/src/db.js` lines 343-365
- Cause: No delta/diff — full snapshot every time
- Improvement path: Snapshot on `endTurn` rather than every action, or store only state diffs. Board topology is static after game start and does not need re-serialization.

**`getPublicGameState` recomputes standings, legal actions, fast build targets, and bank ratios on every broadcast:**
- Problem: All derived state is recalculated in `getPublicGameState` on every broadcast to every player
- Files: `packages/core/src/engine.js` lines 1124-1186
- Cause: No memoization or caching
- Improvement path: Low urgency at 2-4 player scale. Would matter if this moves to larger player counts.

**`assignTokensWithGuardrails` runs up to 400 shuffle iterations at game creation:**
- Problem: Board token placement tries up to 400 random layouts looking for the one with lowest adjacency penalty score
- Files: `packages/core/src/board.js` lines 112-144
- Cause: Brute-force search at game start
- Improvement path: Acceptable at current scale since it runs once. Would need deterministic placement if board generation time becomes visible to users.

## Fragile Areas

**Snake setup phase relies on sequential index into a mutable queue:**
- Files: `packages/core/src/engine.js` lines 233-247, 335-340
- Why fragile: `state.setup.index` is incremented by side effects inside `buildCottage` and `buildTrail`. If any action throws after partial mutation, the setup pointer can advance out of sync with actual placements. No rollback mechanism.
- Safe modification: Any change to setup flow must ensure `advanceSetupPointer` is only called after all mutations succeed.
- Test coverage: Setup is tested via `completeSnakeSetup` helper but only the happy path.

**`charterClaim.remainingGlobalTurns` decremented in `tickEndOfTurnEffects` rather than on `endTurn`:**
- Files: `packages/core/src/engine.js` lines 303-319, 972-999
- Why fragile: Turn effects tick inside `tickEndOfTurnEffects` which is called from `endTurn`. If `endTurn` is called in a state where `checkTimedWin` already ended the game, the tick still runs before the early return check. Minor state inconsistency on final turn of timed games.
- Safe modification: Add phase guard at top of `tickEndOfTurnEffects`.

**Client re-renders entire DOM on every state change:**
- Files: `apps/client/src/main.js` — `render()` at line 1687, called from every message handler
- Why fragile: `innerHTML` replacement destroys and recreates all DOM nodes including SVG board, option handlers, and form inputs on every server message. Event handlers are re-bound after each render. Any render that throws leaves the UI blank.
- Safe modification: Board SVG should only re-render when board state changes. Any input field re-render loses in-progress user text.
- Test coverage: No client-side tests exist.

## Scaling Limits

**In-memory `rooms` Map on server:**
- Current capacity: All active rooms stored in a single process-level Map
- Limit: Cannot horizontally scale — two server instances have different room Maps. A load balancer will route reconnects to the wrong instance.
- Scaling path: Move room state to Redis or use sticky sessions at the load balancer level.

**Connection rate limit uses in-memory Map:**
- Current capacity: `connectionAttemptsByIp` Map grows per unique IP and is cleaned up in the maintenance loop
- Limit: Same single-process constraint as rooms Map. Does not protect against distributed attacks across multiple server instances.
- Scaling path: Move rate limit counters to Redis if multi-instance deployment is required.

## Dependencies at Risk

**No `npm audit` baseline:**
- Risk: No record of current dependency vulnerabilities exists in the repo
- Impact: Unknown exposure to known CVEs in `pg`, `ws`, `express`, `uuid`, or their transitive dependencies
- Migration plan: Run `npm audit` and pin or update any high/critical findings before deploying to production.

## Missing Critical Features

**No end-to-end tests for game flow:**
- Problem: `playwright` is installed as a dev dependency but no E2E test files exist in the repo
- Blocks: Regression testing of full game flow (lobby -> setup -> main -> win) across the client-server boundary
- The only automated tests are unit tests in `packages/core/test/engine.test.js` which test engine logic in isolation

**No health monitoring or alerting:**
- Problem: `/health` endpoint exists but there is no structured error reporting, alerting, or uptime monitoring configured
- Blocks: Silent failure detection — if the server crashes or the DB connection drops, there is no notification path

**No game history or replay:**
- Problem: Snapshots are pruned to `SNAPSHOT_LIMIT` (default 50) and deleted with the room after TTL expiry
- Blocks: Post-game review, stats, or dispute resolution

## Test Coverage Gaps

**Client has zero test coverage:**
- What's not tested: All rendering logic, WebSocket message handling, action dispatching, board interaction, trade UI, dev card UI
- Files: `apps/client/src/main.js` (1,752 lines, no test file)
- Risk: Any regression in UI or client-side validation is invisible
- Priority: High

**Server has zero test coverage:**
- What's not tested: Room lifecycle, player admission, reconnect flow, rate limiting, game action routing, persistence restore
- Files: `apps/server/src/index.js` (1,014 lines, no test file)
- Risk: Server-side bugs in session handling or game state dispatch go undetected
- Priority: High

**Engine tests do not cover timed win path:**
- What's not tested: `checkTimedWin`, `resolveTimedWinner`, `pendingHostTieBreak` tie-break flow, `chooseTimedWinner`
- Files: `packages/core/test/engine.test.js`
- Risk: Timed game ending logic is exercised only via the maintenance loop integration, not unit tested
- Priority: Medium

**Engine tests do not cover dev card interactions with game end:**
- What's not tested: `heritage_deed` point counting at game end, `charter_claim` expiry on final turn, `trailblazer` free trail when pieces run out
- Files: `packages/core/test/engine.test.js`
- Risk: Edge cases in point calculation at game end could produce wrong winner
- Priority: Medium

---

*Concerns audit: 2026-04-08*
