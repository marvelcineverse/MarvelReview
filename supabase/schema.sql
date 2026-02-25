-- MarvelReview schema (admin + medias)
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 2 and 30),
  avatar_url text,
  is_admin boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles drop column if exists media;

create table if not exists public.media_outlets (
  id uuid primary key default gen_random_uuid(),
  admin_profile_id uuid references public.profiles(id) on delete set null,
  name text not null unique,
  twitter_url text,
  instagram_url text,
  youtube_url text,
  tiktok_url text,
  website_url text,
  avatar_url text,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.media_outlets alter column admin_profile_id drop not null;
alter table public.media_outlets add column if not exists tiktok_url text;
alter table public.media_outlets add column if not exists avatar_url text;

create table if not exists public.profile_media_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  media_id uuid not null references public.media_outlets(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  unique (profile_id, media_id)
);

alter table public.profile_media_memberships
  drop constraint if exists profile_media_memberships_profile_id_key;

alter table public.profile_media_memberships
  add constraint profile_media_memberships_profile_id_media_id_key
  unique (profile_id, media_id);

create table if not exists public.films (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique,
  franchise text not null default 'MCU',
  type text not null default 'Film',
  phase text,
  release_date date,
  poster_url text,
  synopsis text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.films add column if not exists slug text;
alter table public.films add column if not exists franchise text not null default 'MCU';
alter table public.films add column if not exists type text not null default 'Film';
alter table public.films add column if not exists phase text;
alter table public.films add column if not exists release_date date;
alter table public.films add column if not exists poster_url text;
alter table public.films add column if not exists synopsis text;

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  film_id uuid not null references public.films(id) on delete cascade,
  score numeric(4,2) not null check (score >= 0 and score <= 10 and mod((score * 100)::int, 25) = 0),
  review text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, film_id)
);

alter table public.ratings
  alter column score type numeric(4,2) using score::numeric;

alter table public.ratings drop constraint if exists ratings_score_check;
alter table public.ratings
  add constraint ratings_score_check
  check (score >= 0 and score <= 10 and mod((score * 100)::int, 25) = 0);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id and p.is_admin = true
  );
$$;

create or replace function public.admin_list_users()
returns table (
  user_id uuid,
  email text,
  username text
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Admin rights required';
  end if;

  return query
  select
    u.id::uuid as user_id,
    u.email::text as email,
    p.username::text as username
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.deleted_at is null
  order by u.created_at desc;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  media_outlet_text text;
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substring(new.id::text from 1 for 8))
  )
  on conflict (id) do nothing;

  media_outlet_text := new.raw_user_meta_data ->> 'media_outlet_id';

  if media_outlet_text is not null and media_outlet_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    insert into public.profile_media_memberships (profile_id, media_id, status)
    values (new.id, media_outlet_text::uuid, 'pending')
    on conflict (profile_id, media_id) do update
      set status = 'pending',
          decided_at = null,
          decided_by = null;
  end if;

  return new;
end;
$$;

create or replace function public.admin_create_user_account(
  p_email text,
  p_password text,
  p_username text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_user_id uuid := gen_random_uuid();
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Admin rights required';
  end if;

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    v_new_user_id,
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('username', p_username),
    now(),
    now()
  );

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    created_at,
    updated_at,
    last_sign_in_at
  )
  values (
    gen_random_uuid(),
    v_new_user_id,
    jsonb_build_object('sub', v_new_user_id::text, 'email', lower(trim(p_email))),
    'email',
    lower(trim(p_email)),
    now(),
    now(),
    now()
  );

  insert into public.profiles (id, username)
  values (v_new_user_id, p_username)
  on conflict (id) do nothing;

  return v_new_user_id;
end;
$$;

