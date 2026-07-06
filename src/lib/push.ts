// Helpers de Web Push para el panel del barbero: registrar el service worker,
// suscribirse y guardar la suscripción en Supabase (tabla push_subscriptions).
// La Edge Function `notify-booking` lee esa tabla y envía el aviso por cada
// reserva. En iOS solo funciona con la app instalada en la pantalla de inicio.
import type { SupabaseClient } from "@supabase/supabase-js";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

// Convierte la clave pública VAPID (base64url) al Uint8Array que espera
// pushManager.subscribe().
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Backed by an explicit ArrayBuffer so el tipo calce con BufferSource
  // (applicationServerKey) sin ArrayBufferLike genérico.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// true cuando la web corre como app instalada (standalone). iOS exige esto para
// permitir push; en Android el push funciona incluso desde el navegador.
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari iOS expone esta propiedad no estándar.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream
  );
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

// Registra el SW, pide permiso, se suscribe y guarda la suscripción para este
// barbero. Devuelve la suscripción o lanza un error con mensaje legible.
export async function subscribeBarber(
  supabase: SupabaseClient,
  barberId: string,
): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      "Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY. Avisá al administrador.",
    );
  }
  if (!isPushSupported()) {
    throw new Error("Este dispositivo o navegador no soporta notificaciones push.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "No diste permiso para notificaciones. Activalo en los ajustes del navegador.",
    );
  }

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      barber_id: barberId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: "endpoint" },
  );
  if (error) {
    throw new Error("No se pudo guardar la suscripción: " + error.message);
  }

  return sub;
}

export async function unsubscribeBarber(supabase: SupabaseClient): Promise<void> {
  const sub = await getExistingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
}
