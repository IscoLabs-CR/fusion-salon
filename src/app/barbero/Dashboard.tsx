"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Appointment } from "@/lib/types";
import type { SalonConfig, SalonService } from "@/lib/salon";
import MonthCalendar from "@/components/MonthCalendar";
import {
  type Slot,
  type BusyRow,
  type BookingWindow,
  getService,
  generateDaySlots,
  shopInstant,
  addDaysStr,
  shopToday,
  shopDateOf,
  formatShopTime,
  longDateLabel,
  upcomingDates,
  dateParts,
  isClosedDay,
  minutesToLabel,
  priceLabel,
  formatCRC,
  servicesByCategory,
  weekRange,
  weekRangeLabel,
  dayHours,
  hoursWindow,
  openDaysInRange,
  rangeLengthDays,
  SLOT_STEP_MIN,
} from "@/lib/booking";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPushSupported,
  isStandalone,
  isIOS,
  getExistingSubscription,
  subscribeBarber,
  unsubscribeBarber,
} from "@/lib/push";

type ModalState =
  | null
  | { type: "new" }
  | { type: "block" }
  | { type: "reschedule"; appt: Appointment }
  | { type: "editService"; appt: Appointment };

interface WeekStats {
  expected: number;
  realized: number;
  count: number;
  startStr: string;
}