create or replace function public.admin_upsert_rating_for_user(
  p_user_id uuid,
  p_film_id uuid,
  p_score numeric,
  p_review text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Admin rights required';
  end if;

  insert into public.ratings (user_id, film_id, score, review)
  values (p_user_id, p_film_id, p_score, p_review)
  on conflict (user_id, film_id)
  do update set
    score = excluded.score,
    review = excluded.review,
    updated_at = timezone('utc', now());
end;
$$;

create or replace function public.admin_decide_media_membership(
  p_membership_id uuid,
  p_approved boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.profile_media_memberships%rowtype;
begin
  select * into v_row
  from public.profile_media_memberships
  where id = p_membership_id;

  if not found then
    raise exception 'Membership not found';
  end if;

  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.is_admin(auth.uid())
    or exists (
      select 1
      from public.media_outlets m
      where m.id = v_row.media_id and m.admin_profile_id = auth.uid()
    )
  ) then
    raise exception 'Only admin or media manager can validate this membership';
  end if;

  update public.profile_media_memberships
  set status = case when p_approved then 'approved' else 'rejected' end,
      decided_at = timezone('utc', now()),
      decided_by = auth.uid()
  where id = p_membership_id;
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

drop trigger if exists trg_media_outlets_updated_at on public.media_outlets;
create trigger trg_media_outlets_updated_at
before update on public.media_outlets
for each row
execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.media_outlets enable row level security;
alter table public.profile_media_memberships enable row level security;
alter table public.films enable row level security;
alter table public.ratings enable row level security;

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
on public.profiles
for select
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
on public.profiles
for update
using (auth.uid() = id or public.is_admin(auth.uid()))
with check (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "media_public_read" on public.media_outlets;
create policy "media_public_read"
on public.media_outlets
for select
using (true);

drop policy if exists "media_admin_insert" on public.media_outlets;
create policy "media_admin_insert"
on public.media_outlets
for insert
with check (public.is_admin(auth.uid()));

drop policy if exists "media_admin_update" on public.media_outlets;
create policy "media_admin_update"
on public.media_outlets
for update
using (
  public.is_admin(auth.uid())
  or admin_profile_id = auth.uid()
)
with check (
  public.is_admin(auth.uid())
  or admin_profile_id = auth.uid()
);

drop policy if exists "media_admin_delete" on public.media_outlets;
create policy "media_admin_delete"
on public.media_outlets
for delete
using (public.is_admin(auth.uid()));

drop policy if exists "memberships_public_read" on public.profile_media_memberships;
create policy "memberships_public_read"
on public.profile_media_memberships
for select
using (
  public.is_admin(auth.uid())
  or
  status = 'approved'
  or auth.uid() = profile_id
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
);

drop policy if exists "memberships_insert_own" on public.profile_media_memberships;
create policy "memberships_insert_own"
on public.profile_media_memberships
for insert
with check (auth.uid() = profile_id and status = 'pending');

drop policy if exists "memberships_insert_admin_or_media_admin" on public.profile_media_memberships;
create policy "memberships_insert_admin_or_media_admin"
on public.profile_media_memberships
for insert
with check (
  public.is_admin(auth.uid())
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
);

drop policy if exists "memberships_update_owner_or_media_admin" on public.profile_media_memberships;
create policy "memberships_update_owner_or_media_admin"
on public.profile_media_memberships
for update
using (
  public.is_admin(auth.uid())
  or
  auth.uid() = profile_id
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
)
with check (
  public.is_admin(auth.uid())
  or
  auth.uid() = profile_id
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
);

drop policy if exists "memberships_delete_admin_or_media_admin" on public.profile_media_memberships;
create policy "memberships_delete_admin_or_media_admin"
on public.profile_media_memberships
for delete
using (
  public.is_admin(auth.uid())
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
);

drop policy if exists "films_public_read" on public.films;
create policy "films_public_read"
on public.films
for select
using (true);

drop policy if exists "films_admin_insert" on public.films;
create policy "films_admin_insert"
on public.films
for insert
with check (public.is_admin(auth.uid()));

drop policy if exists "films_admin_update" on public.films;
create policy "films_admin_update"
on public.films
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "films_admin_delete" on public.films;
create policy "films_admin_delete"
on public.films
for delete
using (public.is_admin(auth.uid()));

drop policy if exists "ratings_public_read" on public.ratings;
create policy "ratings_public_read"
on public.ratings
for select
using (true);

drop policy if exists "ratings_insert_own_or_admin" on public.ratings;
create policy "ratings_insert_own_or_admin"
on public.ratings
for insert
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "ratings_update_own_or_admin" on public.ratings;
create policy "ratings_update_own_or_admin"
on public.ratings
for update
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "ratings_delete_own_or_admin" on public.ratings;
create policy "ratings_delete_own_or_admin"
on public.ratings
for delete
using (auth.uid() = user_id or public.is_admin(auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-avatars',
  'media-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media_avatars_public_read" on storage.objects;
create policy "media_avatars_public_read"
on storage.objects
for select
using (bucket_id = 'media-avatars');

drop policy if exists "media_avatars_user_insert" on storage.objects;
create policy "media_avatars_user_insert"
on storage.objects
for insert
with check (
  bucket_id = 'media-avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "media_avatars_user_update" on storage.objects;
create policy "media_avatars_user_update"
on storage.objects
for update
using (
  bucket_id = 'media-avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'media-avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "media_avatars_user_delete" on storage.objects;
create policy "media_avatars_user_delete"
on storage.objects
for delete
using (
  bucket_id = 'media-avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

insert into public.films (title, release_date, poster_url, synopsis)
values
  ('Iron Man', '2008-05-02', 'https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg', 'Le film qui lance le MCU.'),
  ('The Avengers', '2012-05-04', 'https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg', 'Reunion des heros face a Loki.'),
  ('Guardians of the Galaxy', '2014-08-01', 'https://image.tmdb.org/t/p/w500/r7vmZjiyZw9rpJMQJdXpjgiCOk9.jpg', 'Une equipe improbable sauve la galaxie.')
on conflict do nothing;

-- Series / saisons / episodes
create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text unique,
  synopsis text,
  poster_url text,
  start_date date,
  end_date date,
  franchise text not null default 'MCU',
  type text not null default 'Serie',
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.series add column if not exists slug text;
alter table public.series add column if not exists synopsis text;
alter table public.series add column if not exists poster_url text;
alter table public.series add column if not exists start_date date;
alter table public.series add column if not exists end_date date;
alter table public.series add column if not exists franchise text not null default 'MCU';
alter table public.series add column if not exists type text not null default 'Serie';

create table if not exists public.series_seasons (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  name text not null,
  season_number int not null check (season_number > 0),
  slug text unique,
  poster_url text,
  start_date date,
  end_date date,
  phase text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (series_id, season_number)
);

alter table public.series_seasons add column if not exists slug text;
alter table public.series_seasons add column if not exists poster_url text;
alter table public.series_seasons add column if not exists start_date date;
alter table public.series_seasons add column if not exists end_date date;
alter table public.series_seasons add column if not exists phase text;

create table if not exists public.series_episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.series_seasons(id) on delete cascade,
  episode_number int not null check (episode_number > 0),
  title text not null,
  air_date date,
  created_at timestamptz not null default timezone('utc', now()),
  unique (season_id, episode_number)
);

create table if not exists public.episode_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  episode_id uuid not null references public.series_episodes(id) on delete cascade,
  score numeric(4,2) not null check (score >= 0 and score <= 10 and mod((score * 100)::int, 25) = 0),
  review text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, episode_id)
);

alter table public.episode_ratings
  alter column score type numeric(4,2) using score::numeric;

alter table public.episode_ratings drop constraint if exists episode_ratings_score_check;
alter table public.episode_ratings
  add constraint episode_ratings_score_check
  check (score >= 0 and score <= 10 and mod((score * 100)::int, 25) = 0);

create table if not exists public.season_user_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_id uuid not null references public.series_seasons(id) on delete cascade,
  manual_score numeric(4,2),
  adjustment numeric(4,2) not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, season_id)
);

alter table public.season_user_ratings
  alter column manual_score type numeric(4,2) using manual_score::numeric;
alter table public.season_user_ratings
  alter column adjustment type numeric(4,2) using adjustment::numeric;

alter table public.season_user_ratings drop constraint if exists season_user_ratings_manual_score_check;
alter table public.season_user_ratings
  add constraint season_user_ratings_manual_score_check
  check (
    manual_score is null
    or (manual_score >= 0 and manual_score <= 10 and mod((manual_score * 100)::int, 25) = 0)
  );

alter table public.season_user_ratings drop constraint if exists season_user_ratings_adjustment_check;
alter table public.season_user_ratings
  add constraint season_user_ratings_adjustment_check
  check (
    adjustment >= -2
    and adjustment <= 2
  );

drop trigger if exists trg_episode_ratings_updated_at on public.episode_ratings;
create trigger trg_episode_ratings_updated_at
before update on public.episode_ratings
for each row
execute function public.set_updated_at();

drop trigger if exists trg_season_user_ratings_updated_at on public.season_user_ratings;
create trigger trg_season_user_ratings_updated_at
before update on public.season_user_ratings
for each row
execute function public.set_updated_at();

alter table public.series enable row level security;
alter table public.series_seasons enable row level security;
alter table public.series_episodes enable row level security;
alter table public.episode_ratings enable row level security;
alter table public.season_user_ratings enable row level security;

drop policy if exists "series_public_read" on public.series;
create policy "series_public_read"
on public.series
for select
using (true);

drop policy if exists "series_admin_insert" on public.series;
create policy "series_admin_insert"
on public.series
for insert
with check (public.is_admin(auth.uid()));

drop policy if exists "series_admin_update" on public.series;
create policy "series_admin_update"
on public.series
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "series_admin_delete" on public.series;
create policy "series_admin_delete"
on public.series
for delete
using (public.is_admin(auth.uid()));

drop policy if exists "series_seasons_public_read" on public.series_seasons;
create policy "series_seasons_public_read"
on public.series_seasons
for select
using (true);

drop policy if exists "series_seasons_admin_insert" on public.series_seasons;
create policy "series_seasons_admin_insert"
on public.series_seasons
for insert
with check (public.is_admin(auth.uid()));

drop policy if exists "series_seasons_admin_update" on public.series_seasons;
create policy "series_seasons_admin_update"
on public.series_seasons
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "series_seasons_admin_delete" on public.series_seasons;
create policy "series_seasons_admin_delete"
on public.series_seasons
for delete
using (public.is_admin(auth.uid()));

drop policy if exists "series_episodes_public_read" on public.series_episodes;
create policy "series_episodes_public_read"
on public.series_episodes
for select
using (true);

drop policy if exists "series_episodes_admin_insert" on public.series_episodes;
create policy "series_episodes_admin_insert"
on public.series_episodes
for insert
with check (public.is_admin(auth.uid()));

drop policy if exists "series_episodes_admin_update" on public.series_episodes;
create policy "series_episodes_admin_update"
on public.series_episodes
for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "series_episodes_admin_delete" on public.series_episodes;
create policy "series_episodes_admin_delete"
on public.series_episodes
for delete
using (public.is_admin(auth.uid()));

drop policy if exists "episode_ratings_public_read" on public.episode_ratings;
create policy "episode_ratings_public_read"
on public.episode_ratings
for select
using (true);

drop policy if exists "episode_ratings_insert_own_or_admin" on public.episode_ratings;
create policy "episode_ratings_insert_own_or_admin"
on public.episode_ratings
for insert
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "episode_ratings_update_own_or_admin" on public.episode_ratings;
create policy "episode_ratings_update_own_or_admin"
on public.episode_ratings
for update
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "episode_ratings_delete_own_or_admin" on public.episode_ratings;
create policy "episode_ratings_delete_own_or_admin"
on public.episode_ratings
for delete
using (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "season_user_ratings_public_read" on public.season_user_ratings;
create policy "season_user_ratings_public_read"
on public.season_user_ratings
for select
using (true);

drop policy if exists "season_user_ratings_insert_own_or_admin" on public.season_user_ratings;
create policy "season_user_ratings_insert_own_or_admin"
on public.season_user_ratings
for insert
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "season_user_ratings_update_own_or_admin" on public.season_user_ratings;
create policy "season_user_ratings_update_own_or_admin"
on public.season_user_ratings
for update
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "season_user_ratings_delete_own_or_admin" on public.season_user_ratings;
create policy "season_user_ratings_delete_own_or_admin"
on public.season_user_ratings
for delete
using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- Jeu de donnees de test: Loki
with upsert_loki as (
  insert into public.series (
    title,
    slug,
    synopsis,
    poster_url,
    start_date,
    end_date,
    franchise,
    type
  )
  values (
    'Loki',
    'loki',
    'Le Dieu de la Malice se retrouve pris dans les rouages du TVA.',
    'https://image.tmdb.org/t/p/w500/voHUmluYmKyleFkTu3lOXQG702u.jpg',
    '2021-06-09',
    '2023-11-09',
    'MCU',
    'Serie'
  )
  on conflict (slug) do update
    set
      title = excluded.title,
      synopsis = excluded.synopsis,
      poster_url = excluded.poster_url,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      franchise = excluded.franchise,
      type = excluded.type
  returning id
),
upsert_s1 as (
  insert into public.series_seasons (
    series_id,
    name,
    season_number,
    slug,
    poster_url,
    start_date,
    end_date,
    phase
  )
  select
    id,
    'Saison 1',
    1,
    'loki-saison-1',
    'https://image.tmdb.org/t/p/w500/voHUmluYmKyleFkTu3lOXQG702u.jpg',
    '2021-06-09',
    '2021-07-14',
    'Phase 4'
  from upsert_loki
  on conflict (series_id, season_number) do update
    set
      name = excluded.name,
      slug = excluded.slug,
      poster_url = excluded.poster_url,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      phase = excluded.phase
  returning id
),
upsert_s2 as (
  insert into public.series_seasons (
    series_id,
    name,
    season_number,
    slug,
    poster_url,
    start_date,
    end_date,
    phase
  )
  select
    id,
    'Saison 2',
    2,
    'loki-saison-2',
    'https://image.tmdb.org/t/p/w500/kEl2t3OhXc3Zb9FBh1AuYzRTgZp.jpg',
    '2023-10-06',
    '2023-11-09',
    'Phase 5'
  from upsert_loki
  on conflict (series_id, season_number) do update
    set
      name = excluded.name,
      slug = excluded.slug,
      poster_url = excluded.poster_url,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      phase = excluded.phase
  returning id
)
insert into public.series_episodes (season_id, episode_number, title, air_date)
select
  season_id,
  episode_number,
  title,
  air_date
from (
  select (select id from upsert_s1) as season_id, 1 as episode_number, 'Un destin exceptionnel' as title, '2021-06-09'::date as air_date
  union all select (select id from upsert_s1), 2, 'Le Variant', '2021-06-16'::date
  union all select (select id from upsert_s1), 3, 'Lamentis', '2021-06-23'::date
  union all select (select id from upsert_s1), 4, 'Le Nexus', '2021-06-30'::date
  union all select (select id from upsert_s1), 5, 'Voyage vers le mystere', '2021-07-07'::date
  union all select (select id from upsert_s1), 6, 'Pour toujours. A jamais.', '2021-07-14'::date
  union all select (select id from upsert_s2), 1, 'Ouroboros', '2023-10-06'::date
  union all select (select id from upsert_s2), 2, 'Brad Fer', '2023-10-13'::date
  union all select (select id from upsert_s2), 3, '1893', '2023-10-20'::date
  union all select (select id from upsert_s2), 4, 'Le coeur du TVA', '2023-10-27'::date
  union all select (select id from upsert_s2), 5, 'Science/Fiction', '2023-11-03'::date
  union all select (select id from upsert_s2), 6, 'Glorieux destin', '2023-11-09'::date
) as loki_episodes
on conflict (season_id, episode_number) do update
  set
    title = excluded.title,
    air_date = excluded.air_date;

-- Reviews series/saisons
alter table public.season_user_ratings
  add column if not exists review text;

create table if not exists public.series_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  review text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, series_id)
);

drop trigger if exists trg_series_reviews_updated_at on public.series_reviews;
create trigger trg_series_reviews_updated_at
before update on public.series_reviews
for each row
execute function public.set_updated_at();

alter table public.series_reviews enable row level security;

drop policy if exists "series_reviews_public_read" on public.series_reviews;
create policy "series_reviews_public_read"
on public.series_reviews
for select
using (true);

drop policy if exists "series_reviews_insert_own_or_admin" on public.series_reviews;
create policy "series_reviews_insert_own_or_admin"
on public.series_reviews
for insert
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "series_reviews_update_own_or_admin" on public.series_reviews;
create policy "series_reviews_update_own_or_admin"
on public.series_reviews
for update
using (auth.uid() = user_id or public.is_admin(auth.uid()))
with check (auth.uid() = user_id or public.is_admin(auth.uid()));

drop policy if exists "series_reviews_delete_own_or_admin" on public.series_reviews;
create policy "series_reviews_delete_own_or_admin"
on public.series_reviews
for delete
using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- Public read-only API (RPC) for external display use-cases
drop function if exists public.api_film_summary(text);

create or replace function public.api_film_score(
  p_film_ref text,
  p_scope text default 'global',
  p_scope_value text default null
)
returns table (
  film_id uuid,
  film_title text,
  film_slug text,
  scope text,
  scope_value text,
  rating_count bigint,
  average numeric
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_film_ref, '')) as film_ref,
      lower(trim(coalesce(p_scope, 'global'))) as scope_kind,
      nullif(trim(coalesce(p_scope_value, '')), '') as scope_ref
  ),
  target_film as (
    select f.*
    from public.films f
    cross join input_params p
    where
      p.film_ref <> ''
      and (
        (p.film_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id = p.film_ref::uuid)
        or lower(coalesce(f.slug, '')) = lower(p.film_ref)
        or lower(f.title) = lower(p.film_ref)
      )
    order by
      case
        when lower(coalesce(f.slug, '')) = lower(p.film_ref) then 0
        when lower(f.title) = lower(p.film_ref) then 1
        else 2
      end
    limit 1
  ),
  scoped_user_ids as (
    select distinct pm.profile_id as user_id
    from input_params p
    join public.profile_media_memberships pm
      on p.scope_kind = 'media'
      and pm.status = 'approved'
    join public.media_outlets mo
      on mo.id = pm.media_id
    where
      p.scope_ref is not null
      and (
        lower(mo.name) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and mo.id = p.scope_ref::uuid)
      )
    union
    select distinct pr.id as user_id
    from input_params p
    join public.profiles pr
      on p.scope_kind = 'user'
    where
      p.scope_ref is not null
      and (
        lower(pr.username) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pr.id = p.scope_ref::uuid)
      )
  ),
  scoped_ratings as (
    select r.*
    from target_film tf
    join public.ratings r
      on r.film_id = tf.id
    cross join input_params p
    where
      p.scope_kind = 'global'
      or r.user_id in (select su.user_id from scoped_user_ids su)
  )
  select
    tf.id as film_id,
    tf.title as film_title,
    tf.slug as film_slug,
    p.scope_kind as scope,
    p.scope_ref as scope_value,
    count(sr.id)::bigint as rating_count,
    case when count(sr.id) > 0 then avg(sr.score)::numeric else null end as average
  from target_film tf
  cross join input_params p
  left join scoped_ratings sr
    on true
  where p.scope_kind in ('global', 'media', 'user')
  group by tf.id, tf.title, tf.slug, p.scope_kind, p.scope_ref;
