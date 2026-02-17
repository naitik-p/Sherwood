import { Pool } from "pg";

const TABLES = Object.freeze({
  rooms: "shorewood_rooms",
  players: "shorewood_players",
  snapshots: "shorewood_match_snapshots"
});

const EXPECTED_COLUMNS = Object.freeze({
  [TABLES.rooms]: ["id", "host_token", "created_at", "expires_at"],
  [TABLES.players]: ["room_id", "session_token", "name", "avatar_id", "last_seen"],
  [TABLES.snapshots]: ["id", "room_id", "state_json", "created_at"]
});

export class RoomStore {
  constructor({
    databaseUrl = null,
    roomTtlHours = 24,
    snapshotLimit = 50,
    databaseSslRejectUnauthorized = null
  } = {}) {
    this.roomTtlHours = roomTtlHours;
    this.snapshotLimit = Math.max(1, Number(snapshotLimit) || 50);
    this.usePg = Boolean(databaseUrl);
    if (this.usePg) {
      const poolConfig = { connectionString: databaseUrl };
      try {
        const host = new URL(databaseUrl).hostname;
        const isSupabaseDirect = host.endsWith(".supabase.co");
        const isSupabasePooler = host.endsWith(".pooler.supabase.com");
        const shouldUseSsl = isSupabaseDirect || isSupabasePooler;

        if (shouldUseSsl || databaseSslRejectUnauthorized !== null) {
          poolConfig.ssl = {
            rejectUnauthorized:
              databaseSslRejectUnauthorized ?? (isSupabasePooler ? false : true)
          };
        }
      } catch {
        // Invalid URLs are surfaced by the PG client; skip URL-based SSL inference.
      }
      this.pool = new Pool(poolConfig);
    } else {
      this.pool = null;
    }

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
      create table if not exists ${TABLES.rooms} (
        id text primary key,
        host_token text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
    `);

    await this.pool.query(`
      create table if not exists ${TABLES.players} (
        room_id text not null,
        session_token text not null,
        name text,
        avatar_id text,
        last_seen timestamptz not null default now(),
        primary key (room_id, session_token),
        foreign key (room_id) references ${TABLES.rooms}(id) on delete cascade
      );
    `);

    await this.pool.query(`
      create table if not exists ${TABLES.snapshots} (
        id bigserial primary key,
        room_id text not null,
        state_json jsonb not null,
        created_at timestamptz not null default now(),
        foreign key (room_id) references ${TABLES.rooms}(id) on delete cascade
      );
    `);

    await this.pool.query(`
      create index if not exists ${TABLES.players}_room_idx on ${TABLES.players} (room_id);
    `);

    await this.pool.query(`
      create index if not exists ${TABLES.snapshots}_room_created_idx
      on ${TABLES.snapshots} (room_id, created_at desc);
    `);

    await this.validateSchema();
  }

  async validateSchema() {
    for (const [tableName, columns] of Object.entries(EXPECTED_COLUMNS)) {
      const { rows } = await this.pool.query(
        `
          select column_name
          from information_schema.columns
          where table_schema = current_schema() and table_name = $1
        `,
        [tableName]
      );

      const actual = new Set(rows.map((row) => row.column_name));
      for (const column of columns) {
        if (!actual.has(column)) {
          throw new Error(
            `Incompatible schema for ${tableName}: missing column "${column}". Run apps/server/sql/001_init.sql.`
          );
        }
      }
    }

    const { rows: fkRows } = await this.pool.query(
      `
        select kcu.column_name, ccu.table_name as foreign_table_name, ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
        where tc.table_schema = current_schema()
          and tc.table_name = $1
          and tc.constraint_type = 'FOREIGN KEY'
      `,
      [TABLES.players]
    );

    for (const fk of fkRows) {
      const valid =
        fk.column_name === "room_id" &&
        fk.foreign_table_name === TABLES.rooms &&
        fk.foreign_column_name === "id";
      if (!valid) {
        throw new Error(
          `Incompatible schema for ${TABLES.players}: unexpected foreign key on "${fk.column_name}" -> ${fk.foreign_table_name}.${fk.foreign_column_name}. This app does not use Supabase Auth profiles.`
        );
      }
    }
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
        `insert into ${TABLES.rooms} (id, host_token, created_at, expires_at) values ($1, $2, $3, $4)`,
        [room.id, room.host_token, room.created_at, room.expires_at]
      );
    } else {
      this.memory.rooms.set(roomId, room);
    }

    return room;
  }

  async getRoom(roomId) {
    if (this.usePg) {
      const { rows } = await this.pool.query(`select * from ${TABLES.rooms} where id = $1`, [roomId]);
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
          insert into ${TABLES.players} (room_id, session_token, name, avatar_id, last_seen)
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
      const { rows } = await this.pool.query(`select * from ${TABLES.players} where room_id = $1`, [roomId]);
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
      await this.pool.query(`insert into ${TABLES.snapshots} (room_id, state_json) values ($1, $2)`, [roomId, stateJson]);
      await this.pool.query(
        `
          delete from ${TABLES.snapshots}
          where room_id = $1
            and id not in (
              select id
              from ${TABLES.snapshots}
              where room_id = $1
              order by created_at desc, id desc
              limit $2
            )
        `,
        [roomId, this.snapshotLimit]
      );
      return;
    }

    const current = this.memory.snapshots.get(roomId) ?? [];
    current.push({ created_at: new Date().toISOString(), state_json: stateJson });
    this.memory.snapshots.set(roomId, current.slice(-this.snapshotLimit));
  }

  async latestSnapshot(roomId) {
    if (this.usePg) {
      const { rows } = await this.pool.query(
        `select state_json from ${TABLES.snapshots} where room_id = $1 order by created_at desc limit 1`,
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
