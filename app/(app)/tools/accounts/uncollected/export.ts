import { csvCell } from "@/lib/goods-in/location-codes"
import { CONTACT_KINDS, EVENT_META, STATUS_META, dateInputValue, type UncollectedCase } from "@/lib/uncollected"

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
  "Buyer", "Buyer no", "Email", "Phone", "Sale", "Invoice", "Lots", "Paid £", "Paid on", "Days waiting",
  "Status", "Next chase", "Last contact", "Last contact by", "Storage charges from", "Entered", "Notes",
]

export function casesCsv(cases: UncollectedCase[]): string {
  const lines: unknown[][] = [
    HEAD,
    ...cases.map(c => [
      c.buyerName, c.buyerNo ?? "", c.email ?? "", c.phone ?? "", c.saleCode ?? "", c.invoiceNo ?? "",
      c.lots ?? "", c.amountPaid == null ? "" : c.amountPaid.toFixed(2), dateInputValue(c.paidAt), c.daysWaiting ?? "",
      STATUS_META[c.status]?.label ?? c.status, dateInputValue(c.nextChaseAt),
      c.lastContact ? `${contactWords(c.lastContact.kind)} ${londonStamp(c.lastContact.at)}` : "",
      c.lastContact?.byName ?? "",
      dateInputValue(c.storageFrom), c.source === "bc" ? "From BC" : "By hand", c.notes ?? "",
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
