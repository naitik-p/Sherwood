# Architecture

**Analysis Date:** 2026-04-08

## Pattern Overview

**Overall:** Monorepo with three npm workspaces — shared game engine (`@shorewood/core`), Node.js WebSocket server (`@shorewood/server`), and a vanilla JS single-page client (`@shorewood/client`).

**Key Characteristics:**
- Pure game logic lives entirely in `@shorewood/core`, imported by both server and client
- All real-time communication happens over a single WebSocket connection per player — no REST for game actions
- Server holds authoritative in-memory room/match state; Postgres (optional) provides persistence across restarts
- Client uses a single global mutable `state` object plus a synchronous `render()` function — no framework
- The server filters game state through `getPublicGameState()` before broadcasting so each player only sees their own private data

## Layers

**Core Engine (`@shorewood/core`):**
- Purpose: Pure game logic, board generation, state mutations, legal action computation
- Location: `packages/core/src/`
- Contains: `engine.js` (state creation and all action functions), `board.js` (hex grid generation), `constants.js` (game config values), `utils.js` (RNG, resource bag helpers)
- Depends on: Nothing external — zero runtime dependencies
- Used by: `@shorewood/server` (authoritative execution) and `@shorewood/client` (constants, labels, build cost display)

**Server (`@shorewood/server`):**
- Purpose: Room lifecycle, player session management, WebSocket dispatch, persistence
- Location: `apps/server/src/`
- Contains: `index.js` (Express + WebSocketServer, all handler functions), `db.js` (`RoomStore` class wrapping Postgres or in-memory fallback)
- Depends on: `@shorewood/core`, `express`, `ws`, `pg`, `uuid`, `dotenv`
- Used by: Nothing — it is the process entry point

**Client (`@shorewood/client`):**
- Purpose: UI rendering, WebSocket lifecycle, player interaction
- Location: `apps/client/src/`
- Contains: `main.js` (entire client — ~1750 lines), `styles.css`
- Depends on: `@shorewood/core` (constants only), native browser WebSocket
- Used by: Nothing — it is the browser entry point

**Database (`RoomStore`):**
- Purpose: Optional persistence of rooms, player records, and match snapshots to Postgres
- Location: `apps/server/src/db.js`
- Contains: Single class with `init()`, `createRoom()`, `upsertPlayer()`, `saveSnapshot()`, `latestSnapshot()`, `listActiveRooms()`, `listPlayers()`
- Depends on: `pg`
- Falls back to: In-memory Maps when `DATABASE_URL` is not set

## Data Flow

**Room Creation:**
1. Client sends `createRoom` WebSocket message with player name/avatar
2. `handleCreateRoom()` in `apps/server/src/index.js` creates room record in `RoomStore` and in-memory `rooms` Map
3. Server replies with `playerStatus` (session token, reconnect secret, player id) and `roomState`
4. Client saves session to `localStorage` keyed by room id

**Join Flow:**
1. Guest sends `requestJoin` with room id and optional session token
2. Server queues player as `pending`, sends host a `prompt` of kind `joinRequest`
3. Host sends `hostAdmit` or `hostDeny`; server updates player status and broadcasts updated `roomState` to all admitted players

**Match Start:**
1. Host sends `startMatch` after all admitted players mark ready
2. `handleStartMatch()` calls `createInitializedGameState()` from `@shorewood/core`
3. Server sets `room.status = "in_game"`, calls `broadcastGameState()` which calls `getPublicGameState(state, playerId)` per player
4. Server persists snapshot via `persistSnapshot()`

**Turn Action:**
1. Client sends action message (e.g. `rollDice`, `buildCottage`, `endTurn`) over WebSocket
2. `handleIncoming()` routes to `handleGameAction()`
3. `handleGameAction()` looks up `room.matchState`, calls the matching exported function from `@shorewood/core` (mutates state in place)
4. `maybeResolveVote()` and `checkTimedWin()` run after every action
5. `persistSnapshot()` saves full state JSON to Postgres
6. `broadcastGameState()` sends filtered `gameState` to each connected player

**Reconnect:**
1. On WebSocket `open`, client checks `localStorage` for stored session; if present, sends `reconnect` with session token + reconnect secret
2. Server validates credentials, reattaches socket to player, re-sends current room or game state

