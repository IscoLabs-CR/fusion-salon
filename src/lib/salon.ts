import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Config del salón (tenant) en la base multitenant compartida. Cada despliegue
 * sirve UN salón — identificado por NEXT_PUBLIC_SALON_SLUG — así que la config se
 * trae UNA vez del RPC público `get_salon_public` y se cachea por request. Los
 * server components la pasan a los client components como prop (es serializable).
 *
 * Fuente de verdad: la base (salons / salon_categories / salon_services /
 * salon_hours). Cambiar un precio/horario NO requiere redeploy.
 */

export const SALON_SLUG = process.env.NEXT_PUBLIC_SALON_SLUG ?? "fusion-salon";

export interface SalonBarber {
  id: string;
  name: string;
  displayOrder: number;
}

export interface SalonCategory {
  slug: string;
  label: string;
  displayOrder: number;
}

export interface SalonService {
  slug: string;
  label: string;
  category: string; // category slug
  priceCRC: number | null; // null = "Por cotizar"
  description: string;
  durationMin: number; // largo del bloque de la cita (múltiplo de 30)
  displayOrder: number;
}

export interface DayHours {
  openMin: number;
  closeMin: number;
}

export interface SalonConfig {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  theme: Record<string, unknown>;
  maxBookingsPerSlot: number;
  barbers: SalonBarber[];
  categories: SalonCategory[];
  services: SalonService[];
  hoursByDow: (DayHours | null)[]; // índice 0..6 (Dom..Sáb); null = cerrado
}

// Forma cruda que devuelve el RPC get_salon_public (snake_case).
interface RawSalon {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  theme: Record<string, unknown> | null;
  max_bookings_per_slot: number;
  barbers: { id: string; name: string; display_order: number }[];
  categories: { slug: string; label: string; display_order: number }[];
  services: {
    slug: string;
    label: string;
    category: string;
    price_crc: number | null;
    description: string;
    duration_min: number;
    display_order: number;
  }[];
  hours: Record<string, { open_min: number; close_min: number }>;
}

function shape(raw: RawSalon): SalonConfig {
  const hoursByDow: (DayHours | null)[] = Array.from({ length: 7 }, () => null);
  for (const [dow, h] of Object.entries(raw.hours ?? {})) {
    hoursByDow[Number(dow)] = { openMin: h.open_min, closeMin: h.close_min };
  }
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    timezone: raw.timezone,
    theme: raw.theme ?? {},
    maxBookingsPerSlot: raw.max_bookings_per_slot,
    barbers: (raw.barbers ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      displayOrder: b.display_order,
    })),
    categories: (raw.categories ?? []).map((c) => ({
      slug: c.slug,
      label: c.label,
      displayOrder: c.display_order,
    })),
    services: (raw.services ?? []).map((s) => ({
      slug: s.slug,
      label: s.label,
      category: s.category,
      priceCRC: s.price_crc,
      description: s.description,
      durationMin: s.duration_min,
      displayOrder: s.display_order,
    })),
    hoursByDow,
  };
}

/**
 * Trae la config del salón de este despliegue. Cacheada por request (React.cache)
 * para que múltiples server components no repitan el fetch. Lanza si el slug no
 * existe (mala configuración del deploy).
 */
export const getSalonConfig = cache(async (): Promise<SalonConfig> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_salon_public", {
    p_slug: SALON_SLUG,
  });
  if (error || !data) {
    throw new Error(
      `No se pudo cargar la configuración del salón "${SALON_SLUG}". ` +
        `¿Existe ese slug en la base? ${error?.message ?? ""}`,
    );
  }
  return shape(data as RawSalon);
});
