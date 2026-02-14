-- MarvelReview schema MVP (JS only app)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 30),
  media text not null check (char_length(media) between 2 and 60),
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  release_year int,
  poster_url text,
  synopsis text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  film_id uuid not null references public.films(id) on delete cascade,
  score int not null check (score >= 0 and score <= 10),
  review text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, film_id)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists trg_ratings_updated_at on public.ratings;
create trigger trg_ratings_updated_at
before update on public.ratings
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, media)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substring(new.id::text from 1 for 8)),
    coalesce(new.raw_user_meta_data ->> 'media', 'Media')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.films enable row level security;
alter table public.ratings enable row level security;

create policy "profiles_public_read"
on public.profiles
for select
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "films_public_read"
on public.films
for select
using (true);

create policy "ratings_public_read"
on public.ratings
for select
using (true);

create policy "ratings_insert_own"
on public.ratings
for insert
with check (auth.uid() = user_id);

create policy "ratings_update_own"
on public.ratings
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "ratings_delete_own"
on public.ratings
for delete
using (auth.uid() = user_id);

insert into public.films (title, release_year, poster_url, synopsis)
values
  ('Iron Man', 2008, 'https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg', 'Le film qui lance le MCU.'),
  ('The Avengers', 2012, 'https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg', 'Reunion des heros face a Loki.'),
  ('Guardians of the Galaxy', 2014, 'https://image.tmdb.org/t/p/w500/r7vmZjiyZw9rpJMQJdXpjgiCOk9.jpg', 'Une equipe improbable sauve la galaxie.')
on conflict do nothing;
