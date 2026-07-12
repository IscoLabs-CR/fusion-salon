"use client";

import { useMemo, useState } from "react";
import type { SalonConfig } from "@/lib/salon";
import {
  type BookingWindow,
  type Month,
  addMonths,
  bookingWindow,
  dateParts,
  isClosedDay,
  isSelectableDay,
  longDateLabel,
  monthGrid,
  monthLabel,
  monthOf,
  monthStart,
  shopToday,
} from "@/lib/booking";

/**
 * Calendario de un mes con flechas para navegar. Lo usan los dos lados: el wizard
 * del cliente (ventana = hoy → horizonte del salón) y el panel del barbero para
 * elegir los extremos de un bloqueo largo (ventana más amplia).
 *
 * Un día se puede tocar solo si el salón abre ese día de la semana y la fecha cae
 * dentro de la ventana. Las flechas se apagan al llegar a los meses de los extremos.
 */

// La grilla arranca en lunes, como se lee un calendario en Costa Rica.
const WEEKDAY_HEADS = ["L", "M", "M", "J", "V", "S", "D"];

export default function MonthCalendar({
  config,
  value,
  onChange,
  window: win,
}: {
  config: SalonConfig;
  value: string | null;
  onChange: (dateStr: string) => void;
  /** Por defecto, la ventana del cliente. */
  window?: BookingWindow;
}) {
  const w = win ?? bookingWindow(config);
  const today = shopToday(config.timezone);

  // Se abre en el mes de la fecha ya elegida; si no hay, en el del primer día
  // agendable (normalmente hoy).
  const [month, setMonth] = useState<Month>(() => monthOf(value ?? w.minDate));

  // Si `value` salta a otro mes desde afuera (en el panel, elegir "Desde" en
  // diciembre arrastra el "Hasta"), la vista lo sigue en vez de quedarse en el
  // mes viejo con todo deshabilitado. Ajuste en render, sin efecto ni parpadeo.
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (value && monthStart(monthOf(value)) !== monthStart(month)) {
      setMonth(monthOf(value));
    }
  }

  const cells = useMemo(() => monthGrid(month), [month]);

  // Una flecha se apaga cuando el mes destino queda fuera de la ventana. Los
  // primeros de mes son YYYY-MM-01, así que ordenan como strings.
  const current = monthStart(month);
  const canPrev = current > monthStart(monthOf(w.minDate));
  const canNext = current < monthStart(monthOf(w.maxDate));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <ArrowButton
          label="Mes anterior"
          disabled={!canPrev}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </ArrowButton>
        <p aria-live="polite" className="font-fancy text-lg capitalize text-ink">
          {monthLabel(month)}
        </p>
        <ArrowButton
          label="Mes siguiente"
          disabled={!canNext}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </ArrowButton>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAY_HEADS.map((d, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="pb-1 text-center text-[11px] uppercase tracking-wider text-muted"
          >
            {d}
          </span>
        ))}

        {cells.map((d, i) =>
          d == null ? (
            <span key={`gap-${i}`} aria-hidden="true" />
          ) : (
            <DayCell
              key={d}
              dateStr={d}
              config={config}
              win={w}
              isToday={d === today}
              active={value === d}
              onSelect={onChange}
            />
          ),
        )}
      </div>
    </div>
  );
}

function DayCell({
  dateStr,
  config,
  win,
  isToday,
  active,
  onSelect,
}: {
  dateStr: string;
  config: SalonConfig;
  win: BookingWindow;
  isToday: boolean;
  active: boolean;
  onSelect: (d: string) => void;
}) {
  const selectable = isSelectableDay(config, dateStr, win);
  // El chip viejo escribía "cerrado" bajo el número; en la grilla no hay lugar,
  // así que el motivo viaja en el aria-label para quien use lector de pantalla.
  const reason = isClosedDay(config, dateStr) ? "cerrado" : "no disponible";

  return (
    <button
      type="button"
      disabled={!selectable}
      onClick={() => onSelect(dateStr)}
      aria-label={
        selectable
          ? longDateLabel(dateStr)
          : `${longDateLabel(dateStr)}, ${reason}`
      }
      aria-current={isToday ? "date" : undefined}
      className={[
        "flex aspect-square items-center justify-center rounded-2xl border font-mono text-base transition-colors",
        !selectable
          ? "cursor-not-allowed border-line bg-line/40 text-muted/60"
          : active
            ? "border-brand bg-brand text-white"
            : isToday
              ? "border-brand/50 bg-paper font-semibold text-ink hover:border-brand hover:bg-brand-tint"
              : "border-line bg-paper text-ink hover:border-brand hover:bg-brand-tint",
      ].join(" ")}
    >
      {dateParts(dateStr).day}
    </button>
  );
}

function ArrowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-xl leading-none text-ink transition-colors hover:border-brand hover:bg-brand-tint disabled:cursor-not-allowed disabled:border-line disabled:bg-line/40 disabled:text-muted/60 disabled:hover:bg-line/40"
    >
      {children}
    </button>
  );
}
