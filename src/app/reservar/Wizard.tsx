"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { SalonConfig, SalonBarber, SalonService } from "@/lib/salon";
import { type CalendarEvent, icsUrl, openInCalendar } from "@/lib/calendar";
import MonthCalendar from "@/components/MonthCalendar";
import {
  type Slot,
  type BusyRow,
  getService,
  generateDaySlots,
  bookingWindow,
  isSelectableDay,
  longDateLabel,
  priceLabel,
  servicesByCategory,
} from "@/lib/booking";

type Step = 0 | 1 | 2 | 3 | 4;
const ALL_STEPS: { index: Step; label: string }[] = [
  { index: 0, label: "Estilista" },
  { index: 1, label: "Fecha" },
  { index: 2, label: "Servicio" },
  { index: 3, label: "Hora" },
  { index: 4, label: "Datos" },
];

interface Confirmation {
  stylistName: string;
  dateStr: string;
  serviceLabel: string;
  servicePrice: string;
  timeLabel: string;
  name: string;
  start: Date;
  end: Date;
  id: string | null;
}

export default function Wizard({ config }: { config: SalonConfig }) {
  const barbers = config.barbers;
  // Con una sola estilista no hay nada que elegir: se preselecciona y se salta.
  const singleBarber = barbers.length === 1;
  const initialStep: Step = singleBarber ? 1 : 0;
  const visibleSteps = singleBarber
    ? ALL_STEPS.filter((s) => s.index !== 0)
    : ALL_STEPS;

  const [step, setStep] = useState<Step>(initialStep);
  const [barber, setBarber] = useState<SalonBarber | null>(
    singleBarber ? barbers[0] : null,
  );
  const [dateStr, setDateStr] = useState<string | null>(null);
  const [service, setService] = useState<string | null>(null); // slug
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Confirmation | null>(null);

  const serviceInfo: SalonService | null = service
    ? getService(config, service) ?? null
    : null;
  const bookWindow = bookingWindow(config);

  function selectBarber(b: SalonBarber) {
    setBarber(b);
    setDateStr(null);
    setService(null);
    setSlot(null);
    setError(null);
    setStep(1);
  }

  function selectDate(d: string) {
    // Además del día cerrado, frena las fechas pasadas y las que se pasan del
    // horizonte de reserva del salón.
    if (!isSelectableDay(config, d, bookWindow)) return;
    setDateStr(d);
    setService(null);
    setSlot(null);
    setError(null);
    setStep(2);
  }

  // Elegir el servicio del dropdown (no avanza: primero se ve el precio / la nota).
  function chooseService(slug: string) {
    setService(slug);
    setSlot(null);
    setError(null);
  }

  // Al continuar, se trae la carga del día (bloqueos + citas) y se generan los
  // horarios, respetando la duración del servicio y el tope de personas por hora.
  async function goToSlots() {
    if (!dateStr || !serviceInfo || !barber) return;
    setStep(3);
    setLoadingSlots(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("get_day_load", {
      p_slug: config.slug,
      p_barber_id: barber.id,
      p_date: dateStr,
    });
    const busy: BusyRow[] = ((data ?? []) as {
      start_time: string;
      end_time: string;
      kind: string;
    }[]).map((r) => ({
      start: new Date(r.start_time),
      end: new Date(r.end_time),
      kind: r.kind === "block" ? "block" : "booking",
    }));
    setSlots(generateDaySlots(config, dateStr, serviceInfo, busy));
    setLoadingSlots(false);
  }

  function selectSlot(s: Slot) {
    if (!s.available) return;
    setSlot(s);
    setError(null);
    setStep(4);
  }

  async function confirm() {
    if (!barber || !slot || !serviceInfo || !dateStr) return;
    if (name.trim().length === 0) {
      setError("Escribí tu nombre para confirmar la cita.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("book_appointment", {
      p_slug: config.slug,
      p_barber_id: barber.id,
      p_start: slot.start.toISOString(),
      p_service_slug: serviceInfo.slug,
      p_name: name.trim(),
      p_phone: phone.trim(),
    });
    setSubmitting(false);
    if (error) {
      setError(error.message || "No se pudo confirmar la cita.");
      return;
    }
    setDone({
      stylistName: barber.name,
      dateStr,
      serviceLabel: serviceInfo.label,
      servicePrice: priceLabel(serviceInfo),
      timeLabel: slot.label,
      name: name.trim(),
      start: slot.start,
      end: slot.end,
      id: (data as string | null) ?? null,
    });
  }

  function reset() {
    setStep(initialStep);
    setBarber(singleBarber ? barbers[0] : null);
    setDateStr(null);
    setService(null);
    setSlots([]);
    setSlot(null);
    setName("");
    setPhone("");
    setError(null);
    setDone(null);
  }

  if (done)
    return (
      <SuccessScreen
        data={done}
        shopName={config.name}
        slug={config.slug}
        onAgain={reset}
      />
    );

  return (
    <div className="flex-1">
      <BookingHeader shopName={config.name} />

      <div className="mx-auto w-full max-w-2xl px-5 pb-16">
        <Stepper
          steps={visibleSteps}
          current={step}
          onGoTo={(s) => s <= step && setStep(s)}
        />

        <div className="mt-7">
          {step === 0 && (
            <Section title="¿Con quién querés tu cita?">
              <div className="grid gap-3">
                {barbers.length === 0 && (
                  <p className="text-muted">
                    No hay estilistas disponibles por ahora.
                  </p>
                )}
                {barbers.map((b) => (
                  <OptionRow
                    key={b.id}
                    active={barber?.id === b.id}
                    onClick={() => selectBarber(b)}
                    title={b.name}
                    subtitle="Estilista"
                  />
                ))}
              </div>
            </Section>
          )}

          {step === 1 && (
            <Section title="Elegí el día">
              <MonthCalendar
                config={config}
                value={dateStr}
                onChange={selectDate}
                window={bookWindow}
              />
            </Section>
          )}

          {step === 2 && dateStr && (
            <Section title="¿Qué servicio querés?" hint={longDateLabel(dateStr)}>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-ink">
                  Servicio
                </span>
                <select
                  value={service ?? ""}
                  onChange={(e) => chooseService(e.target.value)}
                  className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-ink outline-none transition-colors focus:border-brand"
                >
                  <option value="" disabled>
                    Elegí un servicio…
                  </option>
                  {config.categories.map((cat) => (
                    <optgroup key={cat.slug} label={cat.label}>
                      {servicesByCategory(config, cat.slug).map((s) => (
                        <option key={s.slug} value={s.slug}>
                          {s.label} — {priceLabel(s)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <ul className="mt-3 space-y-1.5 text-xs text-muted">
                <li>
                  Luego de 15 minutos sin presentarse, la cita pierde validez y
                  deberá reagendarse.
                </li>
                <li>El precio por diagnóstico previo es de 5.000 colones.</li>
              </ul>

              {serviceInfo && <ServiceCard service={serviceInfo} />}

              {serviceInfo && (
                <button
                  type="button"
                  onClick={goToSlots}
                  className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep"
                >
                  Ver horarios
                </button>
              )}
            </Section>
          )}

          {step === 3 && (
            <Section
              title="Elegí tu horario"
              hint={
                dateStr && serviceInfo
                  ? `${longDateLabel(dateStr)} · ${serviceInfo.label}`
                  : undefined
              }
            >
              <SlotGrid
                slots={slots}
                loading={loadingSlots}
                selectedMin={slot?.startMin ?? null}
                onSelect={selectSlot}
                onBackToDate={() => setStep(1)}
              />
            </Section>
          )}

          {step === 4 && barber && dateStr && serviceInfo && slot && (
            <Section title="Tus datos">
              <TicketSummary
                stylistName={barber.name}
                dateStr={dateStr}
                service={serviceInfo}
                timeLabel={slot.label}
              />

              <div className="mt-5 grid gap-4">
                <Field
                  label="Nombre"
                  required
                  value={name}
                  onChange={setName}
                  placeholder="Tu nombre"
                  autoFocus
                />
                <Field
                  label="Teléfono"
                  type="tel"
                  value={phone}
                  onChange={setPhone}
                  placeholder="Para confirmarte la cita"
                />
              </div>

              {error && <ErrorNote>{error}</ErrorNote>}

              <button
                type="button"
                onClick={confirm}
                disabled={submitting}
                className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-4 font-display text-lg font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep disabled:opacity-60"
              >
                {submitting ? "Confirmando…" : "Confirmar cita"}
              </button>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function BookingHeader({ shopName }: { shopName: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-[#0b1210]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.jpeg"
              alt={shopName}
              className="h-full w-full object-contain"
            />
          </span>
          <span className="font-display text-lg font-semibold uppercase tracking-wide text-ink">
            {shopName}
          </span>
        </Link>
        <Link
          href="/"
          className="text-sm text-muted transition-colors hover:text-brand"
        >
          Cancelar
        </Link>
      </div>
    </header>
  );
}

function Stepper({
  steps,
  current,
  onGoTo,
}: {
  steps: { index: Step; label: string }[];
  current: number;
  onGoTo: (s: Step) => void;
}) {
  return (
    <nav className="mt-6" aria-label="Progreso de la reserva">
      <ol className="flex items-center gap-1.5">
        {steps.map(({ index, label }) => {
          const state =
            index < current
              ? "done"
              : index === current
                ? "current"
                : "upcoming";
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => onGoTo(index)}
                disabled={index > current}
                className={[
                  "h-1.5 w-full rounded-full transition-colors",
                  state === "upcoming" ? "bg-line" : "bg-brand",
                ].join(" ")}
                aria-label={label}
              />
              <span
                className={[
                  "text-[10px] font-medium uppercase tracking-wider sm:text-xs",
                  state === "current"
                    ? "text-brand"
                    : state === "done"
                      ? "text-ink"
                      : "text-muted",
                ].join(" ")}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="font-display text-2xl font-semibold uppercase tracking-tight text-ink">
        {title}
      </h1>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ServiceCard({ service }: { service: SalonService }) {
  return (
    <div className="mt-4 rounded-2xl border border-brand/40 bg-brand-tint px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <span className="font-display text-base font-semibold uppercase tracking-wide text-ink">
          {service.label}
        </span>
        <span className="shrink-0 rounded-full bg-brand px-3 py-1 font-mono text-xs font-medium text-white">
          {priceLabel(service)}
        </span>
      </div>
      {service.description && (
        <p className="mt-2 text-sm text-brand-deep">{service.description}</p>
      )}
    </div>
  );
}

function OptionRow({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group flex items-center justify-between rounded-2xl border px-5 py-4 text-left transition-colors",
        active
          ? "border-brand bg-brand-tint"
          : "border-line bg-paper hover:border-brand hover:bg-brand-tint",
      ].join(" ")}
    >
      <span>
        <span className="block font-display text-lg font-semibold uppercase tracking-wide text-ink">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block text-sm text-muted">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

function SlotGrid({
  slots,
  loading,
  selectedMin,
  onSelect,
  onBackToDate,
}: {
  slots: Slot[];
  loading: boolean;
  selectedMin: number | null;
  onSelect: (s: Slot) => void;
  onBackToDate: () => void;
}) {
  if (loading) {
    return <p className="py-10 text-center text-muted">Cargando horarios…</p>;
  }

  const anyAvailable = slots.some((s) => s.available);

  if (slots.length === 0 || !anyAvailable) {
    return (
      <div className="rounded-2xl border border-line bg-line/30 px-5 py-8 text-center">
        <p className="text-ink">No hay horarios disponibles para este día.</p>
        <button
          type="button"
          onClick={onBackToDate}
          className="mt-3 text-sm font-medium text-brand hover:text-brand-deep"
        >
          Elegir otro día
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
      {slots.map((s) => {
        const selected = selectedMin === s.startMin;
        if (!s.available) {
          return (
            <div
              key={s.startMin}
              aria-label={`${s.label} — no disponible`}
              className="flex flex-col items-center rounded-xl border border-line bg-line/40 px-2 py-2.5 text-muted/70"
            >
              <span className="font-mono text-sm line-through">{s.label}</span>
              <span className="text-[10px] uppercase tracking-wide">
                No disp.
              </span>
            </div>
          );
        }
        return (
          <button
            key={s.startMin}
            type="button"
            onClick={() => onSelect(s)}
            className={[
              "flex flex-col items-center rounded-xl border px-2 py-2.5 transition-colors",
              selected
                ? "border-brand bg-brand text-white"
                : "border-brand/60 bg-brand-tint text-brand hover:bg-brand hover:text-white",
            ].join(" ")}
          >
            <span className="font-mono text-base font-medium">{s.label}</span>
            <span className="text-[10px] uppercase tracking-wide opacity-80">
              Libre
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TicketSummary({
  stylistName,
  dateStr,
  service,
  timeLabel,
}: {
  stylistName: string;
  dateStr: string;
  service: SalonService;
  timeLabel: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="absolute inset-y-0 left-0 w-2 bg-brand" aria-hidden />
      <dl className="grid grid-cols-2 gap-y-3 px-6 py-5 pl-7">
        <SummaryItem label="Estilista" value={stylistName} />
        <SummaryItem label="Servicio" value={service.label} />
        <SummaryItem label="Día" value={longDateLabel(dateStr)} />
        <SummaryItem label="Hora" value={timeLabel} mono />
        <SummaryItem label="Precio" value={priceLabel(service)} mono />
      </dl>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">
        {label}
      </dt>
      <dd
        className={[
          "mt-0.5 text-sm font-medium text-ink",
          mono ? "font-mono" : "",
        ].join(" ")}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full rounded-xl border border-line bg-paper px-4 py-3 text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-brand"
      />
    </label>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-xl border border-brand/30 bg-brand-tint px-4 py-3 text-sm text-brand-deep">
      {children}
    </p>
  );
}

function SuccessScreen({
  data,
  shopName,
  slug,
  onAgain,
}: {
  data: Confirmation;
  shopName: string;
  slug: string;
  onAgain: () => void;
}) {
  const [showPrompt, setShowPrompt] = useState(true);
  const [added, setAdded] = useState(false);

  const event: CalendarEvent = {
    id: data.id,
    serviceLabel: data.serviceLabel,
    shopName,
    slug,
    stylistName: data.stylistName,
    clientName: data.name,
    start: data.start,
    end: data.end,
  };

  function addToCalendar() {
    openInCalendar(event);
    setAdded(true);
    setShowPrompt(false);
  }

  return (
    <main className="flex-1 grid place-items-center px-5 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-white">
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <h1 className="mt-5 font-display text-3xl font-bold uppercase tracking-tight text-ink">
          ¡Cita confirmada!
        </h1>
        <p className="mt-2 text-muted">
          Te esperamos, {data.name.split(" ")[0]}.
        </p>

        <div className="relative mt-7 overflow-hidden rounded-2xl border border-line bg-paper text-left">
          <div className="absolute inset-y-0 left-0 w-2 bg-brand" aria-hidden />
          <dl className="grid grid-cols-2 gap-y-3 px-6 py-5 pl-7">
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">
                Estilista
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {data.stylistName}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">
                Servicio
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {data.serviceLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">
                Día
              </dt>
              <dd className="mt-0.5 text-sm font-medium text-ink">
                {longDateLabel(data.dateStr)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">
                Hora
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-ink">
                {data.timeLabel}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wider text-muted">
                Precio
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-ink">
                {data.servicePrice}
              </dd>
            </div>
          </dl>
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => (added ? addToCalendar() : setShowPrompt(true))}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-brand px-6 py-3.5 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep"
          >
            {added ? "Abrir el calendario otra vez" : "Agregar a mi calendario"}
          </button>
          {added && (
            <p className="-mt-1 text-xs text-muted">
              ¿No se abrió tu calendario?{" "}
              <a
                href={icsUrl(event)}
                className="font-medium text-brand underline underline-offset-2"
              >
                Abrí el archivo de la cita
              </a>
              .
            </p>
          )}
          <button
            type="button"
            onClick={onAgain}
            className="inline-flex items-center justify-center rounded-full border border-line px-6 py-3 text-sm font-medium text-ink transition-colors hover:border-brand hover:text-brand"
          >
            Reservar otra cita
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center py-1 text-sm text-muted transition-colors hover:text-brand"
          >
            Volver al inicio
          </Link>
        </div>
      </div>

      {showPrompt && (
        <CalendarPrompt
          onAdd={addToCalendar}
          onDismiss={() => setShowPrompt(false)}
        />
      )}
    </main>
  );
}

function CalendarPrompt({
  onAdd,
  onDismiss,
}: {
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-5"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl border border-line bg-paper p-6 text-center shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-tint text-brand">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </div>
        <h2 className="mt-4 font-display text-xl font-semibold uppercase tracking-tight text-ink">
          ¿Agregar al calendario?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Se abre el calendario de tu teléfono con{" "}
          <strong className="text-ink">los datos de la cita ya cargados</strong>
          . Solo confirmá para guardarla.
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center justify-center rounded-full bg-brand px-6 py-3.5 font-display font-semibold uppercase tracking-wide text-white transition-colors hover:bg-brand-deep"
          >
            Agregar al calendario
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center justify-center py-2 text-sm font-medium text-muted transition-colors hover:text-brand"
          >
            Ahora no
          </button>
        </div>
      </div>
    </div>
  );
}
