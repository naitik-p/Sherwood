create table if not exists shorewood_rooms (
  id text primary key,
  host_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists shorewood_players (
  room_id text not null,
  session_token text not null,
  name text,
  avatar_id text,
  last_seen timestamptz not null default now(),
  primary key (room_id, session_token),
  foreign key (room_id) references shorewood_rooms(id) on delete cascade
);

create table if not exists shorewood_match_snapshots (
  id bigserial primary key,
  room_id text not null,
  state_json jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (room_id) references shorewood_rooms(id) on delete cascade
);

create index if not exists shorewood_players_room_idx on shorewood_players (room_id);
create index if not exists shorewood_match_snapshots_room_created_idx
on shorewood_match_snapshots (room_id, created_at desc);
