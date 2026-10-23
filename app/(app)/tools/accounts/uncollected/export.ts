import { csvCell } from "@/lib/goods-in/location-codes"
import { CONTACT_KINDS, EVENT_META, SOURCE_META, STATUS_META, dateInputValue, type UncollectedCase } from "@/lib/uncollected"

// Paid, not collected → Export CSV: the list as it is on screen (same filters, same order), made in
// the BROWSER from what the page already holds — nothing is fetched again and there's no export
// route to guard. Every cell goes through csvCell (a name starting = + - @ can't run as a formula),
// a byte-order mark so Excel reads £ and accents properly, Windows line endings, London days as
// YYYY-MM-DD and London times. No bank details — a case has none to give.

/** The UTF-8 byte-order mark, written as an escape so it can be seen in review and no editor strips it. */
const BOM = "\uFEFF"

const LONDON_DT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

/** "2026-10-22 14:05" in London time ("" for none). */
function londonStamp(iso: string | null | undefined): string {
  if (!iso) return ""
  const p = LONDON_DT.formatToParts(new Date(iso))
  const g = (t: Intl.DateTimeFormatPartTypes) => p.find(x => x.type === t)?.value ?? ""
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`
}

const contactWords = (kind: string) =>
  (CONTACT_KINDS as readonly string[]).includes(kind) ? EVENT_META[kind as (typeof CONTACT_KINDS)[number]].label : kind

const HEAD = [
  // "Paid on / by": a case from BC carries the day BC settled the invoice — they paid on or before it.
  "Buyer", "Buyer no", "Email", "Phone", "Sale", "Invoice", "Lots", "Paid £", "Paid on / by", "Paid date is", "Days waiting",
  "Status", "Next chase", "Last contact", "Last contact by",
  // Storage as worked out on the day of the export (it changes daily) — the figures to raise the
  // charge (the Hub never charges anything in BC).
  // Days and weeks in their own columns, as plain numbers ("Storage weeks charged" only when it's
  // charged per week — every week started counts), so a spreadsheet can add them up.
  "Storage charges from", "Storage days charged", "Storage weeks charged", "Lots charged", "Storage £ ex VAT", "Storage VAT £", "Storage £ inc VAT", "Storage waived",
  "Entered", "Notes",
]

/** What the paid date is: BC's own, BC's settled date (they paid on or before it), or typed in. */
const paidKind = (c: UncollectedCase) =>
  !c.paidAt ? "" : c.source === "bc" ? (c.paidExact ? "BC's own paid date" : "BC settled date — paid on or before") : "Typed in"

/** Pence as pounds with two places ("" for none). */
const pounds = (pence: number | null | undefined) => (pence == null ? "" : (pence / 100).toFixed(2))

/** The storage cells, as worked out on the day of the export: "Storage charges from" (the case's
 *  start, or the rule's from the paid date), the days charged, the weeks charged (per week only —
 *  blank per day), the lots charged and the money — blank where it can't be worked out, 0.00 when
 *  waived (what it would have been is in the "Storage waived" column, with the reason, who and when). */
function storageCells(c: UncollectedCase): unknown[] {
  const s = c.storage
  const w = s.waived ? s.waiver : null
  const waived = s.waived
    ? `Yes — ${w?.reason ?? "no reason recorded"}${w ? ` (${[w.byName, dateInputValue(w.at)].filter(Boolean).join(", ")})` : ""}${s.fullTotalPence ? `; would be £${pounds(s.fullTotalPence)} inc VAT` : ""}`
    : "No"
  const days = s.startDay ? s.days : ""
  const weeks = s.startDay && s.period === "week" ? s.units : ""
  return [s.startDay ?? "", days, weeks, s.lots ?? "", pounds(s.exVatPence), pounds(s.vatPence), pounds(s.totalPence), waived]
}

export function casesCsv(cases: UncollectedCase[]): string {
  const lines: unknown[][] = [
    HEAD,
    ...cases.map(c => [
      c.buyerName, c.buyerNo ?? "", c.email ?? "", c.phone ?? "", c.saleCode ?? "", c.invoiceNo ?? "",
      c.lots ?? "", c.amountPaid == null ? "" : c.amountPaid.toFixed(2), dateInputValue(c.paidAt), paidKind(c), c.daysWaiting ?? "",
      STATUS_META[c.status]?.label ?? c.status, dateInputValue(c.nextChaseAt),
      c.lastContact ? `${contactWords(c.lastContact.kind)} ${londonStamp(c.lastContact.at)}` : "",
      c.lastContact?.byName ?? "",
      ...storageCells(c),
      (SOURCE_META[c.source] ?? SOURCE_META.manual).label, c.notes ?? "",
    ]),
  ]
  return BOM + lines.map(cells => cells.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

/** Save text as a CSV file in the browser (a Blob — nothing goes to the server). */
export function downloadCsv(csv: string, name: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
