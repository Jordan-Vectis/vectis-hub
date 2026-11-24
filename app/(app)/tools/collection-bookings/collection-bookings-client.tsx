"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  COLLECTION_STATUS_LABEL, OPEN_COLLECTION_STATUSES, NEARBY_MILES, milesBetween, ref as cbRef, type CollectionStatus,
} from "@/lib/collection-bookings-shared"

// Admin & Operations → Collection bookings. A list of collection trips (filter, search) beside the
// booking you have open: who's dealing with it, what's still to sort, the details, photos, the hotel
// stays, and the notes & history. Every save sends only what changed, and the server logs each change.

const box   = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-lime-500 dark:[color-scheme:dark]"
const btn   = "min-h-11 px-3.5 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const btnGo = "min-h-11 px-4 py-2 text-sm font-semibold rounded-lg bg-lime-600 hover:bg-lime-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
const label = "block text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1"
const muted = "text-gray-500 dark:text-gray-400"
const heading = "text-xs tracking-widest font-semibold text-gray-500 dark:text-gray-400 uppercase"

type Status = CollectionStatus
type Hotel = {
  id: string; name: string; address: string; phone: string; checkIn: string | null; checkOut: string | null
  rooms: string; guests: string; confirmationNo: string; bookedVia: string; costPence: number | null
  payment: string; notes: string; fileKeys: string[]
}
type Booking = {
  id: string; ref: number; status: Status; ownerId: string | null; ownerName: string | null; pickedUpAt: string | null
  vendorName: string; vendorNo: string; phone: string; email: string; address: string; postcode: string
  lat: number | null; lng: number | null; area: string | null; geoPostcode: string | null
  collectFrom: string | null; collectTo: string | null; timeWindow: string
  description: string; size: string; requirements: string; photoKeys: string[]
  drivers: string[]; vanId: string | null; needsHotel: boolean
  createdByName: string; createdAt: string; updatedAt: string; closedAt: string | null
  hotels: Hotel[]
  submissionId: string | null
}
type Ev  = { id: string; kind: string; text: string; byName: string; at: string }
type Van = { id: string; name: string; reg: string; active: boolean }
type Me  = { userId: string; name: string; isAdmin: boolean; canCrm: boolean }
/** A CRM submission set to Collection with no booking yet (lib/collection-bookings.ts crmCollectionsToBook). */
type Crm = {
  submissionId: string; crmRef: string; status: string; name: string; customerNo: string
  phone: string; email: string; address: string; postcode: string; notes: string; items: number; createdAt: string
}

// ── Small helpers ────────────────────────────────────────────────────────────
const fileUrl = (key: string) => `/api/collection-bookings/file?key=${encodeURIComponent(key)}`
const isPdf = (key: string) => key.toLowerCase().endsWith(".pdf")
/** Dates are stored as midnight UTC of the day, so read and show them in UTC. */
const iso = (d: string | null) => (d ? d.slice(0, 10) : "")
const dayLabel = (d: string | null, withYear = false) => d
  ? new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" })
  : ""
const todayIso = () => new Date().toLocaleDateString("en-CA") // YYYY-MM-DD, this computer's day
const when = (d: string) => {
  const x = new Date(d)
  const t = x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return x.toDateString() === new Date().toDateString() ? `${t} today` : `${t}, ${x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
}
const money = (p: number | null) => (p == null ? "" : `£${(p / 100).toFixed(2)}`)
const nights = (a: string | null, b: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000) : null)
const vanLabel = (v: Van | undefined) => (v ? (v.reg ? `${v.name} (${v.reg})` : v.name) : "")
const dates = (b: { collectFrom: string | null; collectTo: string | null; timeWindow?: string }) => {
  if (!b.collectFrom) return ""
  const span = b.collectTo && iso(b.collectTo) !== iso(b.collectFrom) ? `${dayLabel(b.collectFrom)} – ${dayLabel(b.collectTo)}` : dayLabel(b.collectFrom, true)
  return b.timeWindow ? `${span}, ${b.timeWindow}` : span
}
const lastDay = (b: { collectFrom: string | null; collectTo: string | null }) => iso(b.collectTo) || iso(b.collectFrom)

/** Other collections still to happen within NEARBY_MILES of this one, nearest first. Straight-line
 *  miles between the postcodes (postcodes.io) — so if one is cancelled, the driver, van or hotel can
 *  go to one of these instead, and nearby jobs can be put on one trip. */
function nearbyTo(b: Booking, all: Booking[]): { o: Booking; miles: number }[] {
  if (b.lat == null || b.lng == null) return []
  const here = { lat: b.lat, lng: b.lng }
  return all
    .filter(o => o.id !== b.id && OPEN_COLLECTION_STATUSES.includes(o.status) && o.lat != null && o.lng != null)
    .map(o => ({ o, miles: milesBetween(here, { lat: o.lat!, lng: o.lng! }) }))
    .filter(x => x.miles <= NEARBY_MILES)
    .sort((a, b) => a.miles - b.miles)
}
const milesLabel = (m: number) => (m < 1 ? "under a mile" : `${Math.round(m)} mi`)
/** How the two collection dates sit against each other: "same day", "2 days after", "no date". */
function dayGap(from: string | null, to: string | null): string {
  if (!from || !to) return "no date"
  const d = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)
  if (d === 0) return "same day"
  return `${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ${d > 0 ? "after" : "before"}`
}

async function api(url: string, body: any, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error ?? "Something went wrong — please try again.")
  return j
}

// Every colour carries its words, so no separate key is needed (RULES.md design rule 3).
const STATUS_TONE: Record<Status, string> = {
  NEW:       "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  IN_HAND:   "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  BOOKED:    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  COLLECTED: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  CANCELLED: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
}
function StatusPill({ status }: { status: Status }) {
  return <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${STATUS_TONE[status] ?? STATUS_TONE.NEW}`}>{COLLECTION_STATUS_LABEL[status] ?? status}</span>
}

/** What still needs sorting before the trip can go — shown on the booking and counted on the list. */
function stillToSort(b: { status: Status; phone: string; address: string; postcode: string; collectFrom: string | null; drivers: string[]; vanId: string | null; needsHotel: boolean; hotels: Hotel[] }): string[] {
  if (b.status === "COLLECTED" || b.status === "CANCELLED") return []
  const out: string[] = []
  if (!b.collectFrom) out.push("No collection date")
  if (!b.address.trim() && !b.postcode.trim()) out.push("No address")
  if (!b.phone.trim()) out.push("No phone number for the vendor")
  if (!b.drivers.length) out.push("No driver")
  if (!b.vanId) out.push("No van")
  if (b.needsHotel && !b.hotels.length) out.push("Needs a hotel — none added")
  for (const h of b.hotels) {
    if (!h.confirmationNo.trim()) out.push(`${h.name || "A hotel stay"}: no confirmation number`)
    if (!h.checkIn || !h.checkOut) out.push(`${h.name || "A hotel stay"}: check-in / check-out dates missing`)
  }
  return out
}

/** The hotel line on the list: nothing when it isn't an overnight. */
function hotelState(b: Booking): { text: string; tone: string } | null {
  if (!b.needsHotel && !b.hotels.length) return null
  if (!b.hotels.length) return { text: "🏨 Hotel needed", tone: "text-amber-600 dark:text-amber-400" }
  if (b.hotels.some(h => !h.confirmationNo.trim())) return { text: "🏨 Awaiting confirmation", tone: "text-amber-600 dark:text-amber-400" }
  return { text: `🏨 ${b.hotels.map(h => h.name || "Hotel").join(", ")} — confirmed`, tone: "text-green-700 dark:text-green-400" }
}

