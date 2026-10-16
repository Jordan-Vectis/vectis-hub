import Link from "next/link"
import type { ReactNode } from "react"
import type { Prisma } from "@/app/generated/prisma/client"
import { CONTAINER_STATUS, type ContainerStatus, type ReceiptStatus } from "@/lib/goods-in/model"
import { StatusBadge } from "../_components/ui"

// Goods In → Receipts: the small pieces the list and the receipt page share. Server-safe (no hooks),
// so both the server pages and the client parts can use them.

/** Every status a receipt can be shown with. "draft" is a check-in still going on at the counter:
 *  it has its receipt, tote and pallet numbers (so labels can be printed) but it isn't booked in
 *  until Book in is pressed. Written as a union so it holds whether or not model.ts names "draft". */
export type ReceiptStatusShown = ReceiptStatus | "draft"

/** A receipt's own status. A receipt saved before statuses existed (null) counts as open. */
export const RECEIPT_STATUS: Record<ReceiptStatusShown, { label: string; help: string; tone: string }> = {
  draft: {
    label: "Not booked in yet",
    help: "Still being checked in — its numbers are taken and labels can be printed, but it isn't booked in until Book in is pressed.",
    tone: "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700",
  },
  open: {
    label: "Open",
    help: "Being worked on — more totes or pallets can be added.",
    tone: "bg-indigo-50 text-indigo-800 border-indigo-300 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800",
  },
  closed: {
    label: "Closed",
    help: "Finished with. Reopen it to add more.",
    tone: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
  },
  void: {
    label: "Void",
    help: "Booked in error — kept for the record only.",
    tone: "bg-red-50 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-200 dark:border-red-800",
  },
}

export const receiptStatus = (s: string | null | undefined): ReceiptStatusShown =>
  s === "closed" || s === "void" || s === "draft" ? s : "open"


// The filters every count and "booked in" list uses. Prisma's `not` / `notIn` leave out NULLs as
// well, so a receipt saved before statuses existed (null — it counts as open) is let in explicitly.
/** Receipts that have been booked in: everything except a check-in still going on (a draft). */
export const NOT_DRAFT: Prisma.GoodsInReceiptWhereInput = { OR: [{ status: null }, { status: { not: "draft" } }] }
/** Receipts whose goods are real, standing goods: booked in (not a draft) and not voided. */
export const BOOKED_LIVE: Prisma.GoodsInReceiptWhereInput = { OR: [{ status: null }, { status: { notIn: ["draft", "void"] } }] }

/** Where a check-in that hasn't been booked in is carried on. */
export const carryOnHref = (receiptId: string) => `/tools/warehouse/check-in?receipt=${encodeURIComponent(receiptId)}`

/** The "Carry on checking in" button. */
export function CarryOnLink({ receiptId, className, children }: { receiptId: string; className: string; children?: ReactNode }) {
  return <Link href={carryOnHref(receiptId)} className={className}>{children ?? "Carry on checking in"}</Link>
}

export function ReceiptStatusBadge({ status }: { status: string | null | undefined }) {
  const s = receiptStatus(status)
  return (
    <span title={RECEIPT_STATUS[s].help} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${RECEIPT_STATUS[s].tone}`}>
      {RECEIPT_STATUS[s].label}
    </span>
  )
}

/** What the receipt colours mean (RULES design rule 3 — a key wherever colour means something). */
export function ReceiptStatusKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
      {(Object.keys(RECEIPT_STATUS) as ReceiptStatusShown[]).map(s => (
        <span key={s} className="inline-flex items-center gap-1.5"><ReceiptStatusBadge status={s} /> {RECEIPT_STATUS[s].help}</span>
      ))}
    </div>
  )
}

/** "4 totes · 1 pallet" — or "Nothing booked yet" so an empty receipt never reads as a count. */
export function kindCounts(containers: { kind: string }[]): string {
  const pallets = containers.filter(c => c.kind === "pallet").length
  const totes = containers.length - pallets
  const parts = [
    totes ? `${totes} tote${totes === 1 ? "" : "s"}` : null,
    pallets ? `${pallets} pallet${pallets === 1 ? "" : "s"}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "Nothing booked yet"
}

const ORDER = Object.keys(CONTAINER_STATUS) as ContainerStatus[]

/** How many totes/pallets are at each stage, in the order goods move through the building. */
export function statusCounts(containers: { status: string | null }[]): { status: ContainerStatus; n: number }[] {
  const n = new Map<ContainerStatus, number>()
  for (const c of containers) {
    const s = (c.status && c.status in CONTAINER_STATUS ? c.status : "booked") as ContainerStatus
    n.set(s, (n.get(s) ?? 0) + 1)
  }
  return ORDER.filter(s => n.has(s)).map(s => ({ status: s, n: n.get(s)! }))
}

/** The counts as small status chips: "3 [In storage] 1 [At a bench]". */
export function StatusCounts({ containers }: { containers: { status: string | null }[] }) {
  const counts = statusCounts(containers)
  if (counts.length === 0) return <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {counts.map(c => (
        <span key={c.status} className="inline-flex items-center gap-1">
          <span className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">{c.n}</span>
          <StatusBadge status={c.status} />
        </span>
      ))}
    </span>
  )
}
