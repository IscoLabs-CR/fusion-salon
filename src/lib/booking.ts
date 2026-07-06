import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { SalonConfig, SalonService, DayHours } from "@/lib/salon";

/**
 * Lógica de agenda compartida por el wizard del cliente y el panel del barbero.
 * TODA la config (servicios, horario, categorías, zona, tope por espacio) llega
 * desde la base vía `SalonConfig` (RPC get_salon_public) — nada quemado. El
 * razonamiento de reloj de pared usa la zona del salón; los instantes absolutos
 * (Date / timestamptz) se usan para guardar.
 *
 * Duración por servicio + tope por espacio cubren ambos modelos:
 *   - barbería: cortes de 30/60/90 min, 1 por espacio;
 *   - salón:   bloque de 30 min, N por espacio.
 */

export const SLOT_STEP_MIN = 30; // granularidad de la rejilla

/* --------------------------------------------------------------- precios */

export function formatCRC(amount: number): string {
  return `₡${amount.toLocaleString("en-US")}`;
}

/** Etiqueta de precio: el monto, o "Por cotizar" cuando no hay. */
export function priceLabel(s: SalonService): string {
  return s.priceCRC == null ? "Por cotizar" : formatCRC(s.priceCRC);
}

/* -------------------------------------------------------------- servicios */

export function getService(
  config: SalonConfig,
  slug: string,
): SalonService | undefined {
  return config.services.find((s) => s.slug === slug);
}

export function servicesByCategory(
  config: SalonConfig,
  categorySlug: string,
): SalonService[] {
  return config.services.filter((s) => s.category === categorySlug);
}

/* --------------------------------------------------------------- horario */

/** Ventana más amplia de la semana (menor apertura / mayor cierre). Respaldo para
 *  la UI que necesita límites aunque el día caiga cerrado (p. ej. bloquear horario). */
export function hoursWindow(config: SalonConfig): DayHours {
  const open = config.hoursByDow
    .filter((h): h is DayHours => h != null)
    .map((h) => h.openMin);
  const close = config.hoursByDow
    .filter((h): h is DayHours => h != null)
    .map((h) => h.closeMin);
  return {
    openMin: open.length ? Math.min(...open) : 480,
    closeMin: close.length ? Math.max(...close) : 1080,
  };
}

/* ----------------------------------------------------------------- slots */

export interface Slot {
  startMin: number; // minutos desde medianoche (hora local del salón)
  label: string; // ej. "9:00"
  start: Date; // instante absoluto (UTC)
  end: Date; // instante absoluto (UTC), start + duración del servicio
  available: boolean;
}

