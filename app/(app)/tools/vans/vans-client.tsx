"use client"

import { useCallback, useEffect, useRef, useState } from "react"

// Facilities → Vans. Three collection vans: who has each one out, what's due, and the
// history of everything done to them. Built from the /jordan garage with the personal
// parts left out and a sign-out / sign-in added.

const box   = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-amber-500"
const btn   = "min-h-11 px-3.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const label = "block text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1"
const muted = "text-gray-500 dark:text-gray-400"

const KINDS = ["MOT", "SERVICE", "REPAIR", "TAX", "INSURANCE", "OTHER"] as const
const KIND_LABEL: Record<string, string> = { MOT: "MOT", SERVICE: "Service", REPAIR: "Repair", TAX: "Tax", INSURANCE: "Insurance", OTHER: "Other" }

type Rec  = { id: string; kind: string; date: string; mileage: number | null; costPence: number | null; garage: string; result: string; notes: string; fileKeys: string[]; createdByName: string }
type Trip = { id: string; driverName: string; purpose: string; outAt: string; outMileage: number | null; inAt: string | null; inMileage: number | null; notes: string; createdByName: string }
type Van  = {
  id: string; name: string; reg: string; make: string; model: string; colour: string; year: string; fuel: string
  notes: string; photoKey: string; mileage: number | null
  motDue: string | null; taxDue: string | null; serviceDue: string | null; insuranceDue: string | null
  active: boolean; records: Rec[]; trips: Trip[]
}

const fileUrl = (key: string) => `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`
const iso = (d: string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "")
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`)
const shortDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"
const when = (d: string) => {
  const x = new Date(d), today = new Date()
  const sameDay = x.toDateString() === today.toDateString()
  const t = x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return sameDay ? `${t} today` : `${t}, ${x.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
}
const miles = (n: number | null) => (n == null ? "" : `${n.toLocaleString("en-GB")} mi`)

function daysTo(d: string | null): number | null {
  if (!d) return null
  const then = new Date(d); then.setHours(12, 0, 0, 0)
  const now = new Date();  now.setHours(12, 0, 0, 0)
  return Math.round((then.getTime() - now.getTime()) / 86_400_000)
}

/** "Not recorded" must never look like "due today" — a missing date gets its own grey state.
 *  Every colour carries its words, so no key is needed. */
function dueTone(d: string | null): { cls: string; label: string } {
  const n = daysTo(d)
  if (n === null) return { cls: "text-gray-400 dark:text-gray-500", label: "not recorded" }
  if (n < 0)      return { cls: "text-red-600 dark:text-red-400 font-semibold", label: `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue` }
  if (n === 0)    return { cls: "text-red-600 dark:text-red-400 font-semibold", label: "due today" }
  if (n <= 30)    return { cls: "text-amber-600 dark:text-amber-400 font-semibold", label: `in ${n} day${n === 1 ? "" : "s"}` }
  return { cls: "text-green-700 dark:text-green-400", label: `in ${n} days` }
}

const outTrip = (v: Van) => v.trips.find(t => !t.inAt) ?? null

async function api(url: string, body: any, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? "Something went wrong")
  return j
}

