"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  addDays, blankDay, dayLabel, fromDefaults, mondayOf, weekdayOf, weekEnding,
  type Cell, type DaySchedule, type Defaults, type ScheduleSale,
} from "@/lib/auction-schedule"

// Auction → Auctioneering Schedule. One column per sale in the week, like the old spreadsheet.
// 📌 = same person in that slot every week (weekday defaults); 🔒 = fixed for this sale only.

type Staff = { id: string; name: string; auctioneer: boolean; vectis: boolean; saleroom: boolean }
type ListField = "auctioneers" | "late" | "phones"
type Side = "saleroom" | "vectis"
type Path = { sale: string; field: ListField; name: string } | { sale: string; field: "slot"; index: number; side: Side }
type Kind = "auctioneer" | Side | "anyone"

const box   = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-orange-500"
const btn   = "min-h-11 px-3.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40"
const btnGo = "min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-colors disabled:opacity-40"
const muted = "text-gray-500 dark:text-gray-400"

const KIND_WORD: Record<Kind, string> = { auctioneer: "an auctioneer", saleroom: "a Saleroom clerk", vectis: "a Vectis clerk", anyone: "" }
const thisMonday = () => mondayOf(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()))
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const samePath = (a: Path | null, b: Path) =>
  !!a && a.sale === b.sale && a.field === b.field &&
  (a.field === "slot" && b.field === "slot" ? a.index === b.index && a.side === b.side : (a as any).name === (b as any).name)

