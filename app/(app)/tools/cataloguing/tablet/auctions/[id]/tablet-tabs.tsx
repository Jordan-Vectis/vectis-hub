"use client"

import { useState, useTransition, useRef, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  updateLot,
  deleteLot,
  uploadLotPhoto,
  deleteLotPhoto,
} from "@/lib/actions/catalogue"
import LotWizardTab, { CATEGORY_MAP, BRANDS_LIST } from "../../../auctions/[id]/lot-wizard-tab"
import PhotoOnlyTab from "../../../auctions/[id]/photo-only-tab"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "manage" | "add-lot" | "photo-only"

interface Auction {
  id: string
  code: string
  name: string
}

interface Lot {
  id: string
  lotNumber: string
  barcode: string | null
  title: string
  keyPoints: string
  description: string
  estimateLow: number | null
  estimateHigh: number | null
  condition: string | null
  vendor: string | null
  tote: string | null
  receipt: string | null
  category: string | null
  subCategory: string | null
  brand: string | null
  notes: string | null
  status: string
  imageUrls: string[]
  createdAt: string   // ISO string
}

type SortKey = "lot-asc" | "newest" | "oldest"

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Good Plus", "Good", "Fair", "Poor"]
const STATUSES   = ["ENTERED", "REVIEWED", "PUBLISHED", "SOLD", "UNSOLD", "WITHDRAWN"]
const PARCEL_OPTIONS = ["Small", "Medium", "Large", "Contact", "Collection Only"]

const STATUS_STYLES: Record<string, string> = {
  ENTERED:   "bg-gray-700 text-gray-300",
  REVIEWED:  "bg-blue-900/50 text-blue-300",
  PUBLISHED: "bg-green-900/50 text-green-300",
  SOLD:      "bg-emerald-900/50 text-emerald-300",
  UNSOLD:    "bg-red-900/50 text-red-300",
  WITHDRAWN: "bg-orange-900/50 text-orange-300",
}

const ACCENT = "#2AB4A6"

const inp = "w-full rounded-xl border border-gray-700 bg-[#2C2C2E] px-4 py-3.5 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
const lbl = "block text-sm font-semibold uppercase tracking-wider text-gray-400 mb-2"

// ─── Root component ───────────────────────────────────────────────────────────

export default function TabletTabs({ auction, lots, showScanTimer, timerYellowMins, timerRedMins }: { auction: Auction; lots: Lot[]; showScanTimer?: boolean; timerYellowMins?: number; timerRedMins?: number }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("manage")
  const [editingLotId, setEditingLotId] = useState<string | null>(null)
  const [navDir, setNavDir] = useState<"next" | "prev" | null>(null)
  const editingLot = lots.find(l => l.id === editingLotId) ?? null

  return (
    <div
      className="flex flex-col bg-[#141416]"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        WebkitOverflowScrolling: "touch" as any,
      }}
    >

      {/* Header bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-4 border-b border-gray-800 bg-[#1C1C1E]">
        <button
          onClick={() => router.push("/tools/cataloguing/tablet/auctions")}
          className="text-[#2AB4A6] text-lg font-medium p-2 -ml-2"
          style={{ touchAction: "manipulation" }}
        >
          ←
        </button>
        <div className="min-w-0 flex-1">
          <span className="font-mono font-bold text-[#2AB4A6] text-lg">{auction.code}</span>
          <span className="text-gray-400 text-base ml-2 truncate">{auction.name}</span>
        </div>
        <span className="text-sm text-gray-500 flex-shrink-0">{lots.length} lots</span>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-700 bg-[#1C1C1E]">
        {([
          { id: "manage",    label: `Lots (${lots.length})` },
          { id: "add-lot",   label: "Add Lot" },
          { id: "photo-only", label: "Photo Only" },
        ] as { id: Tab; label: string }[]).map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setEditingLotId(null) }}
            style={{ touchAction: "manipulation" }}
            className={`flex-1 py-5 text-base font-semibold border-b-2 transition-colors ${
              tab === t.id
                ? "border-[#2AB4A6] text-[#2AB4A6]"
                : "border-transparent text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {/* Manage Lots */}
        {tab === "manage" && (
          editingLotId
            ? <TabletLotEdit
                key={editingLotId}
                lot={editingLot}
                allLots={lots}
                auctionId={auction.id}
                entryDir={navDir}
                onDone={() => { setNavDir(null); setEditingLotId(null); router.refresh() }}
                onNavigate={(id, dir) => { setNavDir(dir); setEditingLotId(id) }}
              />
            : <TabletManageLots
                lots={lots}
                auctionId={auction.id}
                onEdit={setEditingLotId}
                onDelete={() => { router.refresh() }}
              />
        )}

        {/* Add Lot — hidden not unmounted so state persists on tab switch */}
        <div className={tab === "add-lot" ? "h-full" : "hidden"}>
          <div className="p-4 h-full">
            <LotWizardTab
              auctionId={auction.id}
              auction={auction}
              onCreated={() => router.refresh()}
              tablet
              showScanTimer={showScanTimer}
              timerYellowMins={timerYellowMins}
              timerRedMins={timerRedMins}
            />
          </div>
        </div>

        {/* Photo Only */}
        {tab === "photo-only" && (
          <div className="p-4">
            <PhotoOnlyTab
              auctionId={auction.id}
              auctionCode={auction.code}
              onCreated={() => router.refresh()}
              tablet
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manage lots — card list ──────────────────────────────────────────────────

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "lot-asc", label: "Lot No." },
  { key: "newest",  label: "Newest"  },
  { key: "oldest",  label: "Oldest"  },
]

