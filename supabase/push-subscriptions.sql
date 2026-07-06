-- ============================================================================
--  Web Push subscriptions — migración incremental
--  Aplicar sobre una base YA desplegada con `apply_migration`
--  (name: push_subscriptions). Para instalaciones nuevas esto ya está incluido
--  al final de schema.sql, así que NO hace falta correrlo dos veces.
--
--  Guarda la suscripción push del navegador/celular del barbero para poder
--  enviarle una notificación del sistema cada vez que entra una reserva.
--  La Edge Function `notify-booking` la lee con el service_role (salta RLS).
-- ============================================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers(id) on delete cascade,
  endpoint   text not null unique,       -- identifica el canal push del dispositivo
  p256dh     text not null,              -- clave pública del cliente (cifrado del payload)
  auth       text not null,              -- secreto de autenticación del cliente
  user_agent text,                       -- para que el barbero reconozca el dispositivo
  created_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_barber
  on public.push_subscriptions (barber_id);

alter table public.push_subscriptions enable row level security;

-- Un barbero solo administra SUS propias suscripciones. No hay policy para anon:
-- los clientes nunca tocan esta tabla. La Edge Function usa el service_role.
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
