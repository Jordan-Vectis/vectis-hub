"use client"

import { useEffect, useRef, useState } from "react"
import type { SearchResponse, SearchResult, SearchSource } from "@/app/api/website-search/route"
import { useCategoryMap } from "@/lib/use-category-map"
import ThemeToggle from "@/components/theme-toggle"

// 🔎 Website Search — the tablet cataloguing screen's research tool, just left of Lens
// (Jordan, 2026-09-10: "the ultimate search bar to help them research. Our own website's
// search bar is rubbish"). It replaced Description Finder.
//
// One search over three sources, sorted as one list (see /api/website-search):
//   BC  — lots sold through Business Central, with the website's full description, photo and link
//   ABC — lots sold through ABC, 1999–2023
//   Hub — lots catalogued in the Hub that haven't been through a sale yet
//
// A panel, not a page, for the same reason as Lens beside it: a cataloguer opens this mid-lot
// and must not lose the entry in progress. It stays mounted once opened, so closing it and
// coming back keeps the search, the filters and the results.
//
// ⚠ It searches OUR copies — the website refuses the Hub's server — so it is as fresh as the
// last "Update the BC lots" collection from the office.

const ACCENT = "#2AB4A6"

const SOURCES: { key: SearchSource; label: string; long: string; cls: string }[] = [
  { key: "bc",  label: "BC",  long: "sold through Business Central",       cls: "bg-violet-100 dark:bg-violet-500/20 text-violet-800 dark:text-violet-200 border-violet-300 dark:border-violet-400/50" },
  { key: "abc", label: "ABC", long: "sold through ABC, 1999–2023",          cls: "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-400/50" },
  { key: "hub", label: "Hub", long: "catalogued in the Hub, not sold yet", cls: "bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-200 border-sky-300 dark:border-sky-400/50" },
]
const SOURCE = Object.fromEntries(SOURCES.map(s => [s.key, s])) as Record<SearchSource, (typeof SOURCES)[number]>

const SORTS = [
  { key: "newest",      label: "Newest first" },
  { key: "oldest",      label: "Oldest first" },
  { key: "hammer_desc", label: "Hammer: high to low" },
  { key: "hammer_asc",  label: "Hammer: low to high" },
  { key: "est_desc",    label: "Estimate: high to low" },
  { key: "est_asc",     label: "Estimate: low to high" },
]

type Filters = {
  q: string
  phrase: boolean
  /** Numbers match whole — "37" never finds 373 (Jordan, 2026-09-11). On by default. */
  whole: boolean
  without: string
  src: Record<SearchSource, boolean>
  sale: string
  cat: string
  sub: string
  hmin: string
  hmax: string
  emin: string
  emax: string
  yfrom: string
  yto: string
  status: "" | "sold" | "unsold"
  photo: boolean
  order: string
}

const EMPTY: Filters = {
  q: "", phrase: false, whole: true, without: "", src: { bc: true, abc: true, hub: true }, sale: "", cat: "", sub: "",
  hmin: "", hmax: "", emin: "", emax: "", yfrom: "", yto: "", status: "", photo: false, order: "newest",
}

const THIS_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: THIS_YEAR - 1999 + 1 }, (_, i) => String(THIS_YEAR - i))

const gbp = (n: number | null) => (n == null ? null : "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 }))
const fmtDay = (d: string | null) => {
  if (!d) return null
  const x = new Date(d + "T12:00:00Z")
  return isNaN(x.getTime()) ? d : x.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })
}
const estimate = (r: SearchResult) =>
  r.estimateLow == null && r.estimateHigh == null ? null
    : r.estimateLow != null && r.estimateHigh != null ? `${gbp(r.estimateLow)}–${gbp(r.estimateHigh)}`
    : gbp(r.estimateLow ?? r.estimateHigh)
const result = (r: SearchResult) => (r.hammer != null ? gbp(r.hammer) : r.source === "hub" ? "Not sold yet" : "Unsold")
const identLabel: Record<SearchSource, string> = { abc: "LotID", bc: "Unique ID", hub: "Barcode" }

function buildParams(f: Filters, page: number): string {
  const p = new URLSearchParams()
  if (f.q.trim()) p.set("q", f.q.trim())
  if (f.phrase) p.set("phrase", "1")
  p.set("whole", f.whole ? "1" : "0")
  if (f.without.trim()) p.set("without", f.without.trim())
  p.set("src", SOURCES.filter(s => f.src[s.key]).map(s => s.key).join(","))
  for (const k of ["sale", "cat", "sub", "hmin", "hmax", "emin", "emax", "yfrom", "yto", "status"] as const) {
    if (String(f[k]).trim()) p.set(k, String(f[k]).trim())
  }
  if (f.photo) p.set("photo", "1")
  p.set("order", f.order)
  p.set("page", String(page))
  return p.toString()
}

