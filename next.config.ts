import type { NextConfig } from "next";

// Standard defense-in-depth HTTP security headers, applied to every route.
// These mitigate clickjacking, MIME sniffing, referrer leakage, and limit the
// browser features the page can request.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

// En desarrollo NO enviamos las cabeceras que bloquean el framing
// (X-Frame-Options/HSTS): las extensiones de "mobile preview" cargan la app en
// un iframe/webview y con DENY se ven en blanco. En producción sí van todas.
const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Don't advertise the framework/version to attackers.
  poweredByHeader: false,

  async headers() {
    return [
      ...(isProd
        ? [
            {
              source: "/:path*",
              headers: securityHeaders,
            },
          ]
        : []),
      {
        // El service worker no debe cachearse, para que el navegador siempre
        // tome la última versión y controle todo el sitio (scope "/").
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
