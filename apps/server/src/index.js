import "dotenv/config";

import cors from "cors";
import express from "express";
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
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? "*";
const ROOM_TTL_HOURS = Number(process.env.ROOM_TTL_HOURS ?? 24);
const DATABASE_SSL_REJECT_UNAUTHORIZED =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === undefined
    ? null
    : process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN === "*" ? true : CLIENT_ORIGIN }));
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

function makeRoomId() {
  return `r_${uuidv4().slice(0, 8)}`;
}

function makeSessionToken() {
  return `sess_${uuidv4()}`;
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
  return {
    roomId: room.id,
    status: room.status,
    expiresAt: new Date(room.expiresAt).toISOString(),
    hostSessionToken: room.hostSessionToken,
    players: [...room.players.values()]
      .filter((player) => player.status === "admitted")
      .map((player) => ({
        sessionToken: player.sessionToken,
        name: player.name,
        avatarId: player.avatarId,
        ready: player.ready,
        isHost: player.sessionToken === room.hostSessionToken
      })),
    pendingRequests: isHost
      ? [...room.players.values()]
          .filter((player) => player.status === "pending")
          .map((player) => ({ sessionToken: player.sessionToken, name: player.name, avatarId: player.avatarId }))
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

    const state = getPublicGameState(room.matchState, player.sessionToken);
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
    roomId: room.id,
    sessionToken
  };
}

async function handleCreateRoom(ws, payload) {
  const roomId = makeRoomId();
  const sessionToken = payload.sessionToken || makeSessionToken();

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
    name: payload.name || "Host",
    avatarId: payload.avatarId || "badge_1",
    ready: false,
    status: "admitted",
    socket: ws
  };

  room.players.set(sessionToken, host);
  rooms.set(roomId, room);

  await ensurePlayerRecord(roomId, host);

  ws.meta = { roomId, sessionToken };

  send(ws, "playerStatus", { roomId, sessionToken, role: "host" });
  send(ws, "roomState", roomStateFor(room, sessionToken));
}

async function handleRequestJoin(ws, payload) {
  const room = getRoom(payload.roomId);
  if (room.status !== "lobby") {
    throw new Error("Game already started for this room");
  }

  const sessionToken = payload.sessionToken || makeSessionToken();
  const existing = room.players.get(sessionToken);
  if (existing && existing.status === "admitted") {
    attachSocketToPlayer(room, sessionToken, ws);
    send(ws, "playerStatus", { roomId: room.id, sessionToken, role: sessionToken === room.hostSessionToken ? "host" : "guest" });
    send(ws, "roomState", roomStateFor(room, sessionToken));
    return;
  }

  const pending = {
    sessionToken,
    name: payload.name || "Guest",
    avatarId: payload.avatarId || "badge_1",
    ready: false,
    status: "pending",
    socket: ws
  };

  room.players.set(sessionToken, pending);
  ws.meta = { roomId: room.id, sessionToken };
  await ensurePlayerRecord(room.id, pending);

  send(ws, "playerStatus", { roomId: room.id, sessionToken, role: "guest", pending: true });
  send(ws, "prompt", { kind: "waitingForHostAdmission" });

  const host = room.players.get(room.hostSessionToken);
  if (host?.socket) {
    send(host.socket, "prompt", {
      kind: "joinRequest",
      roomId: room.id,
      sessionToken,
      name: pending.name,
      avatarId: pending.avatarId
    });
  }

  broadcastRoomState(room);
}

async function handleReconnect(ws, payload) {
  const room = getRoom(payload.roomId);
  const player = room.players.get(payload.sessionToken);
  if (!player) {
    throw new Error("Reconnect failed: session not found");
  }

  attachSocketToPlayer(room, payload.sessionToken, ws);
  await ensurePlayerRecord(room.id, player);

  send(ws, "playerStatus", {
    roomId: room.id,
    sessionToken: payload.sessionToken,
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
  const room = getRoom(payload.roomId);
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);

  const player = room.players.get(payload.sessionToken);
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
  const room = getRoom(payload.roomId);
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);

  const player = room.players.get(payload.sessionToken);
  if (!player || player.status !== "pending") {
    throw new Error("Join request not found");
  }

  if (player.socket) {
    send(player.socket, "error", { reason: "Host denied your join request" });
  }
  room.players.delete(payload.sessionToken);
  broadcastRoomState(room);
}

