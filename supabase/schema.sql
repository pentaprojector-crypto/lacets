-- Lacets : schéma Supabase pour l'onglet Communauté.
-- À coller dans Supabase → SQL Editor → New query, puis « Run ».
-- Ensuite : Authentication → Sign In / Providers → activer « Allow anonymous sign-ins ».

-- Sorties proposées
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  meet_name text check (char_length(meet_name) <= 160),
  meet_lat double precision check (meet_lat between -90 and 90),
  meet_lon double precision check (meet_lon between -180 and 180),
  pace text check (pace in ('cool', 'dynamique', 'sportif')),
  route jsonb,                       -- tracé simplifié : [[lon, lat], ...] (600 points max)
  distance_km numeric(7, 1),
  gain_m integer
);

-- Participants (« Je participe »)
create table if not exists public.ride_participants (
  ride_id uuid not null references public.rides(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_name text not null check (char_length(user_name) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (ride_id, user_id)
);

-- Photos publiées
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  caption text check (char_length(caption) <= 200),
  photo_path text not null,
  lat double precision,
  lon double precision
);

-- Dangers signalés sur la route
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 40),
  kind text not null check (kind in ('gravillons', 'huile', 'glissant', 'nid', 'travaux', 'fermee', 'animaux', 'accident', 'autre')),
  note text check (char_length(note) <= 140),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  expires_at timestamptz not null check (expires_at <= now() + interval '8 days')
);

create index if not exists rides_starts_at_idx on public.rides (starts_at);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists alerts_expires_at_idx on public.alerts (expires_at);

-- Règles d'accès : tout utilisateur connecté (y compris anonyme) lit tout,
-- et ne peut créer, modifier ou supprimer que ce qu'il a publié.
alter table public.rides enable row level security;
alter table public.ride_participants enable row level security;
alter table public.posts enable row level security;
alter table public.alerts enable row level security;

drop policy if exists "lecture" on public.rides;
drop policy if exists "ajout" on public.rides;
drop policy if exists "modif" on public.rides;
drop policy if exists "suppression" on public.rides;
create policy "lecture" on public.rides for select to authenticated using (true);
create policy "ajout" on public.rides for insert to authenticated with check (author_id = auth.uid());
create policy "modif" on public.rides for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "suppression" on public.rides for delete to authenticated using (author_id = auth.uid());

drop policy if exists "lecture" on public.ride_participants;
drop policy if exists "ajout" on public.ride_participants;
drop policy if exists "modif" on public.ride_participants;
drop policy if exists "suppression" on public.ride_participants;
create policy "lecture" on public.ride_participants for select to authenticated using (true);
create policy "ajout" on public.ride_participants for insert to authenticated with check (user_id = auth.uid());
create policy "modif" on public.ride_participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "suppression" on public.ride_participants for delete to authenticated using (user_id = auth.uid());

drop policy if exists "lecture" on public.posts;
drop policy if exists "ajout" on public.posts;
drop policy if exists "suppression" on public.posts;
create policy "lecture" on public.posts for select to authenticated using (true);
create policy "ajout" on public.posts for insert to authenticated with check (author_id = auth.uid());
create policy "suppression" on public.posts for delete to authenticated using (author_id = auth.uid());

drop policy if exists "lecture" on public.alerts;
drop policy if exists "ajout" on public.alerts;
drop policy if exists "suppression" on public.alerts;
create policy "lecture" on public.alerts for select to authenticated using (true);
create policy "ajout" on public.alerts for insert to authenticated with check (author_id = auth.uid());
create policy "suppression" on public.alerts for delete to authenticated using (author_id = auth.uid());

-- Stockage des photos : dossier public « photos », chacun écrit dans son sous-dossier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "photos : ajout" on storage.objects;
drop policy if exists "photos : suppression" on storage.objects;
create policy "photos : ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos : suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
