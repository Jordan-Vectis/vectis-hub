"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// JORDAN.SYS → GARAGE. Private to /jordan. A handful of cars, what is due when,
// and the history of everything done to them. Past cars keep their records.

const box   = "border border-[#1f5c33] rounded-lg bg-[#040f08]"
const input = "w-full bg-black border border-[#1f5c33] rounded px-2.5 py-1.5 text-sm text-[#33ff66] placeholder:text-[#1f5c33] focus:outline-none focus:border-[#33ff66]"
const btn   = "px-3 py-1.5 text-xs border border-[#1f5c33] rounded hover:bg-[#0a2214] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "px-4 py-2 text-sm font-bold rounded bg-[#33ff66] text-black hover:bg-[#5cff88] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"

const KINDS = ["MOT", "SERVICE", "REPAIR", "TAX", "INSURANCE", "OTHER"] as const
const KIND_LABEL: Record<string, string> = {
  MOT: "MOT", SERVICE: "Service", REPAIR: "Repair", TAX: "Tax", INSURANCE: "Insurance", OTHER: "Other",
}

type Rec = {
  id: string; kind: string; date: string; mileage: number | null; costPence: number | null
  garage: string; result: string; notes: string; fileKeys: string[]
}
type Car = {
  id: string; nickname: string; reg: string; make: string; model: string; colour: string
  year: string; fuel: string; notes: string; photoKey: string; mileage: number | null
  motDue: string | null; taxDue: string | null; serviceDue: string | null; insuranceDue: string | null
  isPast: boolean; boughtOn: string | null; soldOn: string | null
  boughtPrice: number | null; soldPrice: number | null
  records: Rec[]
}

const fileUrl = (key: string) => `/api/jordan/cars/file?key=${encodeURIComponent(key)}`
const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "")
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`)
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
  return { colour: "#33ff66", label: `in ${n} days` }
}

export default function GarageClient() {
  const [cars, setCars]       = useState<Car[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
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
      setCars(j.cars ?? [])
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
      {error && <div className="border border-red-700 bg-red-950/40 text-red-300 rounded-lg px-4 py-2.5 text-xs">{error}</div>}

      {/* ── What's due ── */}
      {current.length > 0 && <DueStrip cars={current} onOpen={setOpenId} />}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tracking-widest opacity-60">CURRENT CARS ({current.length})</span>
        <button className={btn} onClick={() => addCar(false)}>+ ADD A CAR</button>
      </div>

      {loading ? <p className="text-xs opacity-60">LOADING…</p> : current.length === 0 ? (
        <p className="text-xs opacity-50">Nothing here yet — add a car and fill in when its MOT, tax and service are due.</p>
      ) : current.map(car => (
        <CarCard key={car.id} car={car} open={openId === car.id} busy={busy} setBusy={setBusy}
          onToggle={() => setOpenId(openId === car.id ? null : car.id)}
          onChanged={() => load(car.id)} onError={setError} />
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
              onChanged={() => load(car.id)} onError={setError} />
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
              className="px-3 py-1.5 text-xs rounded border hover:bg-[#0a2214] transition-colors"
              style={{ borderColor: t.colour, color: t.colour }}>
              {i.car.nickname || i.car.reg || "Car"} · {i.what} <span className="opacity-70">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CarCard({ car, open, onToggle, onChanged, onError, busy, setBusy }: {
  car: Car; open: boolean; onToggle: () => void; onChanged: () => void
  onError: (m: string) => void; busy: string | null; setBusy: (b: string | null) => void
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

  return (
    <div className={box}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#0a2214] transition-colors">
        {car.photoKey
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={fileUrl(car.photoKey)} alt="" className="w-16 h-12 object-cover rounded border border-[#1f5c33]" />
          : <span className="w-16 h-12 rounded border border-[#123d22] grid place-items-center text-[10px] opacity-40">no photo</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          {sub && <span className="block text-xs opacity-50">{sub}</span>}
        </span>
        {!car.isPast && (
          <span className="hidden sm:flex gap-3 text-[11px]">
            {(["MOT", "Tax", "Service"] as const).map(w => {
              const d = w === "MOT" ? car.motDue : w === "Tax" ? car.taxDue : car.serviceDue
              const t = dueTone(d)
              return <span key={w} style={{ color: t.colour }}>{w} {shortDate(d)}</span>
            })}
          </span>
        )}
        {car.isPast && <span className="text-[11px] opacity-50">sold {shortDate(car.soldOn)}</span>}
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
    <div className="border-t border-[#123d22] pt-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[11px] uppercase tracking-wider opacity-50">
          History ({car.records.length}){total > 0 && <span className="ml-2 opacity-70">spent {money(total)}</span>}
        </span>
        <button className={btn} onClick={() => setAdding(a => !a)}>{adding ? "CANCEL" : "+ ADD RECORD"}</button>
      </div>

      {adding && (
        <div className="border border-[#123d22] rounded p-3 space-y-2 mb-3">
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
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs border border-[#123d22] rounded px-3 py-2">
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
