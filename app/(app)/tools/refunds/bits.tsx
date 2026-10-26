import {
  REFUND_PARTY_LABELS, REFUND_SOURCE_LABELS, REFUND_STATUSES, REFUND_STATUS_META,
  type RefundParty, type RefundSource, type RefundStatus,
} from "@/lib/refunds"
import { formatDay } from "@/lib/uncollected"
import { muted } from "./ui"

// Small pieces the list and a request's page share. Server-safe (no hooks). Every colour and badge
// here has a key beside it on the panel — ColourKey (RULES design rule 3).

export function StatusChip({ status, long = false }: { status: RefundStatus; long?: boolean }) {
  const m = REFUND_STATUS_META[status]
  return (
    <span title={m.help} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${m.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {long ? m.label : m.short}
    </span>
  )
}

const PARTY_CHIP: Record<RefundParty, string> = {
  buyer: "bg-white text-gray-700 border-gray-300 dark:bg-transparent dark:text-gray-300 dark:border-gray-600",
  vendor: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:border-fuchsia-500/30",
}
const PARTY_HELP: Record<RefundParty, string> = {
  buyer: "A buyer — a refund, part refund or return on lots they bought",
  vendor: "A vendor (seller) — a payout on their lot (lost in the warehouse, sold in error…)",
}

/** "Buyer" or "Vendor" — a vendor stands out (it's a payout, not a refund). */
export function PartyBadge({ party }: { party: RefundParty }) {
  return (
    <span title={PARTY_HELP[party]} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${PARTY_CHIP[party]}`}>
      {REFUND_PARTY_LABELS[party]}
    </span>
  )
}

const SOURCE_HELP: Record<RefundSource, string> = {
  form: "Sent by the customer through the Hub's public refund form",
  staff: "Added here by a member of staff (an email, a phone call, a vendor payout)",
  import: "Brought over from the old SharePoint refund log",
}

/** Where it came from — the public form, staff, or the old log. Grey for all three: the words say it. */
export function SourceBadge({ source }: { source: RefundSource }) {
  return (
    <span title={SOURCE_HELP[source]} className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap bg-gray-100 text-gray-600 border-gray-200 dark:bg-white/10 dark:text-gray-300 dark:border-white/15">
      {REFUND_SOURCE_LABELS[source]}
    </span>
  )
}

/** From the public form with the honeypot filled, or from an address over the hourly limit. */
export function SuspectBadge() {
  return (
    <span title="Sent with the hidden spam box filled, or from an address sending lots of requests in an hour — check it's real before acting on it" className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
      ⚠ Check it&apos;s real
    </span>
  )
}

/** "Complete for accounts": ✓ Done (who, when on hover), To do (a paid one not ticked yet), or —. */
export function AccountsMark({ status, doneAt, doneBy }: { status: RefundStatus; doneAt: string | null; doneBy?: string | null }) {
  if (doneAt) {
    return (
      <span className="font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap" title={`Complete for accounts${doneBy ? ` — ${doneBy}` : ""}, ${formatDay(doneAt)}`}>
        ✓ Done
      </span>
    )
  }
  if (status === "paid") {
    return (
      <span title="Paid, but not ticked complete for accounts yet" className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30">
        To do
      </span>
    )
  }
  return <span className={muted} title="Only a paid request is ticked complete for accounts">—</span>
}

/** What every colour, badge and symbol on the panel means. */
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
            {REFUND_STATUSES.map(s => (
              <li key={s} className="flex items-start gap-2">
                <StatusChip status={s} />
                <span className="text-gray-600 dark:text-gray-300"><b className="font-semibold">{REFUND_STATUS_META[s].label}.</b> {REFUND_STATUS_META[s].help}.</span>
              </li>
            ))}
          </ul>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            New, Looking, Awaiting return and To pay are <b className="font-semibold">open</b>; Paid, Declined and Closed are closed.
          </p>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Who it&apos;s for</p>
            <ul className="space-y-2">
              {(["buyer", "vendor"] as const).map(p => (
                <li key={p} className="flex items-start gap-2"><PartyBadge party={p} /><span className="text-gray-600 dark:text-gray-300">{PARTY_HELP[p]}.</span></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Where it came from</p>
            <ul className="space-y-2">
              {(["form", "staff", "import"] as const).map(s => (
                <li key={s} className="flex items-start gap-2"><SourceBadge source={s} /><span className="text-gray-600 dark:text-gray-300">{SOURCE_HELP[s]}.</span></li>
              ))}
              <li className="flex items-start gap-2"><SuspectBadge /><span className="text-gray-600 dark:text-gray-300">From the form, but it looks like spam — check it&apos;s a real customer before doing anything.</span></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Complete for accounts</p>
            <ul className="space-y-2">
              <li className="flex items-start gap-2"><AccountsMark status="paid" doneAt="2026-01-01T12:00:00Z" /><span className="text-gray-600 dark:text-gray-300">Ticked complete for accounts (hover for who and when).</span></li>
              <li className="flex items-start gap-2"><AccountsMark status="paid" doneAt={null} /><span className="text-gray-600 dark:text-gray-300">Paid, but accounts haven&apos;t ticked it yet.</span></li>
              <li className="flex items-start gap-2"><AccountsMark status="new" doneAt={null} /><span className="text-gray-600 dark:text-gray-300">Not paid yet, so nothing for accounts.</span></li>
            </ul>
          </div>
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-red-600 dark:text-red-400">16 days open</span> in red — open for more than two weeks.{" "}
            <span aria-hidden>📷</span> <b className="font-semibold">2</b> — how many photos the customer sent.
            <b className="font-semibold">Not worked out</b> means no amounts yet — open the request to fill its lots from BC.
          </p>
        </div>
      </div>
    </details>
  )
}
