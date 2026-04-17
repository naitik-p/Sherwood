# Development and Testing

## Prerequisites

- Node.js 20+
- npm

Install once:

```bash
npm install
```

## Local Run Modes

From repo root (recommended):

```bash
npm run dev
```

Starts:
- client on `http://localhost:5173`
- server on `http://localhost:8080`

Server-only from `apps/server`:

```bash
node src/index.js
```

The server searches upward for `.env`, so it will pick up the repo-root `.env` by default.
`DOTENV_CONFIG_PATH=../../.env node src/index.js` still works as an explicit override.

## Core Quality Gates

Run from repo root:

```bash
npm test
npm run lint
npm run build
```

## Automated Gameplay Harnesses

Scripts in `output/` use Playwright for browser-level verification.

Turn option + invalid-feedback check:

```bash
node output/turn_option_feedback_check.mjs
```

Comprehensive 4-player pass (setup + multiple turns/player):

```bash
node output/four_player_comprehensive_pass.mjs
```

Strict 4-player, 6-turn retest harness:

```bash
node output/four_player_6turn_full_retest.mjs
```

## Artifacts and How to Read Them

Scripts write to `output/web-game/`:
- screenshots (`*.png`)
- snapshots (`state-*.json`)
- run summaries (`*-summary.json`)

Recommended review loop:
1. Run target script.
2. Open summary JSON and verify expected booleans/checks.
3. Inspect screenshot for UI/state consistency.
4. Cross-check with event log text in screenshot.

## Manual QA Checklist

Lobby and session:
- create room, request join, host admit/deny
- ready-up and start gating
- reconnect behavior

Setup:
- snake order enforcement
- road connectivity to just-placed setup Cottage
- setup resource gain per Cottage placement

Main phase:
- pre-roll gating and roll requirement
- trail/cottage/manor legality and resource costs
- dev card buy/play constraints
- player trade post/accept/decline
- Bazaar ratio enforcement
- end-turn gating

UX feedback:
- invalid click paths show explicit toasts
- active player sees full options list
- non-active player can have empty options in main phase

## Determinism Notes

- Board generation depends on seed when match starts.
- `startMatch` accepts optional `seed` in payload; useful for deterministic repro runs.
- Gameplay harnesses can still vary due to dice randomness and player-economy state.

## Known Coverage Limitation

A strict 6-turn, 4-player window may not always produce a legal main-phase Cottage build due to economic variance, even when trades are attempted. Treat this as a stochastic coverage harness, not a deterministic proof of every action in six turns.