export default function Dashboard({
  config,
  barberId,
  barberName,
}: {
  config: SalonConfig;
  barberId: string;
  barberName: string;
}) {
  const router = useRouter();
  const tz = config.timezone;
  const supabase = useMemo(() => createClient(), []);
  const [dateStr, setDateStr] = useState<string>(shopToday(tz));
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>(null);
  const [week, setWeek] = useState<WeekStats | null>(null);
  // Notificaciones: reservas recientes + cuántas no ha visto la estilista.
  const [notifs, setNotifs] = useState<Appointment[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  // Buscador de clientes: lo que escribe el admin + las citas futuras sobre las
  // que se filtra. `futureLoaded` evita volver a traerlas en cada tecla.
  const [query, setQuery] = useState("");
  const [future, setFuture] = useState<Appointment[] | null>(null);
  const futureLoaded = useRef(false);

  const load = useCallback(
    async (d: string) => {
      setLoading(true);
      const dayStart = shopInstant(d, 0, tz);
      const dayEnd = shopInstant(addDaysStr(d, 1), 0, tz);
      const { data, error } = await supabase
        .from("appointments")
        .select("*")
        .gte("start_time", dayStart.toISOString())
        .lt("start_time", dayEnd.toISOString())
        .order("start_time");
      if (error) console.error("No se pudo cargar la agenda del día:", error.message);
      setAppts((data ?? []) as Appointment[]);
      setLoading(false);
    },
    [supabase, tz],
  );

  // Ingresos de la semana: esperado = todas las reservas de la semana; realizado
  // = las que ya terminaron (end_time <= ahora). Solo suma servicios con precio
  // fijo — los "Por cotizar" no tienen monto, así que no cuentan al total.
  const loadWeek = useCallback(async () => {
    const wr = weekRange(tz);
    const { data, error } = await supabase
      .from("appointments")
      .select("service_slug, end_time")
      .eq("kind", "booking")
      .gte("start_time", wr.start.toISOString())
      .lt("start_time", wr.end.toISOString());
    if (error) console.error("No se pudo cargar el resumen semanal:", error.message);
    const rows = (data ?? []) as {
      service_slug: string | null;
      end_time: string;
    }[];
    const now = Date.now();
    let expected = 0;
    let realized = 0;
    let count = 0;
    for (const r of rows) {
      if (!r.service_slug) continue;
      const price = getService(config, r.service_slug)?.priceCRC ?? 0;
      expected += price;
      count += 1;
      if (new Date(r.end_time).getTime() <= now) realized += price;
    }
    setWeek({ expected, realized, count, startStr: wr.startStr });
  }, [supabase, config, tz]);

  // Reservas recientes (hechas por clientes), más nuevas primero. Se cargan al
  // montar sin tocar el contador de no-vistas — solo los inserts en vivo lo suben.
  const loadNotifs = useCallback(async () => {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("kind", "booking")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) console.error("No se pudieron cargar las notificaciones:", error.message);
    setNotifs((data ?? []) as Appointment[]);
  }, [supabase]);

  // Todas las citas futuras (de ahora en adelante) para el buscador. Se traen
  // UNA vez —cuando el admin empieza a escribir— y el filtrado ocurre en memoria,
  // así la búsqueda responde en cada tecla sin volver a la base.
  const loadFuture = useCallback(async () => {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("kind", "booking")
      .gte("start_time", new Date().toISOString())
      .order("start_time")
      .limit(500);
    if (error)
      console.error("No se pudieron cargar las citas futuras:", error.message);
    setFuture((data ?? []) as Appointment[]);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifs();
  }, [loadNotifs]);

  useEffect(() => {
    if (query.trim().length === 0 || futureLoaded.current) return;
    futureLoaded.current = true;
    loadFuture();
  }, [query, loadFuture]);

  useEffect(() => {
    // Carga la agenda del día desde Supabase; el setState ocurre tras resolver
    // el async, que es el patrón esperado de fetch-en-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(dateStr);
  }, [dateStr, load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWeek();
  }, [loadWeek]);

  // Realtime: refresca en vivo cuando cambian las citas de esta estilista (p. ej.
  // un cliente reserva). RLS limita el stream a sus propias filas.
  useEffect(() => {
    const channel = supabase
      .channel(`appointments-${barberId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `barber_id=eq.${barberId}`,
        },
        (payload) => {
          load(dateStr);
          loadWeek();
          if (futureLoaded.current) loadFuture();
          // Un cliente acaba de reservar: mostrarlo en notificaciones y encender
          // el punto rojo hasta que abra el panel.
          if (payload.eventType === "INSERT") {
            const row = payload.new as Appointment;
            if (row.kind === "booking") {
              setNotifs((prev) =>
                [row, ...prev.filter((n) => n.id !== row.id)].slice(0, 30),
              );
              setUnseen((u) => u + 1);
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, barberId, dateStr, load, loadWeek, loadFuture]);

  function toggleNotif() {
    setNotifOpen((open) => {
      if (!open) setUnseen(0);
      return !open;
    });
  }

  async function removeAppt(id: string) {
    if (!confirm("¿Eliminar este espacio de tu agenda?")) return;
    const { error } = await supabase.from("appointments").delete().eq("id", id);
    if (error) {
      console.error("No se pudo eliminar la cita:", error.message);
      alert("No se pudo eliminar. Intentá de nuevo.");
      return;
    }
    load(dateStr);
    loadWeek();
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/barbero/login");
    router.refresh();
  }

  // Coincidencias por nombre (sin importar mayúsculas ni tildes) o por teléfono
  // (comparando solo dígitos, para que "8888-8888" y "88888888" sean lo mismo).
  const results = useMemo(() => {
    const q = query.trim();
    if (q.length === 0 || !future) return [];
    const name = normalizeText(q);
    const digits = digitsOnly(q);
    return future.filter((a) => {
      const byName =
        name.length > 0 && normalizeText(a.client_name ?? "").includes(name);
      const byPhone =
        digits.length >= 3 && digitsOnly(a.client_phone ?? "").includes(digits);
      return byName || byPhone;
    });
  }, [query, future]);

  // Al tocar un resultado la agenda salta a ese día y baja hasta la lista.
  function openResult(d: string) {
    setDateStr(d);
    setQuery("");
    requestAnimationFrame(() => {
      document
        .getElementById("agenda")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const isToday = dateStr === shopToday(tz);

  return (
    <div className="flex-1">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg bg-[#0b1210]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.jpeg"
                alt={config.name}
                className="h-full w-full object-contain"
              />
            </span>
            <div>
              <p className="font-display text-xs uppercase tracking-[0.3em] text-brand">
                {config.name}
              </p>
              <p className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
                {barberName}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ShareButton shopName={config.name} />
            <NotifBell
              notifs={notifs}
              unseen={unseen}
              open={notifOpen}
              onToggle={toggleNotif}
              onClose={() => setNotifOpen(false)}
              config={config}
            />
            <button
              onClick={logout}
              className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pb-20">
        {/* Notificaciones push: instalar la app + activar avisos por reserva */}
        <PushSetup supabase={supabase} barberId={barberId} />

        {/* Buscar citas futuras de un cliente */}
        <ClientSearch
          query={query}
          onQuery={setQuery}
          results={results}
          loading={future === null}
          config={config}
          onPick={openResult}
        />

        {/* Ingresos de la semana */}
        {week && <WeeklyPanel week={week} />}

        {/* Navegador de fechas */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={() => setDateStr((d) => addDaysStr(d, -1))}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-brand hover:text-brand"
            aria-label="Día anterior"
          >
            ‹
          </button>
          <div className="text-center">
            <p className="font-display text-xl font-semibold uppercase tracking-tight text-ink">
              {longDateLabel(dateStr)}
            </p>
            {!isToday && (
              <button
                onClick={() => setDateStr(shopToday(tz))}
                className="text-xs font-medium text-brand hover:text-brand-deep"
              >
                Ir a hoy
              </button>
            )}
            {isToday && (
              <p className="text-xs uppercase tracking-wider text-muted">Hoy</p>
            )}
          </div>
          <button
            onClick={() => setDateStr((d) => addDaysStr(d, 1))}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-brand hover:text-brand"
            aria-label="Día siguiente"
          >
            ›
          </button>
        </div>

        {/* Acciones */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            onClick={() => setModal({ type: "new" })}
            className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-3 font-display text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep"
          >
            + Nueva cita
          </button>
          <button
            onClick={() => setModal({ type: "block" })}
            className="inline-flex items-center justify-center rounded-full border border-line px-4 py-3 font-display text-sm font-semibold uppercase tracking-wide text-ink transition-colors hover:border-brand hover:text-brand"
          >
            Bloquear horario
          </button>
        </div>

        {/* Agenda */}
        <div id="agenda" className="mt-6 scroll-mt-4">
          {loading ? (
            <p className="py-12 text-center text-muted">Cargando agenda…</p>
          ) : appts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
              <p className="text-ink">No tenés citas este día.</p>
              <p className="mt-1 text-sm text-muted">
                Los clientes pueden reservar con vos desde la web.
              </p>
            </div>
          ) : (
            <ul className="grid gap-3">
              {appts.map((a) => (
                <AgendaRow
                  key={a.id}
                  appt={a}
                  config={config}
                  onDelete={() => removeAppt(a.id)}
                  onReschedule={() => setModal({ type: "reschedule", appt: a })}
                  onEditService={() => setModal({ type: "editService", appt: a })}
                />
              ))}
            </ul>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-muted">
          Esta es tu agenda privada. Nadie más puede verla.
        </p>
      </div>

      {modal?.type === "new" && (
        <NewAppointmentModal
          supabase={supabase}
          config={config}
          barberId={barberId}
          defaultDate={dateStr}
          onClose={() => setModal(null)}
          onDone={(d) => {
            setModal(null);
            setDateStr(d);
            load(d);
          }}
        />
      )}
      {modal?.type === "block" && (
        <BlockModal
          supabase={supabase}
          config={config}
          barberId={barberId}
          defaultDate={dateStr}
          onClose={() => setModal(null)}
          onDone={(d) => {
            setModal(null);
            setDateStr(d);
            load(d);
          }}
        />
      )}
      {modal?.type === "reschedule" && (
        <RescheduleModal
          supabase={supabase}
          config={config}
          appt={modal.appt}
          onClose={() => setModal(null)}
          onDone={(d) => {
            setModal(null);
            setDateStr(d);
            load(d);
          }}
        />
      )}
      {modal?.type === "editService" && (
        <EditServiceModal
          supabase={supabase}
          config={config}
          appt={modal.appt}
          onClose={() => setModal(null)}
          onDone={(d) => {
            setModal(null);
            setDateStr(d);
            load(d);
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------- push notifications */

type PushStatus = "loading" | "unsupported" | "need-install" | "off" | "on";

// Banner que instala la app (iOS) y activa las notificaciones push del sistema
// para que la estilista reciba un aviso por cada reserva aunque tenga la app
// cerrada. Se auto-oculta cuando ya está todo activado.
function PushSetup({
  supabase,
  barberId,
}: {
  supabase: SupabaseClient;
  barberId: string;
}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // iOS solo expone la API de push cuando la web está instalada en la
      // pantalla de inicio; antes de eso hay que guiar a instalarla.
      if (!isPushSupported()) {
        const next = isIOS() && !isStandalone() ? "need-install" : "unsupported";
        if (!cancelled) setStatus(next);
        return;
      }
      const sub = await getExistingSubscription();
      const granted =
        typeof Notification !== "undefined" && Notification.permission === "granted";
      if (!cancelled) setStatus(sub && granted ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await subscribeBarber(supabase, barberId);
      setStatus("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo activar.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeBarber(supabase);
      setStatus("off");
    } catch {
      setError("No se pudo desactivar. Intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || status === "unsupported") return null;

  if (status === "on") {
    return (
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper px-4 py-3">
        <p className="text-sm text-ink">
          <span className="mr-1.5 text-brand">●</span>
          Notificaciones activadas en este dispositivo.
        </p>
        <button
          onClick={disable}
          disabled={busy}
          className="text-xs font-medium text-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
        >
          Desactivar
        </button>
      </div>
    );
  }

  if (status === "need-install") {
    return (
      <div className="mt-4 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3">
        <p className="font-display text-sm font-semibold uppercase tracking-wide text-brand">
          Recibí un aviso por cada reserva
        </p>
        <p className="mt-1 text-sm text-ink">
          En iPhone/iPad, primero instalá la app: tocá el botón{" "}
          <span aria-hidden>⎋</span> <strong>Compartir</strong> y luego{" "}
          <strong>“Agregar a inicio”</strong>. Abrí la app desde el ícono y volvé
          acá para activar las notificaciones.
        </p>
      </div>
    );
  }

  // status === "off"
  return (
    <div className="mt-4 rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-brand">
            Activá los avisos de reservas
          </p>
          <p className="mt-1 text-sm text-ink">
            Te llega una notificación al teléfono cada vez que un cliente reserva,
            aunque tengás la app cerrada.
          </p>
        </div>
        <button
          onClick={enable}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-full bg-brand px-4 py-2.5 font-display text-sm font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
        >
          {busy ? "Activando…" : "Activar notificaciones"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/* --------------------------------------------------------------- compartir */

// Botón que abre la hoja de compartir nativa del teléfono (Web Share API) con el
// enlace de reservas, para pasarlo a las clientas por WhatsApp, etc. En equipos
// sin `navigator.share` (escritorio) copia el enlace al portapapeles.
function ShareButton({ shopName }: { shopName: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.origin;
    const shareData = {
      title: `${shopName} — Reservá tu cita`,
      text: `Reservá tu cita en ${shopName} ✨`,
      url,
    };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // Se cerró la hoja sin compartir (AbortError) u otro error: ignorar.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sin permiso de portapapeles: no hay más que hacer de forma segura.
    }
  }

  return (
    <div className="relative">
      <button
        onClick={share}
        aria-label="Compartir enlace de reservas"
        className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-brand hover:text-brand"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.59 13.51l6.83 3.98" />
          <path d="M15.41 6.51l-6.82 3.98" />
        </svg>
      </button>
      {copied && (
        <span className="absolute right-0 top-12 z-50 whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper shadow-lg">
          ¡Enlace copiado!
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------- notifications */

function NotifBell({
  notifs,
  unseen,
  open,
  onToggle,
  onClose,
  config,
}: {
  notifs: Appointment[];
  unseen: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  config: SalonConfig;
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        aria-label="Notificaciones"
        className="relative grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition-colors hover:border-brand hover:text-brand"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-paper">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Fondo para cerrar al tocar fuera */}
          <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
          {/* En celular: fijo al viewport con márgenes (inset-x-4) para que no se
              corte a la izquierda. En sm+: dropdown anclado bajo la campana. */}
          <div className="fixed inset-x-4 top-16 z-50 overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-80">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
                Reservas
              </p>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="grid h-7 w-7 place-items-center rounded-full text-muted transition-colors hover:bg-line hover:text-brand"
              >
                ✕
              </button>
            </div>
            {notifs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                Aún no hay reservas.
              </p>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                {notifs.map((n) => {
                  const svc = n.service_slug
                    ? getService(config, n.service_slug)
                    : null;
                  return (
                    <li
                      key={n.id}
                      className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0"
                    >
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-semibold uppercase tracking-wide text-ink">
                          {n.client_name ?? "Cliente"}
                        </p>
                        <p className="text-xs text-muted">
                          {longDateLabel(
                            new Intl.DateTimeFormat("en-CA", {
                              timeZone: config.timezone,
                            }).format(new Date(n.start_time)),
                          )}{" "}
                          · {formatShopTime(n.start_time, config.timezone)}
                        </p>
                        {svc && (
                          <p className="text-xs text-muted">{svc.label}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------- buscar clientes */

/** Minúsculas y sin tildes: así "José" aparece buscando "jose" o "JOSE". */
function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Solo los dígitos, para que "8888-8888", "+506 8888 8888" y "88888888" sean
 *  el mismo teléfono al buscar. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// Barra de búsqueda del admin: encuentra las citas FUTURAS de un cliente por
// nombre o teléfono y lleva la agenda al día de la cita elegida.
function ClientSearch({
  query,
  onQuery,
  results,
  loading,
  config,
  onPick,
}: {
  query: string;
  onQuery: (v: string) => void;
  results: Appointment[];
  loading: boolean;
  config: SalonConfig;
  onPick: (dateStr: string) => void;
}) {
  const q = query.trim();

  return (
    <div className="mt-6">
      <div className="relative">
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
          aria-hidden
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Buscar por nombre o teléfono"
          aria-label="Buscar citas futuras por nombre o teléfono"
          autoComplete="off"
          className="w-full rounded-full border border-line bg-paper py-3 pl-11 pr-11 text-ink outline-none placeholder:text-muted focus:border-brand"
        />
        {q.length > 0 && (
          <button
            onClick={() => onQuery("")}
            aria-label="Limpiar búsqueda"
            className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted transition-colors hover:bg-line hover:text-brand"
          >
            ✕
          </button>
        )}
      </div>

      {q.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-ink">
              Próximas citas
            </p>
            <p className="text-xs text-muted">
              {loading
                ? "Buscando…"
                : `${results.length} ${results.length === 1 ? "resultado" : "resultados"}`}
            </p>
          </div>

          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Buscando…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Ningún cliente con citas futuras coincide con “{q}”.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {results.map((a) => {
                const svc = a.service_slug
                  ? getService(config, a.service_slug)
                  : null;
                const d = shopDateOf(a.start_time, config.timezone);
                return (
                  <li
                    key={a.id}
                    className="border-b border-line last:border-b-0"
                  >
                    <button
                      onClick={() => onPick(d)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-line/40"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-semibold uppercase tracking-wide text-ink">
                          {a.client_name ?? "Cliente"}
                        </p>
                        <p className="text-xs text-muted">
                          {longDateLabel(d)} ·{" "}
                          {formatShopTime(a.start_time, config.timezone)}
                          {svc && ` · ${svc.label}`}
                        </p>
                        {a.client_phone && (
                          <p className="font-mono text-xs text-muted">
                            {a.client_phone}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs font-medium text-brand">
                        Ver día ›
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="border-t border-line px-4 py-2 text-[11px] text-muted/80">
            Solo se muestran citas de hoy en adelante.
          </p>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- weekly panel */

function WeeklyPanel({ week }: { week: WeekStats }) {
  const pct =
    week.expected > 0 ? Math.round((week.realized / week.expected) * 100) : 0;
  return (
    <div className="relative mt-6 overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-sm font-semibold uppercase tracking-wide text-ink">
            Esta semana
          </p>
          <p className="text-xs text-muted">{weekRangeLabel(week.startStr)}</p>
        </div>

        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="font-display text-4xl font-bold leading-none text-brand">
              {pct}%
            </p>
            <p className="mt-1 text-xs text-muted">
              del dinero esperado ya realizado
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-lg font-medium text-ink">
              {formatCRC(week.realized)}
            </p>
            <p className="text-xs text-muted">
              de {formatCRC(week.expected)} · {week.count}{" "}
              {week.count === 1 ? "cita" : "citas"}
            </p>
          </div>
        </div>

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-2 text-[11px] text-muted/80">
          El total considera solo servicios con precio fijo (los “Por cotizar” no
          suman).
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- agenda */

function AgendaRow({
  appt,
  config,
  onDelete,
  onReschedule,
  onEditService,
}: {
  appt: Appointment;
  config: SalonConfig;
  onDelete: () => void;
  onReschedule: () => void;
  onEditService: () => void;
}) {
  const isBlock = appt.kind === "block";
  const svc = appt.service_slug ? getService(config, appt.service_slug) : null;

  return (
    <li className="relative overflow-hidden rounded-2xl border border-line bg-paper">
      <div
        className={`absolute inset-y-0 left-0 w-1.5 ${isBlock ? "bg-gold" : "bg-brand"}`}
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3 py-4 pl-5 pr-4">
        <div className="flex gap-4">
          <div className="text-center">
            <p className="font-mono text-lg font-medium leading-none text-ink">
              {formatShopTime(appt.start_time, config.timezone)}
            </p>
            {isBlock && (
              <p className="mt-1 font-mono text-xs text-muted">
                {formatShopTime(appt.end_time, config.timezone)}
              </p>
            )}
          </div>
          <div>
            {isBlock ? (
              <>
                <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">
                  Bloqueado
                </p>
                <p className="text-sm text-muted">
                  Tiempo personal · no reservable
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-base font-semibold uppercase tracking-wide text-ink">
                  {appt.client_name ?? "Cita"}
                </p>
                <p className="text-sm text-muted">
                  {svc?.label ?? "Servicio"}
                  {svc && ` · ${priceLabel(svc)}`}
                </p>
                {appt.client_phone && (
                  <a
                    href={`tel:${appt.client_phone}`}
                    className="mt-0.5 inline-block font-mono text-xs text-brand hover:text-brand-deep"
                  >
                    {appt.client_phone}
                  </a>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {!isBlock && (
            <>
              <button
                onClick={onEditService}
                className="text-xs font-medium text-brand hover:text-brand-deep"
              >
                Servicio
              </button>
              <button
                onClick={onReschedule}
                className="text-xs font-medium text-brand hover:text-brand-deep"
              >
                Reagendar
              </button>
            </>
          )}
          <button
            onClick={onDelete}
            className="text-xs font-medium text-muted hover:text-brand-deep"
          >
            Eliminar
          </button>
        </div>
      </div>
    </li>
  );
}

/* --------------------------------------------------------------- shared */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-5"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md min-w-0 overflow-y-auto rounded-t-3xl border border-line bg-paper p-6 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold uppercase tracking-tight text-ink">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-line hover:text-brand"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function DayChips({
  config,
  value,
  onChange,
}: {
  config: SalonConfig;
  value: string;
  onChange: (d: string) => void;
}) {
  const dates = upcomingDates(14, config.timezone);
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {dates.map((d) => {
        const p = dateParts(d);
        const closed = isClosedDay(config, d);
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            disabled={closed}
            onClick={() => onChange(d)}
            className={[
              "flex shrink-0 flex-col items-center rounded-xl border px-3 py-2 transition-colors",
              closed
                ? "cursor-not-allowed border-line bg-line/40 text-muted/60"
                : active
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-paper text-ink hover:border-brand",
            ].join(" ")}
          >
            <span className="text-[10px] uppercase tracking-wider">
              {p.weekdayShort}
            </span>
            <span className="font-mono text-base font-medium leading-tight">
              {p.day}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ServiceSelect({
  config,
  value,
  onChange,
}: {
  config: SalonConfig;
  value: string;
  onChange: (slug: string) => void;
}) {
  const svc = getService(config, value);
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-ink">Servicio</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-ink outline-none focus:border-brand"
      >
        {config.categories.map((cat) => (
          <optgroup key={cat.slug} label={cat.label}>
            {servicesByCategory(config, cat.slug).map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label} — {priceLabel(s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {svc && (
        <p className="mt-1.5 font-mono text-xs text-muted">{priceLabel(svc)}</p>
      )}
    </div>
  );
}

function SlotButtons({
  slots,
  selectedMin,
  onSelect,
}: {
  slots: Slot[];
  selectedMin: number | null;
  onSelect: (s: Slot) => void;
}) {
  if (!slots.some((s) => s.available))
    return (
      <p className="py-6 text-center text-muted">
        Sin horarios disponibles este día.
      </p>
    );
  return (
    <div className="grid grid-cols-4 gap-2">
      {slots.map((s) =>
        s.available ? (
          <button
            key={s.startMin}
            type="button"
            onClick={() => onSelect(s)}
            className={[
              "rounded-lg border py-2 font-mono text-sm transition-colors",
              selectedMin === s.startMin
                ? "border-brand bg-brand text-white"
                : "border-brand/50 bg-brand-tint text-brand hover:bg-brand hover:text-white",
            ].join(" ")}
          >
            {s.label}
          </button>
        ) : (
          <div
            key={s.startMin}
            className="rounded-lg border border-line bg-line/40 py-2 text-center font-mono text-sm text-muted/60 line-through"
          >
            {s.label}
          </div>
        ),
      )}
    </div>
  );
}

function ModalError({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-brand/30 bg-brand-tint px-4 py-2.5 text-sm text-brand-deep">
      {children}
    </p>
  );
}

// Trae la carga del día (bloqueos + citas) de la estilista (ve sus filas por RLS).
// Se usa para deshabilitar los horarios bloqueados o llenos al crear/reagendar.
function useDayLoad(supabase: SupabaseClient, tz: string) {
  return useCallback(
    async (d: string): Promise<BusyRow[]> => {
      const dayStart = shopInstant(d, 0, tz).toISOString();
      const dayEnd = shopInstant(addDaysStr(d, 1), 0, tz).toISOString();
      const { data, error } = await supabase
        .from("appointments")
        .select("start_time, end_time, kind")
        .lt("start_time", dayEnd)
        .gt("end_time", dayStart);
      if (error) console.error("No se pudo cargar la disponibilidad:", error.message);
      return ((data ?? []) as {
        start_time: string;
        end_time: string;
        kind: string;
      }[]).map((r) => ({
        start: new Date(r.start_time),
        end: new Date(r.end_time),
        kind: r.kind === "block" ? "block" : "booking",
      }));
    },
    [supabase, tz],
  );
}

/* ------------------------------------------------------------ new modal */

function NewAppointmentModal({
  supabase,
  config,
  barberId,
  defaultDate,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  config: SalonConfig;
  barberId: string;
  defaultDate: string;
  onClose: () => void;
  onDone: (d: string) => void;
}) {
  const [service, setService] = useState<string>(config.services[0]?.slug ?? "");
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fetchLoad = useDayLoad(supabase, config.timezone);
  const serviceInfo: SalonService | null = service
    ? getService(config, service) ?? null
    : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const busy = await fetchLoad(date);
      if (!alive) return;
      setSlot(null);
      setSlots(generateDaySlots(config, date, serviceInfo, busy));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, service, fetchLoad]);

  async function submit() {
    if (!slot) {
      setError("Elegí un horario.");
      return;
    }
    if (name.trim().length === 0) {
      setError("Escribí el nombre del cliente.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.rpc("book_appointment", {
      p_slug: config.slug,
      p_barber_id: barberId,
      p_start: slot.start.toISOString(),
      p_service_slug: service,
      p_name: name.trim(),
      p_phone: phone.trim(),
    });
    setSubmitting(false);
    if (error) {
      setError(error.message || "No se pudo crear la cita.");
      return;
    }
    onDone(date);
  }

  return (
    <Modal title="Nueva cita" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4">
        <ServiceSelect config={config} value={service} onChange={setService} />

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Día</p>
          <DayChips config={config} value={date} onChange={setDate} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Horario</p>
          <SlotButtons
            slots={slots}
            selectedMin={slot?.startMin ?? null}
            onSelect={setSlot}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            Nombre del cliente
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-ink outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink">
            Teléfono
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-ink outline-none focus:border-brand"
          />
        </label>

        {error && <ModalError>{error}</ModalError>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
        >
          {submitting ? "Guardando…" : "Crear cita"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------- block modal */

// Cuánto puede mirar hacia adelante el estilista para bloquear. Es más que el
// horizonte del cliente a propósito: las vacaciones de diciembre se cierran en
// agosto, mucho antes de que nadie pueda agendar en esas fechas.
const BLOCK_LOOKAHEAD_DAYS = 365;

type BlockMode = "time" | "days";

function BlockModal({
  supabase,
  config,
  barberId,
  defaultDate,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  config: SalonConfig;
  barberId: string;
  defaultDate: string;
  onClose: () => void;
  onDone: (d: string) => void;
}) {
  const [mode, setMode] = useState<BlockMode>("time");
  const [date, setDate] = useState(defaultDate);
  const win = hoursWindow(config);
  // Horario del día elegido (o la ventana más amplia si cae en un día cerrado).
  const hours = dayHours(config, date) ?? win;
  const [startMin, setStartMin] = useState(hours.openMin);
  const [endMin, setEndMin] = useState(hours.openMin + SLOT_STEP_MIN);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Rango de días completos (vacaciones, viajes).
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState(defaultDate);
  // El conteo viaja con el rango que lo produjo, para no mostrar el número del
  // rango anterior mientras la consulta del nuevo sigue en vuelo.
  const [conflicts, setConflicts] = useState<{ key: string; count: number } | null>(
    null,
  );

  const tz = config.timezone;
  const blockWindow: BookingWindow = useMemo(() => {
    const minDate = shopToday(tz);
    return { minDate, maxDate: addDaysStr(minDate, BLOCK_LOOKAHEAD_DAYS) };
  }, [tz]);

  const openDays = openDaysInRange(config, fromDate, toDate);
  const rangeKey = `${fromDate}:${toDate}`;
  const conflictCount = conflicts?.key === rangeKey ? conflicts.count : 0;

  // Bloquear NO cancela lo que ya está agendado, así que hay que avisarlo antes
  // de que se vaya de vacaciones creyendo que la agenda quedó limpia.
  useEffect(() => {
    if (mode !== "days" || toDate < fromDate) return;
    let cancelled = false;
    (async () => {
      const { count, error } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("kind", "booking")
        .eq("barber_id", barberId)
        .gte("start_time", shopInstant(fromDate, 0, tz).toISOString())
        .lt("start_time", shopInstant(addDaysStr(toDate, 1), 0, tz).toISOString());
      if (error) console.error("No se pudo revisar el rango:", error.message);
      if (!cancelled)
        setConflicts({ key: `${fromDate}:${toDate}`, count: count ?? 0 });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, mode, fromDate, toDate, barberId, tz]);

  // Al cambiar de día, reencuadrá el rango dentro del horario de ese día.
  function pickDate(d: string) {
    const h = dayHours(config, d) ?? win;
    setDate(d);
    setStartMin(h.openMin);
    setEndMin(h.openMin + SLOT_STEP_MIN);
  }

  function pickFrom(d: string) {
    setFromDate(d);
    setError(null);
    // Arrastrar el final evita el estado inválido de "hasta" antes que "desde".
    if (toDate < d) setToDate(d);
  }

  // Un bloqueo por día abierto, de la apertura al cierre. Los días cerrados se
  // saltean: ya son inasignables, no hace falta gastar una fila en ellos.
  async function submitRange() {
    if (toDate < fromDate) {
      setError("El día final debe ser posterior al inicial.");
      return;
    }
    const span = rangeLengthDays(fromDate, toDate);
    if (span > config.bookingHorizonDays) {
      setError(
        `No se pueden bloquear más de ${config.bookingHorizonDays} días de una vez.`,
      );
      return;
    }
    if (openDays.length === 0) {
      setError("No hay días abiertos en ese rango.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const rows = openDays.flatMap((d) => {
      const h = dayHours(config, d);
      if (!h) return [];
      return [
        {
          barber_id: barberId,
          start_time: shopInstant(d, h.openMin, tz).toISOString(),
          end_time: shopInstant(d, h.closeMin, tz).toISOString(),
          kind: "block",
        },
      ];
    });
    const { error } = await supabase.from("appointments").insert(rows);
    setSubmitting(false);
    if (error) {
      setError("No se pudieron crear los bloqueos. Intentá de nuevo.");
      return;
    }
    onDone(fromDate);
  }

  const startOptions: number[] = [];
  for (let m = hours.openMin; m <= hours.closeMin - SLOT_STEP_MIN; m += SLOT_STEP_MIN)
    startOptions.push(m);
  const endOptions: number[] = [];
  for (let m = startMin + SLOT_STEP_MIN; m <= hours.closeMin; m += SLOT_STEP_MIN)
    endOptions.push(m);

  async function submit() {
    if (endMin <= startMin) {
      setError("La hora de fin debe ser posterior al inicio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.from("appointments").insert({
      barber_id: barberId,
      start_time: shopInstant(date, startMin, config.timezone).toISOString(),
      end_time: shopInstant(date, endMin, config.timezone).toISOString(),
      kind: "block",
    });
    setSubmitting(false);
    if (error) {
      setError("No se pudo bloquear. Intentá de nuevo.");
      return;
    }
    onDone(date);
  }

  return (
    <Modal title="Bloquear horario" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4">
        <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-line/30 p-1">
          <ModeTab
            active={mode === "time"}
            onClick={() => {
              setMode("time");
              setError(null);
            }}
          >
            Un rato
          </ModeTab>
          <ModeTab
            active={mode === "days"}
            onClick={() => {
              setMode("days");
              setError(null);
            }}
          >
            Días completos
          </ModeTab>
        </div>

        {mode === "time" ? (
          <>
            <p className="text-sm text-muted">
              Reservá tiempo para vos. Las clientas no podrán agendar dentro de
              ese rango.
            </p>

            <div>
              <p className="mb-2 text-sm font-medium text-ink">Día</p>
              <DayChips config={config} value={date} onChange={pickDate} />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  Desde
                </span>
                <select
                  value={startMin}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setStartMin(v);
                    if (endMin <= v) setEndMin(v + SLOT_STEP_MIN);
                  }}
                  className="w-full min-w-0 rounded-xl border border-line px-3 py-2.5 font-mono text-ink outline-none focus:border-brand"
                >
                  {startOptions.map((m) => (
                    <option key={m} value={m}>
                      {minutesToLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-0">
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  Hasta
                </span>
                <select
                  value={endMin}
                  onChange={(e) => setEndMin(Number(e.target.value))}
                  className="w-full min-w-0 rounded-xl border border-line px-3 py-2.5 font-mono text-ink outline-none focus:border-brand"
                >
                  {endOptions.map((m) => (
                    <option key={m} value={m}>
                      {minutesToLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && <ModalError>{error}</ModalError>}

            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
            >
              {submitting ? "Guardando…" : "Bloquear"}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Cerrá varios días de corrido (vacaciones, un viaje). Se bloquea el
              día completo, de la apertura al cierre.
            </p>

            <div>
              <p className="mb-2 text-sm font-medium text-ink">Desde</p>
              <MonthCalendar
                config={config}
                value={fromDate}
                onChange={pickFrom}
                window={blockWindow}
              />
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-ink">Hasta</p>
              <MonthCalendar
                config={config}
                value={toDate}
                onChange={(d) => {
                  setToDate(d);
                  setError(null);
                }}
                window={{ minDate: fromDate, maxDate: blockWindow.maxDate }}
              />
            </div>

            <p className="text-sm text-muted">
              {openDays.length === 0
                ? "No hay días abiertos en ese rango."
                : `Se van a cerrar ${openDays.length} ${
                    openDays.length === 1 ? "día" : "días"
                  }: ${longDateLabel(openDays[0])}${
                    openDays.length > 1
                      ? ` → ${longDateLabel(openDays[openDays.length - 1])}`
                      : ""
                  }.`}
            </p>

            {conflictCount > 0 && (
              <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm text-gold-deep">
                Ya tenés {conflictCount}{" "}
                {conflictCount === 1 ? "cita agendada" : "citas agendadas"} en
                ese rango. Bloquear no {conflictCount === 1 ? "la" : "las"}{" "}
                cancela: avisale a{" "}
                {conflictCount === 1 ? "la clienta" : "las clientas"} y{" "}
                {conflictCount === 1 ? "eliminala" : "eliminalas"} a mano.
              </p>
            )}

            {error && <ModalError>{error}</ModalError>}

            <button
              type="button"
              onClick={submitRange}
              disabled={submitting || openDays.length === 0}
              className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
            >
              {submitting
                ? "Guardando…"
                : `Bloquear ${openDays.length} ${
                    openDays.length === 1 ? "día" : "días"
                  }`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition-colors",
        active ? "bg-paper text-ink shadow-sm" : "text-muted hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------- reschedule modal */

function RescheduleModal({
  supabase,
  config,
  appt,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  config: SalonConfig;
  appt: Appointment;
  onClose: () => void;
  onDone: (d: string) => void;
}) {
  // Día calendario de la cita en la zona del salón (YYYY-MM-DD).
  const startDateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
  }).format(new Date(appt.start_time));

  const [date, setDate] = useState(startDateStr);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fetchLoad = useDayLoad(supabase, config.timezone);
  const serviceInfo: SalonService | null = appt.service_slug
    ? getService(config, appt.service_slug) ?? null
    : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const busy = await fetchLoad(date);
      if (!alive) return;
      setSlot(null);
      setSlots(generateDaySlots(config, date, serviceInfo, busy));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, fetchLoad]);

  async function submit() {
    if (!slot) {
      setError("Elegí un nuevo horario.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const { error } = await supabase
      .from("appointments")
      .update({
        start_time: slot.start.toISOString(),
        end_time: slot.end.toISOString(),
      })
      .eq("id", appt.id);
    setSubmitting(false);
    if (error) {
      setError("No se pudo reagendar. Intentá de nuevo.");
      return;
    }
    onDone(date);
  }

  return (
    <Modal title="Reagendar cita" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-xl border border-line bg-line/30 px-4 py-3 text-sm">
          <span className="font-medium text-ink">{appt.client_name}</span>
          <span className="text-muted">
            {" "}
            · {formatShopTime(appt.start_time, config.timezone)} → mover a…
          </span>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Día</p>
          <DayChips config={config} value={date} onChange={setDate} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-ink">Nuevo horario</p>
          <SlotButtons
            slots={slots}
            selectedMin={slot?.startMin ?? null}
            onSelect={setSlot}
          />
        </div>

        {error && <ModalError>{error}</ModalError>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
        >
          {submitting ? "Guardando…" : "Guardar cambios"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- edit service modal */

// Cambiar el servicio de una cita ya creada (p. ej. el cliente terminó tomando un
// servicio distinto o adicional al que reservó). Mantiene la hora de inicio;
// recalcula end_time con la duración del nuevo servicio. El precio no se guarda en
// la cita (se deriva del catálogo), así que la agenda y el panel semanal se ajustan solos.
function EditServiceModal({
  supabase,
  config,
  appt,
  onClose,
  onDone,
}: {
  supabase: SupabaseClient;
  config: SalonConfig;
  appt: Appointment;
  onClose: () => void;
  onDone: (d: string) => void;
}) {
  // Día calendario de la cita en la zona del salón (para recargar ese día al terminar).
  const dayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timezone,
  }).format(new Date(appt.start_time));

  const [service, setService] = useState<string>(
    appt.service_slug ?? config.services[0]?.slug ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const unchanged = service === appt.service_slug;

  async function submit() {
    if (!service) {
      setError("Elegí un servicio.");
      return;
    }
    setSubmitting(true);
    setError(null);
    // Recalcula el fin con la duración del nuevo servicio, manteniendo el inicio.
    const dur = getService(config, service)?.durationMin ?? 30;
    const newEnd = new Date(
      new Date(appt.start_time).getTime() + dur * 60_000,
    ).toISOString();
    const { error } = await supabase
      .from("appointments")
      .update({ service_slug: service, end_time: newEnd })
      .eq("id", appt.id);
    setSubmitting(false);
    if (error) {
      // Los mensajes del trigger del servidor ya vienen legibles (p. ej. si el
      // servicio más largo se solapa con otra cita: "No hay campo en ese horario").
      setError(error.message || "No se pudo cambiar el servicio. Intentá de nuevo.");
      return;
    }
    onDone(dayStr);
  }

  return (
    <Modal title="Cambiar servicio" onClose={onClose}>
      <div className="grid grid-cols-1 gap-4">
        <div className="rounded-xl border border-line bg-line/30 px-4 py-3 text-sm">
          <span className="font-medium text-ink">{appt.client_name}</span>
          <span className="text-muted">
            {" "}
            · {longDateLabel(dayStr)} ·{" "}
            {formatShopTime(appt.start_time, config.timezone)}
          </span>
        </div>

        <ServiceSelect config={config} value={service} onChange={setService} />

        {error && <ModalError>{error}</ModalError>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || unchanged}
          className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
        >
          {submitting ? "Guardando…" : "Guardar servicio"}
        </button>
      </div>
    </Modal>
  );
}