async function handleSetProfile(ws, payload) {
  const room = getRoom(payload.roomId);
  const sessionToken = ws.meta?.sessionToken;
  const player = room.players.get(sessionToken);
  if (!player) {
    throw new Error("Player not found in room");
  }

  player.name = payload.name || player.name;
  player.avatarId = payload.avatarId || player.avatarId;
  await ensurePlayerRecord(room.id, player);
  broadcastRoomState(room);
}

async function handleReadyUp(ws, payload) {
  const room = getRoom(payload.roomId);
  const sessionToken = ws.meta?.sessionToken;
  const player = ensureAdmittedPlayer(room, sessionToken);

  player.ready = Boolean(payload.ready);
  await ensurePlayerRecord(room.id, player);
  broadcastRoomState(room);
}

function toCorePlayers(room) {
  return listReadyPlayers(room).map((player) => ({
    id: player.sessionToken,
    name: player.name,
    avatarId: player.avatarId,
    isHost: player.sessionToken === room.hostSessionToken
  }));
}

async function handleStartMatch(ws, payload) {
  const room = getRoom(payload.roomId);
  const actorSession = ws.meta?.sessionToken;
  ensureHost(room, actorSession);

  if (room.status !== "lobby") {
    throw new Error("Match already started");
  }

  const readyPlayers = toCorePlayers(room);
  if (readyPlayers.length < 2) {
    throw new Error("At least 2 ready players are required");
  }

  room.matchState = createInitializedGameState({
    roomId: room.id,
    hostPlayerId: room.hostSessionToken,
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
  const room = getRoom(payload.roomId);
  const actorSession = ws.meta?.sessionToken;
  if (!actorSession) {
    throw new Error("Session missing");
  }

  ensureAdmittedPlayer(room, actorSession);
  if (!room.matchState) {
    throw new Error("Match has not started");
  }

  return { room, actorSession };
}

async function handleGameAction(ws, type, payload) {
  const { room, actorSession } = getRoomAndActor(ws, payload);
  const state = room.matchState;
  const ts = Date.now();

  let sideEvent = null;

  if (type === "voteWinCondition") {
    castWinVote(state, actorSession, payload.mode, ts);
  } else if (type === "rollDice") {
    rollDice(state, actorSession, ts, Math.random);
  } else if (type === "buildTrail") {
    buildTrail(state, actorSession, payload.edgeId, ts);
  } else if (type === "buildCottage") {
    buildCottage(state, actorSession, payload.intersectionId, ts);
  } else if (type === "upgradeManor") {
    upgradeManor(state, actorSession, payload.intersectionId, ts);
  } else if (type === "buyDevCard") {
    const card = buyDevCard(state, actorSession, ts);
    const actor = room.players.get(actorSession);
    if (actor?.socket) {
      send(actor.socket, "prompt", {
        kind: "devCardReveal",
        cardType: card.type,
        cardId: card.id
      });
    }
  } else if (type === "playDevCard") {
    playDevCard(state, actorSession, payload, ts);
  } else if (type === "proposeTrade") {
    const offer = proposeTrade(state, actorSession, payload, ts);
    sideEvent = { type: "tradeOffer", payload: offer };
  } else if (type === "acceptTrade") {
    const offer = acceptTrade(state, actorSession, payload.tradeId, ts);
    sideEvent = { type: "tradeResolved", payload: offer };
  } else if (type === "declineTrade") {
    const offer = declineTrade(state, actorSession, payload.tradeId, ts);
    sideEvent = { type: "tradeResolved", payload: offer };
  } else if (type === "bankTrade") {
    bankTrade(state, actorSession, payload, ts);
  } else if (type === "endTurn") {
    endTurn(state, actorSession, ts);
  } else if (type === "chooseTimedWinner") {
    chooseTimedWinner(state, actorSession, payload.winnerPlayerId, ts);
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
  let message = null;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    sendError(ws, "Invalid JSON message");
    return;
  }

  const { type, payload = {} } = message;

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

wss.on("connection", (ws) => {
  send(ws, "playerStatus", { connected: true });

  ws.on("message", (raw) => {
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