/** Another open booking on overlapping days with the same van or a shared driver. */
function clashes(me: { id: string; collectFrom: string | null; collectTo: string | null; drivers: string[]; vanId: string | null }, all: Booking[], vans: Van[]): string[] {
  const from = iso(me.collectFrom)
  if (!from) return []
  const to = iso(me.collectTo) || from
  const out: string[] = []
  for (const o of all) {
    if (o.id === me.id || !OPEN_COLLECTION_STATUSES.includes(o.status) || !o.collectFrom) continue
    const oFrom = iso(o.collectFrom), oTo = lastDay(o)
    if (oTo < from || oFrom > to) continue
    const on = `${cbRef(o.ref)}${o.vendorName ? ` (${o.vendorName})` : ""}, ${dayLabel(o.collectFrom)}`
    if (me.vanId && o.vanId === me.vanId) out.push(`${vanLabel(vans.find(v => v.id === me.vanId)) || "This van"} is also on ${on}`)
    for (const d of me.drivers) if (o.drivers.some(x => x.toLowerCase() === d.toLowerCase())) out.push(`${d} is also driving ${on}`)
  }
  return out
}

const FILTERS = [
  { key: "open",      label: "Open" },
  { key: "new",       label: "Needs picking up" },
  { key: "mine",      label: "Mine" },
  { key: "booked",    label: "Booked" },
  { key: "collected", label: "Collected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all",       label: "All" },
  { key: "crm",       label: "From the CRM" },
] as const
type FilterKey = typeof FILTERS[number]["key"]

// ── The page ─────────────────────────────────────────────────────────────────
export default function CollectionBookingsClient({ initialId, initialFilter }: { initialId: string; initialFilter?: string }) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [vans, setVans]         = useState<Van[]>([])
  const [driverNames, setDriverNames] = useState<string[]>([])
  const [crm, setCrm]           = useState<Crm[]>([])
  const [crmRefs, setCrmRefs]   = useState<Record<string, string>>({})
  const [me, setMe]             = useState<Me>({ userId: "", name: "", isAdmin: false, canCrm: false })
  const [loading, setLoading]   = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<FilterKey>(FILTERS.some(f => f.key === initialFilter) ? (initialFilter as FilterKey) : "open")
  const [q, setQ]               = useState("")
  const [openId, setOpenId]     = useState<string>(initialId)
  const [creating, setCreating] = useState(false)
  // "📍 Show nearby collections" on a booking: the list becomes that booking plus the open collections
  // within NEARBY_MILES of it, nearest first, each with its miles.
  const [nearOf, setNearOf]     = useState<string | null>(null)
  const [dirty, setDirty]       = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/collection-bookings")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? "Couldn't load the collection bookings")
      setNeedsMigration(!!j.needsMigration)
      setBookings(j.bookings ?? []); setVans(j.vans ?? []); setDriverNames(j.driverNames ?? [])
      setCrm(j.crm ?? []); setCrmRefs(j.crmRefs ?? {})
      if (j.me) setMe(j.me)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // Keep ?id= in the address bar, so a booking can be linked to or reopened after a refresh.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (openId) url.searchParams.set("id", openId); else url.searchParams.delete("id")
    window.history.replaceState(null, "", url.toString())
  }, [openId])

  function open(id: string) {
    if (id === openId) return
    if (dirty && !confirm("You have changes on this booking that aren't saved. Leave them?")) return
    setDirty(false); setCreating(false); setOpenId(id)
  }

  const today = todayIso()
  const counts = useMemo(() => ({
    new:     bookings.filter(b => b.status === "NEW").length,
    inHand:  bookings.filter(b => b.status === "IN_HAND").length,
    booked:  bookings.filter(b => b.status === "BOOKED").length,
    week:    bookings.filter(b => OPEN_COLLECTION_STATUSES.includes(b.status) && b.collectFrom && lastDay(b) >= today && iso(b.collectFrom) <= addDays(today, 7)).length,
    overdue: bookings.filter(b => OPEN_COLLECTION_STATUSES.includes(b.status) && b.collectFrom && lastDay(b) < today).length,
  }), [bookings, today])

  const nearCentre = nearOf ? bookings.find(b => b.id === nearOf) ?? null : null
  const nearList = useMemo(() => (nearCentre ? nearbyTo(nearCentre, bookings) : []), [nearCentre, bookings])

  const shown = useMemo(() => {
    if (nearCentre) return [nearCentre, ...nearList.map(n => n.o)]
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = bookings.filter(b => {
      if (filter === "open" && !OPEN_COLLECTION_STATUSES.includes(b.status)) return false
      if (filter === "new" && b.status !== "NEW") return false
      if (filter === "mine" && (b.ownerId !== me.userId || !OPEN_COLLECTION_STATUSES.includes(b.status))) return false
      if (filter === "booked" && b.status !== "BOOKED") return false
      if (filter === "collected" && b.status !== "COLLECTED") return false
      if (filter === "cancelled" && b.status !== "CANCELLED") return false
      if (!words.length) return true
      const hay = [cbRef(b.ref), b.vendorName, b.vendorNo, b.phone, b.email, b.address, b.postcode, b.description, b.drivers.join(" "),
        b.ownerName ?? "", vanLabel(vans.find(v => v.id === b.vanId)), ...b.hotels.flatMap(h => [h.name, h.confirmationNo])].join(" ").toLowerCase()
      return words.every(w => hay.includes(w))
    })
    // Still to happen: soonest first, undated at the end. Finished: most recent first.
    const upcoming = filter === "open" || filter === "new" || filter === "mine" || filter === "booked"
    return list.sort((a, b) => {
      const da = iso(a.collectFrom), db = iso(b.collectFrom)
      if (upcoming) {
        if (!da !== !db) return da ? -1 : 1
        if (da !== db) return da < db ? -1 : 1
        return a.createdAt < b.createdAt ? -1 : 1
      }
      const ka = da || a.createdAt, kb = db || b.createdAt
      return ka < kb ? 1 : -1
    })
  }, [bookings, filter, q, me.userId, vans, nearCentre, nearList])
  const milesAway = (id: string): number | "centre" | undefined =>
    !nearCentre ? undefined : id === nearCentre.id ? "centre" : nearList.find(n => n.o.id === id)?.miles

  /** Shows the nearby list. Under xl the list is hidden while a booking is open, so the booking closes. */
  function showNearby(id: string) {
    if (!window.matchMedia("(min-width: 1280px)").matches) {
      if (dirty && !confirm("You have changes on this booking that aren't saved. Leave them?")) return
      setDirty(false); setOpenId("")
    }
    setNearOf(id)
  }

  const selected = bookings.find(b => b.id === openId) ?? null
  const split = !!(openId || creating)

  return (
    <div className="space-y-4 pb-16">
      {needsMigration && (
        <div className="rounded-lg border border-amber-500 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-4 py-3 text-sm">
          A database update is waiting — the collection bookings tables aren&apos;t there yet. An admin presses <strong>Run Migrations</strong> on the Admin page, then reload.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-400 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-3 text-sm flex items-start gap-3">
          <span className="flex-1">{error}</span>
          <button className="text-xs underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* The numbers that matter, each one a shortcut to its list. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat n={counts.new} label="Need picking up" tone={counts.new ? "text-amber-600 dark:text-amber-400" : ""} onClick={() => setFilter("new")} />
        <Stat n={counts.inHand} label="Being arranged" onClick={() => setFilter("open")} />
        <Stat n={counts.booked} label="Booked" onClick={() => setFilter("booked")} />
        <Stat n={counts.week} label="Going out in the next 7 days" onClick={() => setFilter("open")} />
        <Stat n={counts.overdue} label="Date passed, not marked collected" tone={counts.overdue ? "text-red-600 dark:text-red-400" : ""} onClick={() => setFilter("open")} />
        <Stat n={crm.length} label="From the CRM, not booked yet" tone={crm.length ? "text-indigo-600 dark:text-indigo-400" : ""} onClick={() => { setNearOf(null); setFilter("crm") }} />
      </div>

      <div className={split ? "grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start" : ""}>
        {/* The list — hidden under xl while a booking is open, so a tablet gets the whole width for it. */}
        <div className={`space-y-3 ${split ? "hidden xl:block xl:sticky xl:top-4 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:pr-1" : ""}`}>
          {nearCentre && (
            <div className="rounded-lg border border-lime-500 bg-lime-50 dark:bg-lime-950/30 px-4 py-3 text-sm text-lime-900 dark:text-lime-200 flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-48">
                📍 Open collections within {NEARBY_MILES} miles of <b>{cbRef(nearCentre.ref)}</b>{nearCentre.vendorName ? ` (${nearCentre.vendorName})` : ""} —{" "}
                {nearList.length === 0 ? "none found" : `${nearList.length} found, nearest first`}. Straight-line miles between postcodes.
              </span>
              <button className={btn} onClick={() => setNearOf(null)}>✕ Show all bookings</button>
            </div>
          )}
          <div className={`flex flex-wrap items-center gap-2 ${nearCentre ? "hidden" : ""}`}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`min-h-11 px-3 text-sm rounded-lg border transition-colors ${filter === f.key
                  ? "border-lime-500 bg-lime-50 text-lime-800 dark:bg-lime-900/30 dark:text-lime-300"
                  : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"}`}>
                {f.label}{f.key === "crm" ? ` (${crm.length})` : ""}
              </button>
            ))}
          </div>
          <div className={`flex flex-wrap gap-2 ${nearCentre ? "hidden" : ""}`}>
            <input value={q} onChange={e => setQ(e.target.value)} className={`${input} flex-1 min-w-48`} placeholder="Search vendor, postcode, CB number, driver, hotel, confirmation…" />
            <button className={btnGo} onClick={() => { if (dirty && !confirm("You have changes on this booking that aren't saved. Leave them?")) return; setDirty(false); setOpenId(""); setCreating(true) }}>+ New collection</button>
          </div>

          {loading ? <p className={`text-sm ${muted}`}>Loading…</p>
            : filter === "crm" && !nearCentre ? (
              <CrmList items={crm} q={q} canCrm={me.canCrm} onError={setError} onMade={async id => {
                await load()
                setFilter("open"); setCreating(false); setDirty(false); setOpenId(id)
              }} />
            ) : shown.length === 0 ? (
              <p className={`text-sm ${muted} ${box} px-4 py-6 text-center`}>
                {bookings.length === 0 ? "No collection bookings yet — press + New collection to add the first." : `Nothing here under “${FILTERS.find(f => f.key === filter)?.label}”${q ? " matching that search" : ""}.`}
              </p>
            ) : (
              <div className="space-y-2">
                <p className={`text-xs ${muted}`}>{shown.length} booking{shown.length === 1 ? "" : "s"}</p>
                {shown.map(b => <Row key={b.id} b={b} vans={vans} all={bookings} me={me} today={today} active={b.id === openId} milesAway={milesAway(b.id)} crmRef={b.submissionId ? crmRefs[b.submissionId] : undefined} onOpen={() => open(b.id)} />)}
              </div>
            )}
        </div>

        {split && (
          <div className="min-w-0">
            <button className={`${btn} mb-3 xl:hidden`} onClick={() => { if (dirty && !confirm("You have changes on this booking that aren't saved. Leave them?")) return; setDirty(false); setOpenId(""); setCreating(false) }}>← All bookings</button>
            {creating
              ? <NewBooking onCancel={() => setCreating(false)} onError={setError} onCreated={id => { setCreating(false); setOpenId(id); void load() }} />
              : openId && (
                <Detail key={openId} id={openId} summary={selected} all={bookings} vans={vans} driverNames={driverNames} me={me} onOpen={open} onShowNearby={showNearby}
                  onListChanged={load} onError={setError} onDirty={setDirty}
                  onClose={() => { if (dirty && !confirm("You have changes on this booking that aren't saved. Leave them?")) return; setDirty(false); setOpenId("") }}
                  onDeleted={() => { setDirty(false); setOpenId(""); void load() }} />
              )}
          </div>
        )}
      </div>
    </div>
  )
}

