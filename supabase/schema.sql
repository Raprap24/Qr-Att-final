-- ============================================================
-- QR-ATT — Supabase PostgreSQL Schema
--
-- Roles: student, teacher, admin
-- Entities: profiles, events, attendance
--
-- HOW TO RUN:
--   1. Open Supabase Dashboard -> SQL Editor
--   2. Paste the ENTIRE file
--   3. Click "Run"
--
-- This script is IDEMPOTENT and safe to re-run on an existing
-- database created by the previous version of this schema.
-- ============================================================

-- ------------------------------------------------------------
-- 1. TABLES
-- ------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'student',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  title text not null,
  description text,
  venue text,
  start_time timestamptz,
  end_time timestamptz,
  status text not null default 'open',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists description text;
alter table public.events add column if not exists venue text;
alter table public.events add column if not exists status text not null default 'open';
alter table public.events add column if not exists updated_at timestamptz not null default now();

alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in ('open', 'closed'));

alter table public.events drop constraint if exists events_time_check;
alter table public.events
  add constraint events_time_check
  check (
    start_time is null
    or end_time is null
    or end_time > start_time
  );

-- Per-event QR secret. Only the event owner and admins can read it,
-- so the code alone is not enough to forge an attendance QR.
create table if not exists public.event_qr_tokens (
  event_id uuid primary key references public.events (id) on delete cascade,
  token text not null unique
    default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

-- Roster of students expected to attend an event. Teachers use this
-- to mark students who never scanned (e.g. absent).
create table if not exists public.event_students (
  event_id uuid not null references public.events (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, student_id)
);

create index if not exists event_students_student_idx
  on public.event_students (student_id);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  status text not null default 'present',
  scanned_at timestamptz not null default now(),
  recorded_by uuid references auth.users (id) on delete set null,
  notes text,
  updated_at timestamptz not null default now(),
  unique (student_id, event_id)
);

alter table public.attendance add column if not exists status text not null default 'present';
alter table public.attendance add column if not exists recorded_by uuid references auth.users (id) on delete set null;
alter table public.attendance add column if not exists notes text;
alter table public.attendance add column if not exists updated_at timestamptz not null default now();

alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check
  check (status in ('present', 'late', 'absent', 'excused'));

create unique index if not exists attendance_student_event_idx
  on public.attendance (student_id, event_id);
create index if not exists attendance_event_idx
  on public.attendance (event_id);
create index if not exists events_created_by_idx
  on public.events (created_by);

-- ------------------------------------------------------------
-- 2. HELPERS
-- ------------------------------------------------------------

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false);
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists events_touch_updated_at on public.events;
create trigger events_touch_updated_at
  before update on public.events
  for each row execute procedure public.touch_updated_at();

drop trigger if exists attendance_touch_updated_at on public.attendance;
create trigger attendance_touch_updated_at
  before update on public.attendance
  for each row execute procedure public.touch_updated_at();

-- Create a secret QR token whenever an event is created.
create or replace function public.create_event_qr_token()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_qr_tokens (event_id)
  values (new.id)
  on conflict (event_id) do nothing;
  return new;
end;
$$;

drop trigger if exists events_create_qr_token on public.events;
create trigger events_create_qr_token
  after insert on public.events
  for each row execute procedure public.create_event_qr_token();

-- Enroll every active student in a newly created event.
create or replace function public.enroll_students_for_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_students (event_id, student_id)
  select new.id, p.id
  from public.profiles p
  where p.role = 'student'
    and p.is_active
  on conflict (event_id, student_id) do nothing;
  return new;
end;
$$;

drop trigger if exists events_enroll_students on public.events;
create trigger events_enroll_students
  after insert on public.events
  for each row execute procedure public.enroll_students_for_event();

