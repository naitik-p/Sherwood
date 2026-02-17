create table if not exists rooms (
  id text primary key,
  host_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists players (
  room_id text not null,
  session_token text not null,
  name text,
  avatar_id text,
  last_seen timestamptz not null default now(),
  primary key (room_id, session_token)
);

create table if not exists match_snapshots (
  id bigserial primary key,
  room_id text not null,
  state_json jsonb not null,
  created_at timestamptz not null default now()
);
