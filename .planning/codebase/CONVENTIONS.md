# Coding Conventions

**Analysis Date:** 2026-04-08

## Naming Patterns

**Files:**
- All source files use `kebab-case` or single lowercase words: `engine.js`, `board.js`, `utils.js`, `constants.js`, `main.js`, `db.js`
- No TypeScript — everything is plain `.js`

**Functions:**
- `camelCase` for all functions: `createGameState`, `buildCottage`, `rollDice`, `pushLog`, `getPlayer`
- Boolean-returning helpers use `is` or `has` prefix: `isValidRoomId`, `isEdgeConnectedToNetwork`, `hasNeighborStructure`
- State mutation helpers use verb prefix: `bagAddInPlace`, `bagSubtractInPlace`
- Factory/constructor functions use `create` prefix: `createGameState`, `createBoard`, `createPlayerState`
- Getters use `get` prefix: `getPlayer`, `getHex`, `getActivePlayerId`, `getPublicGameState`

**Variables:**
- `camelCase` throughout: `activePlayerId`, `targetHex`, `playerOrder`
- Numeric separators for large literals: `1_000`, `30_000`, `1_000_000`
- Environment constants use `UPPER_SNAKE_CASE` at module top: `PORT`, `CLIENT_ORIGIN`, `ROOM_TTL_HOURS`

**Constants:**
- `UPPER_SNAKE_CASE` for all exported constants: `RESOURCES`, `BUILD_COSTS`, `WIN_MODES`, `DEV_CARD_COUNTS`
- Object-shaped constants use nested object literals: `TERRAINS`, `DEFAULT_CONFIG`

**Classes:**
- `PascalCase`: `RoomStore` (only class in the codebase)

## Code Style

**Formatting:**
- No Prettier config detected — formatting is consistent but not enforced by a formatter
- 2-space indentation throughout
- Single quotes not enforced — double quotes used consistently in eslint config, but template literals used for interpolation
- Trailing commas present in multiline arrays and object destructuring

**Linting:**
- ESLint 9 flat config at `/eslint.config.js`
- Target: `**/*.js` (not TypeScript)
- `ecmaVersion: "latest"`, `sourceType: "module"`
- `no-unused-vars` enforced — args prefixed with `_` are ignored
- `no-console` is off (console logging is allowed)
- Rule: `"no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]`

## Import Organization

**Order (observed pattern):**
1. External packages (`import { Pool } from "pg"`, `import cors from "cors"`)
2. Node built-ins (`import { randomBytes } from "node:crypto"`)
3. Workspace packages (`import { ... } from "@shorewood/core"`)
4. Local modules (`import { RoomStore } from "./db.js"`)

**Path Style:**
- Explicit `.js` extensions on all local imports: `"./constants.js"`, `"./board.js"`
- Workspace packages use scoped name: `@shorewood/core`
- No path aliases; all imports are explicit paths or package names

## Error Handling

**Pattern in core engine:**
- Throw `new Error("message")` directly for all illegal state / invalid input
- Error messages are human-readable strings matching the test assertions (e.g., `/Illegal trail placement/`, `/Roll dice before posting a trade offer/`)
- No custom error classes — plain `Error` only
- Guard functions `ensureMainActionTurn`, `consumeCost` throw early rather than returning booleans

**Pattern in server:**
- WebSocket errors returned as structured messages via `sendError(ws, reason)`
- Startup failures call `process.exit(1)` after logging
- `try/catch` blocks used for JSON parsing and URL analysis; catch body uses inline comment explaining intent (e.g., `// Invalid URLs are surfaced by the PG client; skip URL-based SSL inference.`)

**Pattern in client:**
- `try/catch` around `localStorage` JSON parsing with fallback behavior
- No global error boundary — silent fallback to null/default

## Logging

**Server:**
- `console.log` for startup/restore summaries
- `console.error` for fatal init errors before `process.exit(1)`
- Game event log stored as structured entries in `state.log` via `pushLog(state, text, ts)` in the engine

**Engine:**
- In-state log via `pushLog` creates entries: `{ id, text, ts, iso }`
- Log entries use player names for human-readable messages
- No external logger package

**Client:**
- `console.error` for WebSocket errors and unhandled message types

## Comments

**When to Comment:**
- Single-line inline comments explain non-obvious decisions or backward-compat intent
- Examples: `// Backward compatibility with legacy string-only session storage.`, `// Invalid URLs are surfaced by the PG client; skip URL-based SSL inference.`
- No JSDoc or TSDoc annotations anywhere in the codebase
- No block comments

## Function Design

**Size:**
- Private helpers are small, single-purpose (5-30 lines): `emptyResources`, `getPlayer`, `newLogEntry`
- Larger exported functions handle full action flows but stay focused: `rollDice` (~50 lines), `buildCottage` (~30 lines)
- `getPublicGameState` (~60 lines) is the largest single exported function — it's a projection/read operation

**Parameters:**
- Mutable state object always passed as first parameter: `(state, playerId, ...)`
- Timestamps always passed as `ts = Date.now()` with default
- RNG injected for testability: `rng = Math.random`

**Return Values:**
- Mutation functions return the created/updated object (e.g., `proposeTrade` returns the offer)
- Query functions return plain values or plain objects (no wrapped types)
- Boolean-returning functions use explicit `return true/false`

## Module Design

**Exports:**
- `packages/core/src/index.js` re-exports everything from all modules using `export * from`
- Engine functions are exported individually with `export function`
- Constants exported individually: `export const RESOURCES = ...`
- Class exported with `export class RoomStore`

**Private Functions:**
- All internal helpers in `engine.js` and `board.js` are non-exported function declarations at module scope
- No IIFE or closure patterns for privacy

**Barrel Files:**
- Single barrel at `packages/core/src/index.js` for the entire core package

---

*Convention analysis: 2026-04-08*
