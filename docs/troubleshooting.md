# Troubleshooting

## 1) "Your Options" looks blank

Expected cases:
- In main phase, if it is not your turn, the options list can be empty.
- In setup, only the player whose setup step is active sees a placement option.

How to verify quickly:
1. Check header `Active: <name>`.
2. Compare with your player name in the players list.
3. If they differ, blank options are expected.

If it is your turn and still blank:
- confirm socket status is connected
- reload once and rejoin via reconnect
- check browser console for runtime errors

## 2) "Roll the dice before taking that action"

Cause:
- Build/trade/buy/end-turn actions in main phase require a roll first.

Expected pre-roll legal actions for active player:
- `Roll Dice`
- `Accept Trade`
- `Decline Trade`

## 3) "Not enough resources" errors

Expected when attempting actions without required cost.

Reference costs:
- Road: 1 timber + 1 clay
- Cottage: 1 timber + 1 clay + 1 wool + 1 harvest
- Manor: 2 harvest + 3 iron
- Development Card: 1 wool + 1 harvest + 1 iron

UI behavior:
- client pre-checks show missing-resource toast
- server still revalidates and can return authoritative error

## 4) Supabase not connecting

### Symptom A: server starts in memory mode unexpectedly

Likely cause:
- `DATABASE_URL` not loaded due dotenv working-directory behavior.

Fix:
- run from repo root with `npm run dev`, or
- from `apps/server` run:

```bash
DOTENV_CONFIG_PATH=../../.env node src/index.js
```

Check:

```bash
curl http://localhost:8080/health
```

Expect `"persistence":"postgres"` if env is loaded.

### Symptom B: startup fails when `DATABASE_URL` is set

Common errors:
- `ENOTFOUND`: hostname/DNS issue
- `EHOSTUNREACH`: runtime cannot route to DB host

Mitigations:
- prefer Supabase pooler host (`*.pooler.supabase.com`) on IPv4-only networks
- verify outbound network/firewall rules
- verify DB credentials and host/port
- if needed for cert-chain edge cases, set `DATABASE_SSL_REJECT_UNAUTHORIZED=false`

## 5) "Origin not allowed" / WS blocked

Cause:
- browser origin not present in `CLIENT_ORIGIN` allowlist.

Fix:
- set `CLIENT_ORIGIN` to the exact frontend origin
- for multiple origins, use comma-separated list

## 6) "Too many messages" or connection throttling

Cause:
- server rate limits triggered.

Tune (with care):
- `MESSAGE_RATE_LIMIT_WINDOW_MS`
- `MESSAGE_RATE_LIMIT_MAX`
- `CONNECTION_RATE_WINDOW_MS`
- `CONNECTION_RATE_MAX`

## 7) Room expired

Symptom:
- users disconnected with room-expired error.

Cause:
- room exceeded TTL (`ROOM_TTL_HOURS`, default 24h).

Fix:
- create new room
- optionally increase TTL in env

## 8) Reconnect failed: invalid credentials

Cause:
- missing or stale `sessionToken` / `reconnectSecret` pair.

Fix:
- avoid clearing localStorage mid-session
- if credentials are lost, rejoin via normal join flow

## 9) Setup appears stuck

Checks:
1. Look at current setup step in options panel.
2. Place only the expected piece type (Cottage or Road).
3. For setup Road, select an edge touching the just-placed Cottage.

## 10) Regression check commands

Use these to quickly validate gameplay flow after changes:

```bash
node output/turn_option_feedback_check.mjs
node output/four_player_comprehensive_pass.mjs
```
