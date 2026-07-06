-- ============================================================================
--  Fusion Salon booking app — full database schema
--  Apply with Supabase `apply_migration` (name: fusion_salon_schema).
--
--  Salon rules baked in here:
--    * No per-service duration; each booking is a nominal 30-min block.
--    * NO overbooking limit — several bookings may share the same time
--      (there is intentionally no EXCLUDE constraint).
--  The `-- === SEED STYLIST ===` block at the bottom is run SEPARATELY with
--  execute_sql after the auth user exists (see below).
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists pgcrypto;      -- gen_random_uuid / crypt for the seed
create extension if not exists pg_net;        -- net.http_post used by the notify trigger

-- Tables ---------------------------------------------------------------------
create table if not exists public.barbers (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  display_order integer not null default 0,
  active        boolean not null default true,
  notify_email  text,
  created_at    timestamptz not null default now()
);

create table if not exists public.appointments (
  id           uuid primary key default gen_random_uuid(),
  barber_id    uuid not null references public.barbers(id) on delete cascade,
  start_time   timestamptz not null,
  end_time     timestamptz not null,
  service_type text check (service_type in (
    'exfoliante_grasa','acido_hialuronico','soft_touch','nutricion_brillo',
    'cirugia_capilar','control_caida','celulas_madre','curly_therapy',
    'lavado_plancha','lavado_blower','lavado_ondas','lavado_corte_plancha',
    'tinte_completo','bano_color','refrescamiento_rubios',
    'trenzas_africanas','extensiones_naturales','corn_row','tecnica_crochet',
    'extensiones_semi','hair_glitter'
  )),
  kind         text not null default 'booking' check (kind in ('booking','block')),
  client_name  text,
  client_phone text,
  created_at   timestamptz not null default now(),
  constraint appt_time_valid check (end_time > start_time)
  -- NOTE: no anti-overlap EXCLUDE constraint — Fusion Salon allows unlimited
  -- bookings at the same time on purpose.
);
create index if not exists idx_appointments_barber_start
  on public.appointments (barber_id, start_time);

-- Private key/value store (VAPID keys etc). RLS on, NO policies => only the
-- service_role can read it.
create table if not exists public.app_config (
  name  text primary key,
  value text
);

-- Row Level Security ---------------------------------------------------------
alter table public.barbers      enable row level security;
alter table public.appointments enable row level security;
alter table public.app_config   enable row level security;

-- barbers: anyone can read (to list them); a stylist can update only their row.
drop policy if exists barbers_public_read on public.barbers;
create policy barbers_public_read on public.barbers
  for select to public using (true);

