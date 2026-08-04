import Link from "next/link";
import { getSalonConfig } from "@/lib/salon";
import { weeklyHoursLabel } from "@/lib/booking";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = await getSalonConfig();
  const tagline =
    typeof config.theme.tagline === "string" ? config.theme.tagline : null;
  // Subtítulo "con {barbero}" solo cuando hay un único profesional.
  const soloBarber = config.barbers.length === 1 ? config.barbers[0].name : null;
  const hours = weeklyHoursLabel(config);

  return (
    <main className="relative flex-1 grid place-items-center overflow-hidden px-5 py-10">
      {/* Fondo mesh difuminado en los colores de la marca */}
      <div
        className="mesh-bg pointer-events-none absolute -inset-[20%] -z-10"
        aria-hidden
      />
      <div className="w-full max-w-xl">
        <div className="relative overflow-hidden rounded-[2rem] bg-paper shadow-[0_30px_90px_-45px_rgba(15,118,110,0.45)] ring-1 ring-black/5">
          {/* Acceso del equipo. Va DENTRO del card, en su esquina: en celular el
              card ocupa casi todo el ancho, así que flotarlo sobre la página lo
              dejaría montado sobre el borde redondeado. Apagado y lejos del botón
              de reservar, para que ninguna clienta lo toque por error. */}
          <Link
            href="/barbero/login"
            aria-label="Acceso estilista"
            title="Acceso estilista"
            className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full text-muted/70 transition-colors hover:bg-brand-tint hover:text-brand sm:right-5 sm:top-5"
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
              aria-hidden
            >
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="m10 17 5-5-5-5" />
              <path d="M15 12H3" />
            </svg>
          </Link>

          <div className="px-8 py-12 text-center sm:px-14 sm:py-16">
            {/* Logo sobre placa negra (el archivo tiene fondo negro, así calza) */}
            <div className="mx-auto mb-7 grid h-36 w-36 place-items-center overflow-hidden rounded-3xl bg-[#0b1210] ring-1 ring-gold/40 sm:h-40 sm:w-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.jpeg"
                alt={config.name}
                className="h-full w-full object-contain"
              />
            </div>

            {tagline && (
              <p className="font-display text-xs uppercase tracking-[0.4em] text-gold-deep">
                {tagline}
              </p>
            )}

            <h1 className="mt-3 font-fancy text-6xl font-bold uppercase leading-[1] tracking-tight text-ink sm:text-7xl">
              {config.name}
            </h1>

            {soloBarber && (
              <p className="mt-2 font-fancy text-xl italic tracking-wide text-brand">
                con {soloBarber}
              </p>
            )}

            <p className="mx-auto mt-5 max-w-sm text-balance text-muted">
              Reservá tu cita en segundos — elegí día y servicio, sin crear cuenta
              y sin filas.
            </p>

            {/* Un solo llamado a la acción: la clienta no puede equivocarse de
                botón. El acceso del equipo vive en la esquina del card. */}
            <div className="mx-auto mt-9 max-w-xs">
              <Link
                href="/reservar"
                className="inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-4 font-display text-lg font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep"
              >
                Reservar cita
              </Link>
            </div>

            <p className="mt-9 text-xs uppercase leading-relaxed tracking-[0.25em] text-muted">
              {hours.map((line, i) => (
                <span key={i}>
                  {line}
                  {i < hours.length - 1 && <br />}
                </span>
              ))}
            </p>
          </div>
        </div>

        <footer className="mt-6 text-center text-[11px] leading-relaxed text-muted/70 select-none">
          <p className="font-display uppercase tracking-[0.25em]">Isco Labs · 2026</p>
          <p className="mt-0.5 tracking-wide">
            Contacto:{" "}
            <a
              href="mailto:iscolabscr@gmail.com"
              className="transition-colors hover:text-brand"
            >
              iscolabscr@gmail.com
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
