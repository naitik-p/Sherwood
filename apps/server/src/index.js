import "dotenv/config";

import cors from "cors";
import express from "express";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { v4 as uuidv4 } from "uuid";
import WebSocket, { WebSocketServer } from "ws";

import {
  acceptTrade,
  bankTrade,
  buildCottage,
  buildTrail,
  buyDevCard,
  castWinVote,
  checkTimedWin,
  chooseTimedWinner,
  createInitializedGameState,
  declineTrade,
  endTurn,
  getPublicGameState,
  maybeResolveVote,
  playDevCard,
  proposeTrade,
  rollDice,
  upgradeManor
} from "@shorewood/core";
import { RoomStore } from "./db.js";

const PORT = Number(process.env.PORT ?? 8080);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const ROOM_TTL_HOURS = Number(process.env.ROOM_TTL_HOURS ?? 24);
const SNAPSHOT_LIMIT = Number(process.env.SNAPSHOT_LIMIT ?? 50);
const DATABASE_SSL_REJECT_UNAUTHORIZED =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === undefined
    ? null
    : process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";
const MAX_WS_MESSAGE_BYTES = Number(process.env.MAX_WS_MESSAGE_BYTES ?? 16 * 1024);
const MESSAGE_RATE_LIMIT_WINDOW_MS = Number(process.env.MESSAGE_RATE_LIMIT_WINDOW_MS ?? 5000);
const MESSAGE_RATE_LIMIT_MAX = Number(process.env.MESSAGE_RATE_LIMIT_MAX ?? 80);
const CONNECTION_RATE_WINDOW_MS = Number(process.env.CONNECTION_RATE_WINDOW_MS ?? 60_000);
const CONNECTION_RATE_MAX = Number(process.env.CONNECTION_RATE_MAX ?? 80);

const ROOM_ID_RE = /^r_[a-z0-9]{8}$/;
const SESSION_TOKEN_RE = /^sess_[0-9a-f-]{36}$/;
const PLAYER_ID_RE = /^ply_[0-9a-f]{32}$/;
const RECONNECT_SECRET_RE = /^[A-Za-z0-9_-]{32,}$/;
const ALLOWED_AVATAR_IDS = new Set(Array.from({ length: 15 }, (_, index) => `badge_${index + 1}`));

const configuredOrigins = CLIENT_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOW_ALL_ORIGINS = configuredOrigins.includes("*");
const ALLOWED_ORIGINS = new Set(configuredOrigins);
const connectionAttemptsByIp = new Map();

const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOW_ALL_ORIGINS || ALLOWED_ORIGINS.has(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error("Origin not allowed"));
    }
  })
);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    persistence: process.env.DATABASE_URL ? "postgres" : "memory"
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const store = new RoomStore({
  databaseUrl: process.env.DATABASE_URL,
  roomTtlHours: ROOM_TTL_HOURS,
  snapshotLimit: SNAPSHOT_LIMIT,
  databaseSslRejectUnauthorized: DATABASE_SSL_REJECT_UNAUTHORIZED
});

try {
  await store.init();
} catch (error) {
  console.error("Failed to initialize Shorewood persistence.");
  console.error("This server expects its own tables and does not use Supabase auth profile foreign keys.");
  console.error('Run "apps/server/sql/001_init.sql" against your database and verify DATABASE_URL.');
  console.error(error);
  process.exit(1);
}

const rooms = new Map();

function send(ws, type, payload) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify({ type, payload }));
}

function sendError(ws, reason) {
  send(ws, "error", { reason });
}

function roomExpired(room) {
  return Date.now() > room.expiresAt;
}

function isValidRoomId(value) {
  return typeof value === "string" && ROOM_ID_RE.test(value);
}

function isValidSessionToken(value) {
  return typeof value === "string" && SESSION_TOKEN_RE.test(value);
}

function isValidPlayerId(value) {
  return typeof value === "string" && PLAYER_ID_RE.test(value);
}

function isValidReconnectSecret(value) {
  return typeof value === "string" && RECONNECT_SECRET_RE.test(value);
}