export default function VansClient({ me }: { me: string }) {
  const [vans, setVans]       = useState<Van[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [openId, setOpenId]   = useState<string | null>(null)
  const [showRetired, setShowRetired] = useState(false)

  const load = useCallback(async (keepOpen?: string) => {
    try {
      const r = await fetch("/api/vans")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load the vans")
      setNeedsMigration(!!j.needsMigration)
      setVans(j.vans ?? [])
      if (keepOpen !== undefined) setOpenId(keepOpen || null)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function addVan() {
    const name = prompt("What is the van called? (e.g. Van 1, the white Transit)")?.trim()
    if (!name) return
    setError(null)
    try { const j = await api("/api/vans", { name }); await load(j.id) }
    catch (e: any) { setError(e.message) }
  }

  const active  = vans.filter(v => v.active)
  const retired = vans.filter(v => !v.active)

  return (
    <div className="space-y-5 pb-16">
      {needsMigration && (
        <div className="rounded-lg border border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
          A database update is waiting — the vans tables aren&apos;t there yet. An admin presses <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-400 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button className="text-xs underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {active.length > 0 && <WhoHasWhat vans={active} me={me} onChanged={load} onError={setError} onOpen={setOpenId} />}
      {active.length > 0 && <DueStrip vans={active} onOpen={setOpenId} />}

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs tracking-widest font-semibold text-gray-500 dark:text-gray-400">VANS ({active.length})</h2>
        <button className={btn} onClick={addVan}>+ Add a van</button>
      </div>

      {loading ? <p className={`text-sm ${muted}`}>Loading…</p> : active.length === 0 ? (
        <p className={`text-sm ${muted}`}>No vans yet — add one and fill in when its MOT, tax and service are due.</p>
      ) : active.map(v => (
        <VanCard key={v.id} van={v} me={me} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onChanged={() => load(v.id)} onError={setError} />
      ))}

      {retired.length > 0 && (
        <>
          <button className="text-xs tracking-widest font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 pt-4" onClick={() => setShowRetired(s => !s)}>
            {showRetired ? "▼" : "▶"} RETIRED / SOLD ({retired.length})
          </button>
          {showRetired && retired.map(v => (
            <VanCard key={v.id} van={v} me={me} open={openId === v.id} onToggle={() => setOpenId(openId === v.id ? null : v.id)} onChanged={() => load(v.id)} onError={setError} />
          ))}
        </>
      )}
    </div>
  )
}

/** The question people actually walk up with: which van is free? One row per van, with the
 *  sign-out / sign-in button right there so nobody has to open a card for it. */
function WhoHasWhat({ vans, me, onChanged, onError, onOpen }: { vans: Van[]; me: string; onChanged: () => void; onError: (m: string) => void; onOpen: (id: string) => void }) {
  const [signing, setSigning] = useState<{ vanId: string; mode: "out" | "in" } | null>(null)
  return (
    <div className={`${box} p-4`}>
      <h2 className="text-xs tracking-widest font-semibold text-gray-500 dark:text-gray-400 mb-3">WHO HAS WHAT</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {vans.map(v => {
          const t = outTrip(v)
          return (
            <div key={v.id} className={`rounded-lg border px-3 py-2.5 ${t ? "border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20" : "border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/20"}`}>
              <div className="flex items-center gap-2">
                <button className="font-semibold text-gray-900 dark:text-white hover:underline text-left" onClick={() => onOpen(v.id)}>{v.name}{v.reg ? <span className={`font-normal ${muted}`}> · {v.reg}</span> : null}</button>
                <span className={`ml-auto text-xs ${t ? "text-amber-700 dark:text-amber-300" : "text-green-700 dark:text-green-300"}`}>{t ? "OUT" : "IN"}</span>
              </div>
              <div className="text-xs mt-0.5 text-gray-700 dark:text-gray-300">
                {t ? <>With <b>{t.driverName}</b> since {when(t.outAt)}{t.purpose ? ` · ${t.purpose}` : ""}</> : "Available"}
              </div>
              <div className="mt-2">
                <button className={`${btn} w-full`} onClick={() => setSigning({ vanId: v.id, mode: t ? "in" : "out" })}>{t ? "Sign it back in" : "Sign it out"}</button>
              </div>
            </div>
          )
        })}
      </div>
      {signing && (
        <SignForm van={vans.find(v => v.id === signing.vanId)!} mode={signing.mode} me={me}
          onDone={() => { setSigning(null); onChanged() }} onCancel={() => setSigning(null)} onError={onError} />
      )}
    </div>
  )
}

function SignForm({ van, mode, me, onDone, onCancel, onError }: { van: Van; mode: "out" | "in"; me: string; onDone: () => void; onCancel: () => void; onError: (m: string) => void }) {
  const t = outTrip(van)
  const [driver, setDriver]   = useState(me)
  const [purpose, setPurpose] = useState("")
  const [mileage, setMileage] = useState("")
  const [notes, setNotes]     = useState("")
  const [busy, setBusy]       = useState(false)
  const busyRef = useRef(false)

  async function go() {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true)
    try {
      if (mode === "out") await api("/api/vans/trips", { vanId: van.id, driverName: driver, purpose, outMileage: mileage })
      else if (t)         await api("/api/vans/trips", { id: t.id, signIn: true, inMileage: mileage, notes }, "PUT")
      onDone()
    } catch (e: any) { onError(e.message) }
    finally { busyRef.current = false; setBusy(false) }
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-300 dark:border-gray-700 p-3 space-y-2">
      <div className="text-sm font-semibold text-gray-900 dark:text-white">{mode === "out" ? `Sign out ${van.name}` : `Sign in ${van.name}`}{t && mode === "in" ? <span className={`font-normal ${muted}`}> — out with {t.driverName} since {when(t.outAt)}{t.outMileage != null ? `, ${miles(t.outMileage)}` : ""}</span> : null}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {mode === "out" && <F label="Who's taking it" v={driver} on={setDriver} />}
        {mode === "out" && <F label="What for" v={purpose} on={setPurpose} placeholder="e.g. Collection — Leeds" />}
        <F label={mode === "out" ? "Mileage out" : "Mileage back"} v={mileage} on={setMileage} placeholder={van.mileage != null ? `last known ${van.mileage.toLocaleString("en-GB")}` : "on the dash"} />
        {mode === "in" && <F label="Anything to note" v={notes} on={setNotes} placeholder="fuel left, a scrape, a warning light" />}
      </div>
      <div className="flex gap-2">
        <button className={btnGo} onClick={go} disabled={busy || (mode === "out" && !driver.trim())}>{busy ? "Saving…" : mode === "out" ? "Sign out" : "Sign in"}</button>
        <button className={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function DueStrip({ vans, onOpen }: { vans: Van[]; onOpen: (id: string) => void }) {
  const items = vans.flatMap(v => ([
    { van: v, what: "MOT", when: v.motDue }, { van: v, what: "Tax", when: v.taxDue },
    { van: v, what: "Service", when: v.serviceDue }, { van: v, what: "Insurance", when: v.insuranceDue },
  ]))
    .filter(i => i.when).map(i => ({ ...i, days: daysTo(i.when)! })).filter(i => i.days <= 60).sort((a, b) => a.days - b.days)
  if (!items.length) return null
  return (
    <div className={`${box} p-4`}>
      <h2 className="text-xs tracking-widest font-semibold text-gray-500 dark:text-gray-400 mb-2">DUE SOON</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((i, n) => {
          const t = dueTone(i.when)
          return (
            <button key={n} onClick={() => onOpen(i.van.id)} className={`min-h-11 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 ${t.cls}`}>
              {i.van.name} · {i.what} <span className="opacity-80">{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function VanCard({ van, me, open, onToggle, onChanged, onError }: { van: Van; me: string; open: boolean; onToggle: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState(() => toForm(van))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setForm(toForm(van)); setDirty(false) }, [van])
  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); setDirty(true) }

  async function save() {
    setBusy("save")
    try { await api("/api/vans", { id: van.id, ...form }, "PUT"); onChanged() }
    catch (e: any) { onError(e.message) } finally { setBusy(null) }
  }
  async function uploadPhoto(file: File) {
    setBusy("photo")
    try {
      const fd = new FormData(); fd.append("file", file)
      const r = await fetch("/api/vans/file", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Upload failed")
      const old = van.photoKey
      await api("/api/vans", { id: van.id, photoKey: j.key }, "PUT")
      if (old) await fetch("/api/vans/file", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: old }) }).catch(() => {})
      onChanged()
    } catch (e: any) { onError(e.message) }
    finally { setBusy(null); if (photoRef.current) photoRef.current.value = "" }
  }
  async function setActive(active: boolean) {
    try { await api("/api/vans", { id: van.id, active }, "PUT"); onChanged() } catch (e: any) { onError(e.message) }
  }
  async function remove() {
    if (!confirm(`Delete "${van.name}" with all ${van.records.length} records and its sign-out history? This also removes its files. Retiring it keeps the history.`)) return
    try { await api("/api/vans", { id: van.id }, "DELETE"); onChanged() } catch (e: any) { onError(e.message) }
  }

  const t = outTrip(van)
  const sub = [van.year, van.make, van.model, van.colour].filter(Boolean).join(" ")
  return (
    <div className={box}>
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-xl transition-colors">
        {van.photoKey
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={fileUrl(van.photoKey)} alt="" className="w-16 h-12 object-cover rounded-md border border-gray-200 dark:border-gray-700" />
          : <span className={`w-16 h-12 rounded-md border border-dashed border-gray-300 dark:border-gray-700 grid place-items-center text-[10px] ${muted}`}>no photo</span>}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-gray-900 dark:text-white">{van.name}{van.reg ? <span className={`font-normal ${muted}`}> · {van.reg}</span> : null}</span>
          <span className={`block text-xs ${muted}`}>{sub || "no details yet"}{van.mileage != null ? ` · ${miles(van.mileage)}` : ""}</span>
        </span>
        {van.active && <span className={`text-xs px-2 py-1 rounded ${t ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300" : "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300"}`}>{t ? `Out · ${t.driverName}` : "In"}</span>}
        {van.active && (
          <span className="hidden md:flex gap-3 text-xs">
            {(["MOT", "Tax", "Service"] as const).map(w => {
              const d = w === "MOT" ? van.motDue : w === "Tax" ? van.taxDue : van.serviceDue
              const tone = dueTone(d)
              return <span key={w} className={tone.cls}>{w} {shortDate(d)}</span>
            })}
          </span>
        )}
        {!van.active && <span className={`text-xs ${muted}`}>retired</span>}
        <span className={`text-xs ${muted}`}>{open ? "▼" : "▶"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <button className={btn} onClick={() => photoRef.current?.click()} disabled={busy === "photo"}>{busy === "photo" ? "Uploading…" : van.photoKey ? "Change photo" : "⬆ Add photo"}</button>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f) }} />
            {van.active ? <button className={btn} onClick={() => setActive(false)}>Retire / sold</button> : <button className={btn} onClick={() => setActive(true)}>Back in service</button>}
            <button className={`${btn} ml-auto hover:border-red-500 hover:text-red-500`} onClick={remove}>Delete van</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            <F label="Name"    v={form.name}    on={v => set("name", v)} />
            <F label="Reg"     v={form.reg}     on={v => set("reg", v.toUpperCase())} />
            <F label="Make"    v={form.make}    on={v => set("make", v)} />
            <F label="Model"   v={form.model}   on={v => set("model", v)} />
            <F label="Colour"  v={form.colour}  on={v => set("colour", v)} />
            <F label="Year"    v={form.year}    on={v => set("year", v)} />
            <F label="Fuel"    v={form.fuel}    on={v => set("fuel", v)} />
            <F label="Mileage" v={form.mileage} on={v => set("mileage", v)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <F label="MOT due"       v={form.motDue}       on={v => set("motDue", v)} type="date" />
            <F label="Tax due"       v={form.taxDue}       on={v => set("taxDue", v)} type="date" />
            <F label="Service due"   v={form.serviceDue}   on={v => set("serviceDue", v)} type="date" />
            <F label="Insurance due" v={form.insuranceDue} on={v => set("insuranceDue", v)} type="date" />
          </div>
          <label className="block">
            <span className={label}>Notes</span>
            <textarea value={form.notes} rows={2} onChange={e => set("notes", e.target.value)} className={`${input} resize-y`} placeholder="Where the keys live, the fuel card, anything the next driver should know" />
          </label>
          <div className="flex items-center gap-3">
            <button className={btnGo} onClick={save} disabled={!dirty || busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</button>
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">unsaved changes</span>}
          </div>

          <History van={van} onChanged={onChanged} onError={onError} />
          <Trips van={van} onChanged={onChanged} onError={onError} />
        </div>
      )}
    </div>
  )
}

/** What the van has cost over its recorded life, as averages — from the first record to today,
 *  never under one month, so one invoice in week one doesn't read as thousands a month. */
function RunningCosts({ van }: { van: Van }) {
  const dated = van.records.filter(r => r.costPence != null)
  const total = dated.reduce((s, r) => s + (r.costPence ?? 0), 0)
  if (!total || !van.records.length) return null
  const first = van.records.reduce((m, r) => (r.date < m ? r.date : m), van.records[0].date)
  const months = Math.max(1, (Date.now() - new Date(first).getTime()) / (365.25 / 12 * 86_400_000))
  const byKind = KINDS.map(k => ({ kind: k, pence: dated.filter(r => r.kind === k).reduce((s, r) => s + (r.costPence ?? 0), 0) })).filter(k => k.pence > 0).sort((a, b) => b.pence - a.pence)
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 mb-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={label.replace("mb-1", "")}>Running costs</span>
        <span><b>{money(Math.round(total / months))}</b> <span className={muted}>a month</span></span>
        <span><b>{money(Math.round(total / months * 12))}</b> <span className={muted}>a year</span></span>
        <span className={`text-xs ${muted}`}>{money(total)} since {shortDate(first)}</span>
      </div>
      <div className="mt-2 space-y-1">
        {byKind.map(k => (
          <div key={k.kind} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-gray-700 dark:text-gray-300">{KIND_LABEL[k.kind]}</span>
            <span className="flex-1 h-2 rounded-sm bg-gray-100 dark:bg-gray-800 overflow-hidden"><span className="block h-full bg-amber-500" style={{ width: `${Math.max(2, (k.pence / total) * 100)}%` }} /></span>
            <span className="w-20 text-right text-gray-900 dark:text-white">{money(k.pence)}</span>
            <span className={`w-10 text-right ${muted}`}>{Math.round((k.pence / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function History({ van, onChanged, onError }: { van: Van; onChanged: () => void; onError: (m: string) => void }) {
  const blank = { kind: "SERVICE", date: new Date().toISOString().slice(0, 10), mileage: "", cost: "", garage: "", result: "", notes: "", fileKeys: [] as string[] }
  const [adding, setAdding] = useState(false)
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const total = van.records.reduce((s, r) => s + (r.costPence ?? 0), 0)

  async function attach(file: File) {
    setBusy(true)
    try {
      const fd = new FormData(); fd.append("file", file)
      const r = await fetch("/api/vans/file", { method: "POST", body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Upload failed")
      setF(x => ({ ...x, fileKeys: [...x.fileKeys, j.key] }))
    } catch (e: any) { onError(e.message) }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }
  async function add() {
    setBusy(true)
    try { await api("/api/vans/records", { vanId: van.id, ...f }); setF(blank); setAdding(false); onChanged() }
    catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }
  async function remove(id: string) {
    if (!confirm("Delete this record and any files on it?")) return
    try { await api("/api/vans/records", { id }, "DELETE"); onChanged() } catch (e: any) { onError(e.message) }
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className={label.replace("mb-1", "")}>History ({van.records.length}){total > 0 && <span className="ml-2 normal-case tracking-normal">spent {money(total)}</span>}</span>
        <button className={btn} onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "+ Add record"}</button>
      </div>
      <RunningCosts van={van} />
      {adding && (
        <div className="rounded-lg border border-gray-300 dark:border-gray-700 p-3 space-y-2 mb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <label className="block">
              <span className={label}>Type</span>
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
                <span className={label}>Result</span>
                <select value={f.result} onChange={e => setF({ ...f, result: e.target.value })} className={input}>
                  <option value="">—</option><option value="PASS">Pass</option><option value="FAIL">Fail</option>
                </select>
              </label>
            )}
          </div>
          <label className="block">
            <span className={label}>Notes / advisories</span>
            <textarea value={f.notes} rows={2} onChange={e => setF({ ...f, notes: e.target.value })} className={`${input} resize-y`} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => fileRef.current?.click()} disabled={busy}>⬆ Attach invoice / certificate</button>
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void attach(file) }} />
            {f.fileKeys.map((k, i) => <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer" className="text-xs underline">file {i + 1}</a>)}
            <button className={`${btnGo} ml-auto`} onClick={add} disabled={busy || !f.date}>{busy ? "Saving…" : "Save record"}</button>
          </div>
        </div>
      )}
      {van.records.length === 0 ? <p className={`text-sm ${muted}`}>Nothing recorded yet.</p> : (
        <div className="space-y-1.5">
          {van.records.map(r => (
            <div key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
              <span className={`font-semibold ${r.result === "FAIL" ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>{KIND_LABEL[r.kind] ?? r.kind}{r.result ? ` · ${r.result === "PASS" ? "Pass" : "Fail"}` : ""}</span>
              <span className="text-gray-700 dark:text-gray-300">{shortDate(r.date)}</span>
              {r.mileage != null && <span className={muted}>{miles(r.mileage)}</span>}
              {r.costPence != null && <span className={muted}>{money(r.costPence)}</span>}
              {r.garage && <span className={muted}>{r.garage}</span>}
              {r.notes && <span className="basis-full text-gray-700 dark:text-gray-300">{r.notes}</span>}
              {r.fileKeys.map((k, i) => <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer" className="underline text-xs">file {i + 1}</a>)}
              <span className={`text-xs ${muted}`}>by {r.createdByName}</span>
              <button className={`ml-auto ${muted} hover:text-red-500`} onClick={() => remove(r.id)} aria-label="Delete record">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Trips({ van, onChanged, onError }: { van: Van; onChanged: () => void; onError: (m: string) => void }) {
  async function remove(id: string) {
    if (!confirm("Remove this sign-out from the history?")) return
    try { await api("/api/vans/trips", { id }, "DELETE"); onChanged() } catch (e: any) { onError(e.message) }
  }
  if (!van.trips.length) return null
  return (
    <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
      <span className={label}>Sign-outs (last {van.trips.length})</span>
      <div className="space-y-1.5">
        {van.trips.map(t => {
          const driven = t.outMileage != null && t.inMileage != null ? t.inMileage - t.outMileage : null
          return (
            <div key={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
              <span className="font-semibold text-gray-900 dark:text-white">{t.driverName}</span>
              <span className="text-gray-700 dark:text-gray-300">{when(t.outAt)} → {t.inAt ? when(t.inAt) : <span className="text-amber-600 dark:text-amber-400">still out</span>}</span>
              {t.purpose && <span className={muted}>{t.purpose}</span>}
              {driven != null && <span className={muted}>{driven.toLocaleString("en-GB")} miles</span>}
              {t.notes && <span className="basis-full text-gray-700 dark:text-gray-300">{t.notes}</span>}
              <button className={`ml-auto ${muted} hover:text-red-500`} onClick={() => remove(t.id)} aria-label="Remove sign-out">✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function toForm(v: Van) {
  return {
    name: v.name, reg: v.reg, make: v.make, model: v.model, colour: v.colour, year: v.year, fuel: v.fuel, notes: v.notes,
    mileage: v.mileage == null ? "" : String(v.mileage),
    motDue: iso(v.motDue), taxDue: iso(v.taxDue), serviceDue: iso(v.serviceDue), insuranceDue: iso(v.insuranceDue),
  }
}

function F({ label: l, v, on, type, placeholder }: { label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {/* A bare date input takes the browser's own colours — dark on dark in dark mode (RULES.md design rule 2). */}
      <input type={type ?? "text"} value={v} onChange={e => on(e.target.value)} className={`${input} dark:[color-scheme:dark]`} placeholder={placeholder} />
    </label>
  )
}
