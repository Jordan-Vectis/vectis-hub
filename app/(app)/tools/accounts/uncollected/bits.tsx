import {
  AGE_BANDS, EVENT_META, SOURCE_META, STATUS_META, STORAGE_TEXT, UNCOLLECTED_STATUSES, ageBandFor, formatDateTime, formatDay,
  formatPence, isLiveShipment, paidHelp, paidWords,
  type ChaseState, type StorageCharge, type UncollectedLastContact, type UncollectedShippingInfo, type UncollectedSource,
  type UncollectedStatus,
} from "@/lib/uncollected"
import { muted } from "./ui"

// Small pieces the panel and the case page share. Server-safe (no hooks). Every colour here has a
// key beside it on the panel — ColourKey (RULES design rule 3).

/** A case's collection docket(s), the shipment request(s) on them that aren't cancelled (number ·
 *  status) and who packed them (the shipment request card's Internal Reference) — as the BC check last
 *  read them. `null` = not read yet. Plain text, no colour to explain. */
export function Shipping({ s, inline = false }: { s: UncollectedShippingInfo | null; inline?: boolean }) {
  if (!s) return <span className={`text-xs ${muted}`} title="The BC check reads it on its next run">Not read yet</span>
  const live = s.shipments.filter(isLiveShipment)
  const docket = s.collectionNos.length ? s.collectionNos.join(", ") : null
  if (inline) {
    return (
      <span className="break-words">
        Docket {docket ? <span className="font-mono">{docket}</span> : "none"}
        {" · "}
        {live.length
          ? live.map((x, i) => (
              <span key={x.no}>
                {i > 0 && ", "}
                Shipment <span className="font-mono font-semibold">{x.no}</span> ({x.status}){x.packedBy ? ` — packed by ${x.packedBy}` : ""}
              </span>
            ))
          : "no shipment"}
      </span>
    )
  }
  return (
    <div className="min-w-0">
      <div className="font-mono text-sm">{docket ?? <span className={`font-sans text-xs ${muted}`}>No docket</span>}</div>
      {live.length ? (
        live.map(x => (
          <div key={x.no} className="text-xs mt-0.5">
            <span className="font-mono font-semibold">{x.no}</span> · {x.status}
            {x.packedBy && <div className={muted}>Packed by {x.packedBy}</div>}
          </div>
        ))
      ) : (
        <div className={`text-xs ${muted}`}>No shipment</div>
      )}
    </div>
  )
}

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

/** "Paid by 3 Jun 2026" (from BC — BC's settled date, explained on hover), "Paid on 3 Jun 2026"
 *  (BC's own paid date — `exact`), or "Paid 3 Jun 2026" (by hand). */
export function PaidWhen({ source, paidAt, exact = false }: { source: UncollectedSource; paidAt: string | null; exact?: boolean }) {
  if (!paidAt) return <span className={muted}>Paid date not known</span>
  return <span title={source === "bc" ? paidHelp(source, exact) : undefined}>{paidWords(source, paidAt, exact)}</span>
}

/**
 * A case's storage in a narrow cell: "£180.00 + VAT" over "£216.00 inc VAT"; "Waived"; "Free until
 * 29 Oct"; "Lots not known"; or "—" when there's no storage start (no paid date). The whole line in
 * words (the charge's `words`) is on hover. `inline` puts it on one line (the phone cards, the case
 * page's header). Orange = being charged (STORAGE_TEXT — in ColourKey).
 */
export function StorageOwed({ s, inline = false }: { s: StorageCharge; inline?: boolean }) {
  const words = s.words
  if (!s.known) return <span className={muted} title={words}>—</span>
  if (s.started && s.waived) {
    return (
      <span title={words} className="inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap bg-gray-100 text-gray-700 border-gray-200 dark:bg-white/10 dark:text-gray-300 dark:border-white/15">
        Waived
      </span>
    )
  }
  if (!s.started || s.totalPence == null || s.exVatPence == null) {
    return <span className={`whitespace-nowrap ${muted}`} title={words}>{s.shortWords}</span>
  }
  const ex = formatPence(s.exVatPence)
  const inc = formatPence(s.totalPence)
  if (s.vatPercent <= 0) {
    return <span className={`font-semibold tabular-nums whitespace-nowrap ${STORAGE_TEXT}`} title={words}>{inc} <span className="font-normal text-xs text-gray-500 dark:text-gray-400">no VAT</span></span>
  }
  if (inline) {
    return (
      <span className={`font-semibold tabular-nums ${STORAGE_TEXT}`} title={words}>
        {ex} + VAT <span className="font-normal text-gray-600 dark:text-gray-300">({inc} inc VAT)</span>
      </span>
    )
  }
  return (
    <span title={words} className="whitespace-nowrap">
      <span className={`block font-semibold tabular-nums ${STORAGE_TEXT}`}>{ex} + VAT</span>
      <span className="block text-xs text-gray-500 dark:text-gray-400 tabular-nums">{inc} inc VAT</span>
    </span>
  )
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
            invoice (&ldquo;Paid by&rdquo;), so they have waited at least that long; once BC publishes its own paid date the case
            says &ldquo;Paid on&rdquo; and counts from that. Once a case is closed it stops counting.
          </p>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-4 mb-1">Next chase</p>
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-red-600 dark:text-red-400">Red</span> means it&apos;s due today or overdue — time to get in touch.
          </p>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-4 mb-1">Storage owed</p>
          <p className="text-gray-600 dark:text-gray-300">
            <span className={`font-semibold ${STORAGE_TEXT}`}>Orange</span> is the storage charged so far, before VAT, with the total
            including VAT under it (hover for how it&apos;s worked out). <b className="font-semibold">Free until</b> means the free days
            haven&apos;t run out yet; <b className="font-semibold">Waived</b> means an admin has waived it on that case;{" "}
            <b className="font-semibold">Lots not known</b> means the case has no number of lots; <b className="font-semibold">—</b> means
            there&apos;s no paid date or storage start to count from. <b className="font-semibold">None</b> means the case closed before
            its storage would have started; <b className="font-semibold">no VAT</b> appears beside the figure when VAT is set to 0%.
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