function requireRoomId(value) {
  if (!isValidRoomId(value)) {
    throw new Error("Invalid room id");
  }
  return value;
}

function normalizeName(name, fallback = "Guest") {
  if (typeof name !== "string") {
    return fallback;
  }

  const trimmed = name.trim().slice(0, 20);
  const safe = trimmed.replace(/[^a-zA-Z0-9 .,'_-]/g, "");
  return safe.length > 0 ? safe : fallback;
}

function normalizeAvatarId(avatarId) {
  if (typeof avatarId !== "string") {
    return "badge_1";
  }
  return ALLOWED_AVATAR_IDS.has(avatarId) ? avatarId : "badge_1";
}

function makeRoomId() {
  return `r_${uuidv4().slice(0, 8)}`;
}

function makeSessionToken() {
  return `sess_${uuidv4()}`;
}

function makePlayerId() {
  return `ply_${uuidv4().replaceAll("-", "")}`;
}

function makeReconnectSecret() {
  return randomBytes(24).toString("base64url");
}

function findPlayerByPlayerId(room, playerId) {
  for (const player of room.players.values()) {
    if (player.playerId === playerId) {
      return player;
    }
  }
  return null;
}

function getSocketIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

function checkConnectionRateLimit(ip) {
  const now = Date.now();
  const entry = connectionAttemptsByIp.get(ip) ?? { windowStart: now, count: 0 };

  if (now - entry.windowStart > CONNECTION_RATE_WINDOW_MS) {
    entry.windowStart = now;
    entry.count = 0;
  }

  entry.count += 1;
  connectionAttemptsByIp.set(ip, entry);
  return entry.count <= CONNECTION_RATE_MAX;
}

function checkMessageRateLimit(ws) {
  const now = Date.now();
  const meta = ws.meta ?? {};
  const windowStart = meta.messageRateWindowStart ?? now;
  const count = meta.messageRateCount ?? 0;

  if (now - windowStart > MESSAGE_RATE_LIMIT_WINDOW_MS) {
    meta.messageRateWindowStart = now;
    meta.messageRateCount = 1;
    ws.meta = meta;
    return true;
  }

  meta.messageRateWindowStart = windowStart;
  meta.messageRateCount = count + 1;
  ws.meta = meta;
  return meta.messageRateCount <= MESSAGE_RATE_LIMIT_MAX;
}

function isOriginAllowed(origin) {
  if (ALLOW_ALL_ORIGINS) {
    return true;
  }
  if (!origin) {
    return process.env.NODE_ENV !== "production";
  }
  return ALLOWED_ORIGINS.has(origin);
}

function getRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    throw new Error("Room does not exist");
  }
  if (roomExpired(room)) {
    throw new Error("Room expired");
  }
  return room;
}

function listAdmittedPlayers(room) {
  return [...room.players.values()].filter((player) => player.status === "admitted");
}

function listReadyPlayers(room) {
  return listAdmittedPlayers(room).filter((player) => player.ready);
}

function roomStateFor(room, sessionToken) {
  const isHost = sessionToken === room.hostSessionToken;
  const self = room.players.get(sessionToken) ?? null;
  const host = room.players.get(room.hostSessionToken) ?? null;
  return {
    roomId: room.id,
    status: room.status,
    expiresAt: new Date(room.expiresAt).toISOString(),
    hostPlayerId: host?.playerId ?? null,
    selfPlayerId: self?.playerId ?? null,
    players: [...room.players.values()]
      .filter((player) => player.status === "admitted")
      .map((player) => ({
        playerId: player.playerId,
        name: player.name,
        avatarId: player.avatarId,
        ready: player.ready,
        isHost: player.sessionToken === room.hostSessionToken
      })),
    pendingRequests: isHost
      ? [...room.players.values()]
          .filter((player) => player.status === "pending")
          .map((player) => ({ playerId: player.playerId, name: player.name, avatarId: player.avatarId }))
      : [],
    canStart: room.status === "lobby" && listReadyPlayers(room).length >= 2
  };
}