function TabletManageLots({ lots, auctionId, onEdit, onDelete }: {
  lots: Lot[]
  auctionId: string
  onEdit: (id: string) => void
  onDelete: () => void
}) {
  const [search,  setSearch]  = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("lot-asc")
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    const result = q
      ? lots.filter(l =>
          l.lotNumber.toLowerCase().includes(q) ||
          (l.barcode ?? "").toLowerCase().includes(q) ||
          l.title.toLowerCase().includes(q) ||
          (l.vendor ?? "").toLowerCase().includes(q) ||
          (l.tote ?? "").toLowerCase().includes(q)
        )
      : lots

    return [...result].sort((a, b) => {
      if (sortKey === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sortKey === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      // lot-asc: numeric then alpha
      const an = parseInt(a.lotNumber, 10)
      const bn = parseInt(b.lotNumber, 10)
      if (!isNaN(an) && !isNaN(bn)) return an - bn
      return a.lotNumber.localeCompare(b.lotNumber)
    })
  }, [lots, search, sortKey])

  async function handleDelete(lot: Lot) {
    if (!confirm(`Delete lot ${lot.lotNumber}?`)) return
    setDeleting(lot.id)
    start(async () => {
      await deleteLot(lot.id, auctionId)
      setDeleting(null)
      onDelete()
    })
  }

  if (lots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
        <span className="text-5xl mb-4">📦</span>
        <p className="text-gray-400 font-medium">No lots yet</p>
        <p className="text-gray-600 text-sm mt-1">Use Add Lot or Photo Only to get started</p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-3">
      {/* Search + sort */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search lots…"
        className="w-full rounded-xl border border-gray-700 bg-[#2C2C2E] px-4 py-3 text-base text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
      />

      {/* Sort chips */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600 font-medium shrink-0">Sort:</span>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            type="button"
            style={{ touchAction: "manipulation" }}
            onClick={() => setSortKey(opt.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              sortKey === opt.key
                ? "bg-[#2AB4A6] text-[#1C1C1E] border-[#2AB4A6]"
                : "bg-[#2C2C2E] text-gray-400 border-gray-700 active:bg-[#3C3C3E]"
            }`}
          >
            {opt.label}
          </button>
        ))}
        {search && (
          <span className="text-xs text-gray-500 ml-auto">{filtered.length} of {lots.length}</span>
        )}
      </div>

      {/* Lot cards */}
      {filtered.map(lot => (
        <div
          key={lot.id}
          className="bg-[#1C1C1E] border border-gray-700 rounded-2xl overflow-hidden"
        >
          {/* Tap area */}
          <button
            className="w-full text-left px-4 pt-4 pb-3 active:bg-[#2C2C2E] transition-colors"
            style={{ touchAction: "manipulation" }}
            onClick={() => onEdit(lot.id)}
          >
            <div className="flex items-start gap-3 mb-2">
              <span className="font-mono font-bold text-[#2AB4A6] text-xl leading-none">
                {lot.lotNumber || "—"}
              </span>
              <span className={`ml-auto text-sm px-3 py-1 rounded-full font-medium flex-shrink-0 ${STATUS_STYLES[lot.status] ?? "bg-gray-700 text-gray-300"}`}>
                {lot.status}
              </span>
            </div>

            <p className="text-white font-medium text-base leading-snug mb-2">
              {lot.title || <span className="text-gray-600 italic">Uncatalogued</span>}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-gray-400">
              {lot.barcode && <span className="font-mono">{lot.barcode}</span>}
              {lot.vendor  && <span>Vendor: {lot.vendor}</span>}
              {lot.tote    && <span>Tote: {lot.tote}</span>}
              {lot.estimateLow && lot.estimateHigh && (
                <span>£{lot.estimateLow}–£{lot.estimateHigh}</span>
              )}
              {lot.imageUrls.length > 0 && (
                <span className="text-[#2AB4A6]">📷 {lot.imageUrls.length}</span>
              )}
            </div>
          </button>

          {/* Delete button */}
          <div className="px-4 pb-3 flex justify-end">
            <button
              onClick={() => handleDelete(lot)}
              disabled={deleting === lot.id || pending}
              style={{ touchAction: "manipulation" }}
              className="text-sm text-red-500 hover:text-red-400 py-3 px-4 disabled:opacity-40"
            >
              {deleting === lot.id ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Lot edit ─────────────────────────────────────────────────────────────────

function TabletLotEdit({ lot, allLots, auctionId, entryDir, onDone, onNavigate }: {
  lot: Lot | null
  allLots: Lot[]
  auctionId: string
  entryDir?: "next" | "prev" | null
  onDone: () => void
  onNavigate: (id: string, dir: "next" | "prev") => void
}) {
  // Sorted list matches the manage-lots sort order
  const sortedLots = useMemo(() => [...allLots].sort((a, b) => {
    const an = parseInt(a.lotNumber, 10)
    const bn = parseInt(b.lotNumber, 10)
    if (!isNaN(an) && !isNaN(bn)) return an - bn
    return a.lotNumber.localeCompare(b.lotNumber)
  }), [allLots])

  const currentIdx = sortedLots.findIndex(l => l.id === lot?.id)
  const prevLot    = currentIdx > 0 ? sortedLots[currentIdx - 1] : null
  const nextLot    = currentIdx < sortedLots.length - 1 ? sortedLots[currentIdx + 1] : null
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [imageKeys, setImageKeys] = useState<string[]>(lot?.imageUrls ?? [])
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollRef  = useRef<HTMLDivElement>(null)

  // Slide-in animation on mount
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const startX = entryDir === "next" ? "60px" : entryDir === "prev" ? "-60px" : "0"
    el.style.transform = `translateX(${startX})`
    el.style.opacity = "0"
    requestAnimationFrame(() => {
      el.style.transition = "transform 220ms cubic-bezier(0.25,0.46,0.45,0.94), opacity 180ms ease"
      el.style.transform = "translateX(0)"
      el.style.opacity = "1"
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function navigate(id: string, dir: "next" | "prev") {
    const el = contentRef.current
    if (!el) { onNavigate(id, dir); return }
    const endX = dir === "next" ? "-60px" : "60px"
    el.style.transition = "transform 180ms cubic-bezier(0.55,0,1,0.45), opacity 160ms ease"
    el.style.transform = `translateX(${endX})`
    el.style.opacity = "0"
    setTimeout(() => onNavigate(id, dir), 185)
  }

  const [titleVal, setTitleVal] = useState(lot?.title ?? "")

  // Condition
  const condParts = (lot?.condition ?? "").split(" to ")
  const [cond1, setCond1] = useState(condParts[0] ?? "")
  const [cond2, setCond2] = useState(condParts[1] ?? "")
  const condValue = [cond1, cond2]
    .filter(Boolean)
    .sort((a, b) => CONDITIONS.indexOf(b) - CONDITIONS.indexOf(a))
    .join(" to ")

  // Parcel
  const [parcel, setParcel] = useState(lot?.notes ?? "")

  // Category
  const [mainCat, setMainCat] = useState(lot?.category ?? "")
  const [subCat,  setSubCat]  = useState(lot?.subCategory ?? "")
  const [brand,   setBrand]   = useState(lot?.brand ?? "")
  const mainCatList = Object.keys(CATEGORY_MAP).sort()
  const subCatList  = mainCat ? (CATEGORY_MAP[mainCat] ?? []) : []

  // Load signed photo URLs
  useEffect(() => {
    if (!lot || imageKeys.length === 0) return
    const missing = imageKeys.filter(k => !signedUrls[k])
    if (missing.length === 0) return
    Promise.all(
      missing.map(async key => {
        const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
        const { url } = await res.json()
        return [key, url] as [string, string]
      })
    ).then(results =>
      setSignedUrls(prev => ({ ...prev, ...Object.fromEntries(results) }))
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKeys])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !lot) return
    e.target.value = ""
    setUploadingPhoto(true)
    try {
      const fd = new FormData()
      fd.set("photo", file)
      const updated = await uploadLotPhoto(lot.id, auctionId, fd)
      setImageKeys(updated)
    } finally { setUploadingPhoto(false) }
  }

  async function handlePhotoDelete(key: string) {
    if (!lot || !confirm("Remove this photo?")) return
    const updated = await deleteLotPhoto(lot.id, auctionId, key)
    setImageKeys(updated)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!lot) return
    const fd = new FormData(e.currentTarget)
    // Override condition and notes (parcel) since they're managed via state
    fd.set("condition", condValue)
    fd.set("notes", parcel)
    fd.set("category", mainCat)
    fd.set("subCategory", subCat)
    fd.set("brand", brand)
    start(async () => {
      await updateLot(lot.id, auctionId, fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  if (!lot) return null

  return (
    <div ref={scrollRef} className="pb-8">
      {/* Sticky nav bar: Back · counter · Prev · Next */}
      <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 bg-[#141416] border-b border-gray-800">
        <button
          onClick={onDone}
          style={{ touchAction: "manipulation" }}
          className="text-[#2AB4A6] text-sm font-medium py-2 pr-3 flex-shrink-0"
        >
          ← Back
        </button>
        <span className="text-xs text-gray-600 flex-1 text-center">
          {currentIdx + 1} / {sortedLots.length}
        </span>
        <button
          type="button"
          onClick={() => prevLot && navigate(prevLot.id, "prev")}
          disabled={!prevLot}
          style={{ touchAction: "manipulation" }}
          className="px-4 py-2.5 rounded-xl border border-gray-700 text-gray-300 text-sm font-semibold disabled:opacity-25 active:bg-[#2C2C2E] flex-shrink-0"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => nextLot && navigate(nextLot.id, "next")}
          disabled={!nextLot}
          style={{ touchAction: "manipulation", background: nextLot ? ACCENT : "#2C2C2E", color: nextLot ? "#1C1C1E" : "#6b7280" }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-25 flex-shrink-0"
        >
          Next →
        </button>
      </div>

      {/* Animated content */}
      <div ref={contentRef} className="p-4 pt-5">

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Title */}
        <div>
          <label className={lbl}>Title</label>
          <input
            name="title"
            value={titleVal}
            onChange={e => setTitleVal(e.target.value)}
            className={inp}
          />
        </div>

        {/* Lot number / barcode */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Lot No.</label>
            <input name="lotNumber" defaultValue={lot.lotNumber} className={inp} />
          </div>
          <div>
            <label className={lbl}>Barcode</label>
            <input name="barcode" defaultValue={lot.barcode ?? ""} className={`${inp} font-mono`} />
          </div>
        </div>

        {/* Vendor / Tote / Receipt */}
        <div>
          <label className={lbl}>Vendor</label>
          <input name="vendor" defaultValue={lot.vendor ?? ""} className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Tote</label>
            <input name="tote" defaultValue={lot.tote ?? ""} className={`${inp} font-mono`} />
          </div>
          <div>
            <label className={lbl}>Receipt</label>
            <input name="receipt" defaultValue={lot.receipt ?? ""} className={inp} />
          </div>
        </div>

        {/* Key Points */}
        <div>
          <label className={lbl}>Key Points</label>
          <textarea
            name="keyPoints"
            defaultValue={lot.keyPoints}
            rows={4}
            className={`${inp} resize-none`}
          />
        </div>
        {/* Description */}
        <div>
          <label className={lbl}>Description</label>
          <textarea
            name="description"
            defaultValue={lot.description}
            rows={4}
            className={`${inp} resize-none`}
          />
        </div>

        {/* Estimate */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Est. Low £</label>
            <input name="estimateLow" defaultValue={lot.estimateLow ?? ""} type="number" className={inp} />
          </div>
          <div>
            <label className={lbl}>Est. High £</label>
            <input name="estimateHigh" defaultValue={lot.estimateHigh ?? ""} type="number" className={inp} />
          </div>
        </div>

        {/* Category */}
        <div>
          <label className={lbl}>Category</label>
          <select
            value={mainCat}
            onChange={e => { setMainCat(e.target.value); setSubCat("") }}
            className={inp}
          >
            <option value="">— Select —</option>
            {mainCatList.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {mainCat && subCatList.length > 0 && (
          <div>
            <label className={lbl}>Sub-Category</label>
            <select
              value={subCat}
              onChange={e => setSubCat(e.target.value)}
              className={inp}
            >
              <option value="">— Select —</option>
              {subCatList.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {/* Brand */}
        <div>
          <label className={lbl}>Brand</label>
          <input
            value={brand}
            onChange={e => setBrand(e.target.value)}
            list="tablet-brands"
            className={inp}
            placeholder="Search brand…"
          />
          <datalist id="tablet-brands">
            {BRANDS_LIST.map(b => <option key={b} value={b} />)}
          </datalist>
        </div>

        {/* Condition */}
        <div>
          <label className={lbl}>Condition</label>
          <div className="grid grid-cols-2 gap-2">
            <select value={cond1} onChange={e => setCond1(e.target.value)} className={inp}>
              <option value="">—</option>
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={cond2} onChange={e => setCond2(e.target.value)} className={inp}>
              <option value="">— to —</option>
              {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {condValue && (
            <p className="text-sm text-[#2AB4A6] mt-2 px-1">Condition: {condValue}</p>
          )}
        </div>

        {/* Parcel size */}
        <div>
          <label className={lbl}>Parcel Size</label>
          <div className="flex flex-wrap gap-2">
            {PARCEL_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setParcel(v => v === opt ? "" : opt)}
                className="px-4 py-3 rounded-xl text-sm font-medium transition-colors"
                style={{ touchAction: "manipulation",
                  background: parcel === opt ? ACCENT : "#2C2C2E",
                  color: parcel === opt ? "#1C1C1E" : "#d1d5db",
                  border: `1px solid ${parcel === opt ? ACCENT : "#374151"}`,
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {/* Status */}
        <div>
          <label className={lbl}>Status</label>
          <select name="status" defaultValue={lot.status} className={inp}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Save */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={pending}
            className="w-full py-4 rounded-xl font-bold text-base transition-colors disabled:opacity-50"
            style={{ background: ACCENT, color: "#1C1C1E", touchAction: "manipulation" }}
          >
            {pending ? "Saving…" : saved ? "✓ Saved" : "Save Changes"}
          </button>
        </div>

      </form>

      {/* Photos — at bottom so they don't push the form fields down */}
      <div className="bg-[#1C1C1E] border border-gray-700 rounded-2xl p-4 mt-5">
        <p className={lbl}>Photos {imageKeys.length > 0 && <span className="text-[#2AB4A6]">({imageKeys.length})</span>}</p>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePhotoUpload}
        />
        <button
          type="button"
          onClick={() => photoRef.current?.click()}
          disabled={uploadingPhoto}
          style={{ touchAction: "manipulation" }}
          className="w-full py-4 rounded-xl border-2 border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] transition-colors flex items-center justify-center gap-2 mb-3 disabled:opacity-50"
        >
          <span className="text-2xl">📷</span>
          <span className="font-medium">{uploadingPhoto ? "Uploading…" : "Take / add photo"}</span>
        </button>

        {imageKeys.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {imageKeys.map((key, i) => (
              <div key={key} className="relative aspect-square">
                {signedUrls[key] ? (
                  <img
                    src={signedUrls[key]}
                    alt={`Photo ${i + 1}`}
                    className="w-full h-full object-cover rounded-xl border border-gray-700"
                  />
                ) : (
                  <div className="w-full h-full rounded-xl border border-gray-700 bg-[#2C2C2E] flex items-center justify-center">
                    <span className="text-gray-600 text-sm">Loading…</span>
                  </div>
                )}
                <button
                  onClick={() => handlePhotoDelete(key)}
                  style={{ touchAction: "manipulation" }}
                  className="absolute -top-2 -right-2 w-9 h-9 bg-red-600 rounded-full text-white text-base flex items-center justify-center"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>{/* end animated content */}
    </div>
  )
}