$$;

create or replace function public.api_film_reviews(
  p_film_ref text,
  p_scope text default 'global',
  p_scope_value text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  film_id uuid,
  film_title text,
  film_slug text,
  user_id uuid,
  username text,
  user_media text,
  score numeric,
  review text,
  rated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_film_ref, '')) as film_ref,
      lower(trim(coalesce(p_scope, 'global'))) as scope_kind,
      nullif(trim(coalesce(p_scope_value, '')), '') as scope_ref,
      greatest(coalesce(p_limit, 100), 0) as row_limit,
      greatest(coalesce(p_offset, 0), 0) as row_offset
  ),
  target_film as (
    select f.*
    from public.films f
    cross join input_params p
    where
      p.film_ref <> ''
      and (
        (p.film_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id = p.film_ref::uuid)
        or lower(coalesce(f.slug, '')) = lower(p.film_ref)
        or lower(f.title) = lower(p.film_ref)
      )
    order by
      case
        when lower(coalesce(f.slug, '')) = lower(p.film_ref) then 0
        when lower(f.title) = lower(p.film_ref) then 1
        else 2
      end
    limit 1
  ),
  scoped_user_ids as (
    select distinct pm.profile_id as user_id
    from input_params p
    join public.profile_media_memberships pm
      on p.scope_kind = 'media'
      and pm.status = 'approved'
    join public.media_outlets mo
      on mo.id = pm.media_id
    where
      p.scope_ref is not null
      and (
        lower(mo.name) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and mo.id = p.scope_ref::uuid)
      )
    union
    select distinct pr.id as user_id
    from input_params p
    join public.profiles pr
      on p.scope_kind = 'user'
    where
      p.scope_ref is not null
      and (
        lower(pr.username) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pr.id = p.scope_ref::uuid)
      )
  )
  select
    tf.id as film_id,
    tf.title as film_title,
    tf.slug as film_slug,
    r.user_id,
    coalesce(pr.username, 'Utilisateur') as username,
    um.user_media,
    r.score::numeric as score,
    coalesce(r.review, '') as review,
    coalesce(r.updated_at, r.created_at) as rated_at
  from target_film tf
  join public.ratings r
    on r.film_id = tf.id
  join input_params p
    on p.scope_kind in ('global', 'media', 'user')
  left join public.profiles pr
    on pr.id = r.user_id
  left join lateral (
    select string_agg(mo.name, ', ' order by mo.name) as user_media
    from public.profile_media_memberships pm
    join public.media_outlets mo
      on mo.id = pm.media_id
    where pm.profile_id = r.user_id and pm.status = 'approved'
  ) um on true
  where
    p.scope_kind = 'global'
    or r.user_id in (select su.user_id from scoped_user_ids su)
  order by coalesce(r.updated_at, r.created_at) desc, r.id desc
  limit (select row_limit from input_params)
  offset (select row_offset from input_params);
