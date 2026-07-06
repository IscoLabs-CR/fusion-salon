/**
 * Builds an iCalendar (.ics) event for a confirmed appointment, including a
 * 2-hour reminder (VALARM TRIGGER:-PT2H). When the client opens the file, their
 * phone's calendar stores the event and fires the reminder locally — no server
 * push required.
 *
 * Los datos del salón (nombre, slug, servicio) vienen como parámetros: el módulo
 * no conoce ninguna config quemada (multitenant).
 */
export interface CalendarEvent {
  id: string | null;
  serviceLabel: string;
  shopName: string;
  slug: string; // dominio del UID del evento
  stylistName: string;
  clientName: string;
  start: Date;
  end: Date;
}

/** Date -> iCal UTC stamp, e.g. 2026-07-03T19:20:00.000Z -> 20260703T192000Z */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Escape reserved characters in iCal text values. */
function escICS(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function buildAppointmentICS(ev: CalendarEvent): string {
  const uid = `${ev.id ?? Date.now()}@${ev.slug}`;
  const summary = `Cita en ${ev.shopName} — ${ev.serviceLabel}`;
  const description = `Servicio: ${ev.serviceLabel}\nEstilista: ${ev.stylistName}\nA nombre de: ${ev.clientName}`;

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${ev.shopName}//Reservas//ES`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${escICS(summary)}`,
    `DESCRIPTION:${escICS(description)}`,
    `LOCATION:${escICS(ev.shopName)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio: tu cita es en 2 horas",
    "TRIGGER:-PT2H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Trigger the phone/browser to open the .ics so it can be saved to a calendar. */
export function downloadICS(ics: string, filename = "cita.ics"): void {
  const uri = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
  const a = document.createElement("a");
  a.href = uri;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