/** How many filters (beyond the search words and the sort) are set — shown on the collapsed filter bar. */
function filterCount(f: Filters): number {
  let n = 0
  if (f.phrase) n++
  if (!f.whole) n++          // on is the default, so only "off" counts as a filter
  if (f.without.trim()) n++
  if (SOURCES.some(s => !f.src[s.key])) n++
  for (const k of ["sale", "cat", "sub", "hmin", "hmax", "emin", "emax", "yfrom", "yto", "status"] as const) if (String(f[k]).trim()) n++
  if (f.photo) n++
  return n
}

const canSearch = (f: Filters) => f.q.trim().length >= 2 || !!f.sale.trim() || !!f.cat

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea")
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand("copy")
    ta.remove()
    return ok
  } catch { return false }
}

// ── Small pieces ────────────────────────────────────────────────────────────────

const input = "w-full min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 text-base text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#2AB4A6] [color-scheme:light] dark:[color-scheme:dark]"
const label = "block text-xs uppercase tracking-wider text-gray-600 dark:text-gray-400 mb-1"

function SourceBadge({ s }: { s: SearchSource }) {
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${SOURCE[s].cls}`}>{SOURCE[s].label}</span>
}

function Tick({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{ touchAction: "manipulation" }}
      className={`min-h-[44px] w-full flex items-center gap-3 rounded-lg border px-3 text-left text-sm transition-colors ${on ? "border-[#2AB4A6] bg-[#2AB4A6]/10 text-gray-900 dark:text-white" : "border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500"}`}>
      <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${on ? "border-[#2AB4A6] bg-[#2AB4A6] text-black" : "border-gray-400 dark:border-gray-500"}`}>{on ? "✓" : ""}</span>
      <span className="flex-1">{children}</span>
    </button>
  )
}

// ── The detail view ─────────────────────────────────────────────────────────────

