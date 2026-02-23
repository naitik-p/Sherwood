# WebSocket Protocol Reference

Server endpoint:
- `ws://<host>/ws` (or `wss://` in production)

Envelope format:

```json
{ "type": "messageType", "payload": {} }
```

All client->server and server->client messages use this envelope.

## Client -> Server Messages

### Lobby/session

- `createRoom`
  - payload: `{ "sessionToken"?, "name", "avatarId" }`
- `requestJoin`
  - payload: `{ "roomId", "sessionToken"?, "reconnectSecret"?, "name", "avatarId" }`
- `reconnect`
  - payload: `{ "roomId", "sessionToken", "reconnectSecret" }`
- `setProfile`
  - payload: `{ "roomId", "name"?, "avatarId"? }`
- `readyUp`
  - payload: `{ "roomId", "ready" }`
- `hostAdmit`
  - payload: `{ "roomId", "playerId" }`
- `hostDeny`
  - payload: `{ "roomId", "playerId" }`
- `startMatch`
  - payload: `{ "roomId", "seed"? }`

### Gameplay actions

- `voteWinCondition`
  - payload: `{ "roomId", "mode" }`
- `rollDice`
  - payload: `{ "roomId" }`
- `buildTrail`
  - payload: `{ "roomId", "edgeId" }`
- `buildCottage`
  - payload: `{ "roomId", "intersectionId" }`
- `upgradeManor`
  - payload: `{ "roomId", "intersectionId" }`
- `buyDevCard`
  - payload: `{ "roomId" }`
- `playDevCard`
  - payload: `{ "roomId", "cardId"?, "cardType"?, "resources"?, "hexId"? }`
- `proposeTrade`
  - payload: `{ "roomId", "toPlayerId"?, "give", "receive" }`
- `acceptTrade`
  - payload: `{ "roomId", "tradeId" }`
- `declineTrade`
  - payload: `{ "roomId", "tradeId" }`
- `bankTrade`
  - payload: `{ "roomId", "giveResource", "receiveResource", "giveAmount"?, "receiveAmount"? }`
- `endTurn`
  - payload: `{ "roomId" }`
- `chooseTimedWinner`
  - payload: `{ "roomId", "winnerPlayerId" }`

## Server -> Client Messages

- `playerStatus`
  - connection/session identity updates
  - examples: `{ "connected": true }`, `{ "roomId", "sessionToken", "reconnectSecret", "playerId", "role" }`
- `roomState`
  - lobby state for current session view
- `gameState`
  - full viewer-scoped game snapshot
- `logEntry`
  - incremental log item broadcast
- `prompt`
  - UI prompts; `kind` values include:
    - `waitingForHostAdmission`
    - `joinRequest`
    - `admitted`
    - `devCardReveal`
- `tradeOffer`
  - emitted when a trade is posted
- `tradeResolved`
  - emitted when a trade is accepted/declined
- `error`
  - authoritative validation failure with `{ "reason" }`

## `gameState` Notes

`gameState` is viewer-specific:
- self player sees full `resources` and own dev card identities
- opponents expose resource/deck counts only
- includes per-viewer `legalActions`, `fastBuildTargets`, and `bankRatios`

Main top-level fields:
- `roomId`, `phase`, `hostPlayerId`
- `board`, `players`, `structures`, `playerOrder`
- `setup`, `vote`, `winMode`, `turn`
- `standings`, `legalActions`, `fastBuildTargets`, `bankRatios`
- `pendingTrades`, `charterClaim`, `log`, `winner`, `pendingHostTieBreak`

## Error Model

- Server rejects illegal/out-of-sequence actions with `error` and a human-readable `reason`.
- Client should treat server errors as source of truth even if local pre-checks passed.

## Protocol Constraints

Server enforces:
- maximum message payload size (`MAX_WS_MESSAGE_BYTES`)
- per-socket message rate limits
- per-IP connection rate limits
- origin allowlist checks (`CLIENT_ORIGIN`)
