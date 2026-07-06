import type { Metadata, Viewport } from "next";
import { Oswald, Inter, Geist_Mono, Cormorant } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-ticket",
  subsets: ["latin"],
});

// Serif elegante "tipo Amalfia" para el wordmark del hero (landing).
const cormorant = Cormorant({
  variable: "--font-fancy",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Fusion Salon — Reservá tu cita",
  description:
    "Agendá tu cita en Fusion Salon con Zeidy Rodríguez. Elegí día y servicio, sin crear cuenta.",
  // iOS no toma todo del manifest: necesita el apple-touch-icon y el meta
  // apple-mobile-web-app para instalarse "a pantalla completa" y habilitar push.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fusion Salon",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${oswald.variable} ${inter.variable} ${mono.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