function broadcastRoomState(room) {
  for (const player of room.players.values()) {
    if (player.socket) {
      send(player.socket, "roomState", roomStateFor(room, player.sessionToken));
    }
  }
}

function broadcastGameState(room) {
  if (!room.matchState) {
    return;
  }

  for (const player of room.players.values()) {
    if (player.status !== "admitted" || !player.socket) {
      continue;
    }

    const state = getPublicGameState(room.matchState, player.playerId);
    send(player.socket, "gameState", state);
  }

  const newLogs = room.matchState.log.slice(room.lastBroadcastLogCount);
  if (newLogs.length > 0) {
    for (const entry of newLogs) {
      for (const player of room.players.values()) {
        if (player.status === "admitted" && player.socket) {
          send(player.socket, "logEntry", entry);
        }
      }
    }
  }
  room.lastBroadcastLogCount = room.matchState.log.length;
}

async function persistSnapshot(room) {
  if (!room.matchState) {
    return;
  }

  await store.saveSnapshot({
    roomId: room.id,
    stateJson: room.matchState
  });
}

async function ensurePlayerRecord(roomId, player) {
  await store.upsertPlayer({
    roomId,
    sessionToken: player.sessionToken,
    name: player.name,
    avatarId: player.avatarId,
    lastSeen: Date.now()
  });
}

function ensureHost(room, sessionToken) {
  if (room.hostSessionToken !== sessionToken) {
    throw new Error("Only the host can do that");
  }
}

function ensureAdmittedPlayer(room, sessionToken) {
  const player = room.players.get(sessionToken);
  if (!player || player.status !== "admitted") {
    throw new Error("You are not admitted in this room");
  }
  return player;
}

function attachSocketToPlayer(room, sessionToken, ws) {
  const player = room.players.get(sessionToken);
  if (!player) {
    throw new Error("Player session not found");
  }

  player.socket = ws;
  ws.meta = {
    ...(ws.meta ?? {}),
    roomId: room.id,
    sessionToken
  };
}

async function handleCreateRoom(ws, payload) {
  const roomId = makeRoomId();
  const sessionToken = makeSessionToken();

  const createdAt = Date.now();
  const roomRecord = await store.createRoom({
    roomId,
    hostToken: sessionToken,
    createdAt
  });

  const room = {
    id: roomId,
    createdAt,
    expiresAt: new Date(roomRecord.expires_at).getTime(),
    hostSessionToken: sessionToken,
    status: "lobby",
    players: new Map(),
    matchState: null,
    lastBroadcastLogCount: 0
  };

  const host = {
    sessionToken,
    playerId: makePlayerId(),
    reconnectSecret: makeReconnectSecret(),
    name: normalizeName(payload.name, "Host"),
    avatarId: normalizeAvatarId(payload.avatarId),
    ready: false,
    status: "admitted",
    socket: ws
  };

  room.players.set(sessionToken, host);
  rooms.set(roomId, room);

  await ensurePlayerRecord(roomId, host);

  ws.meta = {
    ...(ws.meta ?? {}),
    roomId,
    sessionToken
  };

  send(ws, "playerStatus", {
    roomId,
    sessionToken,
    reconnectSecret: host.reconnectSecret,
    playerId: host.playerId,
    role: "host"
  });
  send(ws, "roomState", roomStateFor(room, sessionToken));
}

