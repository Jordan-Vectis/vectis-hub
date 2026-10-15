import Link from "next/link"
import { KindBadge, mono } from "../_components/ui"

// Goods In — how a single move (a GoodsInMovement row) reads, shared by the dashboard's "Recent
// moves" and the History screen so the two always say the same thing. Server-safe (no hooks).

export type MoveRow = {
  id: string
  containerId: string | null
  lotId: string | null
  barcode: string | null
  locationCode: string
  fromCode: string | null
  note: string | null
  movedByName: string | null
  movedAt: Date
  container: { kind: string } | null
}

/** The select that fills a MoveRow — use it so both screens read the same columns. */
export const MOVE_SELECT = {
  id: true, containerId: true, lotId: true, barcode: true, locationCode: true, fromCode: true,
  note: true, movedByName: true, movedAt: true, container: { select: { kind: true } },
} as const

export type MoveKind = "tote" | "pallet" | "lot"

export const moveKind = (m: MoveRow): MoveKind =>
  m.containerId ? (m.container?.kind === "pallet" ? "pallet" : "tote") : "lot"

/** The code on the thing that moved: the tote/pallet number, or the lot's barcode. */
export const moveItem = (m: MoveRow): string => m.containerId ?? m.barcode ?? "Lot"

export const findHref = (code: string) => `/tools/warehouse/find?q=${encodeURIComponent(code)}`

/** Tote / Pallet / Lot as a small labelled chip (the label is the key — no colour coding). */
export function MoveKindChip({ kind }: { kind: MoveKind }) {
  if (kind !== "lot") return <KindBadge kind={kind} />
  return <span className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">Lot</span>
}

/** A location code that opens Find on it. */
export function LocationLink({ code }: { code: string }) {
  return (
    <Link href={findHref(code)} className={`${mono} font-semibold text-gray-900 dark:text-white underline decoration-gray-300 dark:decoration-gray-600 underline-offset-2 hover:decoration-indigo-500`}>
      {code}
    </Link>
  )
}

/** Where it came from. A tote's first move has no "from" — it was on its receipt, not anywhere yet. */
export function FromCell({ m }: { m: MoveRow }) {
  if (m.fromCode) return <LocationLink code={m.fromCode} />
  return <span className="text-gray-500 dark:text-gray-400 italic">{m.containerId ? "Booked in" : "First move"}</span>
}

/** "A1B2 → BENCH3", the way staff read a move. */
export function FromTo({ m }: { m: MoveRow }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <FromCell m={m} />
      <span aria-hidden className="text-gray-500 dark:text-gray-400">→</span>
      <span className="sr-only">to</span>
      <LocationLink code={m.locationCode} />
    </span>
  )
}
