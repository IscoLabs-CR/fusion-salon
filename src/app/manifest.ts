import type { MetadataRoute } from "next";

// Web App Manifest — hace la app instalable en la pantalla de inicio (iOS 16.4+
// y Android). `display: standalone` la abre sin barra del navegador, requisito
// para que iOS permita notificaciones push. Los iconos viven en /public.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fusion Salon — Reservas",
    short_name: "Fusion Salon",
    description:
      "Agenda de citas de Fusion Salon: recibí un aviso cada vez que entra una reserva.",
    start_url: "/barbero",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#0f766e",
    lang: "es",
    categories: ["business", "productivity", "lifestyle"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