drop policy if exists barbers_self_update on public.barbers;
create policy barbers_self_update on public.barbers
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- appointments: a stylist has full CRUD over ONLY their own rows. There is NO
-- anon policy on purpose — clients never read appointments directly; they use
-- the SECURITY DEFINER RPCs below (which never expose other clients' PII).
drop policy if exists appt_barber_select on public.appointments;
create policy appt_barber_select on public.appointments
  for select to authenticated using (auth.uid() = barber_id);

drop policy if exists appt_barber_insert on public.appointments;
create policy appt_barber_insert on public.appointments
  for insert to authenticated with check (auth.uid() = barber_id);

drop policy if exists appt_barber_update on public.appointments;
create policy appt_barber_update on public.appointments
  for update to authenticated using (auth.uid() = barber_id) with check (auth.uid() = barber_id);

drop policy if exists appt_barber_delete on public.appointments;
create policy appt_barber_delete on public.appointments
  for delete to authenticated using (auth.uid() = barber_id);

-- app_config: intentionally NO policies (service_role only).

-- RPC: busy ranges for a stylist on a date (no PII, anon-safe). Kept for
-- completeness; the salon no longer blocks slots so the wizard doesn't use it.
create or replace function public.get_busy(p_barber_id uuid, p_date date)
returns table(start_time timestamptz, end_time timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  select a.start_time, a.end_time
  from public.appointments a
  where a.barber_id = p_barber_id
    and a.start_time < ((p_date + 1)::timestamp at time zone 'America/Costa_Rica')
    and a.end_time   > ( p_date     ::timestamp at time zone 'America/Costa_Rica')
  order by a.start_time;
$function$;

-- RPC: day load (bookings + blocks with kind) for a stylist on a date. Anon-safe
-- (times + kind only, no PII). The wizard uses it to grey out slots that fall in
-- a block or that already reached the 3-booking cap.
create or replace function public.get_day_load(p_barber_id uuid, p_date date)
returns table(start_time timestamptz, end_time timestamptz, kind text)
language sql
security definer
set search_path to 'public'
as $function$
  select a.start_time, a.end_time, a.kind
  from public.appointments a
  where a.barber_id = p_barber_id
    and a.start_time < ((p_date + 1)::timestamp at time zone 'America/Costa_Rica')
    and a.end_time   > ( p_date     ::timestamp at time zone 'America/Costa_Rica')
  order by a.start_time;
$function$;

-- RPC: transactional booking with validations (anon-safe) --------------------
create or replace function public.book_appointment(
  p_barber_id uuid,
  p_start timestamptz,
  p_service_type text,
  p_name text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_end timestamptz;
  v_local timestamp;
  v_dow int;
  v_id uuid;
  v_open_min int;
  v_close_min int;
  v_start_min int;
begin
  if not exists (select 1 from public.barbers b where b.id = p_barber_id and b.active) then
    raise exception 'Estilista no válida';
  end if;

  if p_service_type not in (
    'exfoliante_grasa','acido_hialuronico','soft_touch','nutricion_brillo',
    'cirugia_capilar','control_caida','celulas_madre','curly_therapy',
    'lavado_plancha','lavado_blower','lavado_ondas','lavado_corte_plancha',
    'tinte_completo','bano_color','refrescamiento_rubios',
    'trenzas_africanas','extensiones_naturales','corn_row','tecnica_crochet',
    'extensiones_semi','hair_glitter'
  ) then
    raise exception 'Servicio no válido';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'El nombre es obligatorio';
  end if;

  if p_start < now() then
    raise exception 'No se puede agendar en el pasado';
  end if;

  -- Nominal 30-minute block (services have no fixed duration here).
  v_end := p_start + interval '30 minutes';
  v_local := p_start at time zone 'America/Costa_Rica';
  v_dow := extract(dow from v_local);

  -- Horario por día (0=Dom .. 6=Sáb). Cerrado Dom + Mar. Lun/Mié/Jue/Vie
  -- 09:00–18:00. Sáb abre 08:00 y la última cita es a las 14:00 (cierre 14:30).
  if v_dow = 6 then
    v_open_min := 480;   -- 08:00
    v_close_min := 870;  -- 14:30 (última cita 14:00)
  elsif v_dow = any (array[1,3,4,5]::int[]) then
    v_open_min := 540;   -- 09:00
    v_close_min := 1080; -- 18:00
  else
    raise exception 'Cerrado ese día'; -- Dom (0) y Mar (2)
  end if;

  v_start_min := extract(hour from v_local) * 60 + extract(minute from v_local);
  if v_start_min < v_open_min or (v_start_min + 30) > v_close_min then
    raise exception 'Fuera del horario de atención';
  end if;

  if ((v_start_min - v_open_min) % 30) <> 0 then
    raise exception 'Horario no válido';
  end if;

  -- Reject bookings that fall inside a stylist block (personal time). Regular
  -- bookings still overlap each other without limit — only blocks are barriers.
  if exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber_id
      and a.kind = 'block'
      and a.start_time < v_end
      and a.end_time > p_start
  ) then
    raise exception 'Ese horario está bloqueado';
  end if;

  insert into public.appointments(barber_id, start_time, end_time, service_type, kind, client_name, client_phone)
  values (p_barber_id, p_start, v_end, p_service_type, 'booking', trim(p_name), nullif(trim(p_phone), ''))
  returning id into v_id;

  return v_id;
end;
$function$;

grant execute on function public.get_busy(uuid, date) to anon, authenticated;
grant execute on function public.get_day_load(uuid, date) to anon, authenticated;
grant execute on function public.book_appointment(uuid, timestamptz, text, text, text) to anon, authenticated;

-- Trigger: enforce the salon rules on EVERY write path (client booking RPC,
-- admin new appointment, and reschedule UPDATE): a booking may not overlap a
-- stylist block, and at most 3 bookings may overlap the same time.
create or replace function public.enforce_booking_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.kind = 'booking' then
    if exists (
      select 1 from public.appointments a
      where a.barber_id = new.barber_id and a.kind = 'block' and a.id <> new.id
        and a.start_time < new.end_time and a.end_time > new.start_time
    ) then
      raise exception 'Ese horario está bloqueado';
    end if;
    if (
      select count(*) from public.appointments a
      where a.barber_id = new.barber_id and a.kind = 'booking' and a.id <> new.id
        and a.start_time < new.end_time and a.end_time > new.start_time
    ) >= 3 then
      raise exception 'Ya hay 3 citas en ese horario';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_enforce_booking_rules on public.appointments;
create trigger trg_enforce_booking_rules
  before insert or update on public.appointments
  for each row execute function public.enforce_booking_rules();

-- Notification trigger: booking INSERT -> pg_net -> Edge Function -------------
-- Sends Web Push (and email, if configured — Fusion Salon uses push only).
create or replace function public.notify_booking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.kind = 'booking' then
    perform net.http_post(
      url := 'https://vdporvrmmewqwylyathg.supabase.co/functions/v1/notify-booking',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkcG9ydnJtbWV3cXd5bHlhdGhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNTc4MzAsImV4cCI6MjA5ODgzMzgzMH0.hItfpHDPg0hiuLquf5hiF3QaPPMWpZX8Rwi0BpQyu3M'
      ),
      body := jsonb_build_object('appointment_id', new.id),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_booking on public.appointments;
create trigger trg_notify_booking
  after insert on public.appointments
  for each row execute function public.notify_booking();

-- Web Push subscriptions: the stylist's phone/browser registers here to receive
-- a system notification for every booking. -----------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_barber
  on public.push_subscriptions (barber_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_self_select on public.push_subscriptions;
create policy push_subs_self_select on public.push_subscriptions
  for select to authenticated using (auth.uid() = barber_id);

drop policy if exists push_subs_self_insert on public.push_subscriptions;
create policy push_subs_self_insert on public.push_subscriptions
  for insert to authenticated with check (auth.uid() = barber_id);

drop policy if exists push_subs_self_update on public.push_subscriptions;
create policy push_subs_self_update on public.push_subscriptions
  for update to authenticated using (auth.uid() = barber_id) with check (auth.uid() = barber_id);

drop policy if exists push_subs_self_delete on public.push_subscriptions;
create policy push_subs_self_delete on public.push_subscriptions
  for delete to authenticated using (auth.uid() = barber_id);

-- Realtime: stream appointment changes (RLS still applies per user) -----------
alter publication supabase_realtime add table public.appointments;

-- ============================================================================
-- === SEED STYLIST === (run SEPARATELY via execute_sql; already applied for
--   this project with: z.rodriguez@fusionsalon.local / password / Zeidy
--   Rodriguez / notify_email NULL — no email service).
-- Creates the auth user (email/password login) + identity + the barbers row.
-- ============================================================================
-- do $$
-- declare v_uid uuid := gen_random_uuid();
-- begin
--   insert into auth.users (
--     instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
--     created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
--     confirmation_token, recovery_token, email_change_token_new, email_change
--   ) values (
--     '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
--     'z.rodriguez@fusionsalon.local', crypt('zeidy.rodriguez', gen_salt('bf')), now(),
--     now(), now(), '{"provider":"email","providers":["email"]}', '{}',
--     '', '', '', ''
--   );
--   insert into auth.identities (
--     id, user_id, identity_data, provider, provider_id,
--     last_sign_in_at, created_at, updated_at
--   ) values (
--     gen_random_uuid(), v_uid,
--     jsonb_build_object('sub', v_uid::text, 'email', 'z.rodriguez@fusionsalon.local'),
--     'email', 'z.rodriguez@fusionsalon.local', now(), now(), now()
--   );
--   insert into public.barbers (id, name, display_order, active, notify_email)
--   values (v_uid, 'Zeidy Rodriguez', 1, true, null);
-- end $$;