-- Enroll newly registered students in all currently open events.
create or replace function public.enroll_new_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'student' and new.is_active then
    insert into public.event_students (event_id, student_id)
    select e.id, new.id
    from public.events e
    where e.status = 'open'
    on conflict (event_id, student_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_enroll_student on public.profiles;
create trigger profiles_enroll_student
  after insert on public.profiles
  for each row execute procedure public.enroll_new_student();

-- Backfill tokens and rosters for events/users created before this update.
insert into public.event_qr_tokens (event_id)
select e.id from public.events e
on conflict (event_id) do nothing;

insert into public.event_students (event_id, student_id)
select e.id, p.id
from public.events e
join public.profiles p on p.role = 'student' and p.is_active
on conflict (event_id, student_id) do nothing;

-- Prevent privilege escalation: only admins may change role,
-- email or active status through the API.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is NULL for the SQL editor / service role, so direct
  -- database administration (like bootstrapping the first admin) works.
  -- Requests coming from a signed-in app user are protected.
  if auth.uid() is not null and not public.is_admin() then
    new.role := old.role;
    new.email := old.email;
    new.is_active := old.is_active;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

-- ------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_qr_tokens enable row level security;
alter table public.event_students enable row level security;
alter table public.attendance enable row level security;

-- Profiles
drop policy if exists "Profiles are viewable by owner" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Teachers can view profiles of their attendees" on public.profiles;
drop policy if exists "Teachers can view profiles of students in their events" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
drop policy if exists "Admins can update all profiles" on public.profiles;
drop policy if exists "Admins can delete profiles" on public.profiles;

create policy "Profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (
    auth.uid() = id
    and role = 'student'
    and is_active = true
  );

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "Admins can delete profiles"
  on public.profiles for delete
  using (public.is_admin());

create policy "Teachers can view profiles of their attendees"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.attendance a
      join public.events e on e.id = a.event_id
      where a.student_id = profiles.id
        and e.created_by = auth.uid()
    )
  );

create policy "Teachers can view profiles of students in their events"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.event_students es
      join public.events e on e.id = es.event_id
      where es.student_id = profiles.id
        and e.created_by = auth.uid()
    )
  );

-- Events
drop policy if exists "Events are readable by any authenticated user" on public.events;
drop policy if exists "Users can insert events" on public.events;
drop policy if exists "Teachers and admins can insert events" on public.events;
drop policy if exists "Users can update their own events" on public.events;
drop policy if exists "Owners and admins can update events" on public.events;
drop policy if exists "Event owners and admins can delete events" on public.events;

create policy "Events are readable by any authenticated user"
  on public.events for select
  using (auth.role() = 'authenticated');

create policy "Teachers and admins can insert events"
  on public.events for insert
  with check (
    public.current_user_role() in ('teacher', 'admin')
    and created_by = auth.uid()
  );

create policy "Owners and admins can update events"
  on public.events for update
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

create policy "Event owners and admins can delete events"
  on public.events for delete
  using (created_by = auth.uid() or public.is_admin());

-- Event QR tokens (read-only for the event owner and admins;
-- tokens are created by a trigger, never by the client)
drop policy if exists "Event owners and admins can view QR tokens" on public.event_qr_tokens;

create policy "Event owners and admins can view QR tokens"
  on public.event_qr_tokens for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_qr_tokens.event_id
        and (e.created_by = auth.uid() or public.is_admin())
    )
  );

-- Event roster
drop policy if exists "Students can view their own enrollments" on public.event_students;
drop policy if exists "Teachers can view enrollments for their events" on public.event_students;
drop policy if exists "Teachers can manage enrollments for their events" on public.event_students;
drop policy if exists "Admins can manage enrollments" on public.event_students;

create policy "Students can view their own enrollments"
  on public.event_students for select
  using (student_id = auth.uid() or public.is_admin());

create policy "Teachers can view enrollments for their events"
  on public.event_students for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_students.event_id
        and e.created_by = auth.uid()
    )
  );

create policy "Teachers can manage enrollments for their events"
  on public.event_students for all
  using (
    exists (
      select 1 from public.events e
      where e.id = event_students.event_id
        and e.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_students.event_id
        and e.created_by = auth.uid()
    )
  );

create policy "Admins can manage enrollments"
  on public.event_students for all
  using (public.is_admin())
  with check (public.is_admin());

-- Attendance
drop policy if exists "Students can view their own attendance" on public.attendance;
drop policy if exists "Students can insert their own attendance" on public.attendance;
drop policy if exists "Teachers can view attendance for their events" on public.attendance;
drop policy if exists "Admins can view all attendance" on public.attendance;
drop policy if exists "Admins can update attendance" on public.attendance;
drop policy if exists "Admins can delete attendance" on public.attendance;

create policy "Students can view their own attendance"
  on public.attendance for select
  using (auth.uid() = student_id or public.is_admin());