async function api(url: string, method: string, body: any) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Failed (${r.status})`)
  return j
}

export default function ScheduleClient({ initialWeek }: { initialWeek: string }) {
  const [monday, setMonday] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(initialWeek) ? mondayOf(initialWeek) : thisMonday()))
  const [sales, setSales] = useState<ScheduleSale[]>([])
  const [days, setDays] = useState<Record<string, DaySchedule>>({})
  const [defaults, setDefaults] = useState<Defaults>({})
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [needsMigration, setNeedsMigration] = useState(false)
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved")
  const [saveError, setSaveError] = useState("")
  const [notice, setNotice] = useState("")
  const [picked, setPicked] = useState<string | null>(null)           // tap-to-place
  const [drag, setDrag] = useState<{ name: string; from?: Path } | null>(null)
  const [selected, setSelected] = useState<Path | null>(null)         // a placed name, for the action bar
  const [confirmClear, setConfirmClear] = useState(false)
  const [editStaff, setEditStaff] = useState(false)

  const daysRef = useRef(days)
  const pending = useRef(new Set<string>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Loading ──
  const load = useCallback(async (week: string) => {
    setLoading(true); setLoadError(""); setSelected(null)
    try {
      const r = await fetch(`/api/auction-schedule?week=${week}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `Failed (${r.status})`)
      const built: Record<string, DaySchedule> = {}
      for (const s of j.sales as ScheduleSale[]) built[s.id] = j.schedules[s.id] ?? fromDefaults(j.defaults[String(weekdayOf(s.date))])
      daysRef.current = built
      setSales(j.sales); setDays(built); setDefaults(j.defaults); setStaff(j.staff); setNeedsMigration(!!j.needsMigration)
    } catch (e: any) {
      setLoadError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(monday)
    try { window.history.replaceState(null, "", `?week=${monday}`) } catch {}
  }, [monday, load])

  // ── Saving: each change marks its sale; one save shortly after the last change ──
  const flush = useCallback(async () => {
    const ids = [...pending.current]
    if (!ids.length) return
    pending.current.clear()
    setSaveState("saving")
    try {
      for (const id of ids) await api("/api/auction-schedule", "PUT", { auctionId: id, data: daysRef.current[id] })
      setSaveState(pending.current.size ? "saving" : "saved"); setSaveError("")
    } catch (e: any) {
      ids.forEach(id => pending.current.add(id))
      setSaveState("error"); setSaveError(e.message)
    }
  }, [])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending.current.size) e.preventDefault() }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  function changeDay(id: string, fn: (d: DaySchedule) => void) {
    const d = clone(daysRef.current[id]); fn(d)
    daysRef.current = { ...daysRef.current, [id]: d }
    setDays(daysRef.current)
    pending.current.add(id)
    setSaveState("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 600)
  }

  async function saveDefaults(next: Defaults) {
    const before = defaults
    setDefaults(next)
    try { await api("/api/auction-schedule", "PUT", { defaults: next }) }
    catch (e: any) { setDefaults(before); setNotice(`Pin not saved: ${e.message}`) }
  }

  // ── Rules ──
  const staffByName = (name: string) => staff.find(s => s.name === name)
  function canDo(name: string, kind: Kind) {
    if (kind === "anyone") return true
    const s = staffByName(name)
    return !!s && (kind === "auctioneer" ? s.auctioneer : s[kind])
  }
  const kindOf = (p: Path): Kind => (p.field === "slot" ? p.side : p.field === "auctioneers" ? "auctioneer" : "anyone")
  const cellAt = (p: Path): Cell | null => {
    const d = days[p.sale]; if (!d) return null
    return p.field === "slot" ? d.slots[p.index]?.[p.side] ?? null : d[p.field].find(c => c.name === p.name) ?? null
  }

  function remove(p: Path, d: DaySchedule) {
    if (p.field === "slot") d.slots[p.index][p.side] = null
    else d[p.field] = d[p.field].filter(c => c.name !== p.name)
  }

  /** Put `name` in a box: a slot (replacing whoever is there) or a list (added once). */
  function place(target: Path | { sale: string; field: ListField }, name: string, from?: Path) {
    const kind: Kind = target.field === "slot" ? target.side : target.field === "auctioneers" ? "auctioneer" : "anyone"
    if (!canDo(name, kind)) { setNotice(`${name} isn't ticked as ${KIND_WORD[kind]} — tick it in the staff list first.`); return }
    if (from && cellAt(from)?.locked) { setNotice(`${name} is locked there — unlock it first.`); return }
    if (target.field === "slot" && days[target.sale]?.slots[target.index]?.[target.side]?.locked) { setNotice("That box is locked — unlock it first."); return }
    setNotice("")
    if (from && from.sale !== target.sale) changeDay(from.sale, d => remove(from, d))
    changeDay(target.sale, d => {
      if (from && from.sale === target.sale) remove(from, d)
      if (target.field === "slot") d.slots[target.index][target.side] = { name }
      else if (!d[target.field].some(c => c.name === name)) d[target.field].push({ name })
    })
    setPicked(null); setSelected(null)
  }

  // ── Pins (weekday defaults) ──
  const weekdayKey = (saleId: string) => String(weekdayOf(sales.find(s => s.id === saleId)!.date))
  function isPinned(p: Path, name: string) {
    const def = defaults[weekdayKey(p.sale)]
    if (!def) return false
    return p.field === "slot" ? def.slots[p.index]?.[p.side]?.name === name : def[p.field].some(c => c.name === name)
  }
  function togglePin(p: Path, name: string) {
    const key = weekdayKey(p.sale)
    const next = clone(defaults)
    const def = next[key] ?? blankDay()
    if (p.field === "slot") {
      while (def.slots.length <= p.index) def.slots.push({ time: days[p.sale].slots[def.slots.length]?.time ?? "", saleroom: null, vectis: null })
      def.slots[p.index].time = days[p.sale].slots[p.index].time
      def.slots[p.index][p.side] = isPinned(p, name) ? null : { name }
    } else {
      def[p.field] = isPinned(p, name) ? def[p.field].filter(c => c.name !== name) : [...def[p.field], { name }]
    }
    next[key] = def
    saveDefaults(next)
  }
  function toggleLock(p: Path) {
    changeDay(p.sale, d => {
      const c = p.field === "slot" ? d.slots[p.index][p.side] : d[p.field].find(x => x.name === p.name)
      if (c) c.locked = !c.locked || undefined
    })
  }

  // ── Whole-week buttons ──
  function fillFromPinned() {
    let filled = 0
    for (const s of sales) {
      const def = defaults[String(weekdayOf(s.date))]
      if (!def) continue
      changeDay(s.id, d => {
        d.slots.forEach((slot, i) => (["saleroom", "vectis"] as Side[]).forEach(side => {
          const want = def.slots[i]?.[side]?.name
          if (want && !slot[side]?.locked && slot[side]?.name !== want) { slot[side] = { name: want }; filled++ }
        }))
        for (const f of ["auctioneers", "late", "phones"] as ListField[])
          for (const c of def[f]) if (!d[f].some(x => x.name === c.name)) { d[f].push({ name: c.name }); filled++ }
      })
    }
    setNotice(filled ? `Filled ${filled} box${filled === 1 ? "" : "es"} from the pinned names. Locked boxes were left alone.` : "Nothing to fill — every pinned name is already in place (or nothing is pinned for these days).")
  }
  function clearUnlocked() {
    let cleared = 0
    for (const s of sales) changeDay(s.id, d => {
      d.slots.forEach(slot => (["saleroom", "vectis"] as Side[]).forEach(side => { if (slot[side] && !slot[side]!.locked) { slot[side] = null; cleared++ } }))
      for (const f of ["auctioneers", "late", "phones"] as ListField[]) { const keep = d[f].filter(c => c.locked); cleared += d[f].length - keep.length; d[f] = keep }
    })
    setConfirmClear(false)
    setNotice(cleared ? `Cleared ${cleared} name${cleared === 1 ? "" : "s"}. Locked ones were kept.` : "Nothing to clear — the week is empty or everything is locked.")
  }
  function setTime(index: number, time: string) {
    for (const s of sales) changeDay(s.id, d => { if (d.slots[index]) d.slots[index].time = time })
  }

  // ── Pieces ──
  const dropProps = (target: Path | { sale: string; field: ListField }, kind: Kind) => {
    const name = drag?.name ?? picked
    const ok = !name || canDo(name, kind)
    return {
      ok,
      onDragOver: (e: React.DragEvent) => { if (drag && ok) e.preventDefault() },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); if (drag) place(target, drag.name, drag.from); setDrag(null) },
    }
  }

  function chip(p: Path, cell: Cell) {
    const pinned = isPinned(p, cell.name)
    const sel = samePath(selected, p)
    const clash = p.field === "slot" && days[p.sale]?.slots[p.index]?.[p.side === "saleroom" ? "vectis" : "saleroom"]?.name === cell.name
    return (
      <button
        type="button"
        draggable={!cell.locked}
        onDragStart={() => setDrag({ name: cell.name, from: p })}
        onDragEnd={() => setDrag(null)}
        onClick={e => { e.stopPropagation(); if (picked) { place(p.field === "slot" ? p : { sale: p.sale, field: p.field }, picked) } else setSelected(sel ? null : p) }}
        title={clash ? "On both platforms at once" : undefined}
        className={`min-h-9 max-w-full inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-left
          ${sel ? "ring-2 ring-orange-500" : ""}
          ${clash ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"}`}
      >
        <span className="truncate">{cell.name}</span>
        {pinned && <span aria-label="pinned every week">📌</span>}
        {cell.locked && <span aria-label="locked for this sale">🔒</span>}
      </button>
    )
  }

  function slotBox(sale: string, index: number, side: Side) {
    const p: Path = { sale, field: "slot", index, side }
    const cell = days[sale]?.slots[index]?.[side] ?? null
    const { ok, ...dnd } = dropProps(p, side)
    return (
      <div
        {...dnd}
        onClick={() => picked && place(p, picked)}
        className={`min-h-11 flex items-center justify-center rounded-lg border p-1 transition-colors
          ${(drag || picked) && ok ? "border-orange-400 border-dashed bg-orange-50 dark:bg-orange-950/30 cursor-pointer" : "border-gray-200 dark:border-gray-800"}
          ${(drag || picked) && !ok ? "opacity-40" : ""}`}
      >
        {cell ? chip(p, cell) : <span className="text-xs text-gray-400 dark:text-gray-600">{side === "saleroom" ? "Saleroom" : "Vectis"}</span>}
      </div>
    )
  }

  function listBox(sale: string, field: ListField) {
    const kind: Kind = field === "auctioneers" ? "auctioneer" : "anyone"
    const { ok, ...dnd } = dropProps({ sale, field }, kind)
    const cells = days[sale]?.[field] ?? []
    return (
      <div
        {...dnd}
        onClick={() => picked && place({ sale, field }, picked)}
        className={`min-h-11 flex flex-wrap items-center gap-1 rounded-lg border p-1 transition-colors
          ${(drag || picked) && ok ? "border-orange-400 border-dashed bg-orange-50 dark:bg-orange-950/30 cursor-pointer" : "border-gray-200 dark:border-gray-800"}
          ${(drag || picked) && !ok ? "opacity-40" : ""}`}
      >
        {cells.map(c => <span key={c.name} className="contents">{chip({ sale, field, name: c.name }, c)}</span>)}
        {!cells.length && <span className="text-xs text-gray-400 dark:text-gray-600 px-1">Drop names here</span>}
      </div>
    )
  }

  const slotCount = Math.max(0, ...sales.map(s => days[s.id]?.slots.length ?? 0))
  const timeOf = (i: number) => sales.map(s => days[s.id]?.slots[i]?.time).find(Boolean) ?? ""
  const selCell = selected ? cellAt(selected) : null
  const selSale = selected ? sales.find(s => s.id === selected.sale) : null
  const rowLabel = "py-2 pr-3 text-sm font-medium text-gray-700 dark:text-gray-300 align-middle whitespace-nowrap"
  const td = "p-1.5 align-middle"

  return (
    <div onClick={() => { if (selected) setSelected(null) }}>
      {/* Week bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4" onClick={e => e.stopPropagation()}>
        <button className={btn} onClick={() => setMonday(addDays(monday, -7))}>◀ Previous week</button>
        <button className={btn} onClick={() => setMonday(thisMonday())}>This week</button>
        <button className={btn} onClick={() => setMonday(addDays(monday, 7))}>Next week ▶</button>
        <span className="ml-1 text-lg font-semibold text-gray-900 dark:text-white">W/E {weekEnding(monday)}</span>
        <div className="flex-1" />
        <button className={btn} onClick={fillFromPinned} disabled={!sales.length || loading}>📌 Fill from pinned</button>
        {confirmClear
          ? <>
              <button className="min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white" onClick={clearUnlocked}>Yes, clear unlocked names</button>
              <button className={btn} onClick={() => setConfirmClear(false)}>Cancel</button>
            </>
          : <button className={btn} onClick={() => setConfirmClear(true)} disabled={!sales.length || loading}>Clear unlocked</button>}
        {/* The exports read what is SAVED, so they wait for the last change to reach the Hub. */}
        {(["pdf", "xlsx"] as const).map(kind => saveState === "saved"
          ? <a key={kind} className={btnGo + " inline-flex items-center"} href={`/api/auction-schedule/${kind}?week=${monday}`} target={kind === "pdf" ? "_blank" : undefined} rel="noopener noreferrer">{kind === "pdf" ? "🖨 PDF" : "📊 Excel"}</a>
          : <button key={kind} className={btnGo} disabled title="Waiting for the last change to save">{kind === "pdf" ? "🖨 PDF" : "📊 Excel"}</button>)}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-xs">
        <span className={muted}><b>Key:</b></span>
        <span className={muted}>📌 Pinned — the same person in that box every week</span>
        <span className={muted}>🔒 Locked — fixed for this sale; Fill and Clear leave it alone</span>
        <span className="text-amber-700 dark:text-amber-300">Amber name — on Saleroom and Vectis at the same time</span>
        <span className={`ml-auto ${saveState === "error" ? "text-red-600 dark:text-red-400 font-semibold" : muted}`}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? `Not saved: ${saveError}` : "All changes saved"}
          {saveState === "error" && <button className="ml-2 underline" onClick={() => flush()}>Try again</button>}
        </span>
      </div>

      {needsMigration && <div className="mb-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">A database update is waiting — the schedule can&apos;t be saved until Run Migrations is pressed on the Admin page.</div>}
      {notice && <div className="mb-3 rounded-lg border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 px-4 py-2.5 text-sm text-orange-900 dark:text-orange-200 flex items-start gap-3">
        <span className="flex-1">{notice}</span><button className="underline" onClick={() => setNotice("")}>OK</button>
      </div>}
      {picked && <div className="mb-3 rounded-lg bg-orange-600 text-white px-4 py-2.5 text-sm flex items-center gap-3" onClick={e => e.stopPropagation()}>
        <span className="flex-1">Tap a box to put <b>{picked}</b> in it.</span><button className="underline" onClick={() => setPicked(null)}>Cancel</button>
      </div>}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Grid */}
        <div className={`${box} flex-1 min-w-0 overflow-x-auto p-3`}>
          {loading ? <p className={`p-6 ${muted}`}>Loading the week…</p>
            : loadError ? <p className="p-6 text-red-600 dark:text-red-400">Couldn&apos;t load the week: {loadError} <button className="underline" onClick={() => load(monday)}>Try again</button></p>
            : !sales.length ? <p className={`p-6 ${muted}`}>No sales are dated in this week. Sales and lot counts come from the website data collected at Databases → BC Database (Update the BC lots) — a sale shows here once it has been collected, upcoming ones included.</p>
            : (
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="w-36" />
                    {sales.map(s => (
                      <th key={s.id} className="p-1.5 text-left align-bottom min-w-56">
                        <div className="text-base font-bold text-gray-900 dark:text-white">{dayLabel(s.date)}</div>
                        <div className={`text-xs font-normal ${muted}`}>{s.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody onClick={e => e.stopPropagation()}>
                  <tr><td className={rowLabel}>Sale No.</td>{sales.map(s => <td key={s.id} className={`${td} text-sm font-semibold text-gray-900 dark:text-white`}>{s.code}</td>)}</tr>
                  <tr><td className={rowLabel}>No. of Lots</td>{sales.map(s => <td key={s.id} className={`${td} text-sm text-gray-900 dark:text-white`}>{s.lots}</td>)}</tr>
                  <tr>
                    <td className={rowLabel}>Start Time</td>
                    {sales.map(s => <td key={s.id} className={td}>
                      <input className={`${input} w-28`} value={days[s.id]?.startTime ?? ""} onChange={e => changeDay(s.id, d => { d.startTime = e.target.value })} />
                    </td>)}
                  </tr>
                  <tr><td className={rowLabel}>Auctioneers</td>{sales.map(s => <td key={s.id} className={td}>{listBox(s.id, "auctioneers")}</td>)}</tr>
                  <tr>
                    <td className={rowLabel}>Clicking:</td>
                    {sales.map(s => <td key={s.id} className={`${td} text-xs uppercase tracking-wider ${muted}`}><div className="grid grid-cols-2 gap-1.5"><span>Saleroom</span><span>Vectis</span></div></td>)}
                  </tr>
                  {Array.from({ length: slotCount }, (_, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3">
                        <input aria-label="Time" className={`${input} w-32 font-medium`} value={timeOf(i)} onChange={e => setTime(i, e.target.value)} />
                      </td>
                      {sales.map(s => <td key={s.id} className={td}>
                        {days[s.id]?.slots[i] ? <div className="grid grid-cols-2 gap-1.5">{slotBox(s.id, i, "saleroom")}{slotBox(s.id, i, "vectis")}</div> : null}
                      </td>)}
                    </tr>
                  ))}
                  <tr><td className={rowLabel}>Late (if required)</td>{sales.map(s => <td key={s.id} className={td}>{listBox(s.id, "late")}</td>)}</tr>
                  <tr><td className={rowLabel}>Telephone Bids</td>{sales.map(s => <td key={s.id} className={td}>{listBox(s.id, "phones")}</td>)}</tr>
                </tbody>
              </table>
            )}
        </div>

        {/* Staff */}
        <aside className={`${box} w-full lg:w-72 shrink-0 p-3 lg:sticky lg:top-4`} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-900 dark:text-white">Staff</h2>
            <button className="text-sm underline text-orange-700 dark:text-orange-400 min-h-11 px-2" onClick={() => setEditStaff(v => !v)}>{editStaff ? "Done" : "Edit list"}</button>
          </div>
          {editStaff
            ? <StaffEditor staff={staff} setStaff={setStaff} />
            : <StaffList staff={staff} picked={picked} setPicked={setPicked} setDrag={setDrag} />}
        </aside>
      </div>

      {/* Action bar for a placed name */}
      {selected && selCell && selSale && (
        <div className="fixed bottom-4 inset-x-4 z-40 mx-auto max-w-3xl rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 flex flex-wrap items-center gap-2" onClick={e => e.stopPropagation()}>
          <span className="flex-1 min-w-48 text-sm text-gray-900 dark:text-white">
            <b>{selCell.name}</b> · {dayLabel(selSale.date)} {selected.field === "slot" ? `${days[selected.sale].slots[selected.index].time} · ${selected.side === "saleroom" ? "Saleroom" : "Vectis"}` : selected.field === "auctioneers" ? "· Auctioneer" : selected.field === "late" ? "· Late" : "· Telephone bids"}
          </span>
          <button className={btn} onClick={() => togglePin(selected, selCell.name)}>
            {isPinned(selected, selCell.name) ? "📌 Unpin" : `📌 Pin every ${dayLabel(selSale.date).split(" ")[0]}`}
          </button>
          <button className={btn} onClick={() => toggleLock(selected)}>{selCell.locked ? "🔓 Unlock" : "🔒 Lock for this sale"}</button>
          <button className={btn} disabled={!!selCell.locked} onClick={() => { changeDay(selected.sale, d => remove(selected, d)); setSelected(null) }}>✕ Remove</button>
          <button className={btn} onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
    </div>
  )
}

function Badges({ s }: { s: Staff }) {
  const b = "text-[10px] font-bold rounded px-1.5 py-0.5"
  return <span className="flex gap-1 shrink-0">
    {s.auctioneer && <span className={`${b} bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200`} title="Auctioneer">A</span>}
    {s.saleroom && <span className={`${b} bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200`} title="Clerks on the Saleroom">S</span>}
    {s.vectis && <span className={`${b} bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200`} title="Clerks on Vectis">V</span>}
  </span>
}

function StaffList({ staff, picked, setPicked, setDrag }: {
  staff: Staff[]; picked: string | null; setPicked: (n: string | null) => void; setDrag: (d: { name: string } | null) => void
}) {
  if (!staff.length) return <p className={`text-sm ${muted}`}>Nobody yet — press <b>Edit list</b> to add the auctioneers and clerks.</p>
  const groups: [string, Staff[]][] = [
    ["Auctioneers", staff.filter(s => s.auctioneer)],
    ["Clerks", staff.filter(s => !s.auctioneer && (s.saleroom || s.vectis))],
    ["Everyone else (late cover, telephones)", staff.filter(s => !s.auctioneer && !s.saleroom && !s.vectis)],
  ]
  return (
    <div className="space-y-3">
      <p className={`text-xs ${muted}`}>A = auctioneer · S = Saleroom clerk · V = Vectis clerk. Anyone can go on Late or Telephone Bids.</p>
      {groups.filter(([, list]) => list.length).map(([title, list]) => (
        <div key={title}>
          <div className={`text-[11px] uppercase tracking-wider mb-1 ${muted}`}>{title}</div>
          <div className="space-y-1">
            {list.map(s => (
              <button
                key={s.id}
                type="button"
                draggable
                onDragStart={() => setDrag({ name: s.name })}
                onDragEnd={() => setDrag(null)}
                onClick={() => setPicked(picked === s.name ? null : s.name)}
                className={`w-full min-h-11 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm text-left cursor-grab
                  ${picked === s.name ? "border-orange-500 bg-orange-50 dark:bg-orange-950/40 text-orange-900 dark:text-orange-100" : "border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
              >
                <span className="truncate">{s.name}</span><Badges s={s} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StaffEditor({ staff, setStaff }: { staff: Staff[]; setStaff: (s: Staff[]) => void }) {
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const sort = (l: Staff[]) => [...l].sort((a, b) => a.name.localeCompare(b.name))

  async function add() {
    if (!name.trim() || busy) return
    setBusy(true); setError("")
    try { const j = await api("/api/auction-schedule/staff", "POST", { name }); setStaff(sort([...staff, j.staff])); setName("") }
    catch (e: any) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function patch(s: Staff, change: Partial<Staff>) {
    setError("")
    try { const j = await api("/api/auction-schedule/staff", "PUT", { id: s.id, ...change }); setStaff(sort(staff.map(x => (x.id === s.id ? j.staff : x)))) }
    catch (e: any) { setError(e.message) }
  }
  async function del(s: Staff) {
    setError("")
    try { await api("/api/auction-schedule/staff", "DELETE", { id: s.id }); setStaff(staff.filter(x => x.id !== s.id)); setConfirmDel(null) }
    catch (e: any) { setError(e.message) }
  }
  const tick = "w-5 h-5 accent-orange-600"

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input className={`${input} flex-1 min-w-0`} placeholder="Name, e.g. Jake K" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <button className={btnGo} onClick={add} disabled={!name.trim() || busy}>Add</button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <p className={`text-xs ${muted}`}>Tick what each person can do. Removing someone leaves past weeks as they were.</p>
      <div className="space-y-2">
        {staff.map(s => (
          <div key={s.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-2">
            <input className={`${input} w-full mb-1.5`} defaultValue={s.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== s.name && patch(s, { name: e.target.value.trim() })} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-800 dark:text-gray-200">
              <label className="flex items-center gap-1.5 min-h-9"><input type="checkbox" className={tick} checked={s.auctioneer} onChange={e => patch(s, { auctioneer: e.target.checked })} />Auctioneer</label>
              <label className="flex items-center gap-1.5 min-h-9"><input type="checkbox" className={tick} checked={s.saleroom} onChange={e => patch(s, { saleroom: e.target.checked })} />Saleroom</label>
              <label className="flex items-center gap-1.5 min-h-9"><input type="checkbox" className={tick} checked={s.vectis} onChange={e => patch(s, { vectis: e.target.checked })} />Vectis</label>
              {confirmDel === s.id
                ? <span className="ml-auto flex gap-2"><button className="text-red-600 dark:text-red-400 font-semibold underline min-h-9" onClick={() => del(s)}>Remove</button><button className="underline min-h-9" onClick={() => setConfirmDel(null)}>Keep</button></span>
                : <button className="ml-auto text-red-600 dark:text-red-400 underline min-h-9" onClick={() => setConfirmDel(s.id)}>Remove</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
