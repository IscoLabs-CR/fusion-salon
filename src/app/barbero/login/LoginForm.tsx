"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// La estilista ingresa con un usuario. Supabase Auth usa correo por detrás, así
// que mapeamos el usuario a un dominio interno fijo `<slug>.local` (invisible).
export default function LoginForm({
  salonName,
  slug,
}: {
  salonName: string;
  slug: string;
}) {
  const router = useRouter();
  const usernameDomain = `${slug}.local`;
  const rememberKey = `${slug}:stylist-username`;

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pre-llena el usuario si se recordó en un login anterior.
  useEffect(() => {
    const saved = localStorage.getItem(rememberKey);
    // Leer localStorage debe ocurrir en un effect (no en un inicializador) para
    // evitar un desajuste de hidratación SSR/cliente en el valor del input.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setUsername(saved);
  }, [rememberKey]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const email = `${username.trim().toLowerCase()}@${usernameDomain}`;
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      setError("Usuario o contraseña incorrectos.");
      return;
    }
    if (remember) {
      localStorage.setItem(rememberKey, username.trim());
    } else {
      localStorage.removeItem(rememberKey);
    }
    router.push("/barbero");
    router.refresh();
  }

  return (
    <main className="flex-1 grid place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="relative overflow-hidden rounded-3xl border border-line bg-paper p-8 shadow-[0_24px_70px_-40px_rgba(15,118,110,0.5)]">
          <div className="mb-5 grid h-16 w-16 place-items-center overflow-hidden rounded-2xl bg-[#0b1210] ring-1 ring-gold/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpeg"
              alt={salonName}
              className="h-full w-full object-contain"
            />
          </div>

          <p className="font-display text-xs uppercase tracking-[0.35em] text-brand">
            {salonName}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold uppercase tracking-tight text-ink">
            Ingreso estilista
          </h1>
          <p className="mt-1 text-sm text-muted">Accedé a tu agenda personal.</p>

          <form onSubmit={onSubmit} className="mt-6 grid gap-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                Usuario
              </span>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="usuario"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                Contraseña
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
                required
              />
            </label>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-line accent-brand"
              />
              <span>Mantener sesión iniciada</span>
            </label>

            {error && (
              <p className="rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm text-brand-deep">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 inline-flex items-center justify-center rounded-full bg-brand px-6 py-3.5 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
            >
              {loading ? "Ingresando…" : "Ingresar"}
            </button>
          </form>
        </div>

        <Link
          href="/"
          className="mt-5 block text-center text-sm text-muted transition-colors hover:text-brand"
        >
          ← Volver al inicio
        </Link>
      </div>
    </main>
  );
}
