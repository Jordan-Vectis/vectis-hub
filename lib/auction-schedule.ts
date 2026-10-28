// Auction → Auctioneering Schedule. Shared by the page, the API and the PDF.
//
// One DaySchedule per sale. "Pinned" means two different things (Jordan, 2026-10-28: "both"):
//   📌 pinned  = the same person in that slot EVERY week — stored in the weekday defaults, so a
//                new week starts with them already in.
//   🔒 locked  = fixed for THIS sale only — "Fill from pinned" and "Clear" leave it alone.

export type Cell = { name: string; locked?: boolean }

export type Slot = { time: string; saleroom: Cell | null; vectis: Cell | null }

export type DaySchedule = {
  startTime: string
  auctioneers: Cell[]
  slots: Slot[]
  late: Cell[]
  phones: Cell[]
}

/** Pinned names per weekday ("1" = Monday … "7" = Sunday). Slots are matched by row position. */
export type Defaults = Record<string, DaySchedule>

export const DEFAULT_TIMES = ["09:30 - 11:00", "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00", "15:00 - 16:00", "16:00 - 17:00"]

export function blankDay(): DaySchedule {
  return {
    startTime: "09:30",
    auctioneers: [],
    slots: DEFAULT_TIMES.map(time => ({ time, saleroom: null, vectis: null })),
    late: [],
    phones: [],
  }
}

/** A sale never edited before: the weekday's pinned names, nothing locked. */
export function fromDefaults(def: DaySchedule | undefined): DaySchedule {
  if (!def) return blankDay()
  const unlock = (c: Cell | null) => (c?.name ? { name: c.name } : null)
  return {
    startTime: def.startTime || "09:30",
    auctioneers: def.auctioneers.map(c => ({ name: c.name })),
    slots: def.slots.map(s => ({ time: s.time, saleroom: unlock(s.saleroom), vectis: unlock(s.vectis) })),
    late: def.late.map(c => ({ name: c.name })),
    phones: def.phones.map(c => ({ name: c.name })),
  }
}

/** Never trust a stored or posted shape — keep only what the page understands. */
export function cleanDay(v: any): DaySchedule {
  const cell = (c: any): Cell | null => {
    const name = String(c?.name ?? "").trim().slice(0, 60)
    return name ? (c?.locked ? { name, locked: true } : { name }) : null
  }
  const list = (a: any): Cell[] => (Array.isArray(a) ? a.map(cell).filter((c): c is Cell => !!c).slice(0, 20) : [])
  const slots = Array.isArray(v?.slots)
    ? v.slots.slice(0, 20).map((s: any) => ({ time: String(s?.time ?? "").slice(0, 30), saleroom: cell(s?.saleroom), vectis: cell(s?.vectis) }))
    : blankDay().slots
  return {
    startTime: String(v?.startTime ?? "09:30").slice(0, 20),
    auctioneers: list(v?.auctioneers),
    slots,
    late: list(v?.late),
    phones: list(v?.phones),
  }
}

// ── Dates — every weekday and week boundary is worked out in London time (Railway runs UTC) ──

const UK = "Europe/London"

/** "2026-10-27" for an instant, as London sees it. */
export function ukYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: UK, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** 1 = Monday … 7 = Sunday, for a "YYYY-MM-DD". */
export function weekdayOf(ymd: string): number {
  const dow = new Date(ymd + "T12:00:00Z").getUTCDay()
  return dow === 0 ? 7 : dow
}

/** The Monday of the week containing ymd. */
export function mondayOf(ymd: string): string {
  return addDays(ymd, 1 - weekdayOf(ymd))
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** "Tue 27th" */
export function dayLabel(ymd: string): string {
  const d = new Date(ymd + "T12:00:00Z")
  const n = d.getUTCDate()
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"
  return d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) + " " + n + suffix
}

/** "30/10/26" — the week ends on the Friday, as on the old spreadsheet. */
export function weekEnding(monday: string): string {
  const [y, m, d] = addDays(monday, 4).split("-")
  return `${d}/${m}/${y.slice(2)}`
}

export type ScheduleSale = { id: string; code: string; name: string; date: string; lots: number }
