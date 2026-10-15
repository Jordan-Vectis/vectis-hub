// Dates on the test website, always in Europe/London. The server runs in UTC on Railway, so a bare
// format() would print a 09:30 sale as 08:30 or 10:30 half the year (the Hub's standing rule:
// server-side date formatting names the timezone). Pure — fine on the server and in the browser.

const TZ = "Europe/London"

const parts = (d: Date) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)
  const get = (t: string) => p.find(x => x.type === t)?.value ?? ""
  return { weekday: get("weekday"), day: get("day"), month: get("month"), year: get("year"), hour: get("hour"), minute: get("minute") }
}

export const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** "Thursday 15 October", with " 09:30" after it when the time is not midnight. */
export function saleDateLine(d: Date | null): string {
  if (!d) return ""
  const p = parts(d)
  const time = p.hour === "00" && p.minute === "00" ? "" : ` ${p.hour}:${p.minute}`
  return `${p.weekday} ${p.day} ${p.month}${time}`
}

/** "Thursday 15th October 2026 09:30" — the banner's date line on vectis.co.uk. */
export function saleDateLong(d: Date | null): string {
  if (!d) return ""
  const p = parts(d)
  const time = p.hour === "00" && p.minute === "00" ? "" : ` ${p.hour}:${p.minute}`
  return `${p.weekday} ${ordinal(Number(p.day))} ${p.month} ${p.year}${time}`
}

/** "15 October 2026". */
export function dateShort(d: Date | null): string {
  if (!d) return ""
  const p = parts(d)
  return `${p.day} ${p.month} ${p.year}`
}

/** The pieces for a date box: month, day number, weekday. */
export function dateBox(d: Date): { month: string; day: string; weekday: string; year: string } {
  const p = parts(d)
  return { month: p.month, day: p.day, weekday: p.weekday, year: p.year }
}

/** The London calendar day as YYYY-MM-DD. */
export function londonYmd(d: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  return p
}

/** The London year of a date. */
export const londonYear = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric" }).format(d))
