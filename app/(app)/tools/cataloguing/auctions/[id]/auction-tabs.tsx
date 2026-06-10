"use client"

import { useState, useTransition, useRef, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { updateAuction, updateLot, deleteLot, deleteAuction, uploadLotPhoto, deleteLotPhoto, fillLotsFromTotes, togglePublished, generateTitlesFromDescriptions, setStartingBids, toggleLotAiUpgraded, toggleLotAddedToBC, bulkSetLotsAddedToBC, massCreateLots, bulkAssignUniqueIds, bulkAddConditionsToDescriptions, transferLots, bulkClearLotPhotos } from "@/lib/actions/catalogue"
import LotWizardTab, { CATEGORY_MAP, BRANDS_LIST } from "./lot-wizard-tab"
import PhotoOnlyTab from "./photo-only-tab"
import ImportTab from "./import-tab"
import PhotoUploadTab from "./photo-upload-tab"
import AiUpgradeTab from "./ai-upgrade-tab"
import StatsTab from "./stats-tab"
import ReviewTab from "./review-tab"
import LotHistoryTab from "./lot-history-tab"
import * as XLSX from "xlsx"
import JSZip from "jszip"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "settings" | "add-lot" | "manage-lots" | "photo-only" | "import" | "upload-photos" | "ai-upgrade" | "stats" | "lot-history" | "review"

interface Auction {
  id: string; code: string; name: string; auctionDate: Date | null
  auctionType: string; eventName: string | null; notes: string | null
  locked: boolean; finished: boolean; complete: boolean; published: boolean
  catalogued: boolean; addedToBC: boolean; photography: boolean; aiRan: boolean
}

interface Lot {
  id: string; barcode: string | null; title: string; keyPoints: string; description: string
  estimateLow: number | null; estimateHigh: number | null; aiEstimateLow: number | null; aiEstimateHigh: number | null
  startingBid: number | null; reserve: number | null
  hammerPrice: number | null; condition: string | null; vendor: string | null
  tote: string | null; receipt: string | null; receiptUniqueId: string | null; category: string | null
  subCategory: string | null; brand: string | null; notes: string | null
  status: string; aiUpgraded: boolean; addedToBC: boolean; createdByName: string | null; imageUrls: string[]
  extraDetails: string | null
}


// ─── Constants ────────────────────────────────────────────────────────────────

// Title character limit — matches the longest standard Vectis title format
const TITLE_LIMIT = 83

// Round a value UP to the nearest bidding increment
function roundUpToIncrement(value: number): number {
  if (value <= 0)     return 5
  if (value <= 50)    return Math.ceil(value / 5)   * 5
  if (value <= 200)   return Math.ceil(value / 10)  * 10
  if (value <= 700)   return Math.ceil(value / 20)  * 20
  if (value <= 1000)  return Math.ceil(value / 50)  * 50
  if (value <= 3000)  return Math.ceil(value / 100) * 100
  if (value <= 7000)  return Math.ceil(value / 200) * 200
  if (value <= 10000) return Math.ceil(value / 500) * 500
  return Math.ceil(value / 1000) * 1000
}

const AUCTION_TYPES = [
  "GENERAL","DIECAST","TRAINS","VINYL","TV_FILM","MATCHBOX","COMICS","BEARS","DOLLS",
]

const CONDITIONS = ["Mint","Near Mint","Excellent","Good Plus","Good","Fair","Poor"]
const STATUSES   = ["ENTERED","REVIEWED","PUBLISHED","SOLD","UNSOLD","WITHDRAWN"]

const STATUS_STYLES: Record<string, string> = {
  ENTERED:   "bg-gray-700 text-gray-300",
  REVIEWED:  "bg-blue-900/50 text-blue-300",
  PUBLISHED: "bg-green-900/50 text-green-300",
  SOLD:      "bg-emerald-900/50 text-emerald-300",
  UNSOLD:    "bg-red-900/50 text-red-300",
  WITHDRAWN: "bg-orange-900/50 text-orange-300",
}

const input = "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
const lbl   = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"

// ─── Main tabbed component ────────────────────────────────────────────────────

// ─── Duplicate Checker Modal ──────────────────────────────────────────────────

function DupeCheckerModal({ lots, auctionId, onClose, onDeleted }: {
  lots: Lot[]
  auctionId: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting,    setDeleting]    = useState<Set<string>>(new Set())
  const [deleted,     setDeletedIds]  = useState<Set<string>>(new Set())
  const [deleteAllBusy, setDeleteAllBusy] = useState(false)

  // Score a lot by how much data it has — higher = more complete
  function lotScore(l: Lot): number {
    let s = 0
    if (l.description)   s += 4
    if (l.title)         s += 2
    if (l.keyPoints)     s += 1
    if (l.estimateLow)   s += 1
    if (l.estimateHigh)  s += 1
    if (l.barcode)       s += 1
    if (l.vendor)        s += 1
    s += l.imageUrls.length * 2
    return s
  }

  // Group by receiptUniqueId — only keep groups with 2+ lots, sorted best-first
  const dupeGroups = useMemo(() => {
    const map = new Map<string, Lot[]>()
    for (const l of lots) {
      if (!l.receiptUniqueId) continue
      const key = l.receiptUniqueId.trim().toLowerCase()
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return [...map.entries()]
      .filter(([, g]) => g.length > 1)
      .map(([, g]) => [...g].sort((a, b) => lotScore(b) - lotScore(a)))
  }, [lots])

  const visibleGroups = dupeGroups
    .map(g => g.filter(l => !deleted.has(l.id)))
    .filter(g => g.length > 1)

  async function handleDelete(lotId: string) {
    setDeleting(d => new Set(d).add(lotId))
    try {
      await deleteLot(lotId, auctionId)
      setDeletedIds(d => new Set(d).add(lotId))
      onDeleted()
    } finally {
      setDeleting(d => { const n = new Set(d); n.delete(lotId); return n })
    }
  }

  async function handleDeleteAll() {
    setDeleteAllBusy(true)
    // For each group, keep the first (highest score), delete the rest
    const toDelete = visibleGroups.flatMap(g => g.slice(1).map(l => l.id))
    for (const id of toDelete) {
      if (deleted.has(id)) continue
      await deleteLot(id, auctionId)
      setDeletedIds(d => new Set(d).add(id))
    }
    onDeleted()
    setDeleteAllBusy(false)
  }

  const totalToDelete = visibleGroups.reduce((sum, g) => sum + g.length - 1, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Duplicate Checker</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Lots sharing the same Receipt Unique ID — best filled kept automatically</p>
          </div>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {visibleGroups.length === 0 ? (
            <p className="text-green-400 text-sm text-center py-8">✓ No duplicates found</p>
          ) : (
            <div className="space-y-4">
              {visibleGroups.map((group, gi) => (
                <div key={gi} className="bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
                  <div className="px-4 py-2 bg-yellow-900/20 border-b border-yellow-700/30">
                    <span className="text-xs font-mono text-yellow-400 font-semibold">{group[0].receiptUniqueId}</span>
                    <span className="text-xs text-yellow-600 ml-2">— {group.length} lots</span>
                  </div>
                  {group.map((lot, li) => {
                    const isKeep = li === 0
                    return (
                      <div key={lot.id} className={`flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800 last:border-0 ${isKeep ? "bg-green-950/20" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            {isKeep
                              ? <span className="text-green-400 font-semibold">✓ Keep</span>
                              : <span className="text-red-400">Remove</span>}
                            {lot.barcode && <span className="font-mono text-gray-600 dark:text-gray-400">{lot.barcode}</span>}
                            {lot.imageUrls.length > 0 && <span className="text-blue-400">{lot.imageUrls.length} photos</span>}
                            {lot.description && <span className="text-green-400">Description</span>}
                            {lot.title && <span className="text-gray-600 dark:text-gray-400">Title</span>}
                            <span className="text-gray-600">score {lotScore(lot)}</span>
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-300 truncate mt-0.5">{lot.title || "No title"}</p>
                        </div>
                        {!isKeep && (
                          <button
                            onClick={() => handleDelete(lot.id)}
                            disabled={deleting.has(lot.id)}
                            className="shrink-0 px-3 py-1.5 rounded bg-red-900/40 border border-red-700/50 text-red-300 text-xs hover:bg-red-900/70 disabled:opacity-40 transition-colors"
                          >
                            {deleting.has(lot.id) ? "…" : "Delete"}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-300 dark:border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-600 dark:text-gray-500">
            {visibleGroups.length > 0
              ? `${visibleGroups.length} group${visibleGroups.length !== 1 ? "s" : ""} · ${totalToDelete} lot${totalToDelete !== 1 ? "s" : ""} to remove`
              : "All clear"}
          </span>
          {visibleGroups.length > 0 && (
            <button
              onClick={handleDeleteAll}
              disabled={deleteAllBusy}
              className="px-4 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
            >
              {deleteAllBusy ? "Deleting…" : `Delete All ${totalToDelete} Duplicates`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── BC Match Modal ───────────────────────────────────────────────────────────

type BCMatchRow = {
  barcode:    string
  bcReceipt:  string
  bcUniqueId: string
  ourReceipt: string | null
  ourUniqueId: string | null
  lotId:      string | null
  status:     "match" | "mismatch" | "not_found" | "our_only"
}

function BCMatchModal({ lots, auctionId, onClose }: {
  lots: Lot[]
  auctionId: string
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows]                   = useState<BCMatchRow[]>([])
  const [fileName, setFileName]           = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [importing, setImporting]         = useState(false)
  const [importResult, setImportResult]   = useState<{ updated: number; skipped: number } | null>(null)
  const [tableFilter, setTableFilter]     = useState<BCMatchRow["status"] | "all">("all")

  const barcodeMap = useMemo(() => {
    const m = new Map<string, Lot>()
    for (const l of lots) if (l.barcode) m.set(l.barcode.toLowerCase().trim(), l)
    return m
  }, [lots])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setImportResult(null); setFileName(file.name); setTableFilter("all")
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wb  = XLSX.read(ev.target!.result, { type: "binary" })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Record<string, string | number>>(ws)
        const parsed: BCMatchRow[] = (raw.map(r => {
          const barcode    = String(r["Internal Barcode"] ?? "").trim()
          const bcReceipt  = String(r["Receipt No."]      ?? "").trim()
          const bcUniqueId = String(r["UniqueID"]         ?? "").trim()
          if (!barcode) return null
          const lot = barcodeMap.get(barcode.toLowerCase())
          if (!lot) return { barcode, bcReceipt, bcUniqueId, ourReceipt: null, ourUniqueId: null, lotId: null, status: "not_found" as const }
          const receiptMatch = (lot.receipt ?? "").trim().toUpperCase() === bcReceipt.toUpperCase()
          return { barcode, bcReceipt, bcUniqueId, ourReceipt: lot.receipt, ourUniqueId: lot.receiptUniqueId, lotId: lot.id, status: receiptMatch ? "match" as const : "mismatch" as const }
        }).filter(Boolean)) as BCMatchRow[]

        // Reverse check — our lots whose barcode doesn't appear in the BC export at all
        const bcBarcodeSet = new Set(parsed.map(r => r.barcode.toLowerCase()))
        const ourOnly: BCMatchRow[] = lots
          .filter(l => l.barcode && !bcBarcodeSet.has(l.barcode.toLowerCase().trim()))
          .map(l => ({
            barcode:    l.barcode!,
            bcReceipt:  "",
            bcUniqueId: "",
            ourReceipt:  l.receipt,
            ourUniqueId: l.receiptUniqueId,
            lotId:       l.id,
            status:      "our_only" as const,
          }))

        setRows([...parsed, ...ourOnly])
      } catch (e: any) {
        setError("Could not read file: " + (e.message ?? "unknown error"))
      }
    }
    reader.readAsBinaryString(file)
  }

  async function handleImport() {
    const toImport = rows.filter(r => r.status === "match" && r.bcUniqueId)
    if (!toImport.length) return
    setImporting(true)
    try {
      const result = await bulkAssignUniqueIds(auctionId, toImport.map(r => ({ barcode: r.barcode, uniqueId: r.bcUniqueId })))
      setImportResult(result)
    } finally {
      setImporting(false)
    }
  }

  const matched    = rows.filter(r => r.status === "match")
  const mismatched = rows.filter(r => r.status === "mismatch")
  const notFound   = rows.filter(r => r.status === "not_found")
  const ourOnly    = rows.filter(r => r.status === "our_only")

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">BC Match &amp; Import</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">Upload the BC Lines export — matches barcodes and imports Unique IDs where receipts agree</p>
          </div>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* File picker */}
          <div className="flex items-center gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="text-sm border border-gray-300 dark:border-gray-700 hover:border-gray-500 text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg transition-colors">
              {fileName ? `📄 ${fileName}` : "Choose BC Lines .xlsx…"}
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
            {rows.length > 0 && <span className="text-xs text-gray-500">{rows.filter(r => r.status !== "our_only").length} BC rows · {lots.filter(l => l.barcode).length} our lots</span>}
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>
          )}

          {rows.length > 0 && (
            <>
              {/* Summary cards — click to filter table */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([
                  { status: "match"     as const, count: matched.length,    label: "Receipt matches — ready to import", active: "bg-green-100 dark:bg-green-900/60 ring-2 ring-green-500",  inactive: "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50",  num: "text-green-700 dark:text-green-400",  txt: "text-green-600 dark:text-green-500"  },
                  { status: "mismatch"  as const, count: mismatched.length,  label: "Receipt mismatch — skipped",         active: "bg-yellow-100 dark:bg-yellow-900/60 ring-2 ring-yellow-500", inactive: "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 hover:bg-yellow-100 dark:hover:bg-yellow-900/50", num: "text-yellow-700 dark:text-yellow-400", txt: "text-yellow-600 dark:text-yellow-500" },
                  { status: "not_found" as const, count: notFound.length,    label: "In BC but not our system",           active: "bg-gray-200 dark:bg-gray-700/60 ring-2 ring-gray-400",       inactive: "bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800/60",           num: "text-gray-700 dark:text-gray-400",    txt: "text-gray-600 dark:text-gray-500"    },
                  { status: "our_only"  as const, count: ourOnly.length,     label: "In our system but not in BC",        active: "bg-violet-100 dark:bg-violet-900/60 ring-2 ring-violet-500", inactive: "bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/50", num: "text-violet-700 dark:text-violet-400", txt: "text-violet-600 dark:text-violet-500" },
                ] as const).map(card => (
                  <button
                    key={card.status}
                    onClick={() => setTableFilter(f => f === card.status ? "all" : card.status)}
                    className={`text-left rounded-lg px-4 py-3 transition-all ${tableFilter === card.status ? card.active : card.inactive}`}
                  >
                    <div className={`text-2xl font-bold ${card.num}`}>{card.count}</div>
                    <div className={`text-xs mt-0.5 ${card.txt}`}>{card.label}</div>
                    {tableFilter === card.status && <div className="text-xs mt-1 opacity-60 font-medium">Click to clear filter</div>}
                  </button>
                ))}
              </div>

              {/* Import action */}
              {importResult ? (
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-300 dark:border-green-700 rounded-lg px-4 py-3 text-sm text-green-700 dark:text-green-400 font-medium">
                  ✓ Done — {importResult.updated} Unique IDs imported, {importResult.skipped} skipped
                </div>
              ) : (
                <button onClick={handleImport} disabled={importing || matched.length === 0}
                  className="text-sm bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold px-5 py-2 rounded-lg transition-colors">
                  {importing ? "Importing…" : `↓ Import ${matched.length} Unique ID${matched.length !== 1 ? "s" : ""}`}
                </button>
              )}

              {/* Detail table */}
              <div className="bg-white dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#1C1C1E]">
                      <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide">Barcode</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide">BC Receipt</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide">Our Receipt</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide">BC Unique ID</th>
                      <th className="text-left px-3 py-2 font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tableFilter === "all" ? rows : rows.filter(r => r.status === tableFilter)).map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                        <td className="px-3 py-2 font-mono text-gray-800 dark:text-gray-200">{r.barcode}</td>
                        <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{r.bcReceipt || "—"}</td>
                        <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{r.ourReceipt ?? <span className="text-gray-400">—</span>}</td>
                        <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{r.bcUniqueId || "—"}</td>
                        <td className="px-3 py-2">
                          {r.status === "match"     && <span className="text-green-600 dark:text-green-400 font-semibold">✓ Match</span>}
                          {r.status === "mismatch"  && <span className="text-yellow-600 dark:text-yellow-400 font-semibold">⚠ Mismatch</span>}
                          {r.status === "not_found" && <span className="text-gray-500 font-semibold">✗ Not in our system</span>}
                          {r.status === "our_only"  && <span className="text-violet-600 dark:text-violet-400 font-semibold">✗ Not in BC</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Transfer Lots Modal ──────────────────────────────────────────────────────

type AuctionSummary = { id: string; code: string; name: string; auctionDate: Date | null }

function TransferLotsModal({ selectedIds, sourceAuctionId, allAuctions, onClose, onDone }: {
  selectedIds: string[]
  sourceAuctionId: string
  allAuctions: AuctionSummary[]
  onClose: () => void
  onDone: () => void
}) {
  const [targetId, setTargetId] = useState("")
  const [transferring, setTransferring] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = allAuctions.filter(a => {
    const q = search.toLowerCase()
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
  })

  async function handleConfirm() {
    if (!targetId) return
    setTransferring(true)
    try {
      await transferLots(selectedIds, sourceAuctionId, targetId)
      onDone()
    } finally {
      setTransferring(false)
    }
  }

  const target = allAuctions.find(a => a.id === targetId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Transfer Lots</h2>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Moving {selectedIds.length} lot{selectedIds.length !== 1 ? "s" : ""} to another auction
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl leading-none">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <input
            type="text"
            placeholder="Search by code or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] px-3 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
          />

          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-6">No auctions found</p>
            ) : (
              filtered.map(a => {
                const dateStr = a.auctionDate
                  ? new Date(a.auctionDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                  : null
                return (
                  <button
                    key={a.id}
                    onClick={() => setTargetId(a.id)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors ${
                      targetId === a.id
                        ? "bg-[#2AB4A6]/20 text-[#2AB4A6]"
                        : "hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <span className="font-mono font-semibold text-sm mr-2">{a.code}</span>
                    <span className="text-sm">{a.name}</span>
                    {dateStr && <span className="text-xs text-gray-500 ml-2">{dateStr}</span>}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleConfirm}
              disabled={!targetId || transferring}
              className="flex-1 py-2 bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-40 text-black font-semibold text-sm rounded-lg transition-colors"
            >
              {transferring
                ? "Transferring…"
                : target
                  ? `Transfer to ${target.code} — ${target.name}`
                  : "Select a destination auction"}
            </button>
            <button onClick={onClose} className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AuctionTabs({ auction, lots, userId, userName, userRole, showScanTimer, timerYellowMins, timerRedMins, allAuctions }: { auction: Auction; lots: Lot[]; userId: string; userName: string; userRole: string; showScanTimer?: boolean; timerYellowMins?: number; timerRedMins?: number; allAuctions: AuctionSummary[] }) {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const bcLocked     = auction.addedToBC && userRole !== "ADMIN"
  const [tab, setTab]             = useState<Tab>("manage-lots")
  const [published, setPublished] = useState(auction.published)
  const [pubPending, startPub]    = useTransition()
  const [showDupeChecker,  setShowDupeChecker]  = useState(false)
  const [showBCMatch,      setShowBCMatch]      = useState(false)
  const [transferLotIds,   setTransferLotIds]   = useState<string[]>([])

  // Count duplicate unique ID groups for badge
  const dupeCount = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of lots) {
      if (!l.receiptUniqueId) continue
      const key = l.receiptUniqueId.trim().toLowerCase()
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.values()].filter(n => n > 1).length
  }, [lots])

  const editingLotId = searchParams.get("lot")
  const editingLot   = lots.find(l => l.id === editingLotId) ?? null
  const [navDir, setNavDir] = useState<"next" | "prev" | null>(null)

  function openLot(id: string, dir?: "next" | "prev") {
    setNavDir(dir ?? null)
    router.push(`/tools/cataloguing/auctions/${auction.id}?lot=${id}`)
  }

  function closeLot() {
    setNavDir(null)
    router.push(`/tools/cataloguing/auctions/${auction.id}`)
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "manage-lots",  label: `Manage Lots (${lots.length})` },
    { id: "add-lot",      label: "Add Lot" },
    { id: "photo-only",   label: "Photo Only Cataloguing" },
    { id: "import",        label: "Import Lots" },
    { id: "upload-photos", label: "Upload Photos" },
    { id: "ai-upgrade",   label: "✨ AI Upgrade" },
    { id: "review",       label: "🔍 Review" },
    { id: "stats",        label: "📊 Statistics" },
    { id: "lot-history",  label: "📖 Lot History" },
    { id: "settings",     label: "Auction Settings" },
  ]

  function switchTab(t: Tab) { setTab(t) }

  function handleTogglePublish() {
    const next = !published
    startPub(async () => {
      await togglePublished(auction.id, next)
      setPublished(next)
    })
  }

  return (
    <div className="flex flex-col h-full min-h-0 p-6 gap-0">

      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-shrink-0">
        <button onClick={() => router.push("/tools/cataloguing/auctions")}
          className="text-sm text-[#2AB4A6] hover:text-[#24a090] transition-colors">
          ← Auctions
        </button>
        <span className="text-gray-700">/</span>
        <span className="font-mono font-bold text-[#2AB4A6]">{auction.code}</span>
        <span className="text-gray-600 dark:text-gray-300 font-medium">{auction.name}</span>
        {auction.catalogued  && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300">Catalogued</span>}
        {auction.addedToBC   && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-900/50 text-orange-300">Added to BC</span>}
        {auction.photography && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300">Photography</span>}
        {auction.aiRan       && <span className="text-xs px-2 py-0.5 rounded-full bg-pink-900/50 text-pink-300">Ran through AI</span>}
        {auction.complete    && <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300">Complete</span>}
        {published && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300">● Live on Site</span>}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowDupeChecker(true)}
            className="relative text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-400 dark:border-yellow-700/40 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40">
            🔍 Check Duplicates
            {dupeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {dupeCount}
              </span>
            )}
          </button>
          <button onClick={() => setShowBCMatch(true)}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-blue-50 dark:bg-blue-900/20 border border-blue-400 dark:border-blue-700/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40">
            🔗 BC Match
          </button>
          <button onClick={() => {
            const data = lots.map(l => ({
              Folder:               l.receiptUniqueId || l.barcode || "",
              "Receipt Unique ID":  l.receiptUniqueId || "",
              Barcode:              l.barcode || "",
              Description:          l.description,
              Estimate:             l.estimateLow && l.estimateHigh ? `Estimate: £${l.estimateLow}–£${l.estimateHigh}` : "",
              ImageUrls:            l.imageUrls || [],
            }))
            localStorage.setItem("copier_preload", JSON.stringify(data))
            window.open("/tools/auction-ai?tab=copier", "_blank")
          }}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-amber-50 dark:bg-[#C8A96E]/10 border border-amber-400 dark:border-[#C8A96E]/40 text-amber-700 dark:text-[#C8A96E] hover:bg-amber-100 dark:hover:bg-[#C8A96E]/20">
            📋 Description Copier
          </button>
          <button onClick={() => switchTab("ai-upgrade")}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors bg-purple-50 dark:bg-purple-900/20 border border-purple-400 dark:border-purple-700/40 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40">
            ✨ Upgrade descriptions with AI
          </button>
          <button
            onClick={handleTogglePublish}
            disabled={pubPending}
            className={`text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
              published
                ? "bg-red-50 dark:bg-red-900/30 border border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
                : "bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-500 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/50"
            }`}
          >
            {pubPending ? "…" : published ? "Unpublish from Site" : "Publish to Site"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex border-b border-gray-300 dark:border-gray-700 mb-6 overflow-x-auto scrollbar-none -mx-6 px-6">
        {tabs.map(t => (
          <button key={t.id} onClick={() => switchTab(t.id)}
            className={`flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
              tab === t.id
                ? "border-[#2AB4A6] text-[#2AB4A6]"
                : "border-transparent text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* BC locked banner */}
      {bcLocked && (
        <div className="flex-shrink-0 mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-orange-950/40 border border-orange-700/50 text-orange-300 text-sm">
          <span className="text-lg">🔒</span>
          <span>This auction has been <strong>Added to BC</strong> and is locked for editing. Contact an admin to make changes.</span>
        </div>
      )}

      {/* Tab panels — scrollable content area */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-3" style={{ scrollbarWidth: "thin", scrollbarColor: "#4b5563 transparent" }}>
        {tab === "settings" && <SettingsTab auction={auction} />}

        <div className={tab === "add-lot" ? "" : "hidden"}>
          {bcLocked ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-orange-950/40 border border-orange-700/50 text-orange-300 text-sm max-w-lg">
              <span className="text-lg">🔒</span>
              <span>This auction is locked. Adding new lots is disabled. Contact an admin to make changes.</span>
            </div>
          ) : (
            <LotWizardTab auctionId={auction.id} auction={auction}
              userId={userId} userName={userName}
              onCreated={() => router.refresh()} showScanTimer={showScanTimer} timerYellowMins={timerYellowMins} timerRedMins={timerRedMins} />
          )}
        </div>

        {tab === "manage-lots" && (
          editingLotId
            ? <LotEditView key={editingLotId} lot={editingLot} auctionId={auction.id}
                allLots={lots} entryDir={navDir} onEdit={openLot} onDone={closeLot} />
            : <ManageLotsTab lots={lots} auctionId={auction.id} auction={auction}
                allAuctions={allAuctions}
                bcLocked={bcLocked}
                onEdit={openLot}
                onDelete={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)}
                onTransfer={ids => setTransferLotIds(ids)} />
        )}

        {tab === "photo-only" && (
          <PhotoOnlyTab auctionId={auction.id} auctionCode={auction.code} onCreated={() => router.refresh()} />
        )}

        {tab === "import" && (
          <ImportTab auctionId={auction.id} auctionCode={auction.code} onImported={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)} />
        )}

        {tab === "upload-photos" && (
          <PhotoUploadTab auctionId={auction.id} lots={lots} onUploaded={() => router.refresh()} />
        )}

        {tab === "ai-upgrade" && (
          <AiUpgradeTab
            auctionId={auction.id}
            auctionCode={auction.code}
            lots={lots}
            onDone={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)}
          />
        )}

        {tab === "stats" && <StatsTab lots={lots} auction={auction} />}
        {tab === "review" && <ReviewTab auctionId={auction.id} />}

        {tab === "lot-history" && (
          <LotHistoryTab
            auctionId={auction.id}
            lots={lots.map(l => ({
              id:             l.id,
              barcode:        l.barcode,
              receiptUniqueId: l.receiptUniqueId,
              title:          l.title,
              description:    l.description,
              keyPoints:      l.keyPoints,
              category:       l.category,
              subCategory:    l.subCategory,
              brand:          l.brand,
              condition:      l.condition,
              estimateLow:    l.estimateLow,
              estimateHigh:   l.estimateHigh,
              extraDetails:   l.extraDetails,
            }))}
          />
        )}
      </div>

      {showDupeChecker && (
        <DupeCheckerModal
          lots={lots}
          auctionId={auction.id}
          onClose={() => setShowDupeChecker(false)}
          onDeleted={() => router.refresh()}
        />
      )}

      {showBCMatch && (
        <BCMatchModal
          lots={lots}
          auctionId={auction.id}
          onClose={() => setShowBCMatch(false)}
        />
      )}

      {transferLotIds.length > 0 && (
        <TransferLotsModal
          selectedIds={transferLotIds}
          sourceAuctionId={auction.id}
          allAuctions={allAuctions}
          onClose={() => setTransferLotIds([])}
          onDone={() => { setTransferLotIds([]); router.refresh() }}
        />
      )}
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab({ auction }: { auction: Auction }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const defaultDate = auction.auctionDate
    ? new Date(auction.auctionDate).toISOString().split("T")[0]
    : ""

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    start(async () => {
      await updateAuction(auction.id, fd)
      setSaved(true)
      router.refresh()
      setTimeout(() => setSaved(false), 2500)
    })
  }

  async function handleDelete() {
    start(async () => {
      await deleteAuction(auction.id)
      router.push("/tools/cataloguing/auctions")
    })
  }

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Code *</label>
            <input name="code" required defaultValue={auction.code}
              className={`${input} uppercase`} />
          </div>
          <div>
            <label className={lbl}>Date</label>
            <input name="auctionDate" type="date" defaultValue={defaultDate} className={input} />
          </div>
        </div>

        <div>
          <label className={lbl}>Name *</label>
          <input name="name" required defaultValue={auction.name} className={input} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lbl}>Type</label>
            <select name="auctionType" defaultValue={auction.auctionType} className={input}>
              {AUCTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={lbl}>Notes</label>
          <textarea name="notes" rows={3} defaultValue={auction.notes ?? ""}
            className={`${input} resize-none`} />
        </div>

        <div className="flex flex-wrap gap-6">
          {([
            ["catalogued",  "Catalogued"],
            ["addedToBC",   "Added to BC"],
            ["photography", "Photography"],
            ["aiRan",       "Ran through AI"],
            ["complete",    "Complete"],
          ] as const).map(([f, label]) => (
            <label key={f} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name={f} value="true"
                defaultChecked={(auction as any)[f]}
                className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
              <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={pending}
            className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-6 py-2 rounded-lg transition-colors">
            {pending ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="text-sm text-[#2AB4A6]">✓ Saved</span>}
        </div>
      </form>

      {/* Danger zone */}
      <div className="mt-10 border border-red-900/50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-1">Danger Zone</h3>
        <p className="text-xs text-gray-600 dark:text-gray-500 mb-3">Permanently delete this auction and all its lots.</p>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="text-sm px-4 py-2 border border-red-800 text-red-400 rounded-lg hover:bg-red-900/30 transition-colors">
            Delete Auction
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-red-300">Are you sure?</span>
            <button onClick={handleDelete} disabled={pending}
              className="text-sm px-4 py-2 bg-red-900/50 border border-red-700 text-red-300 rounded-lg hover:bg-red-900/70 transition-colors disabled:opacity-50">
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button onClick={() => setConfirmDelete(false)}
              className="text-sm text-gray-600 dark:text-gray-500 hover:text-gray-300 transition-colors">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Manage lots tab ──────────────────────────────────────────────────────────

const COL_INPUT  = "w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#0d0d0f] px-2 py-1 text-xs text-gray-600 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-700 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"
const COL_SELECT = "w-full rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#0d0d0f] px-1 py-1 text-xs text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#2AB4A6]"

function colMatch(value: string | null | undefined, filter: string) {
  if (!filter.trim()) return true
  return (value ?? "").toLowerCase().includes(filter.toLowerCase().trim())
}

function ManageLotsTab({ lots, auctionId, auction, allAuctions, bcLocked, onEdit, onDelete, onTransfer }: {
  lots: Lot[]; auctionId: string
  auction: { id: string; code: string; name: string }
  allAuctions: AuctionSummary[]
  bcLocked: boolean
  onEdit: (id: string) => void
  onDelete: () => void
  onTransfer: (ids: string[]) => void
}) {
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [photosClearing, setPhotosClearing] = useState(false)
  const [pending, start]            = useTransition()
  const [fillPending, startFill]    = useTransition()
  const [fillMsg, setFillMsg]       = useState<string | null>(null)
  const [photoExporting, setPhotoExporting] = useState(false)
  const [photoMsg, setPhotoMsg]     = useState<string | null>(null)

  // Column sort
  type SortCol = "barcode" | "receiptUniqueId" | "title" | "vendor" | "receipt" | "tote" | "category" | "photos" | "status" | "addedBy"
  const [sortCol, setSortCol] = useState<SortCol>("barcode")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  function toggleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortCol(col); setSortDir("asc") }
  }

  // Generate titles
  const [titlesMsg, setTitlesMsg]   = useState<string | null>(null)
  const [titlesPending, startTitles] = useTransition()

  // Mark/unmark selected as added to BC
  const [bcMsg, setBcMsg]           = useState<string | null>(null)
  const [bcPending, startBc]        = useTransition()

  // Autolotter panel
  const [showMassAdd,    setShowMassAdd]    = useState(false)
  const [massCount,      setMassCount]      = useState(10)
  const [massVendor,     setMassVendor]     = useState("")
  const [massTote,       setMassTote]       = useState("")
  const [massReceipt,    setMassReceipt]    = useState("")
  const [massCategory,   setMassCategory]   = useState("")
  const [massSubCat,     setMassSubCat]     = useState("")
  const [massAdding,     startMassAdd]      = useTransition()
  const [massMsg,        setMassMsg]        = useState<string | null>(null)


  // Starting bid panel
  const [showBids, setShowBids] = useState(false)
  const [bidPct, setBidPct]     = useState(60)
  const [bidsMsg, setBidsMsg]   = useState<string | null>(null)
  const [bidsPending, startBids] = useTransition()

  // Unique ID Matcher panel
  const uniqueIdInputRef = useRef<HTMLInputElement>(null)
  const [showUniqueIdMatcher, setShowUniqueIdMatcher] = useState(false)
  const [uniqueIdPairs, setUniqueIdPairs] = useState<{ barcode: string; uniqueId: string }[]>([])
  const [uniqueIdMsg, setUniqueIdMsg]     = useState<string | null>(null)
  const [uniqueIdPending, startUniqueId]  = useTransition()

  // Bulk add conditions to descriptions
  const [condMsg, setCondMsg]         = useState<string | null>(null)
  const [condPending, startCond]      = useTransition()

  function handleBulkAddConditions() {
    const lotsWithCond = lots.filter(l => l.condition?.trim())
    if (lotsWithCond.length === 0) {
      setCondMsg("No lots have a condition set.")
      setTimeout(() => setCondMsg(null), 3000)
      return
    }
    if (!confirm(`This will append the condition to the description for up to ${lotsWithCond.length} lot${lotsWithCond.length !== 1 ? "s" : ""} (skips any that already have it). Continue?`)) return
    startCond(async () => {
      const { updated, skipped } = await bulkAddConditionsToDescriptions(auctionId)
      setCondMsg(`✓ ${updated} lot${updated !== 1 ? "s" : ""} updated, ${skipped} skipped`)
      setTimeout(() => setCondMsg(null), 4000)
    })
  }

  // ── Per-column filters ──────────────────────────────────────────────────
  const [fBarcode,       setFBarcode]       = useState("")
  const [fUniqueId,      setFUniqueId]      = useState("")
  const [fTitle,         setFTitle]         = useState("")
  const [fVendor,        setFVendor]        = useState("")
  const [fReceipt,       setFReceipt]       = useState("")
  const [fTote,          setFTote]          = useState("")
  const [fCategory,      setFCategory]      = useState("")
  const [fPhotos,        setFPhotos]        = useState("")   // "any" | "none" | ""
  const [fAiUpgraded,    setFAiUpgraded]    = useState("")   // "yes" | "no" | ""
  const [fAddedToBC,     setFAddedToBC]     = useState("")   // "yes" | "no" | ""
  const [fStatus,        setFStatus]        = useState("")

  const uniqueStatuses = useMemo(() => Array.from(new Set(lots.map(l => l.status))).sort(), [lots])

  const filtered = useMemo(() => {
    const f = lots.filter(l =>
      colMatch(l.barcode, fBarcode) &&
      colMatch(l.receiptUniqueId, fUniqueId) &&
      colMatch(l.title, fTitle) &&
      colMatch(l.vendor, fVendor) &&
      colMatch(l.receipt, fReceipt) &&
      colMatch(l.tote, fTote) &&
      colMatch(l.category, fCategory) &&
      (fPhotos === "" || (fPhotos === "any" ? l.imageUrls.length > 0 : l.imageUrls.length === 0)) &&
      (fAiUpgraded === "" || (fAiUpgraded === "yes" ? l.aiUpgraded : !l.aiUpgraded)) &&
      (fAddedToBC === ""  || (fAddedToBC  === "yes" ? l.addedToBC  : !l.addedToBC )) &&
      (fStatus === "" || l.status === fStatus)
    )
    return f.sort((a, b) => {
      let cmp = 0
      if (sortCol === "photos") {
        cmp = a.imageUrls.length - b.imageUrls.length
      } else {
        const getVal = (l: Lot) => {
          if (sortCol === "barcode")        return l.barcode
          if (sortCol === "receiptUniqueId") return l.receiptUniqueId
          if (sortCol === "title")          return l.title
          if (sortCol === "vendor")         return l.vendor
          if (sortCol === "receipt")        return l.receipt
          if (sortCol === "tote")           return l.tote
          if (sortCol === "category")       return l.category
          if (sortCol === "status")         return l.status
          if (sortCol === "addedBy")        return l.createdByName
          return l.barcode
        }
        const va = getVal(a) ?? ""
        const vb = getVal(b) ?? ""
        cmp = va.localeCompare(vb, undefined, { numeric: true })
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [lots, fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fAiUpgraded, fAddedToBC, fStatus, sortCol, sortDir])

  const filtersActive = [fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fAiUpgraded, fAddedToBC, fStatus].some(f => f !== "")

  function clearFilters() {
    setFBarcode(""); setFUniqueId(""); setFTitle(""); setFVendor(""); setFReceipt("")
    setFTote(""); setFCategory(""); setFPhotos(""); setFAiUpgraded(""); setFAddedToBC(""); setFStatus("")
  }

  function exportExcel() {
    const rows = filtered.map(l => ({
      "Barcode":       l.barcode ?? "",
      "Unique ID":     l.receiptUniqueId ?? "",
      "Title":         l.title,
      "Key Points":    l.keyPoints,
      "Description":   l.description,
      "Estimate Low":  l.estimateLow ?? "",
      "Estimate High": l.estimateHigh ?? "",
      "Starting Bid":  l.startingBid ?? "",
      "Reserve":       l.reserve ?? "",
      "Hammer Price":  l.hammerPrice ?? "",
      "Condition":     l.condition ?? "",
      "Status":        l.status,
      "Vendor":        l.vendor ?? "",
      "Tote":          l.tote ?? "",
      "Receipt":       l.receipt ?? "",
      "Category":      l.category ?? "",
      "Sub-Category":  l.subCategory ?? "",
      "Brand":         l.brand ?? "",
      "Notes":         l.notes ?? "",
      "Photos":        l.imageUrls.length,
      "AI Upgraded":   l.aiUpgraded ? "Yes" : "No",
      "Added By":      l.createdByName ?? "",
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Lots")
    XLSX.writeFile(wb, `${auction.code}_${auction.name}_lots.xlsx`.replace(/\s+/g, "_"))
  }

  function exportForAHK() {
    // Group filtered lots by tote, collect barcodes per tote, skip lots with no tote
    const toteMap = new Map<string, string[]>()
    for (const l of filtered) {
      if (!l.tote?.trim()) continue
      const tote = l.tote.trim()
      if (!toteMap.has(tote)) toteMap.set(tote, [])
      toteMap.get(tote)!.push((l.barcode ?? "").trim())
    }
    if (toteMap.size === 0) { alert("No lots with tote numbers in current filter."); return }
    const lines = ["ToteNumber,LotCount,Barcodes", ...Array.from(toteMap.entries()).map(([t, barcodes]) => `${t},${barcodes.length},${barcodes.join("|")}`)]
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = "bc_import.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportForAHKReceipt() {
    // Group filtered lots by receipt, collect barcodes per receipt, skip lots with no receipt
    const receiptMap = new Map<string, string[]>()
    for (const l of filtered) {
      if (!l.receipt?.trim()) continue
      const receipt = l.receipt.trim()
      if (!receiptMap.has(receipt)) receiptMap.set(receipt, [])
      receiptMap.get(receipt)!.push((l.barcode ?? "").trim())
    }
    if (receiptMap.size === 0) { alert("No lots with receipt numbers in current filter."); return }
    const lines = ["ToteNumber,LotCount,Barcodes", ...Array.from(receiptMap.entries()).map(([r, barcodes]) => `${r},${barcodes.length},${barcodes.join("|")}`)]
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv" })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement("a")
    a.href     = url
    a.download = "bc_import_receipt.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  async function exportPhotos() {
    const lotsWithPhotos = filtered.filter(l => l.imageUrls.length > 0)
    if (lotsWithPhotos.length === 0) { setPhotoMsg("No photos to export"); setTimeout(() => setPhotoMsg(null), 3000); return }

    setPhotoExporting(true)
    setPhotoMsg(`Fetching photos for ${lotsWithPhotos.length} lots…`)

    try {
      const zip = new JSZip()
      let fetched = 0

      for (const lot of lotsWithPhotos) {
        const folder = zip.folder(lot.barcode || lot.id)!

        for (let i = 0; i < lot.imageUrls.length; i++) {
          const key = lot.imageUrls[i]
          try {
            const res = await fetch(`/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`)
            if (!res.ok) continue
            const blob = await res.blob()
            const ext  = key.split(".").pop() ?? "jpg"
            folder.file(`photo_${i + 1}.${ext}`, blob)
          } catch { /* skip failed images */ }
        }

        fetched++
        setPhotoMsg(`Downloading… ${fetched} / ${lotsWithPhotos.length} lots`)
      }

      setPhotoMsg("Building zip…")
      const content = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(content)
      const a   = document.createElement("a")
      a.href     = url
      a.download = `${auction.code}_photos.zip`.replace(/\s+/g, "_")
      a.click()
      URL.revokeObjectURL(url)
      setPhotoMsg(`✓ Downloaded photos for ${fetched} lots`)
    } catch (e) {
      setPhotoMsg("Export failed")
    } finally {
      setPhotoExporting(false)
      setTimeout(() => setPhotoMsg(null), 4000)
    }
  }

  async function handleDelete(lot: Lot) {
    if (!confirm(`Delete lot "${lot.barcode || lot.id} — ${lot.title}"?`)) return
    setDeleting(lot.id)
    start(async () => {
      await deleteLot(lot.id, auctionId)
      setDeleting(null)
      onDelete()
    })
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`Delete ${selected.size} selected lot${selected.size !== 1 ? "s" : ""}? This cannot be undone.`)) return
    setBulkDeleting(true)
    start(async () => {
      for (const id of selected) await deleteLot(id, auctionId)
      setSelected(new Set())
      setBulkDeleting(false)
      onDelete()
    })
  }

  async function handleBulkClearPhotos(deleteFromStorage: boolean) {
    if (selected.size === 0) return
    const photoTotal = lots.filter(l => selected.has(l.id)).reduce((s, l) => s + l.imageUrls.length, 0)
    if (photoTotal === 0) { alert("The selected lots have no photos."); return }
    const storageWarning = deleteFromStorage ? " Files will be permanently removed from storage." : " The files will remain in storage."
    if (!confirm(`${deleteFromStorage ? "Delete" : "Unlink"} ALL ${photoTotal} photo${photoTotal !== 1 ? "s" : ""} from ${selected.size} selected lot${selected.size !== 1 ? "s" : ""}?${storageWarning} This cannot be undone.`)) return
    setPhotosClearing(true)
    start(async () => {
      try {
        await bulkClearLotPhotos(Array.from(selected), auctionId, deleteFromStorage)
        setSelected(new Set())
        onDelete()
      } finally {
        setPhotosClearing(false)
      }
    })
  }

  async function handleGenerateTitles() {
    if (selected.size === 0) return
    startTitles(async () => {
      await generateTitlesFromDescriptions(auctionId, Array.from(selected))
      setTitlesMsg(`✓ Titles generated for ${selected.size} lot${selected.size !== 1 ? "s" : ""}`)
      setSelected(new Set())
      onDelete()
      setTimeout(() => setTitlesMsg(null), 3000)
    })
  }

  // Bulk mark/unmark selected lots as "Added to BC". Decides direction by
  // looking at the selected lots — if any are still un-ticked we tick them
  // all; if all are already ticked we untick. Avoids needing two buttons.
  async function handleToggleAddedToBC() {
    if (selected.size === 0) return
    const selectedLots = lots.filter(l => selected.has(l.id))
    const anyUnticked  = selectedLots.some(l => !l.addedToBC)
    const newValue     = anyUnticked  // true → mark; false → unmark all
    startBc(async () => {
      const { count } = await bulkSetLotsAddedToBC(Array.from(selected), auctionId, newValue)
      setBcMsg(`${newValue ? "✓ Marked" : "↺ Unmarked"} ${count} lot${count === 1 ? "" : "s"} ${newValue ? "as added to BC" : ""}`)
      setSelected(new Set())
      onDelete()
      setTimeout(() => setBcMsg(null), 3500)
    })
  }

  function handleSetStartingBids() {
    const eligible = (selected.size > 0 ? lots.filter(l => selected.has(l.id)) : lots)
      .filter(l => l.estimateLow != null)
    if (eligible.length === 0) { setBidsMsg("No lots with estimates to update."); return }
    const updates = eligible.map(l => ({
      id:         l.id,
      startingBid: roundUpToIncrement(Math.ceil(l.estimateLow! * bidPct / 100)),
    }))
    startBids(async () => {
      await setStartingBids(auctionId, updates)
      setBidsMsg(`✓ Starting bids set for ${updates.length} lot${updates.length !== 1 ? "s" : ""}`)
      setShowBids(false)
      setSelected(new Set())
      onDelete()
      setTimeout(() => setBidsMsg(null), 3000)
    })
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))
  }

  if (lots.length === 0) {
    return (
      <div>
        {/* ── Mass Add panel still available on empty auction (not when locked) ── */}
        {!bcLocked && (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => setShowMassAdd(v => !v)}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showMassAdd ? "border-orange-500 text-orange-400 bg-orange-900/20" : "border-gray-600 text-gray-600 dark:text-gray-400 hover:border-orange-500 hover:text-orange-400"}`}>
              ➕ Mass Add Lots
            </button>
            {massMsg && <span className="text-xs text-orange-400">{massMsg}</span>}
          </div>
        )}
        {showMassAdd && !bcLocked && (
          <div className="mb-4 bg-white dark:bg-[#1C1C1E] border border-orange-700/40 rounded-xl p-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-orange-300">Mass Add Lots</p>
              <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
                Creates blank lots in bulk. Barcodes are auto-generated as {auction.code}001, {auction.code}002… continuing from the highest existing barcode.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Number of lots <span className="text-orange-400">*</span></label>
                <input type="number" min={1} max={1000} value={massCount}
                  onChange={e => setMassCount(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Vendor</label>
                <input type="text" value={massVendor} onChange={e => setMassVendor(e.target.value)} placeholder="e.g. V000123"
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Tote</label>
                <input type="text" value={massTote} onChange={e => setMassTote(e.target.value)} placeholder="e.g. T01"
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Receipt</label>
                <input type="text" value={massReceipt} onChange={e => setMassReceipt(e.target.value)} placeholder="e.g. R000123"
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Category</label>
                <input type="text" value={massCategory} onChange={e => setMassCategory(e.target.value)} placeholder="e.g. Toys"
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Sub-category</label>
                <input type="text" value={massSubCat} onChange={e => setMassSubCat(e.target.value)} placeholder="e.g. Action Figures"
                  className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                disabled={massAdding}
                onClick={() => {
                  startMassAdd(async () => {
                    setMassMsg(null)
                    const n = await massCreateLots(auction.id, auction.code, {
                      count: massCount, vendor: massVendor, tote: massTote,
                      receipt: massReceipt, category: massCategory, subCategory: massSubCat,
                    })
                    setMassMsg(`✓ ${n} lots created`)
                    setTimeout(() => setMassMsg(null), 4000)
                  })
                }}
                className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
                {massAdding ? "Creating…" : `Create ${massCount} lot${massCount !== 1 ? "s" : ""}`}
              </button>
              <button onClick={() => setShowMassAdd(false)} className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Cancel</button>
            </div>
          </div>
        )}
        <div className="text-center py-16 text-gray-600">
          No lots yet — use the <span className="text-gray-600 dark:text-gray-400">Add Lot</span> tab or Mass Add above to get started.
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setFillMsg(null)
              startFill(async () => {
                const result = await fillLotsFromTotes(auctionId)
                setFillMsg(result.updated > 0 ? `✓ Updated ${result.updated} lot${result.updated !== 1 ? "s" : ""}` : "No lots needed updating")
                setTimeout(() => setFillMsg(null), 3000)
                onDelete()
              })
            }}
            disabled={fillPending}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors disabled:opacity-50"
          >
            {fillPending ? "Pulling…" : "⟳ Pull Vendor/Receipt from Totes"}
          </button>
          {!bcLocked && (
            <button
              onClick={() => { setShowMassAdd(v => !v); setShowBids(false) }}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showMassAdd ? "border-orange-500 text-orange-400 bg-orange-900/20" : "border-gray-600 text-gray-600 dark:text-gray-400 hover:border-orange-500 hover:text-orange-400"}`}>
              ➕ Mass Add Lots
            </button>
          )}
          <button
            onClick={() => { setShowBids(v => !v); setShowMassAdd(false); setShowUniqueIdMatcher(false) }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showBids ? "border-green-500 text-green-400 bg-green-900/20" : "border-gray-600 text-gray-600 dark:text-gray-400 hover:border-green-500 hover:text-green-400"}`}>
            💰 Set Starting Bids
          </button>
          <button
            onClick={() => { setShowUniqueIdMatcher(v => !v); setUniqueIdPairs([]); setUniqueIdMsg(null); setShowBids(false); setShowMassAdd(false) }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg border transition-colors ${showUniqueIdMatcher ? "border-cyan-500 text-cyan-400 bg-cyan-900/20" : "border-gray-600 text-gray-600 dark:text-gray-400 hover:border-cyan-500 hover:text-cyan-400"}`}>
            🔗 Unique ID Matcher
          </button>
          <button
            onClick={handleBulkAddConditions}
            disabled={condPending}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors disabled:opacity-50">
            {condPending ? "Updating…" : "✚ Add Conditions to Descriptions"}
          </button>
          {fillMsg  && <span className="text-xs text-[#2AB4A6]">{fillMsg}</span>}
          {bidsMsg  && <span className="text-xs text-green-400">{bidsMsg}</span>}
          {titlesMsg && <span className="text-xs text-[#2AB4A6]">{titlesMsg}</span>}
          {massMsg  && <span className="text-xs text-orange-400">{massMsg}</span>}
          {uniqueIdMsg && <span className="text-xs text-cyan-400">{uniqueIdMsg}</span>}
          {condMsg && <span className="text-xs text-[#2AB4A6]">{condMsg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {selected.size > 0 && !bcLocked && (
            <>
              {(() => {
                const anyUnticked = lots.some(l => selected.has(l.id) && !l.addedToBC)
                return (
                  <button onClick={handleToggleAddedToBC} disabled={bcPending}
                    className="px-4 py-1.5 text-sm font-medium rounded-lg border border-emerald-700 text-emerald-400 hover:bg-emerald-900/30 transition-colors disabled:opacity-50">
                    {bcPending ? "Updating…" : anyUnticked
                      ? `📦 Mark ${selected.size} added to BC`
                      : `↺ Unmark ${selected.size} as added to BC`}
                  </button>
                )
              })()}
              <button onClick={handleGenerateTitles} disabled={titlesPending}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-blue-700 text-blue-400 hover:bg-blue-900/30 transition-colors disabled:opacity-50">
                {titlesPending ? "Generating…" : `✏️ Generate Titles (${selected.size})`}
              </button>
              <button
                onClick={() => onTransfer(Array.from(selected))}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-indigo-700 text-indigo-400 hover:bg-indigo-900/30 transition-colors">
                ↗ Transfer {selected.size} to another auction
              </button>
              <button onClick={() => handleBulkClearPhotos(false)} disabled={photosClearing}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-orange-700 text-orange-400 hover:bg-orange-900/30 transition-colors disabled:opacity-50"
                title="Removes photos from these lots but keeps files in storage">
                {photosClearing ? "Removing…" : `📷🔗 Unlink photos (${selected.size})`}
              </button>
              <button onClick={() => handleBulkClearPhotos(true)} disabled={photosClearing}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
                title="Permanently deletes photo files from storage">
                {photosClearing ? "Removing…" : `📷🗑 Delete from storage (${selected.size})`}
              </button>
              <button onClick={handleBulkDelete} disabled={bulkDeleting}
                className="px-4 py-1.5 text-sm font-medium rounded-lg border border-red-700 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50">
                {bulkDeleting ? "Deleting…" : `🗑 Delete ${selected.size} selected`}
              </button>
            </>
          )}
          {bcMsg && <span className="text-xs text-emerald-400">{bcMsg}</span>}
          {filtersActive && (
            <span className="text-xs text-gray-600 dark:text-gray-500">
              {filtered.length} / {lots.length} lots
              <button onClick={clearFilters} className="ml-2 text-[#2AB4A6] hover:underline">clear</button>
            </span>
          )}
          <button onClick={exportForAHK}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400 hover:text-purple-400 transition-colors">
            ⬇ Export for BC Macro (Tote)
          </button>
          <button onClick={exportForAHKReceipt}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-purple-400 hover:text-purple-400 transition-colors">
            ⬇ Export for BC Macro (Receipt)
          </button>
          <button onClick={exportPhotos} disabled={photoExporting}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-600 text-gray-600 dark:text-gray-400 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors disabled:opacity-50">
            {photoExporting ? "⏳ Exporting…" : "📷 Export Photos (.zip)"}
          </button>
          <button onClick={exportExcel}
            className="px-4 py-1.5 text-sm font-medium rounded-lg border border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-black transition-colors">
            ⬇ Export to Excel
          </button>
        </div>
      </div>
      {photoMsg && <p className="text-xs text-[#2AB4A6] mb-2">{photoMsg}</p>}

      {/* ── Mass Add Lots panel ── */}
      {showMassAdd && !bcLocked && (
        <div className="mb-4 bg-white dark:bg-[#1C1C1E] border border-orange-700/40 rounded-xl p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-orange-300">Mass Add Lots</p>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Creates blank lots in bulk. Barcodes are auto-generated as {auction.code}001, {auction.code}002… continuing from the highest existing barcode.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Number of lots <span className="text-orange-400">*</span></label>
              <input type="number" min={1} max={1000} value={massCount}
                onChange={e => setMassCount(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Vendor</label>
              <input type="text" value={massVendor} onChange={e => setMassVendor(e.target.value)} placeholder="e.g. V000123"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Tote</label>
              <input type="text" value={massTote} onChange={e => setMassTote(e.target.value)} placeholder="e.g. T01"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Receipt</label>
              <input type="text" value={massReceipt} onChange={e => setMassReceipt(e.target.value)} placeholder="e.g. R000123"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Category</label>
              <input type="text" value={massCategory} onChange={e => setMassCategory(e.target.value)} placeholder="e.g. Toys"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-xs text-gray-600 dark:text-gray-400 block mb-1">Sub-category</label>
              <input type="text" value={massSubCat} onChange={e => setMassSubCat(e.target.value)} placeholder="e.g. Action Figures"
                className="w-full bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:border-orange-500" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              disabled={massAdding}
              onClick={() => {
                startMassAdd(async () => {
                  setMassMsg(null)
                  const n = await massCreateLots(auction.id, auction.code, {
                    count:       massCount,
                    vendor:      massVendor,
                    tote:        massTote,
                    receipt:     massReceipt,
                    category:    massCategory,
                    subCategory: massSubCat,
                  })
                  setMassMsg(`✓ ${n} lots created`)
                  setTimeout(() => setMassMsg(null), 4000)
                })
              }}
              className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors">
              {massAdding ? "Creating…" : `Create ${massCount} lot${massCount !== 1 ? "s" : ""}`}
            </button>
            <button onClick={() => setShowMassAdd(false)} className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Set Starting Bids panel ── */}
      {showBids && (() => {
        const eligible = (selected.size > 0 ? lots.filter(l => selected.has(l.id)) : lots).filter(l => l.estimateLow != null)
        const preview  = eligible.slice(0, 3).map(l => ({
          label: l.barcode || l.id,
          low: l.estimateLow!,
          bid: roundUpToIncrement(Math.ceil(l.estimateLow! * bidPct / 100)),
        }))
        return (
          <div className="mb-4 bg-white dark:bg-[#1C1C1E] border border-green-700/40 rounded-xl p-4 space-y-3">
            <p className="text-sm font-semibold text-green-300">Set Starting Bids</p>
            <p className="text-xs text-gray-600 dark:text-gray-500">
              Calculates {bidPct}% of each lot's low estimate, rounded up to the nearest bidding increment.
              {selected.size > 0 ? ` Applies to ${eligible.length} selected lot${eligible.length !== 1 ? "s" : ""} with estimates.` : ` Applies to all ${eligible.length} lots with estimates.`}
            </p>
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-600 dark:text-gray-400">Percentage of low estimate:</label>
              <input type="number" min={1} max={100} value={bidPct}
                onChange={e => setBidPct(Math.max(1, Math.min(100, Number(e.target.value))))}
                className="w-20 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 text-center" />
              <span className="text-xs text-gray-600">%</span>
            </div>
            {preview.length > 0 && (
              <div className="text-xs text-gray-600 dark:text-gray-500 space-y-1">
                <p className="text-gray-600 uppercase tracking-wider">Preview</p>
                {preview.map(p => (
                  <div key={p.label} className="flex gap-3">
                    <span className="text-gray-600 dark:text-gray-400 font-mono w-16 truncate">{p.label}</span>
                    <span>Low est. £{p.low} → starting bid <span className="text-green-400 font-semibold">£{p.bid}</span></span>
                  </div>
                ))}
                {eligible.length > 3 && <p className="text-gray-600">…and {eligible.length - 3} more</p>}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowBids(false)}
                className="px-4 py-2 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
                Cancel
              </button>
              <button onClick={handleSetStartingBids} disabled={bidsPending || eligible.length === 0}
                className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                {bidsPending ? "Applying…" : `Set starting bids for ${eligible.length} lots`}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── Unique ID Matcher panel ── */}
      {showUniqueIdMatcher && (
        <div className="mb-4 bg-white dark:bg-[#1C1C1E] border border-cyan-700/40 rounded-xl p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-cyan-300">Unique ID Matcher</p>
            <p className="text-xs text-gray-600 dark:text-gray-500 mt-0.5">
              Upload a spreadsheet with <span className="font-mono text-gray-600 dark:text-gray-400">Internal Barcode</span> and <span className="font-mono text-gray-600 dark:text-gray-400">UniqueID</span> columns.
              The matching lots in this auction will have their Unique ID updated automatically.
            </p>
          </div>

          {/* Hidden file input */}
          <input
            ref={uniqueIdInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (!file) return
              import("xlsx").then(({ read, utils }) => {
                const reader = new FileReader()
                reader.onload = ev => {
                  const wb   = read(ev.target!.result, { type: "array" })
                  const ws   = wb.Sheets[wb.SheetNames[0]]
                  const rows = utils.sheet_to_json<Record<string, string>>(ws)
                  const pairs: { barcode: string; uniqueId: string }[] = []
                  for (const row of rows) {
                    // Accept common column name variants (case-insensitive)
                    const barcode  = (row["Internal Barcode"] ?? row["Barcode"] ?? row["barcode"] ?? "").toString().trim()
                    const uniqueId = (row["UniqueID"] ?? row["Unique ID"] ?? row["uniqueId"] ?? row["Receipt Unique ID"] ?? "").toString().trim()
                    if (barcode && uniqueId) pairs.push({ barcode, uniqueId })
                  }
                  setUniqueIdPairs(pairs)
                  setUniqueIdMsg(null)
                }
                reader.readAsArrayBuffer(file)
              })
            }}
          />

          {uniqueIdPairs.length === 0 ? (
            <button
              onClick={() => uniqueIdInputRef.current?.click()}
              className="w-full py-6 rounded-xl border-2 border-dashed border-gray-700 hover:border-cyan-500 text-gray-600 dark:text-gray-400 hover:text-cyan-400 transition-colors flex flex-col items-center gap-1.5 text-sm font-medium">
              <span className="text-2xl">📄</span>
              Click to select spreadsheet (.xlsx / .csv)
            </button>
          ) : (
            <div className="space-y-3">
              {/* Preview */}
              <div className="bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-100 dark:bg-[#0d0d0f] border-b border-gray-200 dark:border-gray-700">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-500 font-medium">Barcode</th>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-500 font-medium">Unique ID</th>
                      <th className="text-left px-3 py-2 text-gray-600 dark:text-gray-500 font-medium">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueIdPairs.slice(0, 100).map((p, i) => {
                      const matched = lots.some(l => l.barcode?.toLowerCase() === p.barcode.toLowerCase())
                      return (
                        <tr key={i} className="border-b border-gray-200 dark:border-gray-800 last:border-0">
                          <td className="px-3 py-1.5 font-mono text-gray-600 dark:text-gray-300">{p.barcode}</td>
                          <td className="px-3 py-1.5 font-mono text-cyan-400">{p.uniqueId}</td>
                          <td className="px-3 py-1.5">
                            {matched
                              ? <span className="text-green-400">✓</span>
                              : <span className="text-gray-600">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-500">
                {uniqueIdPairs.length} rows in file ·{" "}
                <span className="text-green-400 font-medium">
                  {uniqueIdPairs.filter(p => lots.some(l => l.barcode?.toLowerCase() === p.barcode.toLowerCase())).length} matched
                </span>
                {uniqueIdPairs.length > 100 && <span className="text-gray-600"> (showing first 100)</span>}
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setUniqueIdPairs([]); setUniqueIdMsg(null) }}
                  className="px-4 py-2 rounded-lg border border-gray-700 text-gray-600 dark:text-gray-400 text-sm hover:border-gray-500 transition-colors">
                  ← Change file
                </button>
                <button
                  disabled={uniqueIdPending}
                  onClick={() => {
                    startUniqueId(async () => {
                      const result = await bulkAssignUniqueIds(auctionId, uniqueIdPairs)
                      setUniqueIdMsg(`✓ Updated ${result.updated} lot${result.updated !== 1 ? "s" : ""}, skipped ${result.skipped}`)
                      setUniqueIdPairs([])
                      setShowUniqueIdMatcher(false)
                      onDelete()
                      setTimeout(() => setUniqueIdMsg(null), 5000)
                    })
                  }}
                  className="flex-1 py-2 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors">
                  {uniqueIdPending ? "Applying…" : `Apply ${uniqueIdPairs.filter(p => lots.some(l => l.barcode?.toLowerCase() === p.barcode.toLowerCase())).length} matches`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[700px]">
          <thead>
            <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-[#141416]">
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll} className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
              </th>
              {(["barcode","receiptUniqueId","title","vendor","receipt","tote","category","photos","status","addedBy"] as SortCol[]).map((col, i) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none whitespace-nowrap">
                  {["Barcode","Unique ID","Title","Vendor","Receipt","Tote","Category","Photos","Status","Added By"][i]}
                  {sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : <span className="text-gray-700"> ⇅</span>}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">AI</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">BC</th>
              <th className="px-4 py-3" />
            </tr>
            {/* Filter row */}
            <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#111113]">
              <td className="px-4 py-1.5" />
              <td className="px-2 py-1.5"><input value={fBarcode}  onChange={e => setFBarcode(e.target.value)}  placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fUniqueId} onChange={e => setFUniqueId(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fTitle}    onChange={e => setFTitle(e.target.value)}    placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fVendor}   onChange={e => setFVendor(e.target.value)}   placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fReceipt}  onChange={e => setFReceipt(e.target.value)}  placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fTote}     onChange={e => setFTote(e.target.value)}     placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5"><input value={fCategory} onChange={e => setFCategory(e.target.value)} placeholder="Filter…" className={COL_INPUT} /></td>
              <td className="px-2 py-1.5">
                <select value={fPhotos} onChange={e => setFPhotos(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="any">Has photos</option>
                  <option value="none">No photos</option>
                </select>
              </td>
              <td className="px-2 py-1.5">
                <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  {uniqueStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5">
                <select value={fAiUpgraded} onChange={e => setFAiUpgraded(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="yes">✨ Upgraded</option>
                  <option value="no">Not yet</option>
                </select>
              </td>
              <td className="px-2 py-1.5">
                <select value={fAddedToBC} onChange={e => setFAddedToBC(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="yes">📦 Added</option>
                  <option value="no">Not yet</option>
                </select>
              </td>
              <td />
            </tr>
          </thead>
          <tbody>
            {filtered.map(lot => (
              <tr key={lot.id} className={`border-b border-gray-200 dark:border-gray-800 last:border-0 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer ${selected.has(lot.id) ? "bg-[#2AB4A6]/5" : ""}`} onClick={() => onEdit(lot.id)}>
                <td className="w-8" onClick={e => e.stopPropagation()}>
                  <label className="flex items-center justify-center px-4 py-3 cursor-pointer h-full">
                    <input type="checkbox" checked={selected.has(lot.id)} onChange={() => toggleSelect(lot.id)}
                      className="w-4 h-4 rounded border-gray-600 accent-[#2AB4A6]" />
                  </label>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{lot.barcode ?? "—"}</td>
                <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                  {lot.receiptUniqueId
                    ? <span className="text-cyan-400">{lot.receiptUniqueId}</span>
                    : <span className="text-gray-700">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200 max-w-[160px] truncate">{lot.title || <span className="text-gray-600 italic">Uncatalogued</span>}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{lot.vendor ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">
                  {lot.receipt ?? "—"}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs font-mono whitespace-nowrap">{lot.tote ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-xs">
                  {lot.category ? (
                    <span>{lot.category}{lot.subCategory && <span className="text-gray-600"> › {lot.subCategory}</span>}</span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3">
                  {lot.imageUrls.length > 0 ? (
                    <span className="text-xs bg-[#2AB4A6]/20 text-[#2AB4A6] px-2 py-0.5 rounded-full font-medium">
                      {lot.imageUrls.length}
                    </span>
                  ) : <span className="text-gray-700 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[lot.status] ?? "bg-gray-700 text-gray-300"}`}>
                    {lot.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
                  {lot.createdByName ?? "—"}
                </td>
                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => toggleLotAiUpgraded(lot.id, auctionId, !lot.aiUpgraded)}
                    title={lot.aiUpgraded ? "Click to mark as not upgraded" : "Click to mark as AI upgraded"}
                    className="transition-opacity hover:opacity-60">
                    {lot.aiUpgraded
                      ? <span>✨</span>
                      : <span className="text-gray-700 text-xs">—</span>}
                  </button>
                </td>
                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => toggleLotAddedToBC(lot.id, auctionId, !lot.addedToBC)}
                    title={lot.addedToBC ? "Click to mark as not yet added to BC" : "Click to mark as added to BC"}
                    className="transition-opacity hover:opacity-60">
                    {lot.addedToBC
                      ? <span title="Added to Business Central">📦</span>
                      : <span className="text-gray-700 text-xs">—</span>}
                  </button>
                </td>
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  {!bcLocked && (
                    <button onClick={() => handleDelete(lot)} disabled={deleting === lot.id || pending}
                      className="text-xs text-red-500 hover:text-red-400 transition-colors disabled:opacity-40">
                      {deleting === lot.id ? "…" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-600 text-sm">No lots match your filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Lot edit view (inside manage-lots tab) ───────────────────────────────────

const PARCEL_OPTIONS = ["Small", "Medium", "Large", "Contact", "Collection Only"]

function LotEditView({ lot, auctionId, allLots, entryDir, onDone, onEdit }: { lot: Lot | null; auctionId: string; allLots?: Lot[]; entryDir?: "next" | "prev" | null; onDone: () => void; onEdit?: (id: string, dir: "next" | "prev") => void }) {
  const sortedLots = useMemo(() => {
    if (!allLots) return []
    return [...allLots].sort((a, b) => (a.barcode ?? "").localeCompare(b.barcode ?? "", undefined, { numeric: true }))
  }, [allLots])
  const currentIdx = sortedLots.findIndex(l => l.id === lot?.id)
  const prevLot    = currentIdx > 0 ? sortedLots[currentIdx - 1] : null
  const nextLot    = currentIdx < sortedLots.length - 1 ? sortedLots[currentIdx + 1] : null

  const contentRef = useRef<HTMLDivElement>(null)

  // Slide-in on mount
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
    if (!el) { onEdit?.(id, dir); return }
    const endX = dir === "next" ? "-60px" : "60px"
    el.style.transition = "transform 180ms cubic-bezier(0.55,0,1,0.45), opacity 160ms ease"
    el.style.transform = `translateX(${endX})`
    el.style.opacity = "0"
    setTimeout(() => onEdit?.(id, dir), 185)
  }

  const [pending, start]             = useTransition()
  const [imageKeys, setImageKeys]    = useState<string[]>(lot?.imageUrls ?? [])
  const [signedUrls, setSignedUrls]  = useState<Record<string, string>>({})
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoRef = useRef<HTMLInputElement>(null)

  const [titleVal, setTitleVal] = useState(lot?.title ?? "")
  const [descVal,  setDescVal]  = useState(lot?.description ?? "")

  // Parse stored condition "Good to Excellent" → cond1="Good", cond2="Excellent"
  const condParts = (lot?.condition ?? "").split(" to ")
  const [cond1, setCond1] = useState(condParts[0] ?? "")
  const [cond2, setCond2] = useState(condParts[1] ?? "")
  const condValue = [cond1, cond2].filter(Boolean).sort((a, b) => CONDITIONS.indexOf(b) - CONDITIONS.indexOf(a)).join(" to ")

  function addConditionToDesc() {
    if (!condValue) return
    const condText = `Condition appears ${condValue}.`
    setDescVal(prev => {
      const trimmed = prev.trimEnd()
      return trimmed ? `${trimmed} ${condText}` : condText
    })
  }

  // Parcel size is stored in notes
  const [parcel, setParcel] = useState(lot?.notes ?? "")

  // Category / sub-category / brand
  const [mainCat,  setMainCat]  = useState(lot?.category ?? "")
  const [subCat,   setSubCat]   = useState(lot?.subCategory ?? "")
  const [brand,    setBrand]    = useState(lot?.brand ?? "")
  const [brandSearch, setBrandSearch] = useState(lot?.brand ?? "")
  const [brandFocused, setBrandFocused] = useState(false)
  const mainCatList = Object.keys(CATEGORY_MAP).sort()
  const subCatList  = mainCat ? (CATEGORY_MAP[mainCat] ?? []) : []
  const filteredBrands = useMemo(() =>
    brandSearch.trim().length < 2
      ? []
      : BRANDS_LIST.filter(b => b.toLowerCase().includes(brandSearch.toLowerCase())).slice(0, 10),
    [brandSearch]
  )

  useEffect(() => {
    if (!lot || imageKeys.length === 0) return
    const missing = imageKeys.filter(k => !signedUrls[k])
    if (missing.length === 0) return
    setLoadingPhotos(true)
    Promise.all(
      missing.map(async key => {
        const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
        const { url } = await res.json()
        return [key, url] as [string, string]
      })
    ).then(results => {
      setSignedUrls(prev => ({ ...prev, ...Object.fromEntries(results) }))
      setLoadingPhotos(false)
    })
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

  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!lot) return
    const fd = new FormData(e.currentTarget)
    start(async () => {
      await updateLot(lot.id, auctionId, fd)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  if (!lot) return null

  const defaultDate = ""  // lots don't have a date field, placeholder

  return (
    <div>
      {/* Sticky nav bar */}
      <div className="sticky top-0 z-10 flex items-center gap-2 py-2 mb-5 bg-gray-50 dark:bg-[#141416] border-b border-gray-200 dark:border-gray-800 -mx-3 px-3">
        <button onClick={onDone} className="text-sm text-[#2AB4A6] hover:text-[#24a090] transition-colors flex-shrink-0">
          ← Back to lots
        </button>
        {sortedLots.length > 0 && (
          <span className="text-xs text-gray-600 flex-1 text-center">{currentIdx + 1} / {sortedLots.length}</span>
        )}
        <button type="button" onClick={() => prevLot && navigate(prevLot.id, "prev")} disabled={!prevLot}
          className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3C3C3E] disabled:opacity-25 transition-colors flex-shrink-0">
          ← Prev
        </button>
        <button type="button" onClick={() => nextLot && navigate(nextLot.id, "next")} disabled={!nextLot}
          className="px-3 py-1.5 rounded-lg bg-[#2AB4A6] hover:bg-[#24a090] text-white text-xs font-semibold disabled:opacity-25 transition-colors flex-shrink-0">
          Next →
        </button>
      </div>

      {/* Animated content */}
      <div ref={contentRef}>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-4">
            <div>
              <label className={lbl}>Barcode</label>
              <input name="barcode" defaultValue={lot.barcode ?? ""} className={input} placeholder="BC internal barcode" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl} style={{margin:0}}>Title *</label>
                <span className={`text-xs ${titleVal.length > TITLE_LIMIT ? "text-red-400" : titleVal.length > TITLE_LIMIT * 0.9 ? "text-yellow-400" : "text-gray-600"}`}>
                  {titleVal.length}/{TITLE_LIMIT}
                </span>
              </div>
              <input name="title" required value={titleVal} onChange={e => setTitleVal(e.target.value.slice(0, TITLE_LIMIT))}
                maxLength={TITLE_LIMIT} className={input} />
            </div>
            <div>
              <label className={lbl}>Key Points</label>
              <textarea name="keyPoints" rows={4} defaultValue={lot.keyPoints}
                className={`${input} resize-none`} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl} style={{ margin: 0 }}>Description</label>
                {condValue && (
                  <button type="button" onClick={addConditionToDesc}
                    className="text-xs px-2.5 py-1 bg-[#2AB4A6]/20 border border-[#2AB4A6] text-[#2AB4A6] rounded hover:bg-[#2AB4A6]/30 transition-colors font-medium">
                    + Add condition to description
                  </button>
                )}
              </div>
              <textarea name="description" rows={4} value={descVal} onChange={e => setDescVal(e.target.value)}
                className={`${input} resize-none`} />
            </div>
            <div>
              <label className={lbl}>Extra Details <span className="text-gray-600 font-normal">(SEO paragraph — generated on Lot History tab)</span></label>
              <textarea name="extraDetails" rows={5} defaultValue={lot.extraDetails ?? ""}
                className={`${input} resize-none`} placeholder="No extra details yet — generate them on the Lot History tab." />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={lbl} style={{ margin: 0 }}>Condition</label>
                {cond1 && <button type="button" onClick={() => setCond1("")} className="text-xs text-gray-600 dark:text-gray-500 hover:text-red-400 transition-colors leading-none">× clear</button>}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CONDITIONS.map(c => (
                  <button key={c} type="button" onClick={() => setCond1(c)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cond1 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <label className={lbl} style={{ margin: 0 }}>Condition To <span className="text-gray-600 font-normal">(optional)</span></label>
                {cond2 && <button type="button" onClick={() => setCond2("")} className="text-xs text-gray-600 dark:text-gray-500 hover:text-red-400 transition-colors leading-none">× clear</button>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CONDITIONS.map(c => (
                  <button key={c} type="button" onClick={() => setCond2(c)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cond2 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>
              {condValue && <p className="text-xs text-[#2AB4A6] mt-1">{condValue}</p>}
              <input type="hidden" name="condition" value={condValue} />
            </div>
            <div>
              <label className={lbl}>Status</label>
              <select name="status" defaultValue={lot.status} className={input}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Parcel Size</label>
              <div className="flex flex-wrap gap-1.5">
                {PARCEL_OPTIONS.map(opt => (
                  <button key={opt} type="button" onClick={() => setParcel(v => v === opt ? "" : opt)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${parcel === opt ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                    {opt}
                  </button>
                ))}
              </div>
              <input type="hidden" name="notes" value={parcel} />
            </div>
          </div>

          {/* Right */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Estimate Low (£)</label>
                <input name="estimateLow" type="number" min="0" defaultValue={lot.estimateLow ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Estimate High (£)</label>
                <input name="estimateHigh" type="number" min="0" defaultValue={lot.estimateHigh ?? ""} className={input} />
              </div>
            </div>
            {(lot.aiEstimateLow != null || lot.aiEstimateHigh != null) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-950/30 border border-purple-800/40">
                <span className="text-xs text-purple-400">✨ AI estimate:</span>
                <span className="text-xs font-semibold text-purple-300">
                  {lot.aiEstimateLow != null && lot.aiEstimateHigh != null
                    ? `£${lot.aiEstimateLow}–£${lot.aiEstimateHigh}`
                    : lot.aiEstimateLow != null
                      ? `£${lot.aiEstimateLow}`
                      : `£${lot.aiEstimateHigh}`}
                </span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Starting Bid (£)</label>
                <input name="startingBid" type="number" min="0" defaultValue={lot.startingBid ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Reserve (£)</label>
                <input name="reserve" type="number" min="0" defaultValue={lot.reserve ?? ""} className={input} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Hammer Price (£)</label>
                <input name="hammerPrice" type="number" min="0" defaultValue={lot.hammerPrice ?? ""} className={input} />
              </div>
              <div />
            </div>
            <div>
              <label className={lbl}>Vendor</label>
              <input name="vendor" defaultValue={lot.vendor ?? ""} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Tote</label>
                <input name="tote" defaultValue={lot.tote ?? ""} className={input} />
              </div>
              <div>
                <label className={lbl}>Receipt</label>
                <input name="receipt" defaultValue={lot.receipt ?? ""} className={input} />
              </div>
            </div>
            <div>
              <label className={lbl}>Receipt Unique ID</label>
              <input name="receiptUniqueId" defaultValue={lot.receiptUniqueId ?? ""} className={input}
                placeholder="e.g. R007523-1 (auto-assigned on create)" />
            </div>
            <div>
              <label className={lbl}>Category</label>
              <select value={mainCat} onChange={e => { setMainCat(e.target.value); setSubCat("") }} className={input}>
                <option value="">— Select —</option>
                {mainCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="category" value={mainCat} />
            </div>
            <div>
              <label className={lbl}>Sub-Category</label>
              <select value={subCat} onChange={e => setSubCat(e.target.value)} className={input} disabled={!mainCat}>
                <option value="">— Select —</option>
                {subCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="subCategory" value={subCat} />
            </div>
            <div className="relative">
              <label className={lbl}>Brand</label>
              <input
                value={brandSearch}
                onChange={e => { setBrandSearch(e.target.value); setBrand(e.target.value) }}
                onFocus={() => setBrandFocused(true)}
                onBlur={() => setTimeout(() => setBrandFocused(false), 150)}
                placeholder="Search brand…"
                className={input}
                autoComplete="off"
              />
              <input type="hidden" name="brand" value={brand} />
              {brandFocused && filteredBrands.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                  {filteredBrands.map(b => (
                    <li key={b}>
                      <button type="button" onClick={() => { setBrand(b); setBrandSearch(b) }}
                        className="w-full text-left px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2C2C2E] transition-colors">
                        {b}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-300 dark:border-gray-700">
          <button onClick={onDone} type="button"
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-[#2C2C2E] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#3C3C3E] transition-colors">
            ← Back
          </button>
          <button type="submit" disabled={pending}
            className="bg-[#2AB4A6] hover:bg-[#24a090] disabled:opacity-50 text-white font-semibold text-sm px-6 py-2 rounded-lg transition-colors">
            {pending ? "Saving…" : saved ? "✓ Saved" : "Save Changes"}
          </button>
        </div>
      </form>

      {/* ── Photo management ── */}
      <div className="mt-6 border-t border-gray-200 dark:border-gray-800 pt-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300">Photos ({imageKeys.length})</h3>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} />
          <button onClick={() => photoRef.current?.click()} disabled={uploadingPhoto}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-600 dark:text-gray-400 hover:text-[#2AB4A6] text-xs transition-colors disabled:opacity-50">
            {uploadingPhoto ? "Uploading…" : "📷 Add photo"}
          </button>
        </div>

        {loadingPhotos && <p className="text-xs text-gray-600">Loading photos…</p>}

        {!loadingPhotos && imageKeys.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {imageKeys.map(key => (
              <div key={key} className="relative aspect-square group">
                {signedUrls[key] ? (
                  <a href={signedUrls[key]} target="_blank" rel="noopener noreferrer">
                    <img src={signedUrls[key]} alt="Lot photo" className="w-full h-full object-cover rounded-lg border border-gray-700" />
                  </a>
                ) : (
                  <div className="w-full h-full rounded-lg bg-gray-800 animate-pulse" />
                )}
                <button onClick={() => handlePhotoDelete(key)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-700 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {!loadingPhotos && imageKeys.length === 0 && (
          <p className="text-xs text-gray-600">No photos yet.</p>
        )}
      </div>
      </div>{/* end animated content */}
    </div>
  )
}
