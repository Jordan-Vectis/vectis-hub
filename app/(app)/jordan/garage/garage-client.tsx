"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

// JORDAN.SYS → GARAGE. Private to /jordan. A handful of cars, what is due when,
// the history of everything done to them, what each is worth and what it costs
// to run. Past cars keep their records.

const box   = "border border-(--j-dim) rounded-lg bg-(--j-box)"
const input = "w-full bg-(--j-bg) border border-(--j-dim) rounded px-2.5 py-1.5 text-sm text-(--j-text) placeholder:text-(--j-dim) focus:outline-none focus:border-(--j-acc)"
const btn   = "px-3 py-1.5 text-xs border border-(--j-dim) rounded hover:bg-(--j-glow) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "px-4 py-2 text-sm font-bold rounded bg-(--j-acc) text-(--j-on-acc) hover:bg-(--j-acc-hi) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

const KINDS = ["MOT", "SERVICE", "REPAIR", "TAX", "INSURANCE", "OTHER"] as const
const KIND_LABEL: Record<string, string> = {
  MOT: "MOT", SERVICE: "Service", REPAIR: "Repair", TAX: "Tax", INSURANCE: "Insurance", OTHER: "Other",
}

type Rec = {
  id: string; kind: string; date: string; mileage: number | null; costPence: number | null
  garage: string; result: string; notes: string; fileKeys: string[]
}
type Val = {
  id: string; asOf: string; low: number | null; mid: number; high: number | null; tradeIn: number | null
  mileage: number | null; source: string; note: string; model: string; createdAt: string
}
type Car = {
  id: string; nickname: string; reg: string; make: string; model: string; colour: string
  year: string; fuel: string; notes: string; photoKey: string; mileage: number | null
  motDue: string | null; taxDue: string | null; serviceDue: string | null; insuranceDue: string | null
  isPast: boolean; boughtOn: string | null; soldOn: string | null
  boughtPrice: number | null; soldPrice: number | null
  records: Rec[]
  valuations: Val[]
}

