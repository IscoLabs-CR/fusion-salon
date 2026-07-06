# Fusion Salon — App de reservas

Web app para reservar citas en **Fusion Salon** (estilista: **Zeidy Rodríguez**).
Las **clientas agendan sin crear cuenta** desde su teléfono; la **estilista**
gestiona su agenda desde un portal privado.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v3** (NO v4 — su binario nativo se bloquea en Windows con
  Application Control)
- **Supabase**: Postgres + Auth + Realtime + Edge Functions
- **@supabase/ssr** para la sesión de la estilista — protección de rutas en
  `src/proxy.ts` (Next 16 renombró `middleware` → `proxy`)
- **date-fns / date-fns-tz** para la zona horaria (`America/Costa_Rica`)
- **Web Push (VAPID)** para las notificaciones push (sin servicio de correo)

## Reglas de negocio (Fusion Salon)

- **Estilista:** Zeidy Rodríguez (una sola → el paso "estilista" se salta).
- **Horario:** **cerrado Mar y Dom**. Lun/Mié/Jue/Vie 9:00 – 18:00; Sáb 8:00 con
  **última cita a las 14:00** (`HOURS_BY_DOW` en `src/lib/booking.ts`; misma regla
  replicada en `book_appointment` en `supabase/schema.sql`).
- **Sin duración por servicio** y **sin límite de solape**: se pueden agendar
  varias citas a la misma hora (no hay constraint `EXCLUDE`). Cada reserva ocupa
  un bloque nominal de 30 min solo para mostrarse en la rejilla.
- **Servicios** en `src/lib/booking.ts` (`SERVICES`), agrupados en un **dropdown**
  por categoría: Tratamientos · Lavados y estilizados · Colorimetría ·
  Extensiones y trenzas. Los de precio variable muestran **"Por cotizar"** con la
  nota _"El precio depende de una evaluación previa."_
- **Datos de la clienta al reservar:** nombre + teléfono (sin login).

⚠️ Si cambiás servicios/precios, actualizá **tres lugares**: `SERVICES` en
`booking.ts`, el `CHECK`/`book_appointment` en `supabase/schema.sql`, y los
`SERVICE_LABELS`/`SERVICE_PRICES` de la Edge Function.

## Seguridad y datos

- `barbers` (lectura pública), `appointments` (CRUD solo del dueño vía RLS),
  `app_config` (privado, RLS sin policies → solo service_role lee las claves VAPID).
- La clienta anónima no lee `appointments`: usa la RPC `SECURITY DEFINER`
  `book_appointment` (validaciones de horario, día cerrado y alineación a 30 min).
- Login por **usuario/contraseña**: el usuario se mapea a
  `usuario@fusionsalon.local` (Supabase Auth usa correo por detrás, invisible).

## Correr localmente

```bash
npm install
npm run dev   # http://localhost:3000
```

Requiere `.env.local` (ya generado):

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # clave pública VAPID (notificaciones push)
```

**Rutas:** `/` · `/reservar` · `/barbero/login` · `/barbero`.
**Acceso estilista:** usuario `z.rodriguez` · contraseña `zeidy.rodriguez`.

## Notificaciones push (PWA — pantalla de inicio)

La app es instalable (**Agregar a pantalla de inicio**) y envía una **notificación
push del sistema** a la estilista por cada reserva, aunque tenga la app cerrada.
Al insertarse una reserva → trigger `trg_notify_booking` → `pg_net` llama a la
Edge Function `notify-booking` → **Web Push (VAPID)**. (El envío de correo con
Resend está incluido en el código pero **desactivado**: no hay key configurada.)

- **Manifest:** `src/app/manifest.ts` + iconos en `public/`
  (`node scripts/gen-icons.js public`).
- **Service worker:** `public/sw.js` (evento `push` + `notificationclick`).
- **Suscripción:** la estilista toca **"Activar notificaciones"** en `/barbero`;
  se guarda en `public.push_subscriptions` (RLS por usuario).
- **iOS vs Android:** en Android anda incluso desde el navegador; en
  **iPhone/iPad (iOS 16.4+)** hay que instalar la app en la pantalla de inicio y
  abrirla desde ese ícono antes de activar. Requiere **HTTPS** (en local anda en
  `http://localhost`).