async function handleRequestJoin(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  if (room.status !== "lobby") {
    throw new Error("Game already started for this room");
  }

  const requestedSessionToken = isValidSessionToken(payload.sessionToken) ? payload.sessionToken : null;
  const reconnectSecret = isValidReconnectSecret(payload.reconnectSecret) ? payload.reconnectSecret : null;
  const existing = requestedSessionToken ? room.players.get(requestedSessionToken) : null;

  if (existing) {
    if (!reconnectSecret || reconnectSecret !== existing.reconnectSecret) {
      throw new Error("Invalid session credentials");
    }

    attachSocketToPlayer(room, existing.sessionToken, ws);
    await ensurePlayerRecord(room.id, existing);

    send(ws, "playerStatus", {
      roomId: room.id,
      sessionToken: existing.sessionToken,
      reconnectSecret: existing.reconnectSecret,
      playerId: existing.playerId,
      role: existing.sessionToken === room.hostSessionToken ? "host" : "guest",
      pending: existing.status === "pending"
    });

    if (existing.status === "admitted") {
      send(ws, "roomState", roomStateFor(room, existing.sessionToken));
    } else {
      send(ws, "prompt", { kind: "waitingForHostAdmission" });
    }
    broadcastRoomState(room);
    return;
  }

  const pending = {
    sessionToken: makeSessionToken(),
    playerId: makePlayerId(),
    reconnectSecret: makeReconnectSecret(),
    name: normalizeName(payload.name, "Guest"),
    avatarId: normalizeAvatarId(payload.avatarId),
    ready: false,
    status: "pending",
    socket: ws
  };

  room.players.set(pending.sessionToken, pending);
  ws.meta = {
    ...(ws.meta ?? {}),
    roomId: room.id,
    sessionToken: pending.sessionToken
  };
  await ensurePlayerRecord(room.id, pending);

  send(ws, "playerStatus", {
    roomId: room.id,
    sessionToken: pending.sessionToken,
    reconnectSecret: pending.reconnectSecret,
    playerId: pending.playerId,
    role: "guest",
    pending: true
  });
  send(ws, "prompt", { kind: "waitingForHostAdmission" });

  const host = room.players.get(room.hostSessionToken);
  if (host?.socket) {
    send(host.socket, "prompt", {
      kind: "joinRequest",
      roomId: room.id,
      playerId: pending.playerId,
      name: pending.name,
      avatarId: pending.avatarId
    });
  }

  broadcastRoomState(room);
}

async function handleReconnect(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  if (!isValidSessionToken(payload.sessionToken) || !isValidReconnectSecret(payload.reconnectSecret)) {
    throw new Error("Reconnect failed: invalid credentials");
  }

  const player = room.players.get(payload.sessionToken);
  if (!player) {
    throw new Error("Reconnect failed: session not found");
  }
  if (player.reconnectSecret !== payload.reconnectSecret) {
    throw new Error("Reconnect failed: invalid credentials");
  }

  attachSocketToPlayer(room, payload.sessionToken, ws);
  await ensurePlayerRecord(room.id, player);

  send(ws, "playerStatus", {
    roomId: room.id,
    sessionToken: payload.sessionToken,
    reconnectSecret: player.reconnectSecret,
    playerId: player.playerId,
    role: payload.sessionToken === room.hostSessionToken ? "host" : "guest",
    reconnected: true
  });

  if (room.matchState) {
    broadcastGameState(room);
  } else {
    send(ws, "roomState", roomStateFor(room, payload.sessionToken));
  }
}

async function handleHostAdmit(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);
  if (!isValidPlayerId(payload.playerId)) {
    throw new Error("Invalid player id");
  }

  const player = findPlayerByPlayerId(room, payload.playerId);
  if (!player || player.status !== "pending") {
    throw new Error("Join request not found");
  }

  player.status = "admitted";
  player.ready = false;
  await ensurePlayerRecord(room.id, player);

  if (player.socket) {
    send(player.socket, "prompt", { kind: "admitted", roomId: room.id });
    send(player.socket, "roomState", roomStateFor(room, player.sessionToken));
  }

  broadcastRoomState(room);
}

async function handleHostDeny(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);
  if (!isValidPlayerId(payload.playerId)) {
    throw new Error("Invalid player id");
  }

  const player = findPlayerByPlayerId(room, payload.playerId);
  if (!player || player.status !== "pending") {
    throw new Error("Join request not found");
  }

  if (player.socket) {
    send(player.socket, "error", { reason: "Host denied your join request" });
  }
  room.players.delete(player.sessionToken);
  broadcastRoomState(room);
}

async function handleSetProfile(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const sessionToken = ws.meta?.sessionToken;
  const player = room.players.get(sessionToken);
  if (!player) {
    throw new Error("Player not found in room");
  }

  if (typeof payload.name === "string") {
    player.name = normalizeName(payload.name, player.name);
  }
  if (typeof payload.avatarId === "string") {
    player.avatarId = normalizeAvatarId(payload.avatarId);
  }
  await ensurePlayerRecord(room.id, player);
  broadcastRoomState(room);
}

