// The handheld scanner's look — Goods In's palette (app/(app)/tools/warehouse/_components/ui.tsx),
// sized for a SMALL scanner screen (as little as 320 × 568 CSS px, portrait — a Newland MT65 is
// about 360 × 640): base text 15px, headings 18–20px, codes monospace 18–20px bold, primary buttons
// 48px tall (min-h-12), secondary 44px (min-h-11), rounded-xl, 12px gutters. Dark by default, with
// light variants where the Hub's own light/dark switch is set to light. Server-safe (no hooks).
//
// ⚠ Nothing here may give a box holding text a fixed height: the Android WebView (and Chrome's own
// text scaling) can make every font bigger while the boxes stay put — up to 130% must still fit.
// Use min-h-*, let rows wrap, and give every flex child that holds a code or a name `min-w-0`.

export const mono = "font-mono tracking-tight"

/** The screen's canvas colour (also behind the sheets and dialogs drawn over it). */
export const canvas = "bg-gray-50 dark:bg-[#141416] text-gray-900 dark:text-gray-100"

/** Keeps a full-screen layer clear of a notch, the status bar and the gesture bar (viewport-fit=cover). */
export const safeArea = "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"

/** A full-screen layer over the scanner screen (Settings, "Still …?", Switch user). */
export const sheet = `fixed inset-0 flex flex-col overflow-hidden ${canvas} ${safeArea}`

export const card = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"

/** A card's small heading. */
export const cardTitle = "text-[15px] font-bold leading-snug"

/** Small grey words under or beside something. */
export const muted = "text-[13px] leading-snug text-gray-600 dark:text-gray-400"

// ⚠ Each button's height and text size are spelled out ONCE, in its own constant — never by adding a
// second size class on top (`${btn} min-h-12 text-base`). Two classes setting the same property are
// settled by where Tailwind happens to put them in the CSS, not by their order in the string: v4.2
// writes `.text-[15px]` after `.text-base`, so text-base on top of btn's text-[15px] did nothing.
const primaryBase =
  "inline-flex w-full min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2 font-bold leading-tight text-center bg-indigo-600 text-white active:bg-indigo-700 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
const plainBase =
  "inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-3 py-1.5 font-semibold leading-tight text-center border border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 active:bg-gray-100 dark:active:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"

/** The primary button (48px, 16px text). */
export const bigBtn = `${primaryBase} min-h-12 text-base`

/** A primary button inside a list row (44px, 15px text) — Check's "Move it here". */
export const rowBtn = `${primaryBase} min-h-11 text-[15px]`

/** A plain (secondary) button (44px, 15px text). */
export const btn = `${plainBase} min-h-11 text-[15px]`

/** A 48px plain button for the main choices on a screen (Put things here, Cancel, Send now) — 16px text. */
export const btnTall = `${plainBase} min-h-12 text-base`

/** A 44px square button holding only an icon (the top bar's back arrow and cog). Give it an aria-label. */
export const iconBtn =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-700 dark:text-gray-200 active:bg-gray-200 dark:active:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"

export const field =
  "w-full min-w-0 min-h-11 rounded-xl border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-indigo-500"

export const label = "block text-[13px] font-semibold text-gray-700 dark:text-gray-200 mb-1"

/** London clock time with seconds — scans come seconds apart. */
export const clock = (iso: string | number | null | undefined) => {
  if (iso === null || iso === undefined || iso === "") return ""
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