$$;

create or replace function public.api_film_rank_in_franchise(
  p_film_ref text,
  p_mode text default 'all'
)
returns table (
  film_id uuid,
  film_title text,
  film_slug text,
  franchise text,
  type text,
  mode text,
  rating_count bigint,
  average numeric,
  rank_position bigint,
  ranked_items_count bigint,
  total_items_count bigint
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_film_ref, '')) as film_ref,
      lower(trim(coalesce(p_mode, 'all'))) as rank_mode
  ),
  target_film as (
    select f.*
    from public.films f
    cross join input_params p
    where
      p.film_ref <> ''
      and (
        (p.film_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id = p.film_ref::uuid)
        or lower(coalesce(f.slug, '')) = lower(p.film_ref)
        or lower(f.title) = lower(p.film_ref)
      )
    order by
      case
        when lower(coalesce(f.slug, '')) = lower(p.film_ref) then 0
        when lower(f.title) = lower(p.film_ref) then 1
        else 2
      end
    limit 1
  ),
  peers as (
    select f.id, f.title, f.slug, f.franchise, f.type
    from public.films f
    join target_film tf
      on tf.franchise = f.franchise
    cross join input_params p
    where
      p.rank_mode = 'all'
      or (
        p.rank_mode = 'films_only'
        and not (
          trim(regexp_replace(lower(replace(coalesce(f.type, ''), 'é', 'e')), '\s+', ' ', 'g'))
            ~ '(^| )serie(s)?( |$)'
        )
      )
  ),
  peer_scores as (
    select
      p.id,
      p.title,
      p.slug,
      p.franchise,
      p.type,
      count(r.id)::bigint as rating_count,
      case when count(r.id) > 0 then avg(r.score)::numeric else null end as average
    from peers p
    left join public.ratings r
      on r.film_id = p.id
    group by p.id, p.title, p.slug, p.franchise, p.type
  ),
  ranked as (
    select
      ps.*,
      case
        when ps.average is null then null::bigint
        else dense_rank() over (order by round(ps.average::numeric, 2) desc nulls last)::bigint
      end as rank_position,
      count(*) filter (where ps.average is not null) over ()::bigint as ranked_items_count,
      count(*) over ()::bigint as total_items_count
    from peer_scores ps
  )
  select
    r.id as film_id,
    r.title as film_title,
    r.slug as film_slug,
    r.franchise,
    r.type,
    p.rank_mode as mode,
    r.rating_count,
    r.average,
    r.rank_position,
    r.ranked_items_count,
    r.total_items_count
  from ranked r
  join target_film tf
    on tf.id = r.id
  cross join input_params p
  where p.rank_mode in ('all', 'films_only');
$$;