async function handleReadyUp(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const sessionToken = ws.meta?.sessionToken;
  const player = ensureAdmittedPlayer(room, sessionToken);

  player.ready = Boolean(payload.ready);
  await ensurePlayerRecord(room.id, player);
  broadcastRoomState(room);
}

function toCorePlayers(room) {
  return listReadyPlayers(room).map((player) => ({
    id: player.playerId,
    name: player.name,
    avatarId: player.avatarId,
    isHost: player.sessionToken === room.hostSessionToken
  }));
}

async function handleStartMatch(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);

  if (room.status !== "lobby") {
    throw new Error("Match already started");
  }

  const readyPlayers = toCorePlayers(room);
  if (readyPlayers.length < 2) {
    throw new Error("At least 2 ready players are required");
  }

  const hostPlayer = room.players.get(room.hostSessionToken);
  if (!hostPlayer) {
    throw new Error("Host player is missing");
  }

  room.matchState = createInitializedGameState({
    roomId: room.id,
    hostPlayerId: hostPlayer.playerId,
    players: readyPlayers,
    seed: payload.seed || room.id,
    now: Date.now()
  });
  room.status = "in_game";
  room.lastBroadcastLogCount = 0;

  await persistSnapshot(room);
  broadcastRoomState(room);
  broadcastGameState(room);
}

function getRoomAndActor(ws, payload) {
  const room = getRoom(requireRoomId(payload.roomId));
  const actorSession = ws.meta?.sessionToken;
  if (!actorSession) {
    throw new Error("Session missing");
  }

  const actor = ensureAdmittedPlayer(room, actorSession);
  if (!actor.playerId) {
    throw new Error("Actor identity missing");
  }
  if (!room.matchState) {
    throw new Error("Match has not started");
  }

  return { room, actorSession, actorPlayerId: actor.playerId };
}

async function handleGameAction(ws, type, payload) {
  const { room, actorSession, actorPlayerId } = getRoomAndActor(ws, payload);
  const state = room.matchState;
  const ts = Date.now();

  let sideEvent = null;

  if (type === "voteWinCondition") {
    castWinVote(state, actorPlayerId, payload.mode, ts);
  } else if (type === "rollDice") {
    rollDice(state, actorPlayerId, ts, Math.random);
  } else if (type === "buildTrail") {
    buildTrail(state, actorPlayerId, payload.edgeId, ts);
  } else if (type === "buildCottage") {
    buildCottage(state, actorPlayerId, payload.intersectionId, ts);
  } else if (type === "upgradeManor") {
    upgradeManor(state, actorPlayerId, payload.intersectionId, ts);
  } else if (type === "buyDevCard") {
    const card = buyDevCard(state, actorPlayerId, ts);
    const actor = room.players.get(actorSession);
    if (actor?.socket) {
      send(actor.socket, "prompt", {
        kind: "devCardReveal",
        cardType: card.type,
        cardId: card.id
      });
    }
  } else if (type === "playDevCard") {
    playDevCard(state, actorPlayerId, payload, ts);
  } else if (type === "proposeTrade") {
    const offer = proposeTrade(state, actorPlayerId, payload, ts);
    sideEvent = { type: "tradeOffer", payload: offer };
  } else if (type === "acceptTrade") {
    const offer = acceptTrade(state, actorPlayerId, payload.tradeId, ts);
    sideEvent = { type: "tradeResolved", payload: offer };
  } else if (type === "declineTrade") {
    const offer = declineTrade(state, actorPlayerId, payload.tradeId, ts);
    sideEvent = { type: "tradeResolved", payload: offer };
  } else if (type === "bankTrade") {
    bankTrade(state, actorPlayerId, payload, ts);
  } else if (type === "endTurn") {
    endTurn(state, actorPlayerId, ts);
  } else if (type === "chooseTimedWinner") {
    chooseTimedWinner(state, actorPlayerId, payload.winnerPlayerId, ts);
  } else {
    throw new Error(`Unknown game action: ${type}`);
  }

  maybeResolveVote(state, ts);
  checkTimedWin(state, ts);

  await persistSnapshot(room);
  broadcastGameState(room);

  if (sideEvent) {
    for (const player of room.players.values()) {
      if (player.status === "admitted" && player.socket) {
        send(player.socket, sideEvent.type, sideEvent.payload);
      }
    }
  }
}

