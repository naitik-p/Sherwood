# Codebase Structure

**Analysis Date:** 2026-04-08

## Directory Layout

```
shorewood/                        # Monorepo root
├── apps/
│   ├── client/                   # Browser SPA (Vite + vanilla JS)
│   │   ├── src/
│   │   │   ├── main.js           # Entire client (~1750 lines)
│   │   │   └── styles.css        # All styles
│   │   ├── index.html            # Vite entry point
│   │   ├── vite.config.js        # Vite config (port 5173)
│   │   ├── vercel.json           # Vercel SPA rewrites + CSP headers
│   │   └── package.json          # @shorewood/client
│   └── server/
│       ├── src/
│       │   ├── index.js          # Express + WebSocketServer (~1014 lines)
│       │   └── db.js             # RoomStore class (~386 lines)
│       ├── sql/
│       │   └── 001_init.sql      # Schema creation script
│       ├── scripts/
│       │   └── verify_db.mjs     # DB verification utility
│       └── package.json          # @shorewood/server
├── packages/
│   └── core/
│       ├── src/
│       │   ├── index.js          # Re-exports all public symbols
│       │   ├── engine.js         # All game state and action functions (~1202 lines)
│       │   ├── board.js          # Hex board generation (~7703 bytes)
│       │   ├── constants.js      # Game configuration values
│       │   └── utils.js          # RNG, resource bag helpers, assert
│       ├── test/
│       │   └── engine.test.js    # Vitest tests for core engine
│       └── package.json          # @shorewood/core
├── docs/                         # Reference documentation (not consumed by code)
│   ├── architecture.md
│   ├── configuration-reference.md
│   ├── deployment-operations.md
│   ├── development-testing.md
│   ├── gameplay-rules.md
│   ├── troubleshooting.md
│   └── websocket-protocol.md
├── output/                       # Manual test artifacts (screenshots, state JSON)
│   └── web-game/
├── .planning/                    # GSD planning documents
│   └── codebase/
├── package.json                  # Root workspace config (npm workspaces)
├── package-lock.json
├── eslint.config.js              # Root ESLint config
├── .env.example                  # Required env var documentation
├── .gitignore
├── progress.md                   # Development log
└── README.md
```

## Directory Purposes

**`packages/core/src/`:**
- Purpose: Zero-dependency game engine shared between server and client
- Contains: Pure functions that create and mutate game state; board geometry; seeded RNG; resource bag utilities; game constants
- Key files: `engine.js` (all exported action functions), `board.js` (hex grid builder), `constants.js` (BUILD_COSTS, PIECE_LIMITS, DEV_CARD_COUNTS, DEFAULT_CONFIG)

**`apps/server/src/`:**
- Purpose: Node.js process; sole source of truth for match state at runtime
- Contains: WebSocket message dispatch, room lifecycle handlers, player session logic, rate limiting, persistence orchestration
- Key files: `index.js` (entire server), `db.js` (RoomStore — Postgres + memory dual-mode)

**`apps/server/sql/`:**
- Purpose: Database schema management
- Contains: `001_init.sql` — run once to create `shorewood_rooms`, `shorewood_players`, `shorewood_match_snapshots` tables
- Key files: `001_init.sql`

**`apps/client/src/`:**
- Purpose: Browser UI — all rendering, WebSocket handling, and user interaction
- Contains: Single-file vanilla JS application; no framework
- Key files: `main.js` (full client), `styles.css`

**`docs/`:**
- Purpose: Human-readable documentation (gameplay rules, WebSocket protocol reference, deployment guide)
- Generated: No
- Committed: Yes

**`output/web-game/`:**
- Purpose: Manual smoke test artifacts — screenshots and captured state JSON from test runs
- Generated: Yes (manually)
- Committed: Yes (as test evidence)

## Key File Locations

**Entry Points:**
- `apps/server/src/index.js`: Server process entry; starts Express + WebSocketServer
- `apps/client/index.html`: Browser entry; loads `src/main.js` via Vite
- `packages/core/src/index.js`: Package entry; re-exports all public symbols

