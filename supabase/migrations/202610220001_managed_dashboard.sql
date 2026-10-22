-- Managed dashboard foundation. No passwords or merchant API secrets belong here.
-- Apply to a dedicated Supabase project after the account connection is confirmed.
begin;

create table public.kirtle_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,32}$'),
  role text not null check (role in ('owner', 'admin')),
  disabled boolean not null default false,
  auth_version integer not null default 1 check (auth_version > 0),
  created_at timestamptz not null default now()
);
create unique index kirtle_profiles_username_lower on public.kirtle_profiles(lower(username));

create table public.kirtle_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('website','square')),
  external_id text unique,
  external_version bigint not null default -1,
  external jsonb not null default '{}' check (jsonb_typeof(external)='object'),
  intake jsonb not null default '{}' check (jsonb_typeof(intake)='object'),
  work jsonb not null default '{}' check (jsonb_typeof(work)='object'),
  tasks jsonb not null default '[]' check (jsonb_typeof(tasks)='array'),
  revision integer not null default 1 check (revision > 0),
  submission_key text unique,
  submission_hash text,
  linked_to uuid references public.kirtle_jobs(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (linked_to is null or linked_to <> id),
  check ((source='website' and external_id is null) or (source='square' and external_id is not null))
);
create index kirtle_jobs_updated on public.kirtle_jobs(updated_at desc);
create index kirtle_jobs_unlinked on public.kirtle_jobs(created_at desc) where linked_to is null;

create table public.kirtle_activity (
  id bigint generated always as identity primary key,
  actor_id uuid references public.kirtle_profiles(id) on delete set null,
  actor text not null,
  action text not null,
  target text not null,
  created_at timestamptz not null default now()
);

create table public.kirtle_integration_state (
  provider text primary key check (provider in ('square-production','square-sandbox')),
  last_success timestamptz,
  last_error text not null default '',
  -- The lease prevents overlapping scheduled syncs; credentials are function secrets.
  lease_id uuid,
  lease_until timestamptz
);

create table public.kirtle_rate_limits (
  key_hash text primary key,
  attempts integer not null default 1 check (attempts > 0),
  expires_at timestamptz not null
);

-- These helpers are owned by the migration role and return only an access flag.
-- No policy recursively selects the profiles table through its own RLS policy.
create function public.kirtle_is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.kirtle_profiles
    where id=auth.uid() and not disabled and role in ('owner','admin'));
$$;
create function public.kirtle_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.kirtle_profiles
    where id=auth.uid() and not disabled and role='admin');
$$;
revoke all on function public.kirtle_is_staff() from public, anon;
revoke all on function public.kirtle_is_admin() from public, anon;
grant execute on function public.kirtle_is_staff() to authenticated;
grant execute on function public.kirtle_is_admin() to authenticated;

alter table public.kirtle_profiles enable row level security;
alter table public.kirtle_jobs enable row level security;
alter table public.kirtle_activity enable row level security;
alter table public.kirtle_integration_state enable row level security;
alter table public.kirtle_rate_limits enable row level security;

-- Browser users can read only authorized records. All mutations go through the
-- validating Edge Function using its private service role, not direct table writes.
revoke all on public.kirtle_profiles, public.kirtle_jobs, public.kirtle_activity,
  public.kirtle_integration_state, public.kirtle_rate_limits from public, anon, authenticated;
grant select on public.kirtle_profiles, public.kirtle_jobs, public.kirtle_activity,
  public.kirtle_integration_state to authenticated;
grant all on public.kirtle_profiles, public.kirtle_jobs, public.kirtle_activity,
  public.kirtle_integration_state, public.kirtle_rate_limits to service_role;
grant usage, select on sequence public.kirtle_activity_id_seq to service_role;

create policy kirtle_read_own_profile on public.kirtle_profiles for select to authenticated
  using (public.kirtle_is_staff() and (id=auth.uid() or public.kirtle_is_admin()));
create policy kirtle_read_jobs on public.kirtle_jobs for select to authenticated
  using (public.kirtle_is_staff());
create policy kirtle_admin_activity on public.kirtle_activity for select to authenticated
  using (public.kirtle_is_admin());
create policy kirtle_read_connection on public.kirtle_integration_state for select to authenticated
  using (public.kirtle_is_staff());

-- Used only by the Edge Function after verifying session, role, and input.
-- Row locking and revision matching preserve concurrent-edit protection.
create function public.kirtle_save_job(
  p_id uuid, p_revision integer, p_work jsonb, p_tasks jsonb,
  p_actor_id uuid, p_action text
) returns public.kirtle_jobs
language plpgsql security invoker set search_path = '' as $$
declare
  saved public.kirtle_jobs;
  actor_name text;
begin
  select username into actor_name from public.kirtle_profiles
    where id=p_actor_id and not disabled and role in ('owner','admin');
  if actor_name is null then raise exception 'Account is not active' using errcode='42501'; end if;
  select * into saved from public.kirtle_jobs where id=p_id for update;
  if not found then raise exception 'Appointment not found' using errcode='P0002'; end if;
  if saved.revision<>p_revision or saved.linked_to is not null then
    raise exception 'Appointment changed; refresh before saving' using errcode='40001';
  end if;
  if p_work is null or p_tasks is null or jsonb_typeof(p_work)<>'object' or jsonb_typeof(p_tasks)<>'array' then
    raise exception 'Invalid work plan' using errcode='22023';
  end if;
  update public.kirtle_jobs set work=p_work, tasks=p_tasks,
    revision=revision+1, updated_at=now() where id=p_id returning * into saved;
  insert into public.kirtle_activity(actor_id,actor,action,target)
    values(p_actor_id,actor_name,p_action,p_id::text);
  return saved;
end;
$$;
revoke all on function public.kirtle_save_job(uuid,integer,jsonb,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.kirtle_save_job(uuid,integer,jsonb,jsonb,uuid,text) to service_role;

commit;