**State Management (Client):**
- Single module-level `state` object in `apps/client/src/main.js` holds all client state
- Every meaningful event calls `render()`, which replaces `appEl.innerHTML` wholesale and rebinds DOM event listeners
- No diffing or virtual DOM — full re-render on each state change

## Key Abstractions

**Game State (`state` object in engine):**
- Purpose: Complete authoritative match snapshot — board, players, structures, turn, log
- Examples: Created by `createGameState()` in `packages/core/src/engine.js:431`
- Pattern: Plain JS object mutated in place by action functions; `structuredClone` used for copies via `clone()` in `utils.js`

**Public Game State:**
- Purpose: Per-player filtered view — hides other players' dev cards and resources
- Examples: `getPublicGameState()` in `packages/core/src/engine.js:1124`
- Pattern: Called by server on every broadcast; legal actions and fast-build targets computed here per viewer

**Room:**
- Purpose: Server-side room envelope holding players Map, matchState, and lifecycle metadata
- Examples: Constructed inline in `handleCreateRoom()` in `apps/server/src/index.js:494`
- Pattern: Plain object stored in module-level `rooms: Map<roomId, room>`

**RoomStore:**
- Purpose: Persistence abstraction that works with or without Postgres
- Examples: `apps/server/src/db.js:26`
- Pattern: Class with dual-mode behavior — `usePg` flag gates all Postgres calls; memory Maps serve as fallback

**Board:**
- Purpose: Immutable hex grid with intersections, edges, tokens, and bazaar stalls
- Examples: `createBoard()` in `packages/core/src/board.js`
- Pattern: Generated once per match from a seeded RNG; stored as part of game state; never mutated after creation

**Legal Actions:**
- Purpose: Computed list of valid moves for the active player each render
- Examples: `getLegalActions()` in `packages/core/src/engine.js:1056`
- Pattern: Returned inside `getPublicGameState()` and consumed by client to enable/disable UI controls

## Entry Points

**Server Process:**
- Location: `apps/server/src/index.js`
- Triggers: `node --watch src/index.js` (dev) or `node src/index.js` (prod)
- Responsibilities: Binds Express on `PORT`, creates WebSocketServer at `/ws`, initializes `RoomStore`, restores persisted rooms, starts listening

**Client SPA:**
- Location: `apps/client/src/main.js` (loaded by `apps/client/index.html` via Vite)
- Triggers: Browser load; `connectSocket()` called immediately at module eval time
- Responsibilities: Establishes WebSocket, renders landing/lobby/game based on state, handles all user interactions

**Core Package:**
- Location: `packages/core/src/index.js`
- Triggers: Imported as `@shorewood/core` by server and client
- Responsibilities: Re-exports all engine functions, board functions, constants, and utils

## Error Handling

**Strategy:** Throw `Error` in core engine functions; catch at WebSocket dispatch boundary in server and send `error` message back to client; client displays toast.

**Patterns:**
- Core functions throw plain `new Error("message")` for invalid actions (e.g. "Insufficient resources", "It is not your turn")
- `handleIncoming()` in `apps/server/src/index.js:872` wraps all handler calls in `try/catch`, calls `sendError(ws, error.message)`
- Client in `handleServerMessage()` catches `type === "error"` and calls `setToast(payload.reason, "error")`
- Validation errors (bad room id, session token format) use regex guards before processing: `ROOM_ID_RE`, `SESSION_TOKEN_RE`, `PLAYER_ID_RE`

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` on server. In-game event log is part of match state (`state.log` array of `{ id, text, ts, iso }` entries), broadcast to clients as `logEntry` messages.

**Validation:** Input validated at server boundary via regex patterns and allowlists. Core engine validates game rule preconditions (turn order, resource sufficiency, adjacency rules).

**Authentication:** Session-token-based only — no auth provider. Each player holds a `sessionToken` (public, used as Map key) and a `reconnectSecret` (secret, validated on reconnect). Both are stored in `localStorage` on client. No JWTs or external identity.

**Rate Limiting:** Per-IP connection rate limit (`CONNECTION_RATE_MAX` per `CONNECTION_RATE_WINDOW_MS`) and per-socket message rate limit (`MESSAGE_RATE_LIMIT_MAX` per `MESSAGE_RATE_LIMIT_WINDOW_MS`). Implemented in-process via Maps — resets on server restart.

---

*Architecture analysis: 2026-04-08*