create policy "Teachers can view attendance for their events"
  on public.attendance for select
  using (
    exists (
      select 1 from public.events e
      where e.id = attendance.event_id
        and e.created_by = auth.uid()
    )
  );

create policy "Admins can update attendance"
  on public.attendance for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete attendance"
  on public.attendance for delete
  using (public.is_admin());

-- NOTE: There is intentionally no INSERT policy on attendance.
-- Students record attendance only through record_attendance(),
-- which validates the event and prevents duplicates server-side.

-- ------------------------------------------------------------
-- 4. SECURE ATTENDANCE RPC
-- ------------------------------------------------------------

-- Drop the old unauthenticated-signature function so it cannot be
-- called to bypass the QR token check.
drop function if exists public.record_attendance(text);

create or replace function public.record_attendance(
  p_event_code text,
  p_qr_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_event public.events%rowtype;
  v_attendance_id uuid;
  v_status text := 'present';
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Please log in first.'
    );
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Your profile could not be found.'
    );
  end if;

  if not v_profile.is_active then
    return jsonb_build_object(
      'success', false,
      'message', 'Your account has been deactivated.'
    );
  end if;

  if v_profile.role <> 'student' then
    return jsonb_build_object(
      'success', false,
      'message', 'Only students can record attendance.'
    );
  end if;

  if p_event_code is null or length(trim(p_event_code)) = 0
     or p_qr_token is null or length(trim(p_qr_token)) = 0 then
    return jsonb_build_object(
      'success', false,
      'message', 'Invalid QR code.'
    );
  end if;

  select * into v_event
  from public.events
  where event_code = trim(p_event_code);

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Invalid QR code.'
    );
  end if;

  if not exists (
    select 1
    from public.event_qr_tokens t
    where t.event_id = v_event.id
      and t.token = trim(p_qr_token)
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Invalid or expired QR code.'
    );
  end if;

  if v_event.status <> 'open' then
    return jsonb_build_object(
      'success', false,
      'message', 'This event is closed.'
    );
  end if;

  if v_event.start_time is not null and now() < v_event.start_time then
    return jsonb_build_object(
      'success', false,
      'message', 'Event has not started yet.'
    );
  end if;

  -- 15-minute grace period, matching close_ended_events() and the app.
  if v_event.end_time is not null
     and now() > v_event.end_time + interval '15 minutes' then
    return jsonb_build_object(
      'success', false,
      'message', 'Event has already ended.'
    );
  end if;

  -- Mark as late when scanning more than 15 minutes after the start.
  if v_event.start_time is not null
     and now() > v_event.start_time + interval '15 minutes' then
    v_status := 'late';
  end if;

  -- Keep the roster complete for students who registered late.
  insert into public.event_students (event_id, student_id)
  values (v_event.id, v_uid)
  on conflict (event_id, student_id) do nothing;

  insert into public.attendance (student_id, event_id, status, recorded_by)
  values (v_uid, v_event.id, v_status, v_uid)
  on conflict (student_id, event_id) do nothing
  returning id into v_attendance_id;

  if v_attendance_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Already registered for this event.',
      'event_title', v_event.title
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'message', 'Attendance recorded!',
    'status', v_status,
    'event_title', v_event.title,
    'event_code', v_event.event_code,
    'scanned_at', now()
  );
end;
$$;

revoke all on function public.record_attendance(text, text) from public;
revoke all on function public.record_attendance(text, text) from anon;
grant execute on function public.record_attendance(text, text) to authenticated;

-- ------------------------------------------------------------
-- 4b. MANUAL ATTENDANCE RPCs (teacher/admin)
-- ------------------------------------------------------------

create or replace function public.mark_attendance(
  p_event_id uuid,
  p_student_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_event public.events%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Please log in first.'
    );
  end if;

  if p_status not in ('present', 'late', 'absent', 'excused') then
    return jsonb_build_object(
      'success', false,
      'message', 'Invalid attendance status.'
    );
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_active then
    return jsonb_build_object(
      'success', false,
      'message', 'Your account is not active.'
    );
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Event not found.'
    );
  end if;

  if not (
    v_profile.role = 'admin'
    or (v_profile.role = 'teacher' and v_event.created_by = v_uid)
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'You can only manage attendance for your own events.'
    );
  end if;

  if not exists (
    select 1
    from public.event_students es
    where es.event_id = p_event_id
      and es.student_id = p_student_id
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'This student is not on the event roster.'
    );
  end if;

  insert into public.attendance (
    student_id, event_id, status, recorded_by
  )
  values (p_student_id, p_event_id, p_status, v_uid)
  on conflict (student_id, event_id) do update
    set status = excluded.status,
        recorded_by = excluded.recorded_by,
        updated_at = now();

  return jsonb_build_object(
    'success', true,
    'message', 'Attendance updated.',
    'status', p_status
  );