function Detail({ r, onBack }: { r: SearchResult; onBack: () => void }) {
  const [shown, setShown] = useState(0)
  const [copied, setCopied] = useState<"yes" | "no" | null>(null)
  const pics = r.images.length ? r.images : r.photoFull ? [r.photoFull] : r.photo ? [r.photo] : []
  const big = pics[shown] ?? null
  const rows: [string, string | null][] = [
    ["Sale", r.saleName ? `${r.saleName}${r.saleCode && r.source !== "abc" ? ` (${r.saleCode})` : ""}` : r.saleCode],
    ["Date", fmtDay(r.saleDate)],
    ["Lot", r.lot != null ? String(r.lot) : null],
    ["Estimate", estimate(r)],
    [r.source === "hub" ? "Result" : "Hammer", result(r)],
    ["Website hammer", r.siteHammer != null ? `${gbp(r.siteHammer)} — the website shows a different figure` : null],
    [identLabel[r.source], r.ident],
    ["Category", [r.category, r.subcategory].filter(Boolean).join(" · ") || null],
  ]
  async function copy() {
    const ok = await copyText(r.description)
    setCopied(ok ? "yes" : "no")
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-gray-100 dark:bg-[#0D0D0F]">
      <div className="flex-shrink-0 flex items-center gap-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-4 py-3">
        <button type="button" onClick={onBack} style={{ touchAction: "manipulation", color: ACCENT }} className="min-h-[44px] px-3 -ml-2 text-base font-medium">← Results</button>
        <SourceBadge s={r.source} />
        <span className="min-w-0 flex-1 truncate text-sm text-gray-600 dark:text-gray-400">{SOURCE[r.source].long}</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            {big ? (
              <a href={big} target="_blank" rel="noreferrer" title="Open the full-size photo">
                <img src={big} alt="" className="w-full max-h-[60vh] object-contain rounded-xl bg-black" />
              </a>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-xl bg-white dark:bg-[#1C1C1E] text-gray-500">No photo for this lot</div>
            )}
            {pics.length > 1 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {pics.map((p, i) => (
                  <button key={p} type="button" onClick={() => setShown(i)} style={{ touchAction: "manipulation" }}
                    className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border-2 ${i === shown ? "border-[#2AB4A6]" : "border-transparent"}`}>
                    <img src={p} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            {big && <p className="mt-1 text-xs text-gray-500">Tap the photo to open it full size.</p>}
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={copy} style={{ touchAction: "manipulation", background: ACCENT }}
                className="min-h-[44px] rounded-lg px-4 text-sm font-semibold text-black">
                {copied === "yes" ? "✓ Copied" : copied === "no" ? "Couldn't copy — select the text instead" : "Copy description"}
              </button>
              {r.link ? (
                <a href={r.link} target="_blank" rel="noreferrer" style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
                  className="min-h-[44px] inline-flex items-center rounded-lg px-4 text-sm font-medium">Open on vectis.co.uk ↗</a>
              ) : (
                <span className="min-h-[44px] inline-flex items-center rounded-lg border border-gray-200 dark:border-gray-800 px-4 text-sm text-gray-500">
                  {r.source === "hub" ? "Not on the website yet" : "No website link recorded"}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-base leading-relaxed text-gray-900 dark:text-gray-100 select-text">{r.description}</p>
            <dl className="divide-y divide-gray-200 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800">
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8rem_1fr] gap-3 px-3 py-2 text-sm">
                  <dt className="text-gray-600 dark:text-gray-400">{k}</dt>
                  <dd className="break-words text-gray-900 dark:text-gray-100">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The button and the panel ────────────────────────────────────────────────────

export default function WebsiteSearchButton({ tablet = false }: { tablet?: boolean }) {
  const categoryMap = useCategoryMap()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<Filters>(EMPTY)
  const [showFilters, setShowFilters] = useState(true)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [counts, setCounts] = useState<SearchResponse["counts"]>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [corrections, setCorrections] = useState<SearchResponse["corrections"]>([])
  const [spelling, setSpelling] = useState<SearchResponse["spelling"] | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState<{ since: number; more: boolean } | null>(null)
  const [now, setNow] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const [detail, setDetail] = useState<SearchResult | null>(null)
  /** The filters the shown results were searched with — "Show more" must page THOSE, not whatever has been edited since. */
  const searched = useRef<Filters | null>(null)
  const ctl = useRef<AbortController | null>(null)
  const qRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF(prev => ({ ...prev, [k]: v }))

  // A number that moves while it searches (RULES.md 7b), so a slow search never looks stuck.
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (detail) setDetail(null)
      else setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, detail])

  // Lens beside it hands a search over ("See every match in Website Search"): open with that
  // search, everything else back to the defaults, and run it straight away.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = String((e as CustomEvent<{ q?: string }>).detail?.q ?? "").trim()
      if (!q) return
      const next: Filters = { ...EMPTY, q }
      setF(next)
      setDetail(null)
      setMounted(true)
      setOpen(true)
      void run(next, 1)
    }
    window.addEventListener("hub:website-search", onAsk)
    return () => window.removeEventListener("hub:website-search", onAsk)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => ctl.current?.abort(), [])

  async function run(filters: Filters, pageNo: number) {
    if (!canSearch(filters)) { setError("Type a word or two to search for (or pick a sale or a category)."); return }
    if (!SOURCES.some(s => filters.src[s.key])) { setError("Tick at least one of BC, ABC or Hub."); return }
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    setBusy({ since: Date.now(), more: pageNo > 1 })
    setNow(Date.now())
    setError(null)
    setStopped(false)
    try {
      const res = await fetch(`/api/website-search?${buildParams(filters, pageNo)}`, { signal: c.signal, cache: "no-store" })
      const j = (await res.json().catch(() => null)) as (SearchResponse & { error?: string }) | null
      if (!res.ok || !j || !Array.isArray(j.results)) throw new Error(j?.error ?? `The search didn't work (error ${res.status}).`)
      searched.current = filters
      if (pageNo === 1) {
        setResults(j.results)
        setCounts(j.counts)
        setNotes(j.notes ?? [])
        setCorrections(Array.isArray(j.corrections) ? j.corrections : [])
        setSpelling(j.spelling ?? null)
        setShowFilters(false)
      } else {
        setResults(prev => [...(prev ?? []), ...j.results])
      }
      setPage(pageNo)
      setHasMore(j.hasMore)
    } catch (e) {
      if (c.signal.aborted) return
      setError(e instanceof Error ? e.message : "The search didn't work.")
    } finally {
      if (ctl.current === c) { ctl.current = null; setBusy(null) }
    }
  }

  function stop() {
    ctl.current?.abort()
    ctl.current = null
    setBusy(null)
    setStopped(true)
  }

  const submit = (e?: React.FormEvent) => { e?.preventDefault(); qRef.current?.blur(); void run(f, 1) }
  const reSort = (order: string) => {
    const next = { ...f, order }
    setF(next)
    if (searched.current) void run({ ...searched.current, order }, 1)
  }

  const total = counts ? counts.abc + counts.bc + counts.hub : null
  const active = filterCount(f)
  const secs = busy ? Math.max(0, Math.floor((now - busy.since) / 1000)) : 0
  const cats = Object.keys(categoryMap).sort()
  const subs = f.cat ? (categoryMap[f.cat] ?? []) : []

  const filtersPanel = (
    <div className="space-y-4">
      <div>
        <span className={label}>Search in</span>
        <div className="space-y-2">
          {SOURCES.map(s => (
            <Tick key={s.key} on={f.src[s.key]} onClick={() => set("src", { ...f.src, [s.key]: !f.src[s.key] })}>
              <SourceBadge s={s.key} /> <span className="ml-1">{s.long}</span>
            </Tick>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2"><label className={label} htmlFor="ws-sale">Sale — name or code</label>
          <input id="ws-sale" value={f.sale} onChange={e => set("sale", e.target.value)} placeholder="e.g. F111 or Teddy Bear" className={input} /></div>
        <div><label className={label} htmlFor="ws-yfrom">From year</label>
          <select id="ws-yfrom" value={f.yfrom} onChange={e => set("yfrom", e.target.value)} className={input}>
            <option value="">Any</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
        <div><label className={label} htmlFor="ws-yto">To year</label>
          <select id="ws-yto" value={f.yto} onChange={e => set("yto", e.target.value)} className={input}>
            <option value="">Any</option>{YEARS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
        <div><label className={label} htmlFor="ws-hmin">Hammer from £</label>
          <input id="ws-hmin" value={f.hmin} onChange={e => set("hmin", e.target.value)} inputMode="numeric" placeholder="0" className={input} /></div>
        <div><label className={label} htmlFor="ws-hmax">Hammer to £</label>
          <input id="ws-hmax" value={f.hmax} onChange={e => set("hmax", e.target.value)} inputMode="numeric" placeholder="Any" className={input} /></div>
        <div><label className={label} htmlFor="ws-emin">Estimate from £</label>
          <input id="ws-emin" value={f.emin} onChange={e => set("emin", e.target.value)} inputMode="numeric" placeholder="0" className={input} /></div>
        <div><label className={label} htmlFor="ws-emax">Estimate to £</label>
          <input id="ws-emax" value={f.emax} onChange={e => set("emax", e.target.value)} inputMode="numeric" placeholder="Any" className={input} /></div>
        <div className="col-span-2"><label className={label} htmlFor="ws-status">Result</label>
          <select id="ws-status" value={f.status} onChange={e => set("status", e.target.value as Filters["status"])} className={input}>
            <option value="">Sold, unsold and not sold yet</option>
            <option value="sold">Sold only</option>
            <option value="unsold">Unsold only</option>
          </select></div>
        <div className="col-span-2"><label className={label} htmlFor="ws-cat">Category</label>
          <select id="ws-cat" value={f.cat} onChange={e => setF(prev => ({ ...prev, cat: e.target.value, sub: "" }))} className={input}>
            <option value="">Any category</option>{cats.map(c => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></div>
        <div className="col-span-2"><label className={label} htmlFor="ws-sub">Subcategory</label>
          <select id="ws-sub" value={f.sub} onChange={e => set("sub", e.target.value)} disabled={!f.cat} className={`${input} disabled:opacity-40`}>
            <option value="">{f.cat ? "Any subcategory" : "Pick a category first"}</option>{subs.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
        <div className="col-span-2"><label className={label} htmlFor="ws-without">Leave out lots mentioning</label>
          <input id="ws-without" value={f.without} onChange={e => set("without", e.target.value)} placeholder="e.g. reproduction damaged" className={input} /></div>
      </div>
      <div className="space-y-2">
        <Tick on={f.phrase} onClick={() => set("phrase", !f.phrase)}>Match the exact phrase, not just the words</Tick>
        <Tick on={f.whole} onClick={() => set("whole", !f.whole)}>Whole numbers only — “37” won&apos;t find 373 or 3714</Tick>
        <Tick on={f.photo} onClick={() => set("photo", !f.photo)}>Only lots with a photo</Tick>
      </div>
      <p className="text-xs leading-relaxed text-gray-500">
        Hammer and sold/unsold leave out Hub lots (not sold yet); a category leaves out ABC lots (they have none).
        Every word you type must appear in the lot&apos;s description (or its ID). Accents, capitals and punctuation
        don&apos;t matter, plurals count, and a misspelt word also searches the real spelling — the results say when.
      </p>
      <div className="flex gap-2">
        <button type="submit" disabled={!!busy} style={{ background: ACCENT, touchAction: "manipulation" }}
          className="min-h-[44px] flex-1 rounded-lg px-4 text-sm font-semibold text-black disabled:opacity-50">Search</button>
        <button type="button" onClick={() => setF(prev => ({ ...EMPTY, q: prev.q, order: prev.order }))} style={{ touchAction: "manipulation" }}
          className="min-h-[44px] rounded-lg border border-gray-300 dark:border-gray-700 px-4 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500">Clear filters</button>
      </div>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => { setMounted(true); setOpen(true); setTimeout(() => qRef.current?.focus(), 50) }}
        style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
        className={`flex-shrink-0 rounded-lg font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${tablet ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"}`}
      >
        🔎 Website Search
      </button>

      {mounted && (
        <div className={`fixed inset-0 z-50 flex flex-col bg-gray-100 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100 ${open ? "" : "hidden"}`} role="dialog" aria-modal="true" aria-label="Website Search">
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            {/* Header: the search box is always on screen. */}
            <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="hidden text-lg font-bold sm:block" style={{ color: ACCENT }}>🔎 Website Search</h2>
                <input ref={qRef} value={f.q} onChange={e => set("q", e.target.value)} enterKeyHint="search" autoComplete="off"
                  placeholder="Search every lot — e.g. Dinky 105, Steiff Teddy, Corgi Batmobile, F073116" aria-label="Search words"
                  className="min-h-[48px] min-w-0 flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#141416] px-4 text-base text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#2AB4A6]" />
                {busy ? (
                  <button type="button" onClick={stop} style={{ touchAction: "manipulation" }}
                    className="min-h-[48px] flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-600 px-4 text-sm font-semibold text-gray-800 dark:text-gray-200">■ Stop</button>
                ) : (
                  <button type="submit" style={{ background: ACCENT, touchAction: "manipulation" }}
                    className="min-h-[48px] flex-shrink-0 rounded-lg px-5 text-sm font-semibold text-black">Search</button>
                )}
                {/* Light/dark (Jordan, 2026-09-11) — this panel covers the tablet header's switch. */}
                <ThemeToggle size="lg" />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close Website Search" style={{ touchAction: "manipulation" }}
                  className="min-h-[48px] flex-shrink-0 rounded-lg border border-gray-300 dark:border-gray-700 px-4 text-sm text-gray-700 dark:text-gray-300">✕ Close</button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              {/* Filters — beside the results on a landscape iPad, above them in portrait (folded away after a search). */}
              <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 lg:w-[22rem] lg:overflow-y-auto lg:border-b-0 lg:border-r">
                <button type="button" onClick={() => setShowFilters(s => !s)} style={{ touchAction: "manipulation" }}
                  className="flex min-h-[44px] w-full items-center justify-between px-4 text-sm text-gray-700 dark:text-gray-300 lg:hidden">
                  <span>Filters{active ? ` (${active} set)` : ""}</span><span>{showFilters ? "▲ Hide" : "▼ Show"}</span>
                </button>
                <div className={`${showFilters ? "block" : "hidden"} max-h-[45vh] overflow-y-auto px-4 pb-4 lg:block lg:max-h-none lg:py-4`}>
                  {filtersPanel}
                </div>
              </div>

              {/* Results */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" style={{ WebkitOverflowScrolling: "touch" }}>
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 text-sm text-gray-700 dark:text-gray-300" aria-live="polite">
                    {busy ? (
                      <span style={{ color: ACCENT }}>{busy.more ? "Loading more" : "Searching every lot"}… {secs} s</span>
                    ) : error ? (
                      <span className="text-red-600 dark:text-red-400">{error}</span>
                    ) : stopped ? (
                      <span className="text-gray-600 dark:text-gray-400">Stopped.{results ? " The last results are still shown." : ""}</span>
                    ) : total != null && results ? (
                      <span>
                        <b className="text-gray-900 dark:text-white">{total.toLocaleString("en-GB")}</b> {total === 1 ? "lot" : "lots"}
                        {counts && <span className="text-gray-600 dark:text-gray-400"> — BC {counts.bc.toLocaleString("en-GB")} · ABC {counts.abc.toLocaleString("en-GB")} · Hub {counts.hub.toLocaleString("en-GB")}</span>}
                        {results.length < total && <span className="text-gray-500"> · showing {results.length.toLocaleString("en-GB")}</span>}
                      </span>
                    ) : null}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <span className="flex-shrink-0">Sort</span>
                    <select value={f.order} onChange={e => reSort(e.target.value)} className={`${input} w-auto`} aria-label="Sort the results">
                      {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </label>
                </div>

                {/* The key for the source colours (RULES.md: every colour has a key). */}
                <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {SOURCES.map(s => <span key={s.key} className="inline-flex items-center gap-1.5"><SourceBadge s={s.key} /> {s.long}</span>)}
                </p>

                {notes.map(n => <p key={n} className="mb-2 rounded-lg border border-amber-300 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{n}</p>)}

                {/* Say when numbers were matched whole — a Class 373 that doesn't appear must never be a mystery. */}
                {results && !busy && searched.current?.whole && /\d/.test(searched.current.q) && (
                  <p className="mb-2 text-xs text-gray-500">
                    Numbers are matched whole — “37” won&apos;t find 373 or 3714. Untick “Whole numbers only” in the filters to include them.
                  </p>
                )}

                {/* Say what the smarter matching did, so a lot found by a corrected spelling is never a mystery. */}
                {corrections.length > 0 && !busy && (
                  <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                    Also searched for{" "}
                    {corrections.map((c, i) => (
                      <span key={c.typed}>{i ? " · " : ""}<b className="text-gray-900 dark:text-gray-100">{c.also.join(" / ")}</b> (you typed “{c.typed}”)</span>
                    ))}
                  </p>
                )}
                {spelling === "building" && !busy && (
                  <p className="mb-2 text-xs text-gray-500">Spelling help is being set up (first time only, a few minutes) — until then a misspelt word won&apos;t find the right one.</p>
                )}

                {results === null && !busy && !error && (
                  <div className="mx-auto max-w-xl py-12 text-center text-gray-600 dark:text-gray-400">
                    <p className="text-base text-gray-800 dark:text-gray-200">Search every lot we&apos;ve sold since 1999, and every lot catalogued in the Hub.</p>
                    <p className="mt-2 text-sm">Photos, hammer prices, the full description and the link to the lot on vectis.co.uk. Tap a lot for the details and to copy its description.</p>
                    <p className="mt-4 text-xs text-gray-500">Searches the Hub&apos;s copy of the website — it&apos;s as up to date as the last BC lots collection.</p>
                  </div>
                )}

                {results && results.length === 0 && !busy && (
                  <p className="py-10 text-center text-gray-600 dark:text-gray-400">Nothing matches. Try fewer words, or loosen a filter.</p>
                )}

                {results && results.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {results.map(r => (
                      <button key={`${r.source}-${r.id}`} type="button" onClick={() => setDetail(r)} style={{ touchAction: "manipulation" }}
                        className="flex gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-3 text-left hover:border-gray-400 dark:hover:border-gray-600">
                        {r.photo ? (
                          <img src={r.photo} alt="" loading="lazy" className="h-24 w-24 flex-shrink-0 rounded-lg bg-black object-cover" />
                        ) : (
                          <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-[#141416] text-xs text-gray-600">No photo</div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <SourceBadge s={r.source} />
                            <span className={`text-base font-bold ${r.hammer != null ? "text-gray-900 dark:text-white" : "text-gray-500 text-sm font-medium"}`}>{result(r)}</span>
                          </div>
                          <p className="mt-1 line-clamp-3 text-sm text-gray-800 dark:text-gray-200">{r.description}</p>
                          <p className="mt-1 truncate text-xs text-gray-500">
                            {[fmtDay(r.saleDate), r.saleName, r.lot != null ? `Lot ${r.lot}` : null].filter(Boolean).join(" · ")}
                          </p>
                          {estimate(r) && <p className="text-xs text-gray-500">Estimate {estimate(r)}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {results && hasMore && (
                  <div className="py-4 text-center">
                    <button type="button" disabled={!!busy} onClick={() => searched.current && void run(searched.current, page + 1)} style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
                      className="min-h-[44px] rounded-lg px-6 text-sm font-medium disabled:opacity-50">
                      {busy?.more ? `Loading… ${secs} s` : "Show 30 more"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </form>

          {detail && <Detail r={detail} onBack={() => setDetail(null)} />}
        </div>
      )}
    </>
  )
}