**Configuration:**
- `.env.example`: Documents all required environment variables (`DATABASE_URL`, `PORT`, `CLIENT_ORIGIN`, `ROOM_TTL_HOURS`, `SNAPSHOT_LIMIT`, rate limit vars)
- `eslint.config.js`: Root ESLint config shared across workspaces
- `apps/client/vite.config.js`: Vite dev server config (port 5173, host: true)
- `apps/client/vercel.json`: Vercel deployment config with SPA rewrites and CSP

**Core Logic:**
- `packages/core/src/engine.js`: All game state creation and action functions — `createGameState`, `rollDice`, `buildCottage`, `buildTrail`, `upgradeManor`, `buyDevCard`, `playDevCard`, `proposeTrade`, `acceptTrade`, `declineTrade`, `bankTrade`, `endTurn`, `getPublicGameState`, `getLegalActions`, `getFastBuildTargets`
- `packages/core/src/board.js`: Hex grid generation — `createBoard`, `getHex`, `getIntersection`, `getEdge`
- `packages/core/src/constants.js`: `RESOURCES`, `TERRAINS`, `BUILD_COSTS`, `PIECE_LIMITS`, `DEV_CARD_COUNTS`, `WIN_MODES`, `DEFAULT_CONFIG`

**Testing:**
- `packages/core/test/engine.test.js`: Vitest tests; run via `npm test` from root

**Database:**
- `apps/server/src/db.js`: `RoomStore` class
- `apps/server/sql/001_init.sql`: Schema DDL

## Naming Conventions

**Files:**
- Lowercase with hyphens for multi-word config files: `vite.config.js`, `eslint.config.js`
- Flat names for source files: `engine.js`, `board.js`, `main.js`, `index.js`, `db.js`
- SQL files prefixed with migration number: `001_init.sql`
- Test files: `engine.test.js` (co-located in `test/` next to `src/`)

**Directories:**
- Lowercase, no hyphens: `apps`, `client`, `server`, `packages`, `core`, `src`, `sql`, `scripts`, `docs`, `output`

**Identifiers (JS):**
- Functions: camelCase — `createGameState`, `buildCottage`, `handleIncoming`
- Constants/config keys: UPPER_SNAKE_CASE — `BUILD_COSTS`, `WIN_MODES`, `PIECE_LIMITS`
- Classes: PascalCase — `RoomStore`
- Object keys: camelCase — `roomId`, `sessionToken`, `hostPlayerId`
- ID prefixes: `r_` for rooms, `sess_` for sessions, `ply_` for players, `log_` for log entries

## Where to Add New Code

**New game action (e.g. a new thing a player can do on their turn):**
- Implementation: `packages/core/src/engine.js` — add exported function, add to `getLegalActions()` if it needs UI gating
- Export: Add to `packages/core/src/index.js`
- Server dispatch: Add `else if (type === "newAction")` branch in `handleGameAction()` in `apps/server/src/index.js`
- Client UI: Add button/handler in `renderOptions()` or relevant panel in `apps/client/src/main.js`

**New game constant or configuration value:**
- Add to `packages/core/src/constants.js`
- Export via `packages/core/src/index.js` if needed by client

**New board feature:**
- Add to `packages/core/src/board.js`

**New server-side room lifecycle action (e.g. kick player):**
- Add `handleX()` function in `apps/server/src/index.js`
- Wire into `handleIncoming()` dispatch block

**New persistence field:**
- Alter `EXPECTED_COLUMNS` and relevant queries in `apps/server/src/db.js`
- Add migration SQL to `apps/server/sql/` with next number prefix

**New utility (RNG, resource math, etc.):**
- Add to `packages/core/src/utils.js`

**Tests:**
- All tests: `packages/core/test/engine.test.js` (Vitest)

## Special Directories

**`.planning/`:**
- Purpose: GSD planning documents and codebase analysis
- Generated: By Claude Code
- Committed: Yes

**`output/web-game/`:**
- Purpose: Manual test run artifacts (screenshots, captured JSON game states)
- Generated: Manually during testing
- Committed: Yes as test evidence

**`docs/`:**
- Purpose: Developer-facing reference documentation
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-04-08*