function addDays(isoDay: string, n: number) {
  const d = new Date(`${isoDay}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function Stat({ n, label: l, tone, onClick }: { n: number; label: string; tone?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`${box} px-3 py-2.5 text-left hover:border-lime-500 transition-colors`}>
      <span className={`block text-2xl font-bold ${tone || "text-gray-900 dark:text-white"}`}>{n}</span>
      <span className={`block text-xs ${muted}`}>{l}</span>
    </button>
  )
}

function Row({ b, vans, all, me, today, active, milesAway, crmRef, onOpen }: { b: Booking; vans: Van[]; all: Booking[]; me: Me; today: string; active: boolean; milesAway?: number | "centre"; crmRef?: string; onOpen: () => void }) {
  const todo = stillToSort(b)
  const hotel = hotelState(b)
  const clash = OPEN_COLLECTION_STATUSES.includes(b.status) ? clashes(b, all, vans) : []
  const passed = OPEN_COLLECTION_STATUSES.includes(b.status) && b.collectFrom && lastDay(b) < today
  const where = [b.address.split(/\r?\n|,/)[0]?.trim(), b.postcode].filter(Boolean).join(", ")
  // Nearby is marked on collections still to happen, and on cancelled ones (whose slot could go to one of them).
  const near = b.status === "COLLECTED" ? [] : nearbyTo(b, all)
  return (
    <button onClick={onOpen} className={`w-full text-left ${box} px-4 py-3 transition-colors hover:border-lime-500 ${active ? "border-lime-500 ring-1 ring-lime-500" : ""}`}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {milesAway !== undefined && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300">
            {milesAway === "centre" ? "📍 This one" : `📍 ${milesLabel(milesAway)} away`}
          </span>
        )}
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{cbRef(b.ref)}</span>
        <StatusPill status={b.status} />
        <span className="font-semibold text-gray-900 dark:text-white">{b.vendorName || "No vendor name"}</span>
        {b.vendorNo && <span className={`text-xs ${muted}`}>{b.vendorNo}</span>}
        {b.submissionId && <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">CRM {crmRef ?? ""}</span>}
        <span className={`ml-auto text-xs ${b.ownerId ? (b.ownerId === me.userId ? "text-lime-700 dark:text-lime-400 font-semibold" : muted) : "text-amber-600 dark:text-amber-400 font-semibold"}`}>
          {b.ownerId ? `✋ ${b.ownerId === me.userId ? "You" : b.ownerName}` : OPEN_COLLECTION_STATUSES.includes(b.status) ? "Nobody has it" : ""}
        </span>
      </span>
      <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
        <span>📅 {dates(b) || <span className={muted}>no date</span>}</span>
        <span>📍 {where || <span className={muted}>no address</span>}</span>
      </span>
      <span className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs ${muted}`}>
        <span>🧑‍✈️ {b.drivers.length ? b.drivers.join(", ") : "no driver"}</span>
        <span>🚐 {vanLabel(vans.find(v => v.id === b.vanId)) || "no van"}</span>
        {hotel && <span className={hotel.tone}>{hotel.text}</span>}
        {b.photoKeys.length > 0 && <span>📷 {b.photoKeys.length}</span>}
      </span>
      {near.length > 0 && (
        <span className="mt-1 block text-xs text-lime-700 dark:text-lime-400">
          📍 {b.status === "CANCELLED" ? "Open jobs nearby" : "Nearby"}: {near.slice(0, 3).map(n => `${cbRef(n.o.ref)} ${milesLabel(n.miles)}`).join(" · ")}
          {near.length > 3 ? ` · +${near.length - 3} more` : ""}
        </span>
      )}
      {(passed || clash.length > 0 || todo.length > 0) && (
        <span className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {passed && <span className="text-red-600 dark:text-red-400 font-semibold">Date has passed — mark it Collected or change the date</span>}
          {clash.map(c => <span key={c} className="text-amber-600 dark:text-amber-400">⚠ {c}</span>)}
          {todo.length > 0 && <span className="text-amber-600 dark:text-amber-400">{todo.length} thing{todo.length === 1 ? "" : "s"} still to sort</span>}
        </span>
      )}
    </button>
  )
}