// Una fila ocupada del día. Un "block" del barbero bloquea el espacio por sí
// solo; las reservas solo lo bloquean cuando se juntan maxBookingsPerSlot.
export interface BusyRow {
  start: Date;
  end: Date;
  kind: "booking" | "block";
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/** Día de la semana de una fecha YYYY-MM-DD (0 = Domingo .. 6 = Sábado). */
export function dowFromDateStr(dateStr: string): number {
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Horario de trabajo de un día calendario, o null si el salón cierra. */
export function dayHours(config: SalonConfig, dateStr: string): DayHours | null {
  return config.hoursByDow[dowFromDateStr(dateStr)] ?? null;
}

/** true cuando el salón está cerrado ese día. */
export function isClosedDay(config: SalonConfig, dateStr: string): boolean {
  return dayHours(config, dateStr) == null;
}

/** Instante absoluto para una hora de pared local del salón en un día dado. */
export function shopInstant(
  dateStr: string,
  minutesFromMidnight: number,
  tz: string,
): Date {
  const h = Math.floor(minutesFromMidnight / 60);
  const m = minutesFromMidnight % 60;
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  return fromZonedTime(`${dateStr}T${hh}:${mm}:00`, tz);
}

/**
 * Cada hora de inicio en la rejilla de 30 min dentro del horario. Un espacio está
 * disponible si es futuro, no cae en un "block", y tiene menos de
 * maxBookingsPerSlot reservas superpuestas. El fin del espacio usa la DURACIÓN del
 * servicio elegido, así un corte de 60 min ocupa dos casillas de 30.
 */
export function generateDaySlots(
  config: SalonConfig,
  dateStr: string,
  service: SalonService | null,
  busy: BusyRow[] = [],
  now: Date = new Date(),
): Slot[] {
  const hours = dayHours(config, dateStr);
  if (!hours) return [];
  const dur = service?.durationMin ?? SLOT_STEP_MIN;
  const slots: Slot[] = [];
  for (let m = hours.openMin; m + dur <= hours.closeMin; m += SLOT_STEP_MIN) {
    const start = shopInstant(dateStr, m, config.timezone);
    const end = new Date(start.getTime() + dur * 60_000);
    const notPast = start.getTime() > now.getTime();
    const blocked = busy.some(
      (b) => b.kind === "block" && overlaps(start, end, b.start, b.end),
    );
    const bookingCount = busy.reduce(
      (n, b) =>
        n +
        (b.kind === "booking" && overlaps(start, end, b.start, b.end) ? 1 : 0),
      0,
    );
    slots.push({
      startMin: m,
      label: minutesToLabel(m),
      start,
      end,
      available: notPast && !blocked && bookingCount < config.maxBookingsPerSlot,
    });
  }
  return slots;
}

/* -------------------------------------------------------- fechas / zonas */

/** Formatea un instante como HH:mm en la zona del salón. */
export function formatShopTime(d: Date | string, tz: string): string {
  return formatInTimeZone(new Date(d), tz, "HH:mm");
}

/** Fecha de hoy (YYYY-MM-DD) en la zona del salón. */
export function shopToday(tz: string): string {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

const WEEKDAYS_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const WEEKDAYS_FULL = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const MONTHS_SHORT = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];
const MONTHS_FULL = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function addDaysStr(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Próximos `count` días calendario (YYYY-MM-DD) desde hoy, en hora del salón. */
export function upcomingDates(count: number, tz: string): string[] {
  const today = shopToday(tz);
  return Array.from({ length: count }, (_, i) => addDaysStr(today, i));
}

export interface DateParts {
  weekdayShort: string;
  weekdayFull: string;
  day: number;
  monthShort: string;
  monthFull: string;
  year: number;
  dow: number;
}

export function dateParts(dateStr: string): DateParts {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return {
    weekdayShort: WEEKDAYS_SHORT[dow],
    weekdayFull: WEEKDAYS_FULL[dow],
    day: d,
    monthShort: MONTHS_SHORT[mo - 1],
    monthFull: MONTHS_FULL[mo - 1],
    year: y,
    dow,
  };
}

export function longDateLabel(dateStr: string): string {
  const p = dateParts(dateStr);
  return `${p.weekdayFull} ${p.day} de ${p.monthFull}`;
}

export interface WeekRange {
  startStr: string; // Lunes (YYYY-MM-DD)
  endStr: string; // Lunes siguiente, exclusivo (YYYY-MM-DD)
  start: Date; // Lunes 00:00 en hora del salón (instante absoluto)
  end: Date; // Lunes siguiente 00:00 en hora del salón (instante absoluto)
}

/** La semana Lun–Dom (como instantes) que contiene `today` en hora del salón. */
export function weekRange(tz: string, today: string = shopToday(tz)): WeekRange {
  const { dow } = dateParts(today);
  const daysFromMonday = (dow + 6) % 7; // Lun=0, Mar=1, ... Dom=6
  const startStr = addDaysStr(today, -daysFromMonday);
  const endStr = addDaysStr(startStr, 7);
  return {
    startStr,
    endStr,
    start: shopInstant(startStr, 0, tz),
    end: shopInstant(endStr, 0, tz),
  };
}

/** Etiqueta legible de una semana, ej. "Lun 30 jun – Sáb 5 jul". */
export function weekRangeLabel(startStr: string): string {
  const a = dateParts(startStr);
  const b = dateParts(addDaysStr(startStr, 5)); // Sábado
  return `${a.weekdayShort} ${a.day} ${a.monthShort} – ${b.weekdayShort} ${b.day} ${b.monthShort}`;
}

/** Resumen de horario para la landing (agrupa días con el mismo horario), ej.
 *  ["Lun–Vie · 9:00 – 18:00", "Sáb · 8:00 – 14:30", "Cerrado Mar y Dom"]. */
export function weeklyHoursLabel(config: SalonConfig): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Lun..Dom
  const groups: { days: number[]; hours: DayHours | null }[] = [];
  for (const d of order) {
    const h = config.hoursByDow[d] ?? null;
    const last = groups[groups.length - 1];
    const same =
      last &&
      ((last.hours == null && h == null) ||
        (last.hours != null &&
          h != null &&
          last.hours.openMin === h.openMin &&
          last.hours.closeMin === h.closeMin));
    if (same) last.days.push(d);
    else groups.push({ days: [d], hours: h });
  }
  const lines: string[] = [];
  const closed: number[] = [];
  for (const g of groups) {
    if (g.hours == null) {
      closed.push(...g.days);
      continue;
    }
    const label =
      g.days.length === 1
        ? WEEKDAYS_SHORT[g.days[0]]
        : `${WEEKDAYS_SHORT[g.days[0]]}–${WEEKDAYS_SHORT[g.days[g.days.length - 1]]}`;
    lines.push(
      `${label} · ${minutesToLabel(g.hours.openMin)} – ${minutesToLabel(g.hours.closeMin)}`,
    );
  }
  if (closed.length) lines.push(`Cerrado ${closed.map((d) => WEEKDAYS_SHORT[d]).join(" y ")}`);
  return lines;
}
