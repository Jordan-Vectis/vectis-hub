import type { RefundPanelItem } from "@/lib/actions/refunds"
import { csvCell } from "@/lib/goods-in/location-codes"
import {
  REFUND_PARTY_LABELS, REFUND_REASON_LABELS, REFUND_SOLUTION_LABELS, REFUND_SOURCE_LABELS, REFUND_STATUS_META, refundRefWords,
} from "@/lib/refunds"
import { dateInputValue } from "@/lib/uncollected"

// Refunds → Export CSV: the list as it is on screen (same filters, same search, same order), made in
// the BROWSER from what the page already holds — nothing is fetched again and there's no export route
// to guard. Every cell goes through csvCell (a name starting = + - @ can't run as a formula), a
// byte-order mark so Excel reads £ and accents properly, Windows line endings, London days as
// YYYY-MM-DD, money in pounds with two places. No bank details — a request has none to give.

/** The UTF-8 byte-order mark, written as an escape so it can be seen in review and no editor strips it. */
const BOM = "﻿"

const HEAD = [
  "Ref", "Received", "Came from", "Name", "Email", "C-number", "Buyer or vendor", "Sale", "Auction date", "Lots",
  "Reason", "Status", "Solution", "% agreed", "Hammer £", "Commission £", "Postage refunded £", "Total to refund £",
  "Ref code", "Dealt with", "Date processed", "Complete for accounts", "Ticked by", "Photos", "Days open", "Looks like spam",
]

/** Pence as pounds with two places ("" for none). */
const pounds = (pence: number | null | undefined) => (pence == null ? "" : (pence / 100).toFixed(2))

export function refundsCsv(items: RefundPanelItem[]): string {
  const lines: unknown[][] = [
    HEAD,
    ...items.map(r => [
      refundRefWords(r.ref), dateInputValue(r.receivedAt), REFUND_SOURCE_LABELS[r.source], r.name, r.email ?? "", r.customerNo ?? "",
      REFUND_PARTY_LABELS[r.party], r.saleCode ?? "", r.auctionDate ?? "", r.lotsText ?? "",
      REFUND_REASON_LABELS[r.reason], REFUND_STATUS_META[r.status].label, r.solution ? REFUND_SOLUTION_LABELS[r.solution] : "", r.percentText ?? "",
      pounds(r.hammerPence), pounds(r.commissionPence), pounds(r.postagePence), pounds(r.totalPence),
      r.refCode ?? "", r.dealtWithName ?? "", dateInputValue(r.processedAt),
      r.accountsDoneAt ? `Yes — ${dateInputValue(r.accountsDoneAt)}` : r.status === "paid" ? "To do" : "",
      r.accountsDoneBy ?? "", r.photoCount, r.daysOpen, r.suspect ? "Yes" : "",
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