create or replace function public.api_film_rank_in_franchise_all_content(
  p_film_ref text
)
returns table (
  film_id uuid,
  film_title text,
  film_slug text,
  franchise text,
  mode text,
  rating_count bigint,
  average numeric,
  rank_position bigint,
  ranked_items_count bigint,
  total_items_count bigint
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select trim(coalesce(p_film_ref, '')) as film_ref
  ),
  target_film as (
    select f.*
    from public.films f
    cross join input_params p
    where
      p.film_ref <> ''
      and (
        (p.film_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and f.id = p.film_ref::uuid)
        or lower(coalesce(f.slug, '')) = lower(p.film_ref)
        or lower(f.title) = lower(p.film_ref)
      )
    order by
      case
        when lower(coalesce(f.slug, '')) = lower(p.film_ref) then 0
        when lower(f.title) = lower(p.film_ref) then 1
        else 2
      end
    limit 1
  ),
  film_peers as (
    select f.id, f.title, f.slug, f.franchise
    from public.films f
    join target_film tf
      on tf.franchise = f.franchise
  ),
  film_scores as (
    select
      fp.id as content_id,
      fp.title as content_title,
      fp.slug as content_slug,
      fp.franchise,
      'film'::text as content_kind,
      count(r.id)::bigint as rating_count,
      case when count(r.id) > 0 then avg(r.score)::numeric else null end as average
    from film_peers fp
    left join public.ratings r
      on r.film_id = fp.id
    group by fp.id, fp.title, fp.slug, fp.franchise
  ),
  series_peers as (
    select s.id, s.title, s.slug, s.franchise
    from public.series s
    join target_film tf
      on tf.franchise = s.franchise
  ),
  series_total_seasons as (
    select
      sp.id as series_id,
      count(ss.id)::integer as total_seasons
    from series_peers sp
    left join public.series_seasons ss
      on ss.series_id = sp.id
    group by sp.id
  ),
  series_season_episode_counts as (
    select
      ss.id as season_id,
      ss.series_id,
      count(ep.id)::integer as episode_count
    from public.series_seasons ss
    join series_peers sp
      on sp.id = ss.series_id
    left join public.series_episodes ep
      on ep.season_id = ss.id
    group by ss.id, ss.series_id
  ),
  series_season_episode_user_stats as (
    select
      ss.series_id,
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average
    from public.series_episodes ep
    join public.episode_ratings er
      on er.episode_id = ep.id
    join public.series_seasons ss
      on ss.id = ep.season_id
    join series_peers sp
      on sp.id = ss.series_id
    group by ss.series_id, ep.season_id, er.user_id
  ),
  series_season_user_rows as (
    select
      ss.series_id,
      sur.season_id,
      sur.user_id,
      sur.manual_score,
      sur.adjustment
    from public.season_user_ratings sur
    join public.series_seasons ss
      on ss.id = sur.season_id
    join series_peers sp
      on sp.id = ss.series_id
  ),
  series_season_user_keys as (
    select series_id, season_id, user_id from series_season_episode_user_stats
    union
    select series_id, season_id, user_id from series_season_user_rows
  ),
  series_season_user_effective as (
    select
      sk.series_id,
      sk.user_id,
      sk.season_id,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and seus.rated_episode_count = sec.episode_count
          and seus.episode_average is not null
          then greatest(0::numeric, least(10::numeric, seus.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as effective_score
    from series_season_user_keys sk
    left join series_season_episode_counts sec
      on sec.series_id = sk.series_id
      and sec.season_id = sk.season_id
    left join series_season_episode_user_stats seus
      on seus.series_id = sk.series_id
      and seus.season_id = sk.season_id
      and seus.user_id = sk.user_id
    left join series_season_user_rows sur
      on sur.series_id = sk.series_id
      and sur.season_id = sk.season_id
      and sur.user_id = sk.user_id
  ),
  series_user_scores as (
    select
      se.series_id,
      se.user_id,
      avg(se.effective_score)::numeric as user_series_score,
      count(*)::integer as covered_seasons
    from series_season_user_effective se
    where se.effective_score is not null
    group by se.series_id, se.user_id
  ),
  series_scores as (
    select
      sp.id as content_id,
      sp.title as content_title,
      sp.slug as content_slug,
      sp.franchise,
      'series'::text as content_kind,
      count(sus.user_id)::bigint as rating_count,
      case
        when coalesce(sum(
          case
            when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
            else 0::numeric
          end
        ), 0) > 0
          then (
            sum(
              sus.user_series_score *
              case
                when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
                else 0::numeric
              end
            )
            /
            sum(
              case
                when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
                else 0::numeric
              end
            )
          )::numeric
        else null
      end as average
    from series_peers sp
    left join series_total_seasons sts
      on sts.series_id = sp.id
    left join series_user_scores sus
      on sus.series_id = sp.id
    group by sp.id, sp.title, sp.slug, sp.franchise
  ),
  all_content_scores as (
    select * from film_scores
    union all
    select * from series_scores
  ),
  ranked as (
    select
      acs.*,
      case
        when acs.average is null then null::bigint
        else dense_rank() over (order by round(acs.average::numeric, 2) desc nulls last)::bigint
      end as rank_position,
      count(*) filter (where acs.average is not null) over ()::bigint as ranked_items_count,
      count(*) over ()::bigint as total_items_count
    from all_content_scores acs
  )
  select
    tf.id as film_id,
    tf.title as film_title,
    tf.slug as film_slug,
    tf.franchise,
    'all_content'::text as mode,
    fs.rating_count,
    fs.average,
    r.rank_position,
    r.ranked_items_count,
    r.total_items_count
  from target_film tf
  join film_scores fs
    on fs.content_id = tf.id
    and fs.content_kind = 'film'
  join ranked r
    on r.content_id = tf.id
    and r.content_kind = 'film';
$$;

create or replace function public.api_media_members(
  p_media_ref text
)
returns table (
  media_id uuid,
  media_name text,
  user_id uuid,
  username text,
  is_media_admin boolean,
  joined_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select trim(coalesce(p_media_ref, '')) as media_ref
  ),
  target_media as (
    select mo.*
    from public.media_outlets mo
    cross join input_params p
    where
      p.media_ref <> ''
      and (
        lower(mo.name) = lower(p.media_ref)
        or (p.media_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and mo.id = p.media_ref::uuid)
      )
    order by
      case
        when lower(mo.name) = lower(p.media_ref) then 0
        else 1
      end
    limit 1
  )
  select
    tm.id as media_id,
    tm.name as media_name,
    pm.profile_id as user_id,
    coalesce(pr.username, 'Utilisateur') as username,
    (tm.admin_profile_id = pm.profile_id) as is_media_admin,
    pm.requested_at as joined_at
  from target_media tm
  join public.profile_media_memberships pm
    on pm.media_id = tm.id
    and pm.status = 'approved'
  left join public.profiles pr
    on pr.id = pm.profile_id
  order by
    (tm.admin_profile_id = pm.profile_id) desc,
    lower(coalesce(pr.username, '')) asc,
    pm.requested_at asc;
$$;

create or replace function public.api_series_score(
  p_series_ref text,
  p_scope text default 'global',
  p_scope_value text default null
)
returns table (
  series_id uuid,
  series_title text,
  series_slug text,
  scope text,
  scope_value text,
  contributor_count bigint,
  average numeric
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_series_ref, '')) as series_ref,
      lower(trim(coalesce(p_scope, 'global'))) as scope_kind,
      nullif(trim(coalesce(p_scope_value, '')), '') as scope_ref
  ),
  target_series as (
    select s.*
    from public.series s
    cross join input_params p
    where
      p.series_ref <> ''
      and (
        (p.series_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and s.id = p.series_ref::uuid)
        or lower(coalesce(s.slug, '')) = lower(p.series_ref)
        or lower(s.title) = lower(p.series_ref)
      )
    order by
      case
        when lower(coalesce(s.slug, '')) = lower(p.series_ref) then 0
        when lower(s.title) = lower(p.series_ref) then 1
        else 2
      end
    limit 1
  ),
  total_seasons as (
    select count(*)::integer as total_count
    from public.series_seasons ss
    join target_series ts on ts.id = ss.series_id
  ),
  season_episode_counts as (
    select
      ss.id as season_id,
      count(ep.id)::integer as episode_count
    from public.series_seasons ss
    join target_series ts on ts.id = ss.series_id
    left join public.series_episodes ep on ep.season_id = ss.id
    group by ss.id
  ),
  season_episode_user_stats as (
    select
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average,
      max(coalesce(er.updated_at, er.created_at)) as episode_last_activity
    from public.series_episodes ep
    join public.episode_ratings er on er.episode_id = ep.id
    join public.series_seasons ss on ss.id = ep.season_id
    join target_series ts on ts.id = ss.series_id
    group by ep.season_id, er.user_id
  ),
  season_user_rows as (
    select
      sur.season_id,
      sur.user_id,
      sur.manual_score,
      sur.adjustment,
      coalesce(sur.updated_at, sur.created_at) as season_last_activity
    from public.season_user_ratings sur
    join public.series_seasons ss on ss.id = sur.season_id
    join target_series ts on ts.id = ss.series_id
  ),
  season_user_keys as (
    select season_id, user_id from season_episode_user_stats
    union
    select season_id, user_id from season_user_rows
  ),
  season_user_effective as (
    select
      suk.user_id,
      suk.season_id,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and seus.rated_episode_count = sec.episode_count
          and seus.episode_average is not null
          then greatest(0::numeric, least(10::numeric, seus.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as effective_score
    from season_user_keys suk
    left join season_episode_counts sec
      on sec.season_id = suk.season_id
    left join season_episode_user_stats seus
      on seus.season_id = suk.season_id
      and seus.user_id = suk.user_id
    left join season_user_rows sur
      on sur.season_id = suk.season_id
      and sur.user_id = suk.user_id
  ),
  series_user_scores as (
    select
      sue.user_id,
      avg(sue.effective_score)::numeric as series_score,
      count(*)::integer as covered_seasons
    from season_user_effective sue
    where sue.effective_score is not null
    group by sue.user_id
  ),
  scoped_user_ids as (
    select distinct pm.profile_id as user_id
    from input_params p
    join public.profile_media_memberships pm
      on p.scope_kind = 'media'
      and pm.status = 'approved'
    join public.media_outlets mo
      on mo.id = pm.media_id
    where
      p.scope_ref is not null
      and (
        lower(mo.name) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and mo.id = p.scope_ref::uuid)
      )
    union
    select distinct pr.id as user_id
    from input_params p
    join public.profiles pr on p.scope_kind = 'user'
    where
      p.scope_ref is not null
      and (
        lower(pr.username) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pr.id = p.scope_ref::uuid)
      )
  ),
  filtered_user_scores as (
    select
      sus.user_id,
      sus.series_score,
      sus.covered_seasons,
      ts.total_count as total_seasons,
      case
        when ts.total_count > 0 then sus.covered_seasons::numeric / ts.total_count::numeric
        else null
      end as coverage
    from series_user_scores sus
    cross join total_seasons ts
    cross join input_params p
    where
      p.scope_kind = 'global'
      or sus.user_id in (select su.user_id from scoped_user_ids su)
  )
  select
    s.id as series_id,
    s.title as series_title,
    s.slug as series_slug,
    p.scope_kind as scope,
    p.scope_ref as scope_value,
    count(fus.user_id)::bigint as contributor_count,
    case
      when coalesce(sum(fus.coverage), 0) > 0
        then (sum(fus.series_score * fus.coverage) / sum(fus.coverage))::numeric
      else null
    end as average
  from target_series s
  cross join input_params p
  left join filtered_user_scores fus
    on p.scope_kind in ('global', 'media', 'user')
  where p.scope_kind in ('global', 'media', 'user')
  group by s.id, s.title, s.slug, p.scope_kind, p.scope_ref;
$$;

