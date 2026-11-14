-- Run this once in Supabase: SQL Editor > New query > paste > Run
create table if not exists scores (
  name text primary key,
  kills int not null default 0,
  wins int not null default 0,
  games int not null default 0,
  updated_at timestamptz not null default now()
);

alter table scores enable row level security;

create or replace function add_score(p_name text, p_kills int, p_win boolean)
returns void language sql security definer set search_path = public as $$
  insert into scores (name, kills, wins, games)
  values (p_name, greatest(p_kills, 0), case when p_win then 1 else 0 end, 1)
  on conflict (name) do update set
    kills = scores.kills + excluded.kills,
    wins = scores.wins + excluded.wins,
    games = scores.games + 1,
    updated_at = now();
$$;

revoke execute on function add_score(text, int, boolean) from public, anon, authenticated;
