import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

// Avisa a la estilista cuando entra una reserva, disparado por el trigger
// notify_booking() vía pg_net en la base multitenant compartida.
//
// MULTITENANT: resuelve el salón desde la cita y saca todo de la base:
//   * label/precio del servicio -> salon_services (catálogo por salón)
//   * Correo (Resend)           -> salon_secrets del salón (RESEND_API_KEY / NOTIFY_FROM)
//   * Web Push (VAPID)          -> app_config GLOBAL (un solo par para todo el SaaS)
// Manda DOS cosas de forma independiente (si una falla, la otra igual sale):
//   1. Correo — se salta si el salón no tiene Resend o el barbero no tiene notify_email.
//   2. Web Push — notificación al celular de la estilista por cada dispositivo suscrito.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rest(path: string, init?: RequestInit): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) return [];
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function fmt(dt: string, tz: string) {
  const d = new Date(dt);
  const date = new Intl.DateTimeFormat("es-CR", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const time = new Intl.DateTimeFormat("es-CR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, time };
}

function colones(n: number): string {
  return n ? `₡${n.toLocaleString("en-US")}` : "Por cotizar";
}

// Escape user-controlled values before interpolating them into the email HTML.
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- Web Push helpers -------------------------------------------------------

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 2 ? "==" : b64.length % 4 === 3 ? "=" : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Construye el par de JWK que espera @negrel/webpush a partir de las claves
// VAPID en formato "raw" (público = punto 0x04||x||y en base64url; privado = d).
function vapidJwks(pub: string, priv: string) {
  const raw = b64urlToBytes(pub); // 65 bytes: 0x04 || x(32) || y(32)
  const x = bytesToB64url(raw.slice(1, 33));
  const y = bytesToB64url(raw.slice(33, 65));
  return {
    publicKey: { kty: "EC", crv: "P-256", x, y, ext: true, key_ops: ["verify"] },
    privateKey: { kty: "EC", crv: "P-256", x, y, d: priv, ext: true, key_ops: ["sign"] },
  } as { publicKey: JsonWebKey; privateKey: JsonWebKey };
}

type PushRow = { id: string; endpoint: string; p256dh: string; auth: string };

async function sendPush(
  barberId: string,
  cfg: Map<string, string>,
  payload: { title: string; body: string; url: string },
): Promise<{ sent: number; removed: number; skipped?: string }> {
  const pub = Deno.env.get("VAPID_PUBLIC") ?? cfg.get("vapid_public_key") ?? "";
  const privRaw = Deno.env.get("VAPID_PRIVATE") ?? cfg.get("vapid_private_key") ?? "";
  const subject =
    Deno.env.get("VAPID_SUBJECT") ?? cfg.get("vapid_subject") ?? "mailto:notificaciones@example.com";
  if (!pub || !privRaw) return { sent: 0, removed: 0, skipped: "no vapid keys" };

  const subs = (await rest(
    `push_subscriptions?barber_id=eq.${barberId}&select=id,endpoint,p256dh,auth`,
  )) as PushRow[];
  if (subs.length === 0) return { sent: 0, removed: 0, skipped: "no subscriptions" };

  const vapidKeys = await webpush.importVapidKeys(vapidJwks(pub, privRaw), {
    extractable: false,
  });
  const server = await webpush.ApplicationServer.new({
    contactInformation: subject,
    vapidKeys,
  });

  const body = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (row) => {
      try {
        const subscriber = server.subscribe({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        });
        await subscriber.pushTextMessage(body, {});
        sent++;
      } catch (e) {
        // 404/410 => la suscripción ya no existe: la limpiamos para no reintentar.
        const status = (e as { response?: Response })?.response?.status;
        if (status === 404 || status === 410) {
          await rest(`push_subscriptions?id=eq.${row.id}`, { method: "DELETE" });
          removed++;
        } else {
          console.error("push failed:", String(e));
        }
      }
    }),
  );

  return { sent, removed };
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json().catch(() => ({}));
    const id = payload.appointment_id ?? payload.record?.id;
    if (!id) return json({ ok: false, reason: "missing appointment_id" });

    // La cita trae su salón; join a barbers (destinatario) y salons (nombre + tz).
    const rows = await rest(
      `appointments?id=eq.${id}&select=id,salon_id,barber_id,kind,client_name,client_phone,service_slug,start_time,end_time,barbers(name,notify_email),salons(name,timezone)`,
    );
    const appt = rows[0];
    if (!appt) return json({ ok: false, reason: "appointment not found" });
    if (appt.kind !== "booking") return json({ ok: true, reason: "not a booking" });

    const barber = Array.isArray(appt.barbers) ? appt.barbers[0] : appt.barbers;
    const salon = Array.isArray(appt.salons) ? appt.salons[0] : appt.salons;
    const tz = salon?.timezone ?? "America/Costa_Rica";
    const shopName = salon?.name ?? "Salón";

    // Label + precio del servicio, desde el catálogo del salón (no hardcode).
    let svc = appt.service_slug ?? "Servicio";
    let priceNum = 0;
    if (appt.service_slug) {
      const svcRows = await rest(
        `salon_services?salon_id=eq.${appt.salon_id}&slug=eq.${appt.service_slug}&select=label,price_crc`,
      );
      if (svcRows[0]) {
        svc = svcRows[0].label ?? svc;
        priceNum = svcRows[0].price_crc ?? 0;
      }
    }
    const price = colones(priceNum);

    // VAPID global del SaaS.
    const cfgRows = await rest(`app_config?select=name,value`);
    const cfg = new Map(
      cfgRows.map((r: { name: string; value: string }) => [r.name, r.value]),
    );

    // Resend (correo) por salón.
    const secRows = await rest(
      `salon_secrets?salon_id=eq.${appt.salon_id}&select=resend_api_key,notify_from`,
    );
    const sec = (secRows[0] ?? {}) as { resend_api_key?: string; notify_from?: string };

    const { date, time } = fmt(appt.start_time, tz);

    // --- 1. Correo (Resend) — deshabilitado si no hay key/destinatario -------
    let emailResult: unknown = { skipped: true };
    try {
      const to = barber?.notify_email;
      const resendKey = Deno.env.get("RESEND_API_KEY") || (sec.resend_api_key ?? "");
      let from = Deno.env.get("NOTIFY_FROM") || (sec.notify_from ?? "onboarding@resend.dev");
      if (!from.includes("<")) from = `${shopName} <${from}>`;

      if (!to) {
        emailResult = { skipped: "stylist has no notify_email" };
      } else if (!resendKey) {
        emailResult = { skipped: "no resend api key configured" };
      } else {
        const subject = `Nueva cita · ${appt.client_name} · ${date} ${time}`;
        const rrow = (label: string, value: string, bold = false) =>
          `<tr><td style="color:#5c6b68;padding:6px 0;font-size:14px;">${label}</td>` +
          `<td style="text-align:right;padding:6px 0;font-size:14px;${bold ? "font-weight:bold;" : ""}">${value}</td></tr>`;
        const html =
          `<div style="font-family:Arial,Helvetica,sans-serif;color:#0b1210;max-width:520px;margin:0 auto;">` +
          `<div style="background:#0f766e;color:#ffffff;padding:16px 20px;border-radius:12px 12px 0 0;">` +
          `<strong style="font-size:18px;letter-spacing:2px;">NUEVA CITA</strong></div>` +
          `<div style="border:1px solid #e6ece9;border-top:none;border-radius:0 0 12px 12px;padding:8px 20px 20px;">` +
          `<table style="width:100%;border-collapse:collapse;">` +
          rrow("Cliente", esc(appt.client_name ?? "—"), true) +
          rrow("Teléfono", esc(appt.client_phone ?? "—")) +
          rrow("Servicio", esc(svc)) +
          rrow("Precio", esc(price)) +
          rrow("Día", esc(date)) +
          rrow("Hora", esc(time), true) +
          rrow("Estilista", esc(barber?.name ?? "—")) +
          `</table></div></div>`;
        const text =
          `Nueva cita\n\nCliente: ${appt.client_name}\nTeléfono: ${appt.client_phone ?? "—"}\n` +
          `Servicio: ${svc}\nPrecio: ${price}\nDía: ${date}\nHora: ${time}\nEstilista: ${barber?.name ?? "—"}`;

        const sendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from, to, subject, html, text }),
        });
        emailResult = { ok: sendRes.ok, status: sendRes.status };
      }
    } catch (e) {
      emailResult = { ok: false, error: String(e) };
    }

    // --- 2. Web Push --------------------------------------------------------
    let pushResult: unknown = { skipped: true };
    try {
      pushResult = await sendPush(appt.barber_id, cfg, {
        title: "Nueva cita",
        body: `${appt.client_name ?? "Cliente"} · ${date} ${time} · ${svc}`,
        url: "/barbero",
      });
    } catch (e) {
      pushResult = { ok: false, error: String(e) };
    }

    return json({ ok: true, email: emailResult, push: pushResult });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
