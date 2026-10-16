import { LOCATION_KINDS, type LocationKind } from "@/lib/goods-in/model"

// The kind and "switched off" chips used on the Locations list and on a location's own page.
// No hooks, so they work in server and client components alike.

const KIND_TONE: Record<LocationKind, string> = {
  storage: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
  bench: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  shelf: "bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800",
  other: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
}

export const KIND = Object.fromEntries(LOCATION_KINDS.map(k => [k.value, k])) as Record<LocationKind, (typeof LOCATION_KINDS)[number]>

const KINDS = new Set<string>(LOCATION_KINDS.map(k => k.value))
/** A stored kind, or "storage" for a missing or unknown one. */
export const asKind = (k: string | null | undefined): LocationKind => (k && KINDS.has(k) ? (k as LocationKind) : "storage")

export function KindChip({ kind }: { kind: LocationKind }) {
  return <span title={KIND[kind].help} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${KIND_TONE[kind]}`}>{KIND[kind].label}</span>
}

export function OffChip() {
  return <span title="Switched off — kept for its history; nothing new can be moved here." className="inline-flex items-center rounded-full border border-dashed border-gray-400 dark:border-gray-500 px-2 py-0.5 text-xs font-medium text-gray-500 dark:text-gray-300 whitespace-nowrap">Switched off</span>
}
