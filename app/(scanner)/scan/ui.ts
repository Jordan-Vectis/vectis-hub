// The handheld scanner's look — Goods In's palette (app/(app)/tools/warehouse/_components/ui.tsx),
// made for a 4–6" screen held in one hand at arm's length: big type, high contrast, every primary
// button at least 56px tall (min-h-14), secondary ones 48px (min-h-12). Dark by default, with light
// variants where the Hub's own light/dark switch is set to light. Server-safe (no hooks).

export const mono = "font-mono tracking-tight"

export const card = "rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"

/** The big primary button (≥ 56px). */
export const bigBtn =
  "inline-flex w-full items-center justify-center gap-2 min-h-14 rounded-2xl px-5 py-3 text-lg font-bold bg-indigo-600 text-white active:bg-indigo-700 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"

/** A plain (secondary) button, still big enough for a gloved thumb. */
export const btn =
  "inline-flex items-center justify-center gap-2 min-h-12 rounded-xl px-4 py-2 text-base font-semibold border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"

/** A 56px plain button for the main choices on a screen (Done, Home, Move it here). */
export const btnTall = `${btn} !min-h-14 text-lg`

export const field =
  "w-full min-h-14 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-4 py-3 text-lg text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-indigo-500"

export const label = "block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1"

/** London clock time with seconds — scans come seconds apart. */
export const clock = (iso: string | null | undefined) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d) : ""
}

/** "16 Oct, 10:42" — for "since when" on Find. */
export const when = (iso: string | null | undefined) => {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d) : ""
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

export const kindWord = (k: string | null | undefined) =>
  k === "bench" ? "bench" : k === "shelf" ? "shelf" : k === "storage" ? "storage" : k === "other" ? "other" : "location"
