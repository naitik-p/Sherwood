import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

import { RoomStore } from "../src/db.js";
import { loadWorkspaceEnv } from "../src/load-env.js";

loadWorkspaceEnv(import.meta.url);

const ROOM_TTL_HOURS = Number(process.env.ROOM_TTL_HOURS ?? 24);
const SNAPSHOT_LIMIT = Number(process.env.SNAPSHOT_LIMIT ?? 50);
const DATABASE_SSL_REJECT_UNAUTHORIZED =
  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === undefined
    ? null
    : process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true";

function makeRoomId() {
  return `r_${randomBytes(4).toString("hex")}`;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeStore() {
  return new RoomStore({
    databaseUrl: process.env.DATABASE_URL,
    roomTtlHours: ROOM_TTL_HOURS,
    snapshotLimit: SNAPSHOT_LIMIT,
    databaseSslRejectUnauthorized: DATABASE_SSL_REJECT_UNAUTHORIZED
  });
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Configure it in .env before running this check.");
  process.exit(1);
}

const roomId = makeRoomId();
const hostSessionToken = makeSessionToken();
const guestSessionToken = makeSessionToken();
const hostPlayerId = makePlayerId();
const guestPlayerId = makePlayerId();
const hostReconnectSecret = makeReconnectSecret();
const guestReconnectSecret = makeReconnectSecret();

const summary = {
  mode: "postgres",
  roomId,
  checks: {
    connectivity: false,
    schema: false,
    writeRead: false,
    persistenceAcrossReconnect: false,
    cleanup: false
  },
  details: {}
};

let firstStore = null;
let secondStore = null;
try {
  firstStore = makeStore();
  await firstStore.init();
  summary.checks.connectivity = true;
  summary.checks.schema = true;

  await firstStore.createRoom({
    roomId,
    hostToken: hostSessionToken,
    createdAt: Date.now()
  });
  await firstStore.upsertPlayer({
    roomId,
    sessionToken: hostSessionToken,
    playerId: hostPlayerId,
    reconnectSecret: hostReconnectSecret,
    status: "admitted",
    ready: true,
    isHost: true,
    name: "Host Verify",
    avatarId: "badge_1",
    lastSeen: Date.now()
  });
  await firstStore.upsertPlayer({
    roomId,
    sessionToken: guestSessionToken,
    playerId: guestPlayerId,
    reconnectSecret: guestReconnectSecret,
    status: "admitted",
    ready: false,
    isHost: false,
    name: "Guest Verify",
    avatarId: "badge_2",
    lastSeen: Date.now()
  });

  const sampleSnapshot = {
    roomId,
    phase: "main",
    turn: {
      activePlayerId: hostPlayerId,
      rolled: true
    },
    log: [
      {
        at: Date.now(),
        type: "verification",
        message: "persistence smoke check"
      }
    ]
  };
  await firstStore.saveSnapshot({
    roomId,
    stateJson: sampleSnapshot
  });

  const room = await firstStore.getRoom(roomId);
  const players = await firstStore.listPlayers(roomId);
  const latestSnapshot = await firstStore.latestSnapshot(roomId);
  assert(room?.id === roomId, "Room readback failed.");
  assert(players.length >= 2, "Player rows were not written.");
  assert(latestSnapshot?.roomId === roomId, "Snapshot readback failed.");
  summary.checks.writeRead = true;

  summary.details.firstRead = {
    players: players.length,
    hasSnapshot: Boolean(latestSnapshot)
  };

  await firstStore.close();
  firstStore = null;

  secondStore = makeStore();
  await secondStore.init();
  const persistedRoom = await secondStore.getRoom(roomId);
  const persistedPlayers = await secondStore.listPlayers(roomId);
  const persistedSnapshot = await secondStore.latestSnapshot(roomId);
  assert(persistedRoom?.id === roomId, "Room was not persisted across process restart.");
  assert(
    persistedPlayers.some((player) => player.session_token === hostSessionToken && player.player_id === hostPlayerId),
    "Host player identity was not persisted."
  );
  assert(
    persistedPlayers.some(
      (player) => player.session_token === guestSessionToken && player.player_id === guestPlayerId && player.status === "admitted"
    ),
    "Guest player state was not persisted."
  );
  assert(persistedSnapshot?.roomId === roomId, "Snapshot was not persisted across process restart.");
  summary.checks.persistenceAcrossReconnect = true;
  summary.details.secondRead = {
    players: persistedPlayers.length,
    hasSnapshot: Boolean(persistedSnapshot)
  };

  await secondStore.deleteRoom(roomId);
  const deletedRoom = await secondStore.getRoom(roomId);
  assert(!deletedRoom, "Cleanup failed: test room still exists.");
  summary.checks.cleanup = true;

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  summary.error = {
    message: error?.message ?? String(error),
    code: error?.code ?? null
  };
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
} finally {
  if (firstStore) {
    try {
      await firstStore.deleteRoom(roomId);
    } catch {
      // ignore cleanup failures in finally
    }
    await firstStore.close();
  }
  if (secondStore) {
    try {
      await secondStore.deleteRoom(roomId);
    } catch {
      // ignore cleanup failures in finally
    }
    await secondStore.close();
  }
}
