// Accent classes for the training course cards.
//
// ⚠ Written out in full, never built by string concatenation. Tailwind scans the source for
// literal class names — `bg-${accent}-600` produces a class that exists in the HTML and in no
// stylesheet, which is why a dynamically-named colour renders as no colour at all.
//
// A course wears the colour of the panel it teaches (taken from that panel's Hub card), so the
// training for the Admin Centre looks like the Admin Centre.

export type Accent = {
  border: string
  ring:   string
  text:   string
  chip:   string
  btn:    string
}

const A = (border: string, ring: string, text: string, chip: string, btn: string): Accent =>
  ({ border, ring, text, chip, btn })

export const ACCENTS: Record<string, Accent> = {
  indigo:  A("border-indigo-500",  "hover:ring-indigo-500/30",  "text-indigo-600 dark:text-indigo-400",   "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",   "bg-indigo-600 hover:bg-indigo-500"),
  red:     A("border-red-500",     "hover:ring-red-500/30",     "text-red-600 dark:text-red-400",         "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300",               "bg-red-600 hover:bg-red-500"),
  green:   A("border-green-500",   "hover:ring-green-500/30",   "text-green-600 dark:text-green-400",     "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300",       "bg-green-600 hover:bg-green-500"),
  blue:    A("border-blue-500",    "hover:ring-blue-500/30",    "text-blue-600 dark:text-blue-400",       "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300",           "bg-blue-600 hover:bg-blue-500"),
  amber:   A("border-amber-500",   "hover:ring-amber-500/30",   "text-amber-600 dark:text-amber-400",     "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300",       "bg-amber-600 hover:bg-amber-500"),
  teal:    A("border-teal-500",    "hover:ring-teal-500/30",    "text-teal-600 dark:text-teal-400",       "bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300",           "bg-teal-600 hover:bg-teal-500"),
  slate:   A("border-slate-500",   "hover:ring-slate-500/30",   "text-slate-600 dark:text-slate-400",     "bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300",       "bg-slate-600 hover:bg-slate-500"),
  cyan:    A("border-cyan-500",    "hover:ring-cyan-500/30",    "text-cyan-600 dark:text-cyan-400",       "bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",           "bg-cyan-600 hover:bg-cyan-500"),
  rose:    A("border-rose-500",    "hover:ring-rose-500/30",    "text-rose-600 dark:text-rose-400",       "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300",           "bg-rose-600 hover:bg-rose-500"),
  yellow:  A("border-yellow-500",  "hover:ring-yellow-500/30",  "text-yellow-600 dark:text-yellow-400",   "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",   "bg-yellow-600 hover:bg-yellow-500"),
  violet:  A("border-violet-500",  "hover:ring-violet-500/30",  "text-violet-600 dark:text-violet-400",   "bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300",   "bg-violet-600 hover:bg-violet-500"),
  emerald: A("border-emerald-500", "hover:ring-emerald-500/30", "text-emerald-600 dark:text-emerald-400", "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300", "bg-emerald-600 hover:bg-emerald-500"),
  purple:  A("border-purple-500",  "hover:ring-purple-500/30",  "text-purple-600 dark:text-purple-400",   "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300",   "bg-purple-600 hover:bg-purple-500"),
  orange:  A("border-orange-500",  "hover:ring-orange-500/30",  "text-orange-600 dark:text-orange-400",   "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300",   "bg-orange-600 hover:bg-orange-500"),
  pink:    A("border-pink-500",    "hover:ring-pink-500/30",    "text-pink-600 dark:text-pink-400",       "bg-pink-100 dark:bg-pink-500/20 text-pink-700 dark:text-pink-300",           "bg-pink-600 hover:bg-pink-500"),
  sky:     A("border-sky-500",     "hover:ring-sky-500/30",     "text-sky-600 dark:text-sky-400",         "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300",               "bg-sky-600 hover:bg-sky-500"),
  lime:    A("border-lime-500",    "hover:ring-lime-500/30",    "text-lime-600 dark:text-lime-400",       "bg-lime-100 dark:bg-lime-500/20 text-lime-700 dark:text-lime-300",           "bg-lime-600 hover:bg-lime-500"),
  fuchsia: A("border-fuchsia-500", "hover:ring-fuchsia-500/30", "text-fuchsia-600 dark:text-fuchsia-400", "bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300", "bg-fuchsia-600 hover:bg-fuchsia-500"),
}

export function accent(name: string | null | undefined): Accent {
  return ACCENTS[name ?? ""] ?? ACCENTS.indigo
}

// Shared surfaces. The training screens follow the Admin Centre's own house style — large
// type, generous rows, 44px hit targets — because the people being trained on a tool are, by
// definition, the people least at home in it.
export const CARD  = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm"
export const INPUT =
  "w-full px-5 py-4 rounded-xl border-2 border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 " +
  "text-gray-900 dark:text-white text-lg placeholder:text-gray-400 " +
  "focus:outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/20 transition"
export const HINT  = "text-sm text-gray-500 dark:text-gray-400"