const fileUrl = (key: string) => `/api/jordan/cars/file?key=${encodeURIComponent(key)}`
const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "")
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`)
const gbp = (n: number | null | undefined) => (n == null ? "—" : `£${Math.round(n).toLocaleString("en-GB")}`)
const shortDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"

/** Days until a due date — negative is overdue. */
function daysTo(d: string | null): number | null {
  if (!d) return null
  const then = new Date(d); then.setHours(12, 0, 0, 0)
  const now = new Date();  now.setHours(12, 0, 0, 0)
  return Math.round((then.getTime() - now.getTime()) / 86_400_000)
}

/** ⚠ "Not recorded" must never look like "due today" — a missing date gets its
 *  own grey state rather than being lumped in with the urgent ones. */
function dueTone(d: string | null): { colour: string; label: string } {
  const n = daysTo(d)
  if (n === null) return { colour: "#3f5f4a", label: "not recorded" }
  if (n < 0)      return { colour: "#ff5c5c", label: `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue` }
  if (n === 0)    return { colour: "#ff5c5c", label: "today" }
  if (n <= 30)    return { colour: "#ffc94d", label: `in ${n} day${n === 1 ? "" : "s"}` }
  return { colour: "var(--j-ok)", label: `in ${n} days` }
}

/** The newest real valuation (an AI snapshot or a typed quote — never a past-year guess). */
function latestValue(car: Car): Val | null {
  const real = car.valuations.filter(v => v.source !== "AI_HISTORY")
  return real.length ? real[real.length - 1] : null
}

export default function GarageClient() {
  const [cars, setCars]       = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [needsValueMigration, setNeedsValueMigration] = useState(false)
  const [openId, setOpenId]   = useState<string | null>(null)
  const [busy, setBusy]       = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)

  const load = useCallback(async (keepOpen?: string) => {
    setLoading(true)
    try {
      const r = await fetch("/api/jordan/cars")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load the garage")
      setNeedsMigration(!!j.needsMigration)
      setNeedsValueMigration(!!j.needsValueMigration)
      setCars((j.cars ?? []).map((c: any) => ({ ...c, valuations: c.valuations ?? [] })))
      if (keepOpen !== undefined) setOpenId(keepOpen || null)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function api(url: string, body: any, method = "POST") {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }

  async function addCar(isPast: boolean) {
    const nickname = prompt(isPast ? "What was it? (e.g. the old Focus)" : "What do you call it? (e.g. the Golf)")?.trim()
    if (!nickname) return
    setError(null)
    try {
      const j = await api("/api/jordan/cars", { nickname, isPast })
      await load(j.id)
      if (isPast) setShowPast(true)
    } catch (e: any) { setError(e.message) }
  }

  const current = cars.filter(c => !c.isPast)
  const past    = cars.filter(c => c.isPast)

  return (
    <div className="space-y-4 text-sm pb-16">
      {needsMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          The garage tables aren&apos;t in the database yet — press <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {!needsMigration && needsValueMigration && (
        <div className="border border-amber-600 bg-amber-950/30 text-amber-300 rounded-lg px-4 py-2.5 text-xs">
          A database update is waiting for the <strong>value</strong> section — the rest of the garage works as normal.
        </div>
      )}
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs">{error}</div>}

      {/* ── What's due ── */}
      {current.length > 0 && <DueStrip cars={current} onOpen={setOpenId} />}

      {/* ── Worth + running costs across the fleet ── */}
      {cars.length > 0 && <FleetStrip cars={cars} />}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tracking-widest opacity-60">CURRENT CARS ({current.length})</span>
        <button className={btn} onClick={() => addCar(false)}>+ ADD A CAR</button>
      </div>

      {loading ? <p className="text-xs opacity-60">LOADING…</p> : current.length === 0 ? (
        <p className="text-xs opacity-50">Nothing here yet — add a car and fill in when its MOT, tax and service are due.</p>
      ) : current.map(car => (
        <CarCard key={car.id} car={car} open={openId === car.id} busy={busy} setBusy={setBusy}
          onToggle={() => setOpenId(openId === car.id ? null : car.id)}
          onChanged={() => load(car.id)} onError={setError} valueReady={!needsValueMigration} />
      ))}

      {/* ── Past cars ── */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <button className="text-xs tracking-widest opacity-60 hover:opacity-100" onClick={() => setShowPast(s => !s)}>
          {showPast ? "▼" : "▶"} PAST CARS ({past.length})
        </button>
        <button className={btn} onClick={() => addCar(true)}>+ ADD A PAST CAR</button>
      </div>
      {showPast && (past.length === 0
        ? <p className="text-xs opacity-50">None yet. A current car can be moved here with &quot;Mark as sold&quot;.</p>
        : past.map(car => (
            <CarCard key={car.id} car={car} open={openId === car.id} busy={busy} setBusy={setBusy}
              onToggle={() => setOpenId(openId === car.id ? null : car.id)}
              onChanged={() => load(car.id)} onError={setError} valueReady={!needsValueMigration} />
          )))}
    </div>
  )
}

/** The one thing worth seeing without opening anything: what needs doing. */
function DueStrip({ cars, onOpen }: { cars: Car[]; onOpen: (id: string) => void }) {
  const items = cars.flatMap(c => ([
    { car: c, what: "MOT",       when: c.motDue },
    { car: c, what: "Tax",       when: c.taxDue },
    { car: c, what: "Service",   when: c.serviceDue },
    { car: c, what: "Insurance", when: c.insuranceDue },
  ]))
    .filter(i => i.when)
    .map(i => ({ ...i, days: daysTo(i.when)! }))
    .filter(i => i.days <= 60)
    .sort((a, b) => a.days - b.days)

  if (!items.length) return null
  return (
    <div className={`${box} p-4`}>
      <span className="text-xs tracking-widest opacity-60">DUE SOON</span>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((i, n) => {
          const t = dueTone(i.when)
          return (
            <button key={n} onClick={() => onOpen(i.car.id)}
              className="px-3 py-1.5 text-xs rounded border hover:bg-(--j-glow) transition-colors"
              style={{ borderColor: t.colour, color: t.colour }}>
              {i.car.nickname || i.car.reg || "Car"} · {i.what} <span className="opacity-70">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Running costs ───────────────────────────────────────────────────────────

/** What a car has cost over the time it was (is) owned, as averages. The period
 *  runs from "bought on" (or the first record, if that's not filled in) to "sold
 *  on" (or today) — never shorter than one month, so one invoice in week one
 *  doesn't read as thousands a month. */
function runningCosts(car: Car) {
  const dated = car.records.filter(r => r.costPence != null)
  const totalPence = dated.reduce((s, r) => s + (r.costPence ?? 0), 0)
  const firstRec = car.records.length ? car.records.reduce((m, r) => (r.date < m ? r.date : m), car.records[0].date) : null
  const from = car.boughtOn ?? firstRec
  const to = car.soldOn ?? new Date().toISOString()
  if (!from || !totalPence) return null
  const months = Math.max(1, (new Date(to).getTime() - new Date(from).getTime()) / (365.25 / 12 * 86_400_000))
  const byKind = KINDS.map(k => ({ kind: k, pence: dated.filter(r => r.kind === k).reduce((s, r) => s + (r.costPence ?? 0), 0) }))
    .filter(k => k.pence > 0).sort((a, b) => b.pence - a.pence)
  return { totalPence, months, perMonth: totalPence / months, perYear: totalPence / months * 12, byKind, from, to }
}

function RunningCosts({ car }: { car: Car }) {
  const c = runningCosts(car)
  if (!c) return null
  return (
    <div className="border border-(--j-dim2) rounded p-3 mb-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
        <span className="text-[11px] uppercase tracking-wider opacity-50">Running costs</span>
        <span><b>{money(Math.round(c.perMonth))}</b> <span className="opacity-60">a month</span></span>
        <span><b>{money(Math.round(c.perYear))}</b> <span className="opacity-60">a year</span></span>
        <span className="opacity-60">{money(c.totalPence)} over {c.months < 1.5 ? "the first month" : `${Math.round(c.months)} months`} · {shortDate(c.from)} → {car.soldOn ? shortDate(c.to) : "today"}</span>
      </div>
      <div className="mt-2 space-y-1">
        {c.byKind.map(k => (
          <div key={k.kind} className="flex items-center gap-2 text-[11px]">
            <span className="w-16 opacity-70">{KIND_LABEL[k.kind]}</span>
            <span className="flex-1 h-2 rounded-sm bg-(--j-glow) overflow-hidden">
              <span className="block h-full bg-(--j-acc)" style={{ width: `${Math.max(2, (k.pence / c.totalPence) * 100)}%` }} />
            </span>
            <span className="w-20 text-right">{money(k.pence)}</span>
            <span className="w-12 text-right opacity-50">{Math.round((k.pence / c.totalPence) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One line across every car: what the current ones are worth together, and what
 *  the lot costs a month. Hidden until there is something to say. */
function FleetStrip({ cars }: { cars: Car[] }) {
  const current = cars.filter(c => !c.isPast)
  const worth = current.map(latestValue).filter((v): v is Val => !!v)
  const costs = current.map(runningCosts).filter((c): c is NonNullable<ReturnType<typeof runningCosts>> => !!c)
  if (!worth.length && !costs.length) return null
  const totalWorth = worth.reduce((s, v) => s + v.mid, 0)
  const perMonth = costs.reduce((s, c) => s + c.perMonth, 0)
  return (
    <div className={`${box} px-4 py-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs`}>
      {worth.length > 0 && (
        <span><span className="opacity-60">Current cars worth about </span><b className="text-base">{gbp(totalWorth)}</b>
          <span className="opacity-50"> ({worth.length} of {current.length} valued)</span></span>
      )}
      {costs.length > 0 && (
        <span><span className="opacity-60">Running costs </span><b>{money(Math.round(perMonth))}</b><span className="opacity-60"> a month across {costs.length} car{costs.length === 1 ? "" : "s"}</span></span>
      )}
    </div>
  )
}

// ─── Value over time ─────────────────────────────────────────────────────────

type Pt = { x: number; y: number; low: number | null; high: number | null; kind: "ai" | "guess" | "quote" | "bought" | "sold"; label: string; date: string; id?: string }

function ValueSection({ car, onChanged, onError, ready }: { car: Car; onChanged: () => void; onError: (m: string) => void; ready: boolean }) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [result, setResult] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [q, setQ] = useState({ asOf: new Date().toISOString().slice(0, 10), mid: "", low: "", high: "", note: "" })

  const latest = latestValue(car)

  async function value() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setResult(null)
    try {
      const r = await fetch("/api/jordan/cars/value", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carId: car.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? "The valuer didn't answer")
      setResult(`${gbp(j.mid)} today${j.low != null && j.high != null ? ` (${gbp(j.low)}–${gbp(j.high)})` : ""}${j.tradeIn != null ? ` · trade-in ${gbp(j.tradeIn)}` : ""}${j.historyYears ? ` · ${j.historyYears} past year${j.historyYears === 1 ? "" : "s"} estimated` : ""}${j.groundedFallback ? " · ⚠ answered without a live web search" : ""}${j.confident ? "" : " · ⚠ the valuer wasn't sure of the car"}`)
      onChanged()
    } catch (e: any) { onError(e.message) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function addQuote() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      const r = await fetch("/api/jordan/cars/value", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carId: car.id, manual: true, ...q }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? "Couldn't save that")
      setQ({ asOf: new Date().toISOString().slice(0, 10), mid: "", low: "", high: "", note: "" }); setAdding(false); onChanged()
    } catch (e: any) { onError(e.message) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm("Remove this value from the history?")) return
    try {
      const r = await fetch("/api/jordan/cars/value", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't remove it")
      onChanged()
    } catch (e: any) { onError(e.message) }
  }

  // Every point on the chart: valuations, plus what was paid and what it sold for.
  const points = useMemo<Pt[]>(() => {
    const pts: Pt[] = car.valuations.map(v => ({
      x: new Date(v.asOf).getTime(), y: v.mid, low: v.low, high: v.high, id: v.id, date: v.asOf,
      kind: v.source === "MANUAL" ? "quote" : v.source === "AI_HISTORY" ? "guess" : "ai",
      label: v.source === "MANUAL" ? (v.note ? `Quote · ${v.note.slice(0, 60)}` : "Quote") : v.source === "AI_HISTORY" ? "AI estimate of that year-end" : "AI valuation",
    }))
    if (car.boughtOn && car.boughtPrice != null) pts.push({ x: new Date(car.boughtOn).getTime(), y: car.boughtPrice, low: null, high: null, kind: "bought", label: "Bought for", date: car.boughtOn })
    if (car.soldOn && car.soldPrice != null)     pts.push({ x: new Date(car.soldOn).getTime(),   y: car.soldPrice,   low: null, high: null, kind: "sold",   label: "Sold for",   date: car.soldOn })
    return pts.sort((a, b) => a.x - b.x)
  }, [car])

  // Year by year: the average of that year's valuations, and the change on the year before.
  const byYear = useMemo(() => {
    const m = new Map<number, number[]>()
    for (const v of car.valuations) {
      const y = new Date(v.asOf).getFullYear()
      m.set(y, [...(m.get(y) ?? []), v.mid])
    }
    const rows = [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, vals]) => ({ year, avg: vals.reduce((s, n) => s + n, 0) / vals.length, n: vals.length }))
    return rows.map((r, i) => ({ ...r, change: i ? r.avg - rows[i - 1].avg : null, pct: i && rows[i - 1].avg ? ((r.avg - rows[i - 1].avg) / rows[i - 1].avg) * 100 : null }))
  }, [car.valuations])

  const ageDays = latest ? daysTo(latest.asOf) : null

  return (
    <div className="border-t border-(--j-dim2) pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-[11px] uppercase tracking-wider opacity-50">
          Value
          {latest && <span className="ml-2 normal-case tracking-normal opacity-100 text-(--j-text)">
            about <b className="text-sm">{gbp(latest.mid)}</b>
            {latest.low != null && latest.high != null && <span className="opacity-60"> ({gbp(latest.low)}–{gbp(latest.high)})</span>}
            {latest.tradeIn != null && <span className="opacity-60"> · trade-in {gbp(latest.tradeIn)}</span>}
            <span className="opacity-50"> · {latest.source === "MANUAL" ? "a quote" : "AI estimate"} {ageDays === 0 ? "today" : `${Math.abs(ageDays ?? 0)} days ago`}</span>
          </span>}
        </span>
        <span className="flex gap-2">
          <button className={btn} onClick={() => setAdding(a => !a)} disabled={!ready}>{adding ? "CANCEL" : "+ ADD A QUOTE"}</button>
          <button className={btnGo} onClick={value} disabled={busy || !ready}>{busy ? "VALUING…" : latest ? "VALUE IT AGAIN" : "✨ VALUE THIS CAR"}</button>
        </span>
      </div>
      {result && <p className="text-xs mb-2 text-(--j-acc)">{result}</p>}
      {latest?.note && latest.source !== "MANUAL" && <p className="text-xs opacity-70 mb-2">{latest.note}</p>}

      {adding && (
        <div className="border border-(--j-dim2) rounded p-3 space-y-2 mb-3">
          <p className="text-[11px] opacity-60">A real figure — WeBuyAnyCar, a dealer, a similar advert — so the trend has something solid in it.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <F label="Date"    v={q.asOf} on={v => setQ({ ...q, asOf: v })} type="date" />
            <F label="Value £" v={q.mid}  on={v => setQ({ ...q, mid: v })} />
            <F label="Low £ (optional)"  v={q.low}  on={v => setQ({ ...q, low: v })} />
            <F label="High £ (optional)" v={q.high} on={v => setQ({ ...q, high: v })} />
          </div>
          <F label="Where from" v={q.note} on={v => setQ({ ...q, note: v })} />
          <button className={btnGo} onClick={addQuote} disabled={busy || !q.mid}>{busy ? "SAVING…" : "SAVE QUOTE"}</button>
        </div>
      )}

      {points.length === 0 ? (
        <p className="text-xs opacity-40">Not valued yet. Press ✨ Value this car for today&apos;s figure plus an estimate of each past year — it is an AI estimate from live UK listings, not a quote.</p>
      ) : (
        <>
          <ValueChart points={points} />
          {byYear.length > 1 && (
            <table className="mt-2 text-xs w-full max-w-md">
              <thead><tr className="text-[11px] uppercase tracking-wider opacity-50 text-left"><th className="py-1 font-normal">Year</th><th className="py-1 font-normal text-right">Average value</th><th className="py-1 font-normal text-right">Change</th></tr></thead>
              <tbody>
                {byYear.map(r => (
                  <tr key={r.year} className="border-t border-(--j-dim2)">
                    <td className="py-1">{r.year}{r.n > 1 && <span className="opacity-40"> · {r.n} values</span>}</td>
                    <td className="py-1 text-right">{gbp(r.avg)}</td>
                    <td className="py-1 text-right" style={{ color: r.change == null ? undefined : r.change < 0 ? "#ff5c5c" : "var(--j-ok)" }}>
                      {r.change == null ? "—" : `${r.change < 0 ? "−" : "+"}${gbp(Math.abs(r.change))} (${r.pct! < 0 ? "−" : "+"}${Math.abs(r.pct!).toFixed(0)}%)`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button className="mt-2 text-[11px] opacity-50 hover:opacity-100" onClick={() => setShowAll(s => !s)}>
            {showAll ? "▼" : "▶"} every value ({car.valuations.length})
          </button>
          {showAll && (
            <div className="mt-1 space-y-1">
              {[...car.valuations].reverse().map(v => (
                <div key={v.id} className="flex flex-wrap items-baseline gap-x-3 text-[11px] border border-(--j-dim2) rounded px-2 py-1">
                  <span className="opacity-70">{shortDate(v.asOf)}</span>
                  <span className="font-bold">{gbp(v.mid)}</span>
                  {v.low != null && v.high != null && <span className="opacity-50">{gbp(v.low)}–{gbp(v.high)}</span>}
                  <span className="opacity-50">{v.source === "MANUAL" ? `quote${v.note ? ` · ${v.note}` : ""}` : v.source === "AI_HISTORY" ? "AI estimate of that year-end" : "AI valuation"}</span>
                  <button className="ml-auto opacity-40 hover:opacity-100 hover:text-red-400" onClick={() => remove(v.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** One line — what the car was worth — over time. The low–high band sits behind
 *  it where a valuation gave a range. Different kinds of point get different
 *  SHAPES (not just colours) and the key underneath names each one. Hover for
 *  the figure. Colours come from the look's variables, never a hex. */
function ValueChart({ points }: { points: Pt[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(280, el.clientWidth)))
    ro.observe(el); setWidth(Math.max(280, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const H = 220, padL = 52, padR = 16, padT = 14, padB = 28
  const xs = points.map(p => p.x)
  let x0 = Math.min(...xs), x1 = Math.max(...xs)
  if (x1 - x0 < 30 * 86_400_000) { x0 -= 15 * 86_400_000; x1 += 15 * 86_400_000 }
  const ys = points.flatMap(p => [p.y, p.low ?? p.y, p.high ?? p.y])
  const yMax = Math.max(...ys) * 1.08 || 1
  const yMin = Math.max(0, Math.min(...ys) * 0.85)
  const X = (t: number) => padL + ((t - x0) / (x1 - x0 || 1)) * (width - padL - padR)
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - padT - padB)

  // The line joins the valuations only — bought/sold are reference marks.
  const line = points.filter(p => p.kind !== "bought" && p.kind !== "sold")
  const seg = (a: Pt, b: Pt) => `M${X(a.x)},${Y(a.y)} L${X(b.x)},${Y(b.y)}`
  const band = line.filter(p => p.low != null && p.high != null)
  const bandPath = band.length > 1
    ? `M${band.map(p => `${X(p.x)},${Y(p.high!)}`).join(" L")} L${[...band].reverse().map(p => `${X(p.x)},${Y(p.low!)}`).join(" L")} Z`
    : ""

  // Y gridlines: four nice steps. X ticks: 1 January of each year in range.
  const steps = 4
  const rawStep = (yMax - yMin) / steps
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= rawStep) ?? rawStep
  const gridVals: number[] = []
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) gridVals.push(v)
  const years: number[] = []
  for (let y = new Date(x0).getFullYear() + 1; y <= new Date(x1).getFullYear(); y++) years.push(y)
  const showEveryYear = years.length <= Math.floor((width - padL - padR) / 48)

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
    const mx = e.clientX - r.left
    let best = 0, bd = Infinity
    points.forEach((p, i) => { const d = Math.abs(X(p.x) - mx); if (d < bd) { bd = d; best = i } })
    setHover(best)
  }

  const hp = hover != null ? points[hover] : null
  const dash = (a: Pt, b: Pt) => (a.kind === "guess" || b.kind === "guess") ? "5 4" : undefined

  return (
    <div ref={wrap} className="w-full">
      <svg width={width} height={H} className="block select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {gridVals.map(v => (
          <g key={v}>
            <line x1={padL} x2={width - padR} y1={Y(v)} y2={Y(v)} stroke="var(--j-dim2)" strokeWidth={1} />
            <text x={padL - 6} y={Y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--j-text)" opacity={0.6}>{gbp(v)}</text>
          </g>
        ))}
        {years.map((y, i) => {
          const t = new Date(y, 0, 1).getTime()
          if (t < x0 || t > x1) return null
          return (
            <g key={y}>
              <line x1={X(t)} x2={X(t)} y1={padT} y2={H - padB} stroke="var(--j-dim2)" strokeWidth={1} strokeDasharray="2 3" />
              {(showEveryYear || i % 2 === 0) && <text x={X(t)} y={H - padB + 14} textAnchor="middle" fontSize={10} fill="var(--j-text)" opacity={0.6}>{y}</text>}
            </g>
          )
        })}
        {bandPath && <path d={bandPath} fill="var(--j-acc)" opacity={0.12} />}
        {line.slice(1).map((p, i) => (
          <path key={i} d={seg(line[i], p)} stroke="var(--j-acc)" strokeWidth={2} fill="none" strokeDasharray={dash(line[i], p)} strokeLinecap="round" />
        ))}
        {points.map((p, i) => {
          const cx = X(p.x), cy = Y(p.y), on = hover === i
          const r = on ? 6 : 4.5
          if (p.kind === "bought" || p.kind === "sold") return (
            <g key={i}>
              <path d={`M${cx},${cy - r - 1.5} L${cx + r + 1.5},${cy} L${cx},${cy + r + 1.5} L${cx - r - 1.5},${cy} Z`} fill="var(--j-box)" stroke="var(--j-hi)" strokeWidth={2} />
              <text x={cx} y={cy - r - 6} textAnchor="middle" fontSize={10} fill="var(--j-text)" opacity={0.8}>{p.kind === "bought" ? "Bought" : "Sold"} {gbp(p.y)}</text>
            </g>
          )
          if (p.kind === "quote") return <rect key={i} x={cx - r} y={cy - r} width={r * 2} height={r * 2} fill="var(--j-hi)" stroke="var(--j-box)" strokeWidth={2} />
          if (p.kind === "guess") return <circle key={i} cx={cx} cy={cy} r={r} fill="var(--j-box)" stroke="var(--j-acc)" strokeWidth={2} />
          return <circle key={i} cx={cx} cy={cy} r={r} fill="var(--j-acc)" stroke="var(--j-box)" strokeWidth={2} />
        })}
        {hp && (() => {
          const cx = X(hp.x)
          const text = `${shortDate(hp.date)} · ${gbp(hp.y)}${hp.low != null && hp.high != null ? ` (${gbp(hp.low)}–${gbp(hp.high)})` : ""} · ${hp.label}`
          const w = Math.min(width - 20, text.length * 6.2 + 16)
          const bx = Math.max(10, Math.min(width - w - 10, cx - w / 2))
          return (
            <g>
              <line x1={cx} x2={cx} y1={padT} y2={H - padB} stroke="var(--j-dim)" strokeWidth={1} />
              <rect x={bx} y={2} width={w} height={20} rx={4} fill="var(--j-bg)" stroke="var(--j-dim)" />
              <text x={bx + w / 2} y={16} textAnchor="middle" fontSize={11} fill="var(--j-text)">{text}</text>
            </g>
          )
        })()}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] opacity-70 mt-1">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full bg-(--j-acc) align-middle mr-1" />AI valuation</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-(--j-acc) align-middle mr-1" />AI estimate of a past year-end (dashed)</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-(--j-hi) align-middle mr-1" />A real quote</span>
        <span><span className="inline-block w-2.5 h-2.5 border-2 border-(--j-hi) rotate-45 align-middle mr-1" />Bought / sold for</span>
        <span><span className="inline-block w-4 h-2.5 bg-(--j-acc) opacity-30 align-middle mr-1" />Low–high range</span>
      </div>
    </div>
  )
}

// ─── The car card ────────────────────────────────────────────────────────────

function CarCard({ car, open, onToggle, onChanged, onError, busy, setBusy, valueReady }: {
  car: Car; open: boolean; onToggle: () => void; onChanged: () => void
  onError: (m: string) => void; busy: string | null; setBusy: (b: string | null) => void; valueReady: boolean
}) {
  const [form, setForm] = useState(() => toForm(car))
  const [dirty, setDirty] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  // The row is re-rendered from the server after every save, so re-seed the form
  // when the car changes underneath it.
  useEffect(() => { setForm(toForm(car)); setDirty(false) }, [car])

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); setDirty(true) }

  async function api(url: string, body: any, method = "POST") {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? "Something went wrong")
    return j
  }

  async function save() {
    setBusy(`save-${car.id}`)
    try { await api("/api/jordan/cars", { id: car.id, ...form }, "PUT"); onChanged() }
    catch (e: any) { onError(e.message) } finally { setBusy(null) }
  }

  async function uploadPhoto(file: File) {
    setBusy(`photo-${car.id}`)
    try {
      const fd = new FormData(); fd.append("file", file)
      const r = await fetch("/api/jordan/cars/file", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Upload failed")
      const old = car.photoKey
      await api("/api/jordan/cars", { id: car.id, photoKey: j.key }, "PUT")
      // Only bin the old one once the new key is safely on the record.
      if (old) await fetch("/api/jordan/cars/file", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: old }) }).catch(() => {})
      onChanged()
    } catch (e: any) { onError(e.message) }
    finally { setBusy(null); if (photoRef.current) photoRef.current.value = "" }
  }

  async function markSold() {
    const when = prompt("Sold on? (YYYY-MM-DD, blank for today)", new Date().toISOString().slice(0, 10))
    if (when === null) return
    try {
      await api("/api/jordan/cars", { id: car.id, isPast: true, soldOn: when || new Date().toISOString().slice(0, 10) }, "PUT")
      onChanged()
    } catch (e: any) { onError(e.message) }
  }

  async function removeCar() {
    if (!confirm(`Delete "${car.nickname || car.reg}" and all ${car.records.length} of its records? This also removes its photos.`)) return
    try { await api("/api/jordan/cars", { id: car.id }, "DELETE"); onChanged() }
    catch (e: any) { onError(e.message) }
  }

  const title = [car.nickname, car.reg].filter(Boolean).join(" · ") || "Untitled car"
  const sub   = [car.year, car.make, car.model, car.colour].filter(Boolean).join(" ")
  const worth = latestValue(car)

  return (
    <div className={box}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-(--j-glow) transition-colors">
        {car.photoKey
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={fileUrl(car.photoKey)} alt="" className="w-16 h-12 object-cover rounded border border-(--j-dim)" />
          : <span className="w-16 h-12 rounded border border-(--j-dim2) grid place-items-center text-[10px] opacity-40">no photo</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {sub && <span className="block text-xs opacity-50">{sub}</span>}
        </span>
        {!car.isPast && worth && <span className="hidden sm:inline text-[11px] opacity-70">~{gbp(worth.mid)}</span>}
        {!car.isPast && (
          <span className="hidden sm:flex gap-3 text-[11px]">
            {(["MOT", "Tax", "Service"] as const).map(w => {
              const d = w === "MOT" ? car.motDue : w === "Tax" ? car.taxDue : car.serviceDue
              const t = dueTone(d)
              return <span key={w} style={{ color: t.colour }}>{w} {shortDate(d)}</span>
            })}
          </span>
        )}
        {car.isPast && <span className="text-[11px] opacity-50">sold {shortDate(car.soldOn)}{car.soldPrice != null ? ` for ${gbp(car.soldPrice)}` : ""}</span>}
        <span className="opacity-50 text-xs">{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => photoRef.current?.click()} disabled={busy === `photo-${car.id}`}>
              {busy === `photo-${car.id}` ? "UPLOADING…" : car.photoKey ? "CHANGE PHOTO" : "⬆ ADD PHOTO"}
            </button>
            <input ref={photoRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f) }} />
            {!car.isPast && <button className={btn} onClick={markSold}>MARK AS SOLD</button>}
            {car.isPast && <button className={btn} onClick={() => api("/api/jordan/cars", { id: car.id, isPast: false }, "PUT").then(onChanged).catch(e => onError(e.message))}>BACK TO CURRENT</button>}
            <button className={`${btn} ml-auto hover:border-red-500 hover:text-red-400`} onClick={removeCar}>DELETE CAR</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <F label="Nickname" v={form.nickname} on={v => set("nickname", v)} />
            <F label="Reg"      v={form.reg}      on={v => set("reg", v.toUpperCase())} />
            <F label="Make"     v={form.make}     on={v => set("make", v)} />
            <F label="Model"    v={form.model}    on={v => set("model", v)} />
            <F label="Colour"   v={form.colour}   on={v => set("colour", v)} />
            <F label="Year"     v={form.year}     on={v => set("year", v)} />
            <F label="Fuel"     v={form.fuel}     on={v => set("fuel", v)} />
            <F label="Mileage"  v={form.mileage}  on={v => set("mileage", v)} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <F label="MOT due"       v={form.motDue}       on={v => set("motDue", v)} type="date" />
            <F label="Tax due"       v={form.taxDue}       on={v => set("taxDue", v)} type="date" />
            <F label="Service due"   v={form.serviceDue}   on={v => set("serviceDue", v)} type="date" />
            <F label="Insurance due" v={form.insuranceDue} on={v => set("insuranceDue", v)} type="date" />
            <F label="Bought on"     v={form.boughtOn}     on={v => set("boughtOn", v)} type="date" />
            <F label="Bought for £"  v={form.boughtPrice}  on={v => set("boughtPrice", v)} />
            <F label="Sold on"       v={form.soldOn}       on={v => set("soldOn", v)} type="date" />
            <F label="Sold for £"    v={form.soldPrice}    on={v => set("soldPrice", v)} />
          </div>

          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">Notes</span>
            <textarea value={form.notes} rows={2} onChange={e => set("notes", e.target.value)} className={`${input} resize-y`} />
          </label>

          <div className="flex items-center gap-3">
            <button className={btnGo} onClick={save} disabled={!dirty || busy === `save-${car.id}`}>
              {busy === `save-${car.id}` ? "SAVING…" : "SAVE"}
            </button>
            {dirty && <span className="text-[11px] text-amber-400">unsaved</span>}
          </div>

          <ValueSection car={car} onChanged={onChanged} onError={onError} ready={valueReady} />
          <History car={car} onChanged={onChanged} onError={onError} />
        </div>
      )}
    </div>
  )
}

function History({ car, onChanged, onError }: { car: Car; onChanged: () => void; onError: (m: string) => void }) {
  const blank = { kind: "SERVICE", date: new Date().toISOString().slice(0, 10), mileage: "", cost: "", garage: "", result: "", notes: "", fileKeys: [] as string[] }
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const total = car.records.reduce((s, r) => s + (r.costPence ?? 0), 0)

  async function attach(file: File) {
    setBusy(true)
    try {
      const fd = new FormData(); fd.append("file", file)
      const r = await fetch("/api/jordan/cars/file", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Upload failed")
      setF(x => ({ ...x, fileKeys: [...x.fileKeys, j.key] }))
    } catch (e: any) { onError(e.message) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }

  async function add() {
    setBusy(true)
    try {
      const r = await fetch("/api/jordan/cars/records", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId: car.id, ...f }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't save that")
      setF(blank); setAdding(false); onChanged()
    } catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm("Delete this record and any files on it?")) return
    try {
      const r = await fetch("/api/jordan/cars/records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't delete")
      onChanged()
    } catch (e: any) { onError(e.message) }
  }

  return (
    <div className="border-t border-(--j-dim2) pt-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[11px] uppercase tracking-wider opacity-50">
          History ({car.records.length}){total > 0 && <span className="ml-2 opacity-70">spent {money(total)}</span>}
        </span>
        <button className={btn} onClick={() => setAdding(a => !a)}>{adding ? "CANCEL" : "+ ADD RECORD"}</button>
      </div>

      <RunningCosts car={car} />

      {adding && (
        <div className="border border-(--j-dim2) rounded p-3 space-y-2 mb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label className="block">
              <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">Type</span>
              <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} className={input}>
                {KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </label>
            <F label="Date"    v={f.date}    on={v => setF({ ...f, date: v })} type="date" />
            <F label="Mileage" v={f.mileage} on={v => setF({ ...f, mileage: v })} />
            <F label="Cost £"  v={f.cost}    on={v => setF({ ...f, cost: v })} />
            <F label="Garage"  v={f.garage}  on={v => setF({ ...f, garage: v })} />
            {f.kind === "MOT" && (
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">Result</span>
                <select value={f.result} onChange={e => setF({ ...f, result: e.target.value })} className={input}>
                  <option value="">—</option><option value="PASS">Pass</option><option value="FAIL">Fail</option>
                </select>
              </label>
            )}
          </div>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">Notes / advisories</span>
            <textarea value={f.notes} rows={2} onChange={e => setF({ ...f, notes: e.target.value })} className={`${input} resize-y`} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => fileRef.current?.click()} disabled={busy}>⬆ ATTACH FILE</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
              onChange={e => { const file = e.target.files?.[0]; if (file) void attach(file) }} />
            {f.fileKeys.map((k, i) => (
              <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer" className="text-[11px] underline opacity-70 hover:opacity-100">file {i + 1}</a>
            ))}
            <button className={`${btnGo} ml-auto`} onClick={add} disabled={busy || !f.date}>{busy ? "SAVING…" : "SAVE RECORD"}</button>
          </div>
        </div>
      )}

      {car.records.length === 0 ? (
        <p className="text-xs opacity-40">Nothing recorded yet.</p>
      ) : (
        <div className="space-y-1.5">
          {car.records.map(r => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs border border-(--j-dim2) rounded px-3 py-2">
              <span className="font-bold" style={{ color: r.result === "FAIL" ? "#ff5c5c" : undefined }}>
                {KIND_LABEL[r.kind] ?? r.kind}{r.result ? ` · ${r.result === "PASS" ? "Pass" : "Fail"}` : ""}
              </span>
              <span className="opacity-70">{shortDate(r.date)}</span>
              {r.mileage != null && <span className="opacity-50">{r.mileage.toLocaleString()} mi</span>}
              {r.costPence != null && <span className="opacity-50">{money(r.costPence)}</span>}
              {r.garage && <span className="opacity-50">{r.garage}</span>}
              {r.notes && <span className="opacity-70 basis-full">{r.notes}</span>}
              {r.fileKeys.map((k, i) => (
                <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer" className="underline opacity-60 hover:opacity-100">file {i + 1}</a>
              ))}
              <button className="ml-auto opacity-40 hover:opacity-100 hover:text-red-400" onClick={() => remove(r.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toForm(c: Car) {
  return {
    nickname: c.nickname, reg: c.reg, make: c.make, model: c.model, colour: c.colour,
    year: c.year, fuel: c.fuel, notes: c.notes,
    mileage: c.mileage == null ? "" : String(c.mileage),
    motDue: iso(c.motDue), taxDue: iso(c.taxDue), serviceDue: iso(c.serviceDue), insuranceDue: iso(c.insuranceDue),
    boughtOn: iso(c.boughtOn), soldOn: iso(c.soldOn),
    boughtPrice: c.boughtPrice == null ? "" : String(c.boughtPrice),
    soldPrice:   c.soldPrice   == null ? "" : String(c.soldPrice),
  }
}

function F({ label, v, on, type }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wider opacity-50 mb-1">{label}</span>
      {/* ⚠ A bare date input renders with the browser's own dark-on-dark styling —
          colorScheme keeps the picker legible on the black terminal background. */}
      <input type={type ?? "text"} value={v} onChange={e => on(e.target.value)} className={input}
        style={type === "date" ? { colorScheme: "dark" } : undefined} />
    </label>
  )
}