create or replace function public.api_series_reviews(
  p_series_ref text,
  p_scope text default 'global',
  p_scope_value text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  series_id uuid,
  series_title text,
  series_slug text,
  user_id uuid,
  username text,
  user_media text,
  score numeric,
  review text,
  rated_at timestamptz
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_series_ref, '')) as series_ref,
      lower(trim(coalesce(p_scope, 'global'))) as scope_kind,
      nullif(trim(coalesce(p_scope_value, '')), '') as scope_ref,
      greatest(coalesce(p_limit, 100), 0) as row_limit,
      greatest(coalesce(p_offset, 0), 0) as row_offset
  ),
  target_series as (
    select s.*
    from public.series s
    cross join input_params p
    where
      p.series_ref <> ''
      and (
        (p.series_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and s.id = p.series_ref::uuid)
        or lower(coalesce(s.slug, '')) = lower(p.series_ref)
        or lower(s.title) = lower(p.series_ref)
      )
    order by
      case
        when lower(coalesce(s.slug, '')) = lower(p.series_ref) then 0
        when lower(s.title) = lower(p.series_ref) then 1
        else 2
      end
    limit 1
  ),
  season_episode_counts as (
    select
      ss.id as season_id,
      count(ep.id)::integer as episode_count
    from public.series_seasons ss
    join target_series ts on ts.id = ss.series_id
    left join public.series_episodes ep on ep.season_id = ss.id
    group by ss.id
  ),
  season_episode_user_stats as (
    select
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average,
      max(coalesce(er.updated_at, er.created_at)) as episode_last_activity
    from public.series_episodes ep
    join public.episode_ratings er on er.episode_id = ep.id
    join public.series_seasons ss on ss.id = ep.season_id
    join target_series ts on ts.id = ss.series_id
    group by ep.season_id, er.user_id
  ),
  season_user_rows as (
    select
      sur.season_id,
      sur.user_id,
      sur.manual_score,
      sur.adjustment,
      coalesce(sur.updated_at, sur.created_at) as season_last_activity
    from public.season_user_ratings sur
    join public.series_seasons ss on ss.id = sur.season_id
    join target_series ts on ts.id = ss.series_id
  ),
  season_user_keys as (
    select season_id, user_id from season_episode_user_stats
    union
    select season_id, user_id from season_user_rows
  ),
  season_user_effective as (
    select
      suk.user_id,
      suk.season_id,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and seus.rated_episode_count = sec.episode_count
          and seus.episode_average is not null
          then greatest(0::numeric, least(10::numeric, seus.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as effective_score,
      case
        when sur.season_last_activity is null then seus.episode_last_activity
        when seus.episode_last_activity is null then sur.season_last_activity
        else greatest(sur.season_last_activity, seus.episode_last_activity)
      end as last_activity
    from season_user_keys suk
    left join season_episode_counts sec
      on sec.season_id = suk.season_id
    left join season_episode_user_stats seus
      on seus.season_id = suk.season_id
      and seus.user_id = suk.user_id
    left join season_user_rows sur
      on sur.season_id = suk.season_id
      and sur.user_id = suk.user_id
  ),
  series_user_scores as (
    select
      sue.user_id,
      avg(sue.effective_score)::numeric as series_score,
      max(sue.last_activity) as score_last_activity
    from season_user_effective sue
    where sue.effective_score is not null
    group by sue.user_id
  ),
  series_review_rows as (
    select
      sr.user_id,
      coalesce(sr.review, '') as review,
      coalesce(sr.updated_at, sr.created_at) as review_last_activity
    from public.series_reviews sr
    join target_series ts on ts.id = sr.series_id
  ),
  scoped_user_ids as (
    select distinct pm.profile_id as user_id
    from input_params p
    join public.profile_media_memberships pm
      on p.scope_kind = 'media'
      and pm.status = 'approved'
    join public.media_outlets mo
      on mo.id = pm.media_id
    where
      p.scope_ref is not null
      and (
        lower(mo.name) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and mo.id = p.scope_ref::uuid)
      )
    union
    select distinct pr.id as user_id
    from input_params p
    join public.profiles pr on p.scope_kind = 'user'
    where
      p.scope_ref is not null
      and (
        lower(pr.username) = lower(p.scope_ref)
        or (p.scope_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pr.id = p.scope_ref::uuid)
      )
  ),
  user_pool as (
    select user_id from series_user_scores
    union
    select user_id from series_review_rows
  )
  select
    ts.id as series_id,
    ts.title as series_title,
    ts.slug as series_slug,
    up.user_id,
    coalesce(pr.username, 'Utilisateur') as username,
    um.user_media,
    sus.series_score as score,
    coalesce(srr.review, '') as review,
    case
      when srr.review_last_activity is null then sus.score_last_activity
      when sus.score_last_activity is null then srr.review_last_activity
      else greatest(srr.review_last_activity, sus.score_last_activity)
    end as rated_at
  from target_series ts
  join input_params p on p.scope_kind in ('global', 'media', 'user')
  join user_pool up on true
  left join series_user_scores sus on sus.user_id = up.user_id
  left join series_review_rows srr on srr.user_id = up.user_id
  left join public.profiles pr on pr.id = up.user_id
  left join lateral (
    select string_agg(mo.name, ', ' order by mo.name) as user_media
    from public.profile_media_memberships pm
    join public.media_outlets mo
      on mo.id = pm.media_id
    where pm.profile_id = up.user_id and pm.status = 'approved'
  ) um on true
  where
    p.scope_kind = 'global'
    or up.user_id in (select su.user_id from scoped_user_ids su)
  order by rated_at desc nulls last, up.user_id
  limit (select row_limit from input_params)
  offset (select row_offset from input_params);
$$;

create or replace function public.api_series_rank_in_franchise(
  p_series_ref text,
  p_mode text default 'all'
)
returns table (
  series_id uuid,
  series_title text,
  series_slug text,
  franchise text,
  type text,
  mode text,
  contributor_count bigint,
  average numeric,
  rank_position bigint,
  ranked_items_count bigint,
  total_items_count bigint
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select
      trim(coalesce(p_series_ref, '')) as series_ref,
      lower(trim(coalesce(p_mode, 'all'))) as rank_mode
  ),
  target_series as (
    select s.*
    from public.series s
    cross join input_params p
    where
      p.series_ref <> ''
      and s.franchise = 'MCU'
      and (
        (p.series_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and s.id = p.series_ref::uuid)
        or lower(coalesce(s.slug, '')) = lower(p.series_ref)
        or lower(s.title) = lower(p.series_ref)
      )
    order by
      case
        when lower(coalesce(s.slug, '')) = lower(p.series_ref) then 0
        when lower(s.title) = lower(p.series_ref) then 1
        else 2
      end
    limit 1
  ),
  peers as (
    select s.id, s.title, s.slug, s.franchise, s.type
    from public.series s
    join target_series ts on ts.franchise = s.franchise
    cross join input_params p
    where
      s.franchise = 'MCU'
      and (
        p.rank_mode = 'all'
        or (
          p.rank_mode = 'series_only'
          and (
            s.id = ts.id
            or trim(regexp_replace(lower(replace(coalesce(s.type, ''), 'é', 'e')), '\s+', ' ', 'g'))
              in ('serie', 'series', 'serie animee', 'series animee')
          )
        )
      )
  ),
  peer_total_seasons as (
    select
      p.id as series_id,
      count(ss.id)::integer as total_seasons
    from peers p
    left join public.series_seasons ss on ss.series_id = p.id
    group by p.id
  ),
  peer_season_episode_counts as (
    select
      ss.id as season_id,
      ss.series_id,
      count(ep.id)::integer as episode_count
    from public.series_seasons ss
    join peers p on p.id = ss.series_id
    left join public.series_episodes ep on ep.season_id = ss.id
    group by ss.id, ss.series_id
  ),
  peer_season_episode_user_stats as (
    select
      ss.series_id,
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average
    from public.series_episodes ep
    join public.episode_ratings er on er.episode_id = ep.id
    join public.series_seasons ss on ss.id = ep.season_id
    join peers p on p.id = ss.series_id
    group by ss.series_id, ep.season_id, er.user_id
  ),
  peer_season_user_rows as (
    select
      ss.series_id,
      sur.season_id,
      sur.user_id,
      sur.manual_score,
      sur.adjustment
    from public.season_user_ratings sur
    join public.series_seasons ss on ss.id = sur.season_id
    join peers p on p.id = ss.series_id
  ),
  peer_season_user_keys as (
    select series_id, season_id, user_id from peer_season_episode_user_stats
    union
    select series_id, season_id, user_id from peer_season_user_rows
  ),
  peer_season_user_effective as (
    select
      suk.series_id,
      suk.user_id,
      suk.season_id,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and seus.rated_episode_count = sec.episode_count
          and seus.episode_average is not null
          then greatest(0::numeric, least(10::numeric, seus.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as effective_score
    from peer_season_user_keys suk
    left join peer_season_episode_counts sec
      on sec.series_id = suk.series_id
      and sec.season_id = suk.season_id
    left join peer_season_episode_user_stats seus
      on seus.series_id = suk.series_id
      and seus.season_id = suk.season_id
      and seus.user_id = suk.user_id
    left join peer_season_user_rows sur
      on sur.series_id = suk.series_id
      and sur.season_id = suk.season_id
      and sur.user_id = suk.user_id
  ),
  peer_user_scores as (
    select
      psue.series_id,
      psue.user_id,
      avg(psue.effective_score)::numeric as user_series_score,
      count(*)::integer as covered_seasons
    from peer_season_user_effective psue
    where psue.effective_score is not null
    group by psue.series_id, psue.user_id
  ),
  peer_series_scores as (
    select
      p.id as series_id,
      count(pus.user_id)::bigint as contributor_count,
      case
        when coalesce(sum(
          case
            when pts.total_seasons > 0 then pus.covered_seasons::numeric / pts.total_seasons::numeric
            else 0::numeric
          end
        ), 0) > 0
          then (
            sum(
              pus.user_series_score *
              case
                when pts.total_seasons > 0 then pus.covered_seasons::numeric / pts.total_seasons::numeric
                else 0::numeric
              end
            )
            /
            sum(
              case
                when pts.total_seasons > 0 then pus.covered_seasons::numeric / pts.total_seasons::numeric
                else 0::numeric
              end
            )
          )::numeric
        else null
      end as average
    from peers p
    left join peer_total_seasons pts
      on pts.series_id = p.id
    left join peer_user_scores pus
      on pus.series_id = p.id
    group by p.id
  ),
  ranked as (
    select
      p.id,
      p.title,
      p.slug,
      p.franchise,
      p.type,
      pss.contributor_count,
      pss.average,
      case
        when pss.average is null then null::bigint
        else dense_rank() over (order by round(pss.average::numeric, 2) desc nulls last)::bigint
      end as rank_position,
      count(*) filter (where pss.average is not null) over ()::bigint as ranked_items_count,
      count(*) over ()::bigint as total_items_count
    from peers p
    left join peer_series_scores pss
      on pss.series_id = p.id
  )
  select
    r.id as series_id,
    r.title as series_title,
    r.slug as series_slug,
    r.franchise,
    r.type,
    p.rank_mode as mode,
    coalesce(r.contributor_count, 0) as contributor_count,
    r.average,
    r.rank_position,
    r.ranked_items_count,
    r.total_items_count
  from ranked r
  join target_series ts on ts.id = r.id
  cross join input_params p
  where p.rank_mode in ('all', 'series_only');
$$;

create or replace function public.api_series_rank_in_franchise_all_content(
  p_series_ref text
)
returns table (
  series_id uuid,
  series_title text,
  series_slug text,
  franchise text,
  mode text,
  contributor_count bigint,
  average numeric,
  rank_position bigint,
  ranked_items_count bigint,
  total_items_count bigint
)
language sql
stable
set search_path = public
as $$
  with input_params as (
    select trim(coalesce(p_series_ref, '')) as series_ref
  ),
  target_series as (
    select s.*
    from public.series s
    cross join input_params p
    where
      p.series_ref <> ''
      and s.franchise = 'MCU'
      and (
        (p.series_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and s.id = p.series_ref::uuid)
        or lower(coalesce(s.slug, '')) = lower(p.series_ref)
        or lower(s.title) = lower(p.series_ref)
      )
    order by
      case
        when lower(coalesce(s.slug, '')) = lower(p.series_ref) then 0
        when lower(s.title) = lower(p.series_ref) then 1
        else 2
      end
    limit 1
  ),
  film_peers as (
    select f.id, f.title, f.slug, f.franchise
    from public.films f
    join target_series ts
      on ts.franchise = f.franchise
    where f.franchise = 'MCU'
  ),
  film_scores as (
    select
      fp.id as content_id,
      fp.title as content_title,
      fp.slug as content_slug,
      fp.franchise,
      'film'::text as content_kind,
      count(r.id)::bigint as contributor_count,
      case when count(r.id) > 0 then avg(r.score)::numeric else null end as average
    from film_peers fp
    left join public.ratings r
      on r.film_id = fp.id
    group by fp.id, fp.title, fp.slug, fp.franchise
  ),
  series_peers as (
    select s.id, s.title, s.slug, s.franchise
    from public.series s
    join target_series ts
      on ts.franchise = s.franchise
    where
      s.franchise = 'MCU'
      and (
        s.id = ts.id
        or trim(regexp_replace(lower(replace(coalesce(s.type, ''), 'é', 'e')), '\s+', ' ', 'g'))
          in ('serie', 'series', 'serie animee', 'series animee')
      )
  ),
  series_total_seasons as (
    select
      sp.id as series_id,
      count(ss.id)::integer as total_seasons
    from series_peers sp
    left join public.series_seasons ss
      on ss.series_id = sp.id
    group by sp.id
  ),
  series_season_episode_counts as (
    select
      ss.id as season_id,
      ss.series_id,
      count(ep.id)::integer as episode_count
    from public.series_seasons ss
    join series_peers sp
      on sp.id = ss.series_id
    left join public.series_episodes ep
      on ep.season_id = ss.id
    group by ss.id, ss.series_id
  ),
  series_season_episode_user_stats as (
    select
      ss.series_id,
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average
    from public.series_episodes ep
    join public.episode_ratings er
      on er.episode_id = ep.id
    join public.series_seasons ss
      on ss.id = ep.season_id
    join series_peers sp
      on sp.id = ss.series_id
    group by ss.series_id, ep.season_id, er.user_id
  ),
  series_season_user_rows as (
    select
      ss.series_id,
      sur.season_id,
      sur.user_id,
      sur.manual_score,
      sur.adjustment
    from public.season_user_ratings sur
    join public.series_seasons ss
      on ss.id = sur.season_id
    join series_peers sp
      on sp.id = ss.series_id
  ),
  series_season_user_keys as (
    select series_id, season_id, user_id from series_season_episode_user_stats
    union
    select series_id, season_id, user_id from series_season_user_rows
  ),
  series_season_user_effective as (
    select
      sk.series_id,
      sk.user_id,
      sk.season_id,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and seus.rated_episode_count = sec.episode_count
          and seus.episode_average is not null
          then greatest(0::numeric, least(10::numeric, seus.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as effective_score
    from series_season_user_keys sk
    left join series_season_episode_counts sec
      on sec.series_id = sk.series_id
      and sec.season_id = sk.season_id
    left join series_season_episode_user_stats seus
      on seus.series_id = sk.series_id
      and seus.season_id = sk.season_id
      and seus.user_id = sk.user_id
    left join series_season_user_rows sur
      on sur.series_id = sk.series_id
      and sur.season_id = sk.season_id
      and sur.user_id = sk.user_id
  ),
  series_user_scores as (
    select
      se.series_id,
      se.user_id,
      avg(se.effective_score)::numeric as user_series_score,
      count(*)::integer as covered_seasons
    from series_season_user_effective se
    where se.effective_score is not null
    group by se.series_id, se.user_id
  ),
  series_scores as (
    select
      sp.id as content_id,
      sp.title as content_title,
      sp.slug as content_slug,
      sp.franchise,
      'series'::text as content_kind,
      count(sus.user_id)::bigint as contributor_count,
      case
        when coalesce(sum(
          case
            when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
            else 0::numeric
          end
        ), 0) > 0
          then (
            sum(
              sus.user_series_score *
              case
                when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
                else 0::numeric
              end
            )
            /
            sum(
              case
                when sts.total_seasons > 0 then sus.covered_seasons::numeric / sts.total_seasons::numeric
                else 0::numeric
              end
            )
          )::numeric
        else null
      end as average
    from series_peers sp
    left join series_total_seasons sts
      on sts.series_id = sp.id
    left join series_user_scores sus
      on sus.series_id = sp.id
    group by sp.id, sp.title, sp.slug, sp.franchise
  ),
  all_content_scores as (
    select * from film_scores
    union all
    select * from series_scores
  ),
  ranked as (
    select
      acs.*,
      case
        when acs.average is null then null::bigint
        else dense_rank() over (order by round(acs.average::numeric, 2) desc nulls last)::bigint
      end as rank_position,
      count(*) filter (where acs.average is not null) over ()::bigint as ranked_items_count,
      count(*) over ()::bigint as total_items_count
    from all_content_scores acs
  )
  select
    ts.id as series_id,
    ts.title as series_title,
    ts.slug as series_slug,
    ts.franchise,
    'all_content'::text as mode,
    ss.contributor_count,
    ss.average,
    r.rank_position,
    r.ranked_items_count,
    r.total_items_count
  from target_series ts
  join series_scores ss
    on ss.content_id = ts.id
    and ss.content_kind = 'series'
  join ranked r
    on r.content_id = ts.id
    and r.content_kind = 'series';
$$;

create or replace function public.api_film_catalog()
returns table (
  id uuid,
  title text,
  release_date date,
  poster_url text,
  franchise text,
  phase text,
  type text,
  rating_count bigint,
  average numeric
)
language sql
stable
set search_path = public
as $$
  select
    f.id,
    f.title,
    f.release_date,
    f.poster_url,
    f.franchise,
    f.phase,
    f.type,
    count(r.id)::bigint as rating_count,
    case
      when count(r.id) > 0 then avg(r.score)::numeric
      else null
    end as average
  from public.films f
  left join public.ratings r
    on r.film_id = f.id
  group by f.id
  order by f.release_date desc nulls last, f.title asc;
$$;

create or replace function public.api_latest_activity(p_limit integer default 20)
returns table (
  activity_id text,
  activity_type text,
  target_id uuid,
  user_id uuid,
  username text,
  activity_at timestamptz,
  score numeric,
  review text,
  adjustment numeric,
  title text,
  series_title text,
  season_number integer
)
language sql
stable
set search_path = public
as $$
  with season_episode_counts as (
    select
      ep.season_id,
      count(*)::integer as episode_count
    from public.series_episodes ep
    group by ep.season_id
  ),
  season_episode_stats as (
    select
      ep.season_id,
      er.user_id,
      count(er.id)::integer as rated_episode_count,
      avg(er.score)::numeric as episode_average,
      max(coalesce(er.updated_at, er.created_at)) as last_activity_at
    from public.episode_ratings er
    join public.series_episodes ep
      on ep.id = er.episode_id
    group by ep.season_id, er.user_id
  ),
  season_keys as (
    select sur.season_id, sur.user_id
    from public.season_user_ratings sur
    union
    select ses.season_id, ses.user_id
    from season_episode_stats ses
  ),
  season_activity as (
    select
      concat('season-', coalesce(sur.id::text, concat(sk.season_id::text, '-', sk.user_id::text))) as activity_id,
      'season'::text as activity_type,
      sk.season_id as target_id,
      sk.user_id,
      coalesce(p.username, 'Utilisateur') as username,
      coalesce(sur.updated_at, sur.created_at, ses.last_activity_at) as activity_at,
      case
        when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
        when coalesce(sec.episode_count, 0) > 0
          and ses.rated_episode_count = sec.episode_count
          and ses.episode_average is not null
          then greatest(0::numeric, least(10::numeric, ses.episode_average + coalesce(sur.adjustment, 0)))
        else null
      end as score,
      coalesce(sur.review, '') as review,
      coalesce(sur.adjustment, 0)::numeric as adjustment,
      coalesce(ss.name, 'Saison') as title,
      coalesce(s.title, '') as series_title,
      ss.season_number
    from season_keys sk
    left join public.season_user_ratings sur
      on sur.season_id = sk.season_id
      and sur.user_id = sk.user_id
    left join season_episode_stats ses
      on ses.season_id = sk.season_id
      and ses.user_id = sk.user_id
    left join season_episode_counts sec
      on sec.season_id = sk.season_id
    left join public.series_seasons ss
      on ss.id = sk.season_id
    left join public.series s
      on s.id = ss.series_id
    left join public.profiles p
      on p.id = sk.user_id
    where
      sur.manual_score is not null
      or coalesce(sur.adjustment, 0) <> 0
      or char_length(btrim(coalesce(sur.review, ''))) > 0
      or (
        coalesce(sec.episode_count, 0) > 0
        and ses.rated_episode_count = sec.episode_count
        and ses.episode_average is not null
      )
  ),
  film_activity as (
    select
      concat('film-', r.id::text) as activity_id,
      'film'::text as activity_type,
      r.film_id as target_id,
      r.user_id,
      coalesce(p.username, 'Utilisateur') as username,
      coalesce(r.updated_at, r.created_at) as activity_at,
      r.score::numeric as score,
      coalesce(r.review, '') as review,
      0::numeric as adjustment,
      coalesce(f.title, 'Film') as title,
      ''::text as series_title,
      null::integer as season_number
    from public.ratings r
    join public.films f
      on f.id = r.film_id
    left join public.profiles p
      on p.id = r.user_id
  ),
  series_user_scores as (
    select
      x.series_id,
      x.user_id,
      avg(x.effective_score)::numeric as series_score
    from (
      select
        ss.series_id,
        sk.user_id,
        case
          when sur.manual_score is not null then greatest(0::numeric, least(10::numeric, sur.manual_score))
          when coalesce(sec.episode_count, 0) > 0
            and ses.rated_episode_count = sec.episode_count
            and ses.episode_average is not null
            then greatest(0::numeric, least(10::numeric, ses.episode_average + coalesce(sur.adjustment, 0)))
          else null
        end as effective_score
      from season_keys sk
      join public.series_seasons ss
        on ss.id = sk.season_id
      left join public.season_user_ratings sur
        on sur.season_id = sk.season_id
        and sur.user_id = sk.user_id
      left join season_episode_stats ses
        on ses.season_id = sk.season_id
        and ses.user_id = sk.user_id
      left join season_episode_counts sec
        on sec.season_id = sk.season_id
    ) x
    where x.effective_score is not null
    group by x.series_id, x.user_id
  ),
  series_activity as (
    select
      concat('series-', sr.id::text) as activity_id,
      'series'::text as activity_type,
      sr.series_id as target_id,
      sr.user_id,
      coalesce(p.username, 'Utilisateur') as username,
      coalesce(sr.updated_at, sr.created_at) as activity_at,
      sus.series_score as score,
      coalesce(sr.review, '') as review,
      0::numeric as adjustment,
      coalesce(s.title, 'Serie') as title,
      ''::text as series_title,
      null::integer as season_number
    from public.series_reviews sr
    join public.series s
      on s.id = sr.series_id
    left join series_user_scores sus
      on sus.series_id = sr.series_id
      and sus.user_id = sr.user_id
    left join public.profiles p
      on p.id = sr.user_id
  ),
  episode_activity as (
    select
      concat('episode-', er.id::text) as activity_id,
      'episode'::text as activity_type,
      er.episode_id as target_id,
      er.user_id,
      coalesce(p.username, 'Utilisateur') as username,
      coalesce(er.updated_at, er.created_at) as activity_at,
      er.score::numeric as score,
      coalesce(er.review, '') as review,
      0::numeric as adjustment,
      coalesce(ep.title, 'Episode') as title,
      coalesce(s.title, '') as series_title,
      ss.season_number
    from public.episode_ratings er
    join public.series_episodes ep
      on ep.id = er.episode_id
    join public.series_seasons ss
      on ss.id = ep.season_id
    join public.series s
      on s.id = ss.series_id
    left join public.profiles p
      on p.id = er.user_id
    where
      er.score is not null
      or char_length(btrim(coalesce(er.review, ''))) > 0
  ),
  all_activity as (
    select * from film_activity
    union all
    select * from series_activity
    union all
    select * from episode_activity
    union all
    select * from season_activity
  )
  select
    a.activity_id,
    a.activity_type,
    a.target_id,
    a.user_id,
    a.username,
    a.activity_at,
    a.score,
    a.review,
    a.adjustment,
    a.title,
    a.series_title,
    a.season_number
  from all_activity a
  where a.activity_at is not null
  order by a.activity_at desc, a.activity_id desc
  limit greatest(coalesce(p_limit, 20), 0);
$$;

grant execute on function public.api_film_catalog() to anon, authenticated;
grant execute on function public.api_latest_activity(integer) to anon, authenticated;
grant execute on function public.api_film_score(text, text, text) to anon, authenticated;
grant execute on function public.api_film_reviews(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.api_film_rank_in_franchise(text, text) to anon, authenticated;
grant execute on function public.api_film_rank_in_franchise_all_content(text) to anon, authenticated;
grant execute on function public.api_media_members(text) to anon, authenticated;
grant execute on function public.api_series_score(text, text, text) to anon, authenticated;
grant execute on function public.api_series_reviews(text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.api_series_rank_in_franchise(text, text) to anon, authenticated;
grant execute on function public.api_series_rank_in_franchise_all_content(text) to anon, authenticated;