// ── A new booking: the basics, then the rest on the booking itself ───────────
function NewBooking({ onCancel, onCreated, onError }: { onCancel: () => void; onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [f, setF] = useState({ vendorName: "", vendorNo: "", phone: "", email: "", address: "", postcode: "", collectFrom: "", collectTo: "", timeWindow: "", description: "", requirements: "" })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF(x => ({ ...x, [k]: v }))
  async function save() {
    setBusy(true)
    try { const j = await api("/api/collection-bookings", f); onCreated(j.id) }
    catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className={`${box} p-4 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">New collection</h2>
        <button className={btn} onClick={onCancel}>Cancel</button>
      </div>
      <p className={`text-sm ${muted}`}>The basics first — the driver, van, hotel and photos go on the booking once it&apos;s made. It starts as <b>New</b>, for someone to pick up.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <F label="Vendor name" v={f.vendorName} on={v => set("vendorName", v)} />
        <F label="Vendor number" v={f.vendorNo} on={v => set("vendorNo", v)} placeholder="e.g. C123456" />
        <F label="Phone" v={f.phone} on={v => set("phone", v)} type="tel" />
        <F label="Email" v={f.email} on={v => set("email", v)} type="email" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-2">
        <T label="Collection address" v={f.address} on={v => set("address", v)} rows={2} />
        <F label="Postcode" v={f.postcode} on={v => set("postcode", v.toUpperCase())} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <F label="Collection date" v={f.collectFrom} on={v => set("collectFrom", v)} type="date" />
        <F label="Last day (if more than one)" v={f.collectTo} on={v => set("collectTo", v)} type="date" />
        <F label="Time" v={f.timeWindow} on={v => set("timeWindow", v)} placeholder="e.g. from 10am, mornings only" />
      </div>
      <T label="What's being collected" v={f.description} on={v => set("description", v)} rows={3} placeholder="e.g. a Hornby 00 gauge collection — around 40 boxed locomotives and a loft layout" />
      <T label="Special requirements" v={f.requirements} on={v => set("requirements", v)} rows={2} placeholder="Access, stairs, parking, heavy items, two people needed, times to avoid…" />
      <div className="flex justify-end">
        <button className={btnGo} onClick={save} disabled={busy}>{busy ? "Saving…" : "Make the booking"}</button>
      </div>
    </div>
  )
}

// ── The open booking ─────────────────────────────────────────────────────────
type Form = {
  vendorName: string; vendorNo: string; phone: string; email: string; address: string; postcode: string
  collectFrom: string; collectTo: string; timeWindow: string; description: string; size: string; requirements: string
  drivers: string[]; vanId: string; needsHotel: boolean
}
const toForm = (b: Booking): Form => ({
  vendorName: b.vendorName, vendorNo: b.vendorNo, phone: b.phone, email: b.email, address: b.address, postcode: b.postcode,
  collectFrom: iso(b.collectFrom), collectTo: iso(b.collectTo), timeWindow: b.timeWindow,
  description: b.description, size: b.size, requirements: b.requirements,
  drivers: b.drivers, vanId: b.vanId ?? "", needsHotel: b.needsHotel,
})
/** Only the fields that changed, so two people working on one booking don't undo each other's edits. */
function changedFields(f: Form, base: Form): Partial<Form> {
  const out: any = {}
  for (const k of Object.keys(f) as (keyof Form)[]) {
    const a = f[k], b = base[k]
    if (Array.isArray(a) ? a.join("\n") !== (b as string[]).join("\n") : a !== b) out[k] = a
  }
  return out
}

function Detail({ id, summary, all, vans, driverNames, me, onOpen, onShowNearby, onListChanged, onError, onDirty, onClose, onDeleted }: {
  id: string; summary: Booking | null; all: Booking[]; vans: Van[]; driverNames: string[]; me: Me; onOpen: (id: string) => void; onShowNearby: (id: string) => void
  onListChanged: () => void; onError: (m: string) => void; onDirty: (d: boolean) => void; onClose: () => void; onDeleted: () => void
}) {
  const [b, setB]           = useState<Booking | null>(null)
  const [events, setEvents] = useState<Ev[]>([])
  const [fromCrm, setFromCrm] = useState<string | null>(null) // the CRM submission's reference, when made from one
  const [missing, setMissing] = useState(false)
  // Only what's been typed sits here, on top of the saved booking. So when the booking reloads — a
  // hotel added, someone else's save — the untouched fields take the new values and nothing typed is lost.
  const [edits, setEdits]   = useState<Partial<Form>>({})
  const [busy, setBusy]     = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sheet, setSheet]   = useState<string | null>(null) // shown when the browser won't let us copy

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/collection-bookings?id=${encodeURIComponent(id)}`)
      const j = await r.json()
      if (r.status === 404) { setMissing(true); return }
      if (!r.ok) throw new Error(j.error ?? "Couldn't open that booking")
      setB(j.booking); setEvents(j.booking.events ?? []); setFromCrm(j.crmRef ?? null)
    } catch (e: any) { onError(e.message) }
  }, [id, onError])
  useEffect(() => { void load() }, [load])
  /** After any change: this booking and the list both reload. */
  const refresh = useCallback(async () => { await load(); onListChanged() }, [load, onListChanged])

  const base = useMemo(() => (b ? toForm(b) : null), [b])
  const form = useMemo(() => (base ? { ...base, ...edits } : null), [base, edits])
  const diff = useMemo(() => (form && base ? changedFields(form, base) : {}), [form, base])
  const dirty = Object.keys(diff).length > 0
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  if (missing) return <div className={`${box} p-6 text-sm ${muted}`}>That booking isn&apos;t there — it may have been deleted. <button className="underline" onClick={onClose}>Back to the list</button></div>
  if (!b || !form) return <div className={`${box} p-6 text-sm ${muted}`}>{summary ? `Opening ${cbRef(summary.ref)}…` : "Opening…"}</div>

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdits(x => ({ ...x, [k]: v }))
  const live = { ...b, ...form, vanId: form.vanId || null, collectFrom: form.collectFrom || null, collectTo: form.collectTo || null }
  const todo = stillToSort(live)
  const clash = OPEN_COLLECTION_STATUSES.includes(b.status) ? clashes(live, all, vans) : []
  const mine = b.ownerId === me.userId
  const closed = b.status === "COLLECTED" || b.status === "CANCELLED"

  async function run(key: string, fn: () => Promise<any>) {
    setBusy(key)
    try { await fn(); await refresh() } catch (e: any) { onError(e.message) } finally { setBusy(null) }
  }
  const save = () => run("save", async () => {
    await api("/api/collection-bookings", { id: b.id, ...diff }, "PUT")
    await load()
    setEdits({})
  })
  const pickUp = () => run("pickup", () => api("/api/collection-bookings", { id: b.id, action: "pickup" }, "PUT"))
  const release = () => run("pickup", () => api("/api/collection-bookings", { id: b.id, action: "release" }, "PUT"))
  function status(s: Status) {
    if (dirty) { onError("Save or undo your changes first, then change the status."); return }
    if (s === "BOOKED" && todo.length && !confirm(`Still to sort:\n\n• ${todo.join("\n• ")}\n\nMark it Booked anyway?`)) return
    let reason = ""
    if (s === "CANCELLED") {
      const r = prompt("Why is it cancelled? (kept on the booking's history)")
      if (r === null) return
      reason = r
    }
    void run(`status-${s}`, () => api("/api/collection-bookings", { id: b!.id, action: "status", status: s, reason }, "PUT"))
  }
  async function remove() {
    if (!confirm(`Delete ${cbRef(b!.ref)} for good — its hotel stays, photos, notes and history? This can't be undone. Cancelling it keeps the record.`)) return
    setBusy("delete")
    try { await api("/api/collection-bookings", { id: b!.id }, "DELETE"); onDeleted() } catch (e: any) { onError(e.message) } finally { setBusy(null) }
  }
  async function copyForDriver() {
    const text = driverSheet(b!, vans)
    try { await navigator.clipboard.writeText(text); setCopied(true); setSheet(null); setTimeout(() => setCopied(false), 2500) }
    // Some browsers (and locked-down iPads) refuse the clipboard — show the text to copy by hand instead.
    catch { setSheet(text) }
  }

  const mapsUrl = (form.postcode || form.address) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([form.address, form.postcode].filter(Boolean).join(", "))}` : ""

  return (
    <div className="space-y-4">
      {/* ── Who has it and where it stands ── */}
      <div className={`${box} p-4 space-y-3`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-gray-500 dark:text-gray-400">{cbRef(b.ref)}</span>
          <StatusPill status={b.status} />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{b.vendorName || "No vendor name"}</h2>
          <button className={`${btn} ml-auto hidden xl:inline-flex items-center`} onClick={onClose} aria-label="Close this booking">✕ Close</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {b.ownerId
            ? <span className="text-gray-800 dark:text-gray-200">✋ <b>{mine ? "You have it" : `${b.ownerName} has it`}</b>{b.pickedUpAt ? <span className={muted}> · since {when(b.pickedUpAt)}</span> : null}</span>
            : <span className="text-amber-600 dark:text-amber-400 font-semibold">Nobody has picked this up yet</span>}
          {!closed && !mine && <button className={btnGo} onClick={pickUp} disabled={!!busy}>{busy === "pickup" ? "…" : b.ownerId ? "Take it over" : "✋ Pick this up"}</button>}
          {!closed && b.ownerId && <button className={btn} onClick={release} disabled={!!busy}>Put it back</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {!closed && b.status !== "BOOKED" && <button className={btn} onClick={() => status("BOOKED")} disabled={!!busy}>✓ Mark as booked</button>}
          {!closed && b.status === "BOOKED" && <button className={btn} onClick={() => status("IN_HAND")} disabled={!!busy}>Back to being arranged</button>}
          {!closed && <button className={btn} onClick={() => status("COLLECTED")} disabled={!!busy}>📦 Mark collected</button>}
          {!closed && <button className={`${btn} hover:border-red-500 hover:text-red-500`} onClick={() => status("CANCELLED")} disabled={!!busy}>Cancel collection</button>}
          {closed && <button className={btn} onClick={() => status(b.ownerId ? "IN_HAND" : "NEW")} disabled={!!busy}>↺ Reopen</button>}
          <button className={btn} onClick={() => onShowNearby(b.id)} disabled={b.lat == null}
            title={b.lat == null ? "Needs a postcode that can be found first" : undefined}>
            📍 Show nearby collections{b.lat != null ? ` (${nearbyTo(b, all).length})` : ""}
          </button>
          {/* What's SAVED is printed — say so when there are changes not saved yet. */}
          <a className={`${btn} inline-flex items-center`} href={`/api/collection-bookings/pdf?id=${encodeURIComponent(b.id)}`} target="_blank" rel="noreferrer"
            onClick={e => { if (dirty && !confirm("The PDF shows what's saved — your changes here aren't saved yet. Open it anyway?")) e.preventDefault() }}>
            🖨 Print / PDF
          </a>
          <button className={btn} onClick={copyForDriver}>{copied ? "✓ Copied" : "📋 Copy details for the driver"}</button>
          {me.isAdmin && <button className={`${btn} ml-auto hover:border-red-500 hover:text-red-500`} onClick={remove} disabled={!!busy}>Delete</button>}
        </div>
        {b.submissionId && (
          <p className="text-sm text-indigo-700 dark:text-indigo-300">
            📋 Made from CRM submission <b>{fromCrm ?? "(no longer in the CRM)"}</b>
            {me.canCrm && fromCrm && <> · <a className="underline" href={`/submissions/${b.submissionId}`} target="_blank" rel="noreferrer">Open in the CRM ↗</a></>}
          </p>
        )}
        <p className={`text-xs ${muted}`}>Made by {b.createdByName || "—"} · {when(b.createdAt)}{b.closedAt ? ` · ${b.status === "CANCELLED" ? "cancelled" : "collected"} ${when(b.closedAt)}` : ""}</p>
        {sheet !== null && (
          <div className="space-y-2">
            <p className="text-sm text-amber-600 dark:text-amber-400">This browser won&apos;t let the Hub copy for you — select the text below and copy it.</p>
            <textarea readOnly value={sheet} rows={Math.min(16, sheet.split("\n").length + 1)} onFocus={e => e.currentTarget.select()} className={`${input} font-mono text-xs`} />
            <button className={btn} onClick={() => setSheet(null)}>Close</button>
          </div>
        )}
      </div>

      <Nearby b={b} all={all} vans={vans} onOpen={onOpen} />

      {(todo.length > 0 || clash.length > 0) && (
        <div className="rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 space-y-1">
          {todo.length > 0 && <div><b>Still to sort:</b> {todo.join(" · ")}</div>}
          {clash.map(c => <div key={c}>⚠ {c}</div>)}
        </div>
      )}

      {/* ── The details ── */}
      <div className={`${box} p-4 space-y-4`}>
        <Section title="Vendor">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <F label="Vendor name" v={form.vendorName} on={v => set("vendorName", v)} />
            <F label="Vendor number" v={form.vendorNo} on={v => set("vendorNo", v)} placeholder="e.g. C123456" />
            <F label="Phone" v={form.phone} on={v => set("phone", v)} type="tel" />
            <F label="Email" v={form.email} on={v => set("email", v)} type="email" />
          </div>
        </Section>
        <Section title="Where and when">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-2">
            <T label="Collection address" v={form.address} on={v => set("address", v)} rows={2} />
            <div>
              <F label="Postcode" v={form.postcode} on={v => set("postcode", v.toUpperCase())} />
              {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs underline text-lime-700 dark:text-lime-400">Open in Google Maps ↗</a>}
              <PostcodeFound b={b} typed={form.postcode} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <F label="Collection date" v={form.collectFrom} on={v => set("collectFrom", v)} type="date" />
            <F label="Last day (if more than one)" v={form.collectTo} on={v => set("collectTo", v)} type="date" />
            <F label="Time" v={form.timeWindow} on={v => set("timeWindow", v)} placeholder="e.g. from 10am, mornings only" />
          </div>
        </Section>
        <Section title="The collection">
          <T label="What's being collected" v={form.description} on={v => set("description", v)} rows={3} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
            <F label="How much" v={form.size} on={v => set("size", v)} placeholder="e.g. 30 boxes and 2 cabinets — half a van" />
          </div>
          <div className="mt-2"><T label="Special requirements" v={form.requirements} on={v => set("requirements", v)} rows={2} placeholder="Access, stairs, parking, heavy items, two people needed, times to avoid…" /></div>
        </Section>
        <Section title="Driver, van and hotel">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
            <DriversInput value={form.drivers} onChange={v => set("drivers", v)} suggestions={driverNames} />
            <label className="block">
              <span className={label}>Van</span>
              <select value={form.vanId} onChange={e => set("vanId", e.target.value)} className={input}>
                <option value="">— none yet —</option>
                {vans.filter(v => v.active || v.id === form.vanId).map(v => <option key={v.id} value={v.id}>{vanLabel(v)}{v.active ? "" : " (retired)"}</option>)}
              </select>
              {vans.length === 0 && <span className={`mt-1 block text-xs ${muted}`}>No vans on Facilities → Vans yet.</span>}
            </label>
          </div>
          <label className="mt-3 flex items-center gap-3 min-h-11 cursor-pointer">
            <input type="checkbox" checked={form.needsHotel} onChange={e => set("needsHotel", e.target.checked)} className="w-5 h-5 accent-lime-600" />
            <span className="text-sm text-gray-800 dark:text-gray-200">It&apos;s an overnight — needs a hotel</span>
          </label>
        </Section>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 dark:border-gray-800 pt-3">
          <button className={btnGo} onClick={save} disabled={!dirty || !!busy}>{busy === "save" ? "Saving…" : "Save changes"}</button>
          {dirty && <button className={btn} onClick={() => setEdits({})} disabled={!!busy}>Undo changes</button>}
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">{Object.keys(diff).length} unsaved change{Object.keys(diff).length === 1 ? "" : "s"}</span>}
        </div>
      </div>

      <Photos b={b} onChanged={refresh} onError={onError} />
      <Hotels b={b} drivers={form.drivers} needsHotel={form.needsHotel} onChanged={refresh} onError={onError} />
      <History b={b} events={events} onChanged={refresh} onError={onError} />
    </div>
  )
}

/** CRM submissions set to Collection that have no booking yet — one press makes the booking from it. */
function CrmList({ items, q, canCrm, onError, onMade }: { items: Crm[]; q: string; canCrm: boolean; onError: (m: string) => void; onMade: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = items.filter(c => {
    if (!words.length) return true
    const hay = [c.crmRef, c.name, c.customerNo, c.phone, c.email, c.address, c.postcode, c.notes].join(" ").toLowerCase()
    return words.every(w => hay.includes(w))
  })
  async function make(c: Crm) {
    setBusy(c.submissionId)
    try { const j = await api("/api/collection-bookings", { fromSubmission: c.submissionId }); await onMade(j.id) }
    catch (e: any) { onError(e.message) } finally { setBusy(null) }
  }
  return (
    <div className="space-y-2">
      <p className={`text-xs ${muted}`}>
        CRM submissions whose logistics are set to Collection and that haven&apos;t arrived, with no booking made yet ({list.length}).
        Making a booking copies the contact, address, phone, email, items and collection notes across and links the two.
      </p>
      {list.length === 0 ? (
        <p className={`text-sm ${muted} ${box} px-4 py-6 text-center`}>{items.length === 0 ? "Nothing waiting — every CRM collection has a booking." : "None matching that search."}</p>
      ) : list.map(c => (
        <div key={c.submissionId} className={`${box} px-4 py-3 space-y-1`}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">CRM {c.crmRef}</span>
            <span className={`text-xs ${muted}`}>{c.status}</span>
            <span className="font-semibold text-gray-900 dark:text-white">{c.name || "No name"}</span>
            {c.customerNo && <span className={`text-xs ${muted}`}>{c.customerNo}</span>}
            <span className={`ml-auto text-xs ${muted}`}>since {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
            <span>📍 {[c.address.replace(/\s*\r?\n\s*/g, ", "), c.address.toUpperCase().includes(c.postcode) ? "" : c.postcode].filter(Boolean).join(", ") || <span className={muted}>no address</span>}</span>
          </div>
          <div className={`flex flex-wrap gap-x-4 gap-y-1 text-xs ${muted}`}>
            {c.phone && <span>☎ {c.phone}</span>}
            {c.email && <span>✉ {c.email}</span>}
            <span>📦 {c.items} item{c.items === 1 ? "" : "s"}</span>
          </div>
          {c.notes && <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">📝 {c.notes}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button className={btnGo} onClick={() => make(c)} disabled={!!busy}>{busy === c.submissionId ? "Making it…" : "＋ Make a booking"}</button>
            {canCrm && <a className={`${btn} inline-flex items-center`} href={`/submissions/${c.submissionId}`} target="_blank" rel="noreferrer">Open in the CRM ↗</a>}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Whether the postcode was placed on the map — the nearby miles depend on it. */
function PostcodeFound({ b, typed }: { b: Booking; typed: string }) {
  const saved = b.postcode.trim().toUpperCase()
  if (!saved || typed.trim().toUpperCase() !== saved) return null // nothing saved yet, or being changed
  if (b.lat != null) return <span className={`mt-1 block text-xs ${muted}`}>📍 Found{b.area ? `: ${b.area}` : ""} — used for nearby collections</span>
  if (b.geoPostcode === saved) return <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">⚠ That postcode wasn&apos;t found — check it, or nearby collections can&apos;t be worked out</span>
  return <span className={`mt-1 block text-xs ${muted}`}>Couldn&apos;t look the postcode up just now — it&apos;ll try again</span>
}

/** Other open collections within NEARBY_MILES, nearest first, with the miles and how the dates line up. */
function Nearby({ b, all, vans, onOpen }: { b: Booking; all: Booking[]; vans: Van[]; onOpen: (id: string) => void }) {
  if (b.status === "COLLECTED" || b.lat == null) return null
  const near = nearbyTo(b, all)
  return (
    <div className={`${box} p-4`}>
      <h3 className={`${heading} mb-1`}>Nearby collections ({near.length})</h3>
      <p className={`text-xs ${muted} mb-2`}>
        {b.status === "CANCELLED"
          ? `This one's cancelled — these open collections are within ${NEARBY_MILES} miles, so its driver, van or hotel could go to one of them.`
          : `Open collections within ${NEARBY_MILES} miles — worth putting on the same trip, or taking over if this one's cancelled.`}
        {" "}Miles are in a straight line between postcodes; by road is usually a bit further.
      </p>
      {near.length === 0 ? <p className={`text-sm ${muted}`}>No other open collections within {NEARBY_MILES} miles.</p> : (
        <div className="space-y-1.5">
          {near.map(({ o, miles }) => (
            <button key={o.id} onClick={() => onOpen(o.id)}
              className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2 min-h-11 hover:border-lime-500 transition-colors">
              <span className="font-semibold text-lime-700 dark:text-lime-400 w-24">{milesLabel(miles)}</span>
              <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{cbRef(o.ref)}</span>
              <StatusPill status={o.status} />
              <span className="font-semibold text-gray-900 dark:text-white">{o.vendorName || "No vendor name"}</span>
              <span className={muted}>{[o.area, o.postcode].filter(Boolean).join(", ")}</span>
              <span className="text-gray-700 dark:text-gray-300">📅 {o.collectFrom ? `${dayLabel(o.collectFrom)}${b.collectFrom ? ` (${dayGap(b.collectFrom, o.collectFrom)})` : ""}` : "no date"}</span>
              <span className={`text-xs ${muted}`}>🧑‍✈️ {o.drivers.join(", ") || "no driver"} · 🚐 {vanLabel(vans.find(v => v.id === o.vanId)) || "no van"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className={`${heading} mb-2`}>{title}</h3>{children}</div>
}

/** Drivers as removable names; type a name (suggestions are the Hub's staff and past drivers) and Add. */
function DriversInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const [text, setText] = useState("")
  function add() {
    const n = text.trim()
    if (!n) return
    if (!value.some(v => v.toLowerCase() === n.toLowerCase())) onChange([...value, n].slice(0, 6))
    setText("")
  }
  return (
    <div>
      <span className={label}>Drivers</span>
      <div className="flex flex-wrap gap-2 mb-2">
        {value.length === 0 && <span className={`text-sm ${muted}`}>No driver yet</span>}
        {value.map(d => (
          <span key={d} className="inline-flex items-center gap-1 min-h-9 pl-3 pr-1 rounded-full bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-300 text-sm">
            {d}
            <button className="w-7 h-7 rounded-full hover:bg-lime-200 dark:hover:bg-lime-800/60" onClick={() => onChange(value.filter(x => x !== d))} aria-label={`Take ${d} off`}>✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add() } }}
          list="collection-driver-names" className={input} placeholder="Type a name…" />
        <datalist id="collection-driver-names">{suggestions.map(n => <option key={n} value={n} />)}</datalist>
        <button className={btn} onClick={add} disabled={!text.trim() || value.length >= 6}>Add</button>
      </div>
    </div>
  )
}

/** Uploads one at a time, with a count that moves (RULES.md design rule 7b). */
function useUploader(onChanged: () => Promise<void>, onError: (m: string) => void) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  async function upload(files: File[], extra: Record<string, string>) {
    let ok = 0
    const failed: string[] = []
    setProgress({ done: 0, total: files.length })
    for (let i = 0; i < files.length; i++) {
      try {
        const fd = new FormData(); fd.append("file", files[i])
        for (const [k, v] of Object.entries(extra)) fd.append(k, v)
        const r = await fetch("/api/collection-bookings/file", { method: "POST", body: fd })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? "Upload failed")
        ok++
      } catch (e: any) { failed.push(`${files[i].name}: ${e.message}`) }
      setProgress({ done: i + 1, total: files.length })
    }
    await onChanged()
    setProgress(null)
    if (failed.length) onError(`${ok} of ${files.length} uploaded. Not uploaded — ${failed.join("; ")}`)
  }
  return { progress, upload }
}

function Thumb({ k, onRemove }: { k: string; onRemove: () => void }) {
  return (
    <div className="relative group">
      <a href={fileUrl(k)} target="_blank" rel="noreferrer" className="block w-28 h-28 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
        {isPdf(k)
          ? <span className="w-full h-full grid place-items-center text-sm text-gray-700 dark:text-gray-300">📄 PDF</span>
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={fileUrl(k)} alt="" loading="lazy" className="w-full h-full object-cover" />}
      </a>
      <button onClick={onRemove} aria-label="Remove this file"
        className="absolute top-1 right-1 w-8 h-8 rounded-full bg-black/60 text-white text-sm hover:bg-red-600">✕</button>
    </div>
  )
}

function Photos({ b, onChanged, onError }: { b: Booking; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const { progress, upload } = useUploader(onChanged, onError)
  async function remove(k: string) {
    if (!confirm(`Remove this ${isPdf(k) ? "PDF" : "photo"} from the booking?`)) return
    try { await api("/api/collection-bookings/file", { key: k }, "DELETE"); await onChanged() } catch (e: any) { onError(e.message) }
  }
  return (
    <div className={`${box} p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className={heading}>Photos of the collection ({b.photoKeys.length})</h3>
        <button className={btn} onClick={() => ref.current?.click()} disabled={!!progress}>
          {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "⬆ Add photos"}
        </button>
        <input ref={ref} type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void upload(fs, { bookingId: b.id }) }} />
      </div>
      {b.photoKeys.length === 0
        ? <p className={`text-sm ${muted}`}>No photos yet — add the ones the vendor sent, so the driver knows what to expect.</p>
        : <div className="flex flex-wrap gap-2">{b.photoKeys.map(k => <Thumb key={k} k={k} onRemove={() => void remove(k)} />)}</div>}
    </div>
  )
}

// ── Hotel stays ──────────────────────────────────────────────────────────────
type HotelForm = { name: string; address: string; phone: string; checkIn: string; checkOut: string; rooms: string; guests: string; confirmationNo: string; bookedVia: string; cost: string; payment: string; notes: string }
const toHotelForm = (h: Hotel): HotelForm => ({
  name: h.name, address: h.address, phone: h.phone, checkIn: iso(h.checkIn), checkOut: iso(h.checkOut), rooms: h.rooms, guests: h.guests,
  confirmationNo: h.confirmationNo, bookedVia: h.bookedVia, cost: h.costPence == null ? "" : (h.costPence / 100).toFixed(2),
  payment: h.payment, notes: h.notes,
})

function Hotels({ b, drivers, needsHotel, onChanged, onError }: { b: Booking; drivers: string[]; needsHotel: boolean; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [adding, setAdding] = useState(false)
  // A night before the collection is the usual stay, so that's the starting guess.
  const firstNight = b.collectFrom ? addDays(iso(b.collectFrom), -1) : ""
  const blank: HotelForm = { name: "", address: "", phone: "", checkIn: firstNight, checkOut: firstNight ? addDays(firstNight, 1) : "", rooms: "", guests: drivers.join(", "), confirmationNo: "", bookedVia: "", cost: "", payment: "", notes: "" }
  if (!needsHotel && !b.hotels.length && !adding) {
    return (
      <div className={`${box} p-4 flex flex-wrap items-center justify-between gap-2`}>
        <span className={`text-sm ${muted}`}>🏨 No hotel — it&apos;s a day trip. Tick &ldquo;needs a hotel&rdquo; above, or add a stay here.</span>
        <button className={btn} onClick={() => setAdding(true)}>+ Add a hotel stay</button>
      </div>
    )
  }
  return (
    <div className={`${box} p-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={heading}>Hotel ({b.hotels.length} stay{b.hotels.length === 1 ? "" : "s"})</h3>
        {!adding && <button className={btn} onClick={() => setAdding(true)}>+ Add a hotel stay</button>}
      </div>
      {b.hotels.length === 0 && !adding && <p className="text-sm text-amber-600 dark:text-amber-400">It needs a hotel and none is added yet.</p>}
      {b.hotels.map(h => <HotelStay key={h.id} b={b} h={h} onChanged={onChanged} onError={onError} />)}
      {adding && <HotelStay b={b} blank={blank} onDone={() => setAdding(false)} onChanged={onChanged} onError={onError} />}
    </div>
  )
}

function HotelStay({ b, h, blank, onDone, onChanged, onError }: { b: Booking; h?: Hotel; blank?: HotelForm; onDone?: () => void; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const start = h ? toHotelForm(h) : blank!
  // What's been typed, on top of the saved stay (same reason as the booking's form).
  const [edits, setEdits] = useState<Partial<HotelForm>>({})
  const f: HotelForm = { ...start, ...edits }
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { progress, upload } = useUploader(onChanged, onError)

  const changed = (Object.keys(f) as (keyof HotelForm)[]).filter(k => f[k] !== start[k])
  const set = (k: keyof HotelForm, v: string) => setEdits(x => ({ ...x, [k]: v }))
  const n = nights(f.checkIn ? `${f.checkIn}T00:00:00Z` : null, f.checkOut ? `${f.checkOut}T00:00:00Z` : null)

  async function save() {
    setBusy(true)
    try {
      if (h) await api("/api/collection-bookings/hotels", { id: h.id, ...Object.fromEntries(changed.map(k => [k, f[k]])) }, "PUT")
      else await api("/api/collection-bookings/hotels", { bookingId: b.id, ...f })
      await onChanged()
      setEdits({})
      if (!h) onDone?.()
    } catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!h) { onDone?.(); return }
    if (!confirm(`Remove the ${h.name || "hotel"} stay${h.fileKeys.length ? ` and its ${h.fileKeys.length} confirmation file${h.fileKeys.length === 1 ? "" : "s"}` : ""}?`)) return
    try { await api("/api/collection-bookings/hotels", { id: h.id }, "DELETE"); await onChanged() } catch (e: any) { onError(e.message) }
  }
  async function removeFile(k: string) {
    if (!confirm("Remove this confirmation file?")) return
    try { await api("/api/collection-bookings/file", { key: k }, "DELETE"); await onChanged() } catch (e: any) { onError(e.message) }
  }

  return (
    <div className="rounded-lg border border-gray-300 dark:border-gray-700 p-3 space-y-2">
      {h && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-gray-900 dark:text-white">{h.name || "Hotel stay"}</span>
          {h.confirmationNo
            ? <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300">Confirmed · {h.confirmationNo}</span>
            : <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">No confirmation number yet</span>}
          {h.costPence != null && <span className={`text-xs ${muted}`}>{money(h.costPence)}{h.payment ? ` · ${h.payment}` : ""}</span>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <F label="Hotel" v={f.name} on={v => set("name", v)} placeholder="e.g. Premier Inn Leeds City Centre" />
        <F label="Hotel phone" v={f.phone} on={v => set("phone", v)} type="tel" />
        <F label="Booked through" v={f.bookedVia} on={v => set("bookedVia", v)} placeholder="e.g. hotel website, Booking.com, by phone" />
      </div>
      <T label="Hotel address" v={f.address} on={v => set("address", v)} rows={2} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <F label="Check-in" v={f.checkIn} on={v => set("checkIn", v)} type="date" />
        <F label={`Check-out${n != null && n > 0 ? ` (${n} night${n === 1 ? "" : "s"})` : ""}`} v={f.checkOut} on={v => set("checkOut", v)} type="date" />
        <F label="Rooms" v={f.rooms} on={v => set("rooms", v)} placeholder="e.g. 2 singles" />
        <F label="Who's staying" v={f.guests} on={v => set("guests", v)} />
        <F label="Confirmation number" v={f.confirmationNo} on={v => set("confirmationNo", v)} />
        <F label="Cost £" v={f.cost} on={v => set("cost", v)} placeholder="0.00" />
        <div className="sm:col-span-2"><F label="Payment" v={f.payment} on={v => set("payment", v)} placeholder="e.g. paid on the company card, pay on arrival" /></div>
      </div>
      <T label="Hotel notes" v={f.notes} on={v => set("notes", v)} rows={2} placeholder="Parking for the van, late check-in, breakfast included…" />
      {h && (
        <div>
          <span className={label}>Booking confirmation ({h.fileKeys.length})</span>
          <div className="flex flex-wrap items-center gap-2">
            {h.fileKeys.map(k => <Thumb key={k} k={k} onRemove={() => void removeFile(k)} />)}
            <button className={btn} onClick={() => fileRef.current?.click()} disabled={!!progress}>
              {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "⬆ Attach confirmation (PDF or screenshot)"}
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
              onChange={e => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void upload(fs, { bookingId: b.id, hotelId: h.id }) }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className={btnGo} onClick={save} disabled={busy || (!!h && changed.length === 0)}>{busy ? "Saving…" : h ? "Save hotel" : "Add this stay"}</button>
        {h && changed.length > 0 && <button className={btn} onClick={() => setEdits({})} disabled={busy}>Undo</button>}
        {h && changed.length > 0 && <span className="text-xs text-amber-600 dark:text-amber-400">unsaved changes</span>}
        {!h && <span className={`text-xs ${muted}`}>The confirmation file can be attached once the stay is added.</span>}
        <button className={`${btn} ml-auto hover:border-red-500 hover:text-red-500`} onClick={remove} disabled={busy}>{h ? "Remove stay" : "Cancel"}</button>
      </div>
    </div>
  )
}

// ── Notes & history ──────────────────────────────────────────────────────────
const EVENT_ICON: Record<string, string> = { created: "✨", note: "💬", change: "✏️", status: "🔁", pickup: "✋", hotel: "🏨", photo: "📷", file: "📄" }

function History({ b, events, onChanged, onError }: { b: Booking; events: Ev[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [onlyNotes, setOnlyNotes] = useState(false)
  async function add() {
    setBusy(true)
    try { await api("/api/collection-bookings/notes", { bookingId: b.id, text }); setText(""); await onChanged() }
    catch (e: any) { onError(e.message) } finally { setBusy(false) }
  }
  const list = onlyNotes ? events.filter(e => e.kind === "note") : events
  return (
    <div className={`${box} p-4 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={heading}>Notes &amp; history</h3>
        <label className={`flex items-center gap-2 text-sm ${muted} min-h-11 cursor-pointer`}>
          <input type="checkbox" checked={onlyNotes} onChange={e => setOnlyNotes(e.target.checked)} className="w-4 h-4 accent-lime-600" /> Notes only
        </label>
      </div>
      <div className="space-y-2">
        <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className={`${input} resize-y`} placeholder="Add a note — a call with the vendor, what the hotel said, anything the next person should know" />
        <div className="flex justify-end"><button className={btnGo} onClick={add} disabled={busy || !text.trim()}>{busy ? "Saving…" : "Add note"}</button></div>
      </div>
      {list.length === 0 ? <p className={`text-sm ${muted}`}>{onlyNotes ? "No notes yet." : "Nothing yet."}</p> : (
        <ol className="space-y-1.5">
          {list.map(e => (
            <li key={e.id} className={`flex gap-3 text-sm rounded-lg px-3 py-2 ${e.kind === "note" ? "bg-lime-50 dark:bg-lime-950/30 border border-lime-200 dark:border-lime-900" : "border border-gray-200 dark:border-gray-800"}`}>
              <span aria-hidden>{EVENT_ICON[e.kind] ?? "•"}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">{e.text}</span>
                <span className={`block text-xs ${muted}`}>{e.byName || "—"} · {when(e.at)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Everything the driver needs, as plain text to paste into a message or email. */
function driverSheet(b: Booking, vans: Van[]): string {
  const lines: string[] = []
  lines.push(`Collection ${cbRef(b.ref)} — ${dates(b) || "date not set"}`)
  lines.push(`Vendor: ${b.vendorName || "—"}${b.vendorNo ? ` (${b.vendorNo})` : ""}${b.phone ? ` · ${b.phone}` : ""}`)
  lines.push(`Address: ${[b.address.replace(/\s*\r?\n\s*/g, ", "), b.postcode].filter(Boolean).join(", ") || "—"}`)
  if (b.description) lines.push(`Collecting: ${b.description}`)
  if (b.size) lines.push(`How much: ${b.size}`)
  if (b.requirements) lines.push(`Special requirements: ${b.requirements}`)
  lines.push(`Drivers: ${b.drivers.join(", ") || "—"} · Van: ${vanLabel(vans.find(v => v.id === b.vanId)) || "—"}`)
  for (const h of b.hotels) {
    const n = nights(h.checkIn, h.checkOut)
    lines.push("")
    lines.push(`Hotel: ${h.name || "—"}${h.phone ? ` · ${h.phone}` : ""}`)
    if (h.address) lines.push(`  ${h.address.replace(/\s*\r?\n\s*/g, ", ")}`)
    lines.push(`  Check-in ${dayLabel(h.checkIn) || "—"} → check-out ${dayLabel(h.checkOut) || "—"}${n != null && n > 0 ? ` (${n} night${n === 1 ? "" : "s"})` : ""}`)
    lines.push(`  Confirmation: ${h.confirmationNo || "not yet"}${h.rooms ? ` · Rooms: ${h.rooms}` : ""}${h.guests ? ` · Staying: ${h.guests}` : ""}`)
    if (h.notes) lines.push(`  ${h.notes}`)
  }
  return lines.join("\n")
}

function F({ label: l, v, on, type, placeholder }: { label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      <input type={type ?? "text"} value={v} onChange={e => on(e.target.value)} className={input} placeholder={placeholder} />
    </label>
  )
}
function T({ label: l, v, on, rows, placeholder }: { label: string; v: string; on: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      <textarea value={v} onChange={e => on(e.target.value)} rows={rows ?? 2} className={`${input} resize-y`} placeholder={placeholder} />
    </label>
  )
}
