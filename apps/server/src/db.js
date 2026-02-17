import { Pool } from "pg";

export class RoomStore {
  constructor({ databaseUrl = null, roomTtlHours = 24 } = {}) {
    this.roomTtlHours = roomTtlHours;
    this.usePg = Boolean(databaseUrl);
    this.pool = this.usePg ? new Pool({ connectionString: databaseUrl }) : null;

    this.memory = {
      rooms: new Map(),
      players: new Map(),
      snapshots: new Map()
    };
  }

  async init() {
    if (!this.usePg) {
      return;
    }

    await this.pool.query(`
      create table if not exists rooms (
        id text primary key,
        host_token text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
    `);

    await this.pool.query(`
      create table if not exists players (
        room_id text not null,
        session_token text not null,
        name text,
        avatar_id text,
        last_seen timestamptz not null default now(),
        primary key (room_id, session_token)
      );
    `);

    await this.pool.query(`
      create table if not exists match_snapshots (
        id bigserial primary key,
        room_id text not null,
        state_json jsonb not null,
        created_at timestamptz not null default now()
      );
    `);
  }

  roomExpiresAt(createdAtMs = Date.now()) {
    return new Date(createdAtMs + this.roomTtlHours * 3600 * 1000).toISOString();
  }

  async createRoom({ roomId, hostToken, createdAt = Date.now() }) {
    const room = {
      id: roomId,
      host_token: hostToken,
      created_at: new Date(createdAt).toISOString(),
      expires_at: this.roomExpiresAt(createdAt)
    };

    if (this.usePg) {
      await this.pool.query(
        `insert into rooms (id, host_token, created_at, expires_at) values ($1, $2, $3, $4)`,
        [room.id, room.host_token, room.created_at, room.expires_at]
      );
    } else {
      this.memory.rooms.set(roomId, room);
    }

    return room;
  }

  async getRoom(roomId) {
    if (this.usePg) {
      const { rows } = await this.pool.query(`select * from rooms where id = $1`, [roomId]);
      return rows[0] ?? null;
    }
    return this.memory.rooms.get(roomId) ?? null;
  }

  async upsertPlayer({ roomId, sessionToken, name = null, avatarId = null, lastSeen = Date.now() }) {
    const record = {
      room_id: roomId,
      session_token: sessionToken,
      name,
      avatar_id: avatarId,
      last_seen: new Date(lastSeen).toISOString()
    };

    if (this.usePg) {
      await this.pool.query(
        `
          insert into players (room_id, session_token, name, avatar_id, last_seen)
          values ($1, $2, $3, $4, $5)
          on conflict (room_id, session_token)
          do update set name = excluded.name, avatar_id = excluded.avatar_id, last_seen = excluded.last_seen
        `,
        [record.room_id, record.session_token, record.name, record.avatar_id, record.last_seen]
      );
    } else {
      const key = `${roomId}:${sessionToken}`;
      this.memory.players.set(key, record);
    }

    return record;
  }

  async listPlayers(roomId) {
    if (this.usePg) {
      const { rows } = await this.pool.query(`select * from players where room_id = $1`, [roomId]);
      return rows;
    }

    const rows = [];
    for (const player of this.memory.players.values()) {
      if (player.room_id === roomId) {
        rows.push(player);
      }
    }
    return rows;
  }

  async saveSnapshot({ roomId, stateJson }) {
    if (this.usePg) {
      await this.pool.query(`insert into match_snapshots (room_id, state_json) values ($1, $2)`, [roomId, stateJson]);
      return;
    }

    const current = this.memory.snapshots.get(roomId) ?? [];
    current.push({ created_at: new Date().toISOString(), state_json: stateJson });
    this.memory.snapshots.set(roomId, current.slice(-10));
  }

  async latestSnapshot(roomId) {
    if (this.usePg) {
      const { rows } = await this.pool.query(
        `select state_json from match_snapshots where room_id = $1 order by created_at desc limit 1`,
        [roomId]
      );
      return rows[0]?.state_json ?? null;
    }

    const snapshots = this.memory.snapshots.get(roomId) ?? [];
    return snapshots.at(-1)?.state_json ?? null;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