async function handleIncoming(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_WS_MESSAGE_BYTES) {
    sendError(ws, "Message too large");
    ws.close(1009, "Message too large");
    return;
  }

  let message = null;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    sendError(ws, "Invalid JSON message");
    return;
  }

  const { type, payload = {} } = message;
  if (typeof type !== "string" || type.length > 64) {
    sendError(ws, "Invalid message type");
    return;
  }
  if (payload && (typeof payload !== "object" || Array.isArray(payload))) {
    sendError(ws, "Invalid payload");
    return;
  }

  try {
    if (type === "createRoom") {
      await handleCreateRoom(ws, payload);
      return;
    }

    if (type === "requestJoin") {
      await handleRequestJoin(ws, payload);
      return;
    }

    if (type === "reconnect") {
      await handleReconnect(ws, payload);
      return;
    }

    if (["hostAdmit", "hostDeny", "setProfile", "readyUp", "startMatch"].includes(type)) {
      if (type === "hostAdmit") await handleHostAdmit(ws, payload);
      if (type === "hostDeny") await handleHostDeny(ws, payload);
      if (type === "setProfile") await handleSetProfile(ws, payload);
      if (type === "readyUp") await handleReadyUp(ws, payload);
      if (type === "startMatch") await handleStartMatch(ws, payload);
      return;
    }

    await handleGameAction(ws, type, payload);
  } catch (error) {
    sendError(ws, error.message || "Action failed");
  }
}

function detachSocket(ws) {
  const roomId = ws.meta?.roomId;
  const sessionToken = ws.meta?.sessionToken;
  if (!roomId || !sessionToken) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const player = room.players.get(sessionToken);
  if (player && player.socket === ws) {
    player.socket = null;
  }
}

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }

  const socketIp = getSocketIp(req);
  if (!checkConnectionRateLimit(socketIp)) {
    ws.close(1013, "Too many connections");
    return;
  }

  ws.meta = {
    roomId: null,
    sessionToken: null,
    socketIp,
    messageRateWindowStart: Date.now(),
    messageRateCount: 0
  };

  send(ws, "playerStatus", { connected: true });

  ws.on("message", (raw) => {
    if (!checkMessageRateLimit(ws)) {
      sendError(ws, "Too many messages, slow down");
      return;
    }
    handleIncoming(ws, raw);
  });

  ws.on("close", () => {
    detachSocket(ws);
  });

  ws.on("error", () => {
    detachSocket(ws);
  });
});

setInterval(async () => {
  const now = Date.now();
  for (const [ip, entry] of connectionAttemptsByIp.entries()) {
    if (now - entry.windowStart > CONNECTION_RATE_WINDOW_MS * 2) {
      connectionAttemptsByIp.delete(ip);
    }
  }

  for (const room of rooms.values()) {
    if (roomExpired(room)) {
      for (const player of room.players.values()) {
        if (player.socket) {
          sendError(player.socket, "Room expired after 24 hours");
          player.socket.close();
        }
      }
      rooms.delete(room.id);
      continue;
    }

    if (room.matchState && room.status === "in_game") {
      const beforePhase = room.matchState.phase;
      const voteChanged = maybeResolveVote(room.matchState, now);
      const timedChanged = checkTimedWin(room.matchState, now);

      if (voteChanged || timedChanged || beforePhase !== room.matchState.phase) {
        await persistSnapshot(room);
        broadcastGameState(room);
      }
    }
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`Shorewood WS server running on port ${PORT}`);
});

process.on("SIGINT", async () => {
  await store.close();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await store.close();
  process.exit(0);
});
