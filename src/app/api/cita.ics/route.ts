import { type NextRequest } from "next/server";
import { buildAppointmentICS } from "@/lib/calendar";
import { getSalonConfig } from "@/lib/salon";

/**
 * Sirve la cita como archivo iCalendar. Existe porque iOS solo entrega un evento
 * a la app Calendario si llega por HTTP con `Content-Type: text/calendar` y
 * `Content-Disposition: inline`; un data: URI con `download` (lo que hacíamos
 * antes) termina como archivo suelto en Descargas y nunca abre el calendario.
 *
 * Los datos del evento viajan en el query string; el nombre y el slug del salón
 * los pone el server desde la config del despliegue.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const start = new Date(q.get("inicio") ?? "");
  const end = new Date(q.get("fin") ?? "");

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return new Response("Falta la fecha de la cita.", { status: 400 });
  }

  const salon = await getSalonConfig();
  const ics = buildAppointmentICS({
    id: q.get("id"),
    serviceLabel: q.get("servicio") ?? "Cita",
    shopName: salon.name,
    slug: salon.slug,
    stylistName: q.get("estilista") ?? "",
    clientName: q.get("nombre") ?? "",
    start,
    end,
  });

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="cita.ics"',
      "Cache-Control": "no-store",
    },
  });
}
