-- Als Nächstes – Datenbank einrichten
-- Bereits im Projekt „Serien-Watchlist“ eingerichtet. Nur für ein neues Projekt nötig:
-- Supabase → SQL Editor → New query → alles einfügen → Run

create table if not exists public.items (
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  media_type    text not null check (media_type in ('tv', 'movie')),
  tmdb_id       integer not null,
  title         text not null,
  poster_path   text,
  backdrop_path text,
  logo_path     text,
  status        text not null default 'planned' check (status in ('planned', 'watching', 'done', 'dropped')),
  position      double precision not null default 0,
  rating        smallint check (rating between 1 and 10),
  note          text,
  progress      jsonb not null default '{}'::jsonb,
  meta          jsonb not null default '{}'::jsonb,
  added_at      timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id)
);

create table if not exists public.settings (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  tmdb_key   text,
  updated_at timestamptz not null default now()
);

-- Jeder sieht und ändert nur seine eigenen Daten
alter table public.items    enable row level security;
alter table public.settings enable row level security;

drop policy if exists "eigene items" on public.items;
create policy "eigene items" on public.items
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "eigene settings" on public.settings;
create policy "eigene settings" on public.settings
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.items, public.settings from anon;
grant select, insert, update, delete on public.items, public.settings to authenticated;
