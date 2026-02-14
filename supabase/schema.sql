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
  website_url text,
  description text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.media_outlets alter column admin_profile_id drop not null;

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
    crypt(p_password, gen_salt('bf')),
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

  if not exists (
    select 1
    from public.media_outlets m
    where m.id = v_row.media_id and m.admin_profile_id = auth.uid()
  ) then
    raise exception 'Only media admin can validate this membership';
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
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

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

drop policy if exists "memberships_update_owner_or_media_admin" on public.profile_media_memberships;
create policy "memberships_update_owner_or_media_admin"
on public.profile_media_memberships
for update
using (
  auth.uid() = profile_id
  or exists (
    select 1
    from public.media_outlets m
    where m.id = media_id and m.admin_profile_id = auth.uid()
  )
)
with check (
  auth.uid() = profile_id
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

insert into public.films (title, release_date, poster_url, synopsis)
values
  ('Iron Man', '2008-05-02', 'https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg', 'Le film qui lance le MCU.'),
  ('The Avengers', '2012-05-04', 'https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg', 'Reunion des heros face a Loki.'),
  ('Guardians of the Galaxy', '2014-08-01', 'https://image.tmdb.org/t/p/w500/r7vmZjiyZw9rpJMQJdXpjgiCOk9.jpg', 'Une equipe improbable sauve la galaxie.')
on conflict do nothing;