end;
$$;

revoke all on function public.mark_attendance(uuid, uuid, text) from public;
revoke all on function public.mark_attendance(uuid, uuid, text) from anon;
grant execute on function public.mark_attendance(uuid, uuid, text) to authenticated;

create or replace function public.mark_all_present(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_event public.events%rowtype;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Please log in first.'
    );
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_active then
    return jsonb_build_object(
      'success', false,
      'message', 'Your account is not active.'
    );
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Event not found.'
    );
  end if;

  if not (
    v_profile.role = 'admin'
    or (v_profile.role = 'teacher' and v_event.created_by = v_uid)
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'You can only manage attendance for your own events.'
    );
  end if;

  -- Only fill in students without a record. Existing absent/excused/present
  -- marks are preserved so this action is never destructive.
  insert into public.attendance (
    student_id, event_id, status, recorded_by
  )
  select es.student_id, es.event_id, 'present', v_uid
  from public.event_students es
  where es.event_id = p_event_id
  on conflict (student_id, event_id) do nothing;

  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'success', true,
    'message',
      case
        when v_count = 0 then 'Everyone already has a record.'
        else 'Marked ' || v_count || ' student(s) present.'
      end,
    'count', v_count
  );
end;
$$;

revoke all on function public.mark_all_present(uuid) from public;
revoke all on function public.mark_all_present(uuid) from anon;
grant execute on function public.mark_all_present(uuid) to authenticated;

revoke all on function public.create_event_qr_token() from public;
revoke all on function public.enroll_students_for_event() from public;
revoke all on function public.enroll_new_student() from public;

-- ------------------------------------------------------------
-- 5. AUTO-PROFILE TRIGGER
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := new.raw_user_meta_data ->> 'full_name';

  -- Never trust a role supplied during sign-up. Every new account starts
  -- as a student; an administrator promotes teachers from the dashboard.
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, v_name, 'student')
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

------------------------------------------------------------
-- 6. AUTO-CLOSE EVENTS
-- Events close automatically 15 minutes after end_time.
-- The grace period also applies to record_attendance().
-- ------------------------------------------------------------

create or replace function public.close_ended_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.events
  set status = 'closed'
  where status = 'open'
    and end_time is not null
    and now() > end_time + interval '15 minutes';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.close_ended_events() from public;
revoke all on function public.close_ended_events() from anon;
grant execute on function public.close_ended_events() to authenticated;

-- Runs every minute. If pg_cron is unavailable in your project,
-- enable it from Database -> Extensions, then run this file again.
do $do$
begin
  if exists (
    select 1 from pg_available_extensions where name = 'pg_cron'
  ) then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'Could not enable pg_cron: %', sqlerrm;
    end;

    if exists (
      select 1 from pg_namespace where nspname = 'cron'
    ) then
      begin
        execute $q$
          select cron.unschedule('auto-close-ended-events')
          where exists (
            select 1 from cron.job
            where jobname = 'auto-close-ended-events'
          )
        $q$;
      exception when others then
        null;
      end;

      begin
        execute $q$
          select cron.schedule(
            'auto-close-ended-events',
            '* * * * *',
            $c$select public.close_ended_events();$c$
          )
        $q$;
      exception when others then
        raise notice 'Could not schedule auto-close job: %', sqlerrm;
      end;
    end if;
  else
    raise notice 'pg_cron is not available; enable it and re-run this file.';
  end if;
end;
$do$;

------------------------------------------------------------
-- 7. BOOTSTRAP THE FIRST ADMINISTRATOR
-- Register a normal account in the app, then run this once in
-- the SQL editor with that account's email:
--
--   update public.profiles
--   set role = 'admin'
--   where email = 'admin@your-school.edu';
--
-- After that, the Administrator can promote other users from
-- the Admin dashboard.
------------------------------------------------------------
-- END OF SCHEMA
------------------------------------------------------------
