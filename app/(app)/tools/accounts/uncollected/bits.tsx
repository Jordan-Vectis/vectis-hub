import {
  AGE_BANDS, EVENT_META, PAID_BY_HELP, SOURCE_META, STATUS_META, UNCOLLECTED_STATUSES, ageBandFor, formatDateTime, formatDay,
  paidWords, type ChaseState, type UncollectedLastContact, type UncollectedSource, type UncollectedStatus,
} from "@/lib/uncollected"
import { muted } from "./ui"

// Small pieces the panel and the case page share. Server-safe (no hooks). Every colour here has a
// key beside it on the panel — ColourKey (RULES design rule 3).

export function StatusChip({ status, long = false }: { status: UncollectedStatus; long?: boolean }) {
  const m = STATUS_META[status]
  return (
    <span title={m.help} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${m.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {long ? m.label : m.short}
    </span>
  )
}

/** "23 days", coloured by its age band. */
export function DaysWaiting({ days, closed = false }: { days: number | null; closed?: boolean }) {
  if (days == null) return <span className={muted} title="The day they paid isn't known yet">—</span>
  const band = ageBandFor(days)
  return (
    <span className={`font-semibold tabular-nums ${band?.text ?? ""}`} title={closed ? "Days they waited before the case closed" : band?.label}>
      {days} {days === 1 ? "day" : "days"}
    </span>
  )
}

/** The next chase date — red, and saying so in words, when it's due today or overdue. */
export function ChaseDate({ at, chase }: { at: string | null; chase: ChaseState | null }) {
  if (!at) return <span className={muted}>—</span>
  if (chase === "overdue" || chase === "today") {
    return (
      <span className="font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
        {formatDay(at)} <span className="text-xs uppercase tracking-wide">· {chase === "today" ? "today" : "overdue"}</span>
      </span>
    )
  }
  return <span className="whitespace-nowrap">{formatDay(at)}</span>
}

/** Short words for a contact in a narrow cell — every icon has its word beside it (design rule 3). */
const CONTACT_SHORT: Record<UncollectedLastContact["kind"], string> = { call: "Call", email: "Email", letter: "Letter", note: "Note" }

/** "📞 Phone call · 21 Oct 2026, 10:05 · Sam" (compact: "📞 Call · 21 Oct 2026 · Sam") — or "None yet". */
export function LastContact({ last, compact = false }: { last: UncollectedLastContact | null; compact?: boolean }) {
  if (!last) return <span className={muted}>None yet</span>
  const m = EVENT_META[last.kind]
  return (
    <span title={last.text ?? undefined}>
      <span aria-hidden>{m.icon}</span> {compact ? `${CONTACT_SHORT[last.kind]} · ${formatDay(last.at)}` : `${m.label} · ${formatDateTime(last.at)}`}
      {last.byName && <span className="text-gray-500 dark:text-gray-400"> · {last.byName}</span>}
    </span>
  )
}

/** "From BC" or "Added by hand" — every case says which (the key is in ColourKey). */
export function SourceBadge({ source }: { source: UncollectedSource }) {
  const m = SOURCE_META[source] ?? SOURCE_META.manual
  return (
    <span title={m.help} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${m.chip}`}>
      {m.label}
    </span>
  )
}

/** "Paid by 3 Jun 2026" (from BC — BC's settled date, explained on hover) or "Paid 3 Jun 2026". */
export function PaidWhen({ source, paidAt }: { source: UncollectedSource; paidAt: string | null }) {
  if (!paidAt) return <span className={muted}>Paid date not known</span>
  return <span title={source === "bc" ? PAID_BY_HELP : undefined}>{paidWords(source, paidAt)}</span>
}

/** What every colour and chip on the panel means. */
export function ColourKey() {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-2 min-h-11 font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500">
        <span className="transition-transform group-open:rotate-90" aria-hidden>▸</span> What the colours mean
      </summary>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Status</p>
          <ul className="space-y-2">
            {UNCOLLECTED_STATUSES.map(s => (
              <li key={s} className="flex items-start gap-2">
                <StatusChip status={s} />
                <span className="text-gray-600 dark:text-gray-300"><b className="font-semibold">{STATUS_META[s].label}.</b> {STATUS_META[s].help}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Days waiting</p>
          <ul className="space-y-1.5">
            {AGE_BANDS.map(b => (
              <li key={b.key} className="flex items-center gap-2">
                <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.chip}`}>{b.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Counted in London days from the day they paid — for a case from BC, from the day BC settled the
            invoice (&ldquo;Paid by&rdquo;), so they have waited at least that long. Once a case is closed it stops counting.
          </p>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-4 mb-1">Next chase</p>
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-red-600 dark:text-red-400">Red</span> means it&apos;s due today or overdue — time to get in touch.
          </p>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-4 mb-2">Where it came from</p>
          <ul className="space-y-2">
            {(["bc", "manual"] as const).map(s => (
              <li key={s} className="flex items-start gap-2">
                <SourceBadge source={s} />
                <span className="text-gray-600 dark:text-gray-300">{SOURCE_META[s].help}.</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  )
}
