create table if not exists shorewood_rooms (
  id text primary key,
  host_token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists shorewood_players (
  room_id text not null,
  session_token text not null,
  player_id text,
  reconnect_secret text,
  name text,
  avatar_id text,
  status text not null default 'pending',
  ready boolean not null default false,
  is_host boolean not null default false,
  last_seen timestamptz not null default now(),
  primary key (room_id, session_token),
  foreign key (room_id) references shorewood_rooms(id) on delete cascade
);

alter table shorewood_players add column if not exists player_id text;
alter table shorewood_players add column if not exists reconnect_secret text;
alter table shorewood_players add column if not exists status text not null default 'pending';
alter table shorewood_players add column if not exists ready boolean not null default false;
alter table shorewood_players add column if not exists is_host boolean not null default false;

create table if not exists shorewood_match_snapshots (
  id bigserial primary key,
  room_id text not null,
  state_json jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (room_id) references shorewood_rooms(id) on delete cascade
);

create index if not exists shorewood_players_room_idx on shorewood_players (room_id);
create unique index if not exists shorewood_players_room_player_idx
on shorewood_players (room_id, player_id)
where player_id is not null;
create index if not exists shorewood_match_snapshots_room_created_idx
on shorewood_match_snapshots (room_id, created_at desc);
