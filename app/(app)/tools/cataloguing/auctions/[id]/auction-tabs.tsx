"use client"

import { useState, useTransition, useRef, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { updateAuction, updateLot, deleteLot, deleteAuction, uploadLotPhoto, deleteLotPhoto, lookupToteOrReceipt, setLotsVendorReceipt, togglePublished, generateTitlesFromDescriptions, setStartingBids, toggleLotAiUpgraded, toggleLotAddedToBC, bulkSetLotsAddedToBC, bulkSetLotsAiExcluded, massCreateLots, bulkAssignUniqueIds, bulkAddConditionsToDescriptions, bulkRemoveConditionsFromDescriptions, bulkClearDescriptions, transferLots, bulkClearLotPhotos, listBulkUndos, undoBulk } from "@/lib/actions/catalogue"
import { grantAuctionAccess, revokeAuctionAccess } from "@/lib/actions/admin"
import LotWizardTab, { BRANDS_LIST } from "./lot-wizard-tab"
import { useCategoryMap } from "@/lib/use-category-map"
import { parseCondition, buildCondition, type BoxPrefixMode } from "@/lib/condition"
import { useConditionWordings } from "@/lib/use-condition-wordings"
import PhotoOnlyTab from "./photo-only-tab"
import ImportTab from "./import-tab"
import AiUpgradeTab from "./ai-upgrade-tab"
import StatsTab from "./stats-tab"
import ReviewTab from "./review-tab"
import LotHistoryTab from "./lot-history-tab"
import LockingCheckTab from "./locking-check-tab"
import ToteCheckTab from "./tote-check-tab"
import BcCorrectionsTab from "./bc-corrections-tab"
import BcCheckTab from "./bc-check-tab"
import CatchupSheetTab from "./catchup-sheet-tab"
import BcFillTab from "./bc-fill-tab"
import * as XLSX from "xlsx"
import JSZip from "jszip"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "settings" | "add-lot" | "manage-lots" | "photo-only" | "import" | "ai-upgrade" | "stats" | "lot-history" | "review" | "locking-check" | "tote-check" | "bc-corrections" | "bc-check" | "bc-fill" | "catchup-sheet"

interface Auction {
  id: string; code: string; name: string; auctionDate: Date | null
  auctionType: string; eventName: string | null; notes: string | null
  locked: boolean; finished: boolean; complete: boolean; published: boolean
  catalogued: boolean; addedToBC: boolean; photography: boolean; aiRan: boolean
  reviewKpMode: string
}

interface Lot {
  id: string; barcode: string | null; title: string; keyPoints: string; description: string
  estimateLow: number | null; estimateHigh: number | null; aiEstimateLow: number | null; aiEstimateHigh: number | null
  startingBid: number | null; reserve: number | null
  hammerPrice: number | null; condition: string | null; vendor: string | null
  tote: string | null; receipt: string | null; receiptUniqueId: string | null; category: string | null
  subCategory: string | null; brand: string | null; notes: string | null
  status: string; aiUpgraded: boolean; addedToBC: boolean; aiExcluded: boolean; createdByName: string | null; imageUrls: string[]
  aiFlagNote: string | null   // AI-flagged possible cataloguer mistake — surfaced by the Locking Check
  reviewFlag: string | null   // reason text set from the Review tab
  createdAt: string          // ISO — when the lot was created ("Date Added" column)
  extraDetails: string | null
}

// "Date Added" — short and scannable in a table column, and the time matters
// (several lots a day from the same person), so both are shown.
/** The lot's creation date as yyyy-mm-dd, to compare against an <input type="date">.
 *  ⚠ Built from the LOCAL date parts, not toISOString() — that converts to UTC, so anything
 *  catalogued after 01:00 BST would filter under the previous day. Matches what the Date Added
 *  column shows, which is also local. */
function ukDay(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtDateAdded(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
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

  // ⚠ Sharing a unique ID does NOT make two lots the same item. The Hub no
  // longer mints IDs — BC supplies them — so a clash usually means bad data,
  // not a double-entered lot. Two lots with DIFFERENT barcodes are two
  // different things on the shelf, whatever their ID says, and deleting one
  // would destroy a real lot. Jordan hit exactly this on F109: two distinct
  // Steiff bears, F109630 and F109631, both carrying R008767-129, with the
  // checker offering to delete one.
  //
  // So a group is only a genuine duplicate when the barcodes agree — or when at
  // most one of them has a barcode at all (the un-barcoded one being the stray
  // re-entry). Anything else is a CLASH: shown, explained, never deletable here.
  function isRealDuplicate(group: Lot[]): boolean {
    const barcodes = new Set(group.map(l => (l.barcode ?? "").trim().toLowerCase()).filter(Boolean))
    return barcodes.size <= 1
  }

  const live = dupeGroups
    .map(g => g.filter(l => !deleted.has(l.id)))
    .filter(g => g.length > 1)

  const visibleGroups = live.filter(isRealDuplicate)
  const clashGroups   = live.filter(g => !isRealDuplicate(g))

  // The other way a lot can be double-identified: two lots on ONE barcode. This
  // is what silently unbalances BC Match — BC has a single row for that barcode,
  // so one of our two lots can never be matched or given its unique ID, and
  // before this it showed up nowhere. Read-only here: which one is wrong is a
  // judgement about the physical items, not something to guess at.
  const barcodeClashes = useMemo(() => {
    const map = new Map<string, Lot[]>()
    for (const l of lots) {
      const key = (l.barcode ?? "").trim().toLowerCase()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    }
    return [...map.values()].filter(g => g.length > 1)
  }, [lots])
  const visibleBarcodeClashes = barcodeClashes
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

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Two lots on one barcode — the thing that unbalances BC Match. */}
          {visibleBarcodeClashes.length > 0 && (
            <div className="bg-orange-50 dark:bg-orange-950/30 border border-orange-300 dark:border-orange-800 rounded-lg p-4">
              <p className="text-sm font-semibold text-orange-800 dark:text-orange-300 mb-1">
                {visibleBarcodeClashes.length} barcode{visibleBarcodeClashes.length === 1 ? " is" : "s are"} on more than one lot
              </p>
              <p className="text-xs text-orange-700 dark:text-orange-400 mb-3">
                Business Central has one row per barcode, so only one of each pair below can ever be matched or given its unique ID —
                the other is left out of 🔗 BC Match entirely. Check the items on the shelf, correct the barcode on whichever lot is
                wrong, then run BC Match again. Nothing is deleted from here: which one is wrong depends on the actual items.
              </p>
              <div className="space-y-3">
                {visibleBarcodeClashes.map((group, gi) => (
                  <div key={gi} className="bg-white dark:bg-[#141416] border border-orange-200 dark:border-orange-900 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-orange-100 dark:bg-orange-900/30 border-b border-orange-200 dark:border-orange-900">
                      <span className="text-xs font-mono text-orange-800 dark:text-orange-300 font-semibold">{group[0].barcode}</span>
                      <span className="text-xs text-orange-700 dark:text-orange-500 ml-2">— on {group.length} lots</span>
                    </div>
                    {group.map(lot => (
                      <div key={lot.id} className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-gray-700 dark:text-gray-300">{lot.receiptUniqueId || "no unique ID"}</span>
                          {lot.imageUrls.length > 0 && <span className="text-blue-500">{lot.imageUrls.length} photos</span>}
                          {lot.vendor && <span className="text-gray-500">vendor {lot.vendor}</span>}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-300 truncate mt-0.5">{lot.title || "No title"}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Same ID, different barcodes — two real lots, not a duplicate. */}
          {clashGroups.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                {clashGroups.length} unique {clashGroups.length === 1 ? "ID is" : "IDs are"} on more than one lot — these are NOT duplicates
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                Each of these is a different item with its own barcode, so nothing here can be deleted — you&apos;d lose a real lot.
                The unique IDs come from Business Central, so a clash means the wrong ID has been written onto one of them.
                Fix the ID on the sale page, or run 🔗 BC Match again to pull the right ones through.
              </p>
              <div className="space-y-3">
                {clashGroups.map((group, gi) => (
                  <div key={gi} className="bg-white dark:bg-[#141416] border border-amber-200 dark:border-amber-900 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-900">
                      <span className="text-xs font-mono text-amber-800 dark:text-amber-300 font-semibold">{group[0].receiptUniqueId}</span>
                      <span className="text-xs text-amber-700 dark:text-amber-500 ml-2">— on {group.length} different lots</span>
                    </div>
                    {group.map(lot => (
                      <div key={lot.id} className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 last:border-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-gray-700 dark:text-gray-300 font-semibold">{lot.barcode || "no barcode"}</span>
                          {lot.imageUrls.length > 0 && <span className="text-blue-500">{lot.imageUrls.length} photos</span>}
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-300 truncate mt-0.5">{lot.title || "No title"}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {visibleGroups.length === 0 ? (
            clashGroups.length === 0 && visibleBarcodeClashes.length === 0
              ? <p className="text-green-400 text-sm text-center py-8">✓ No duplicates found</p>
              : <p className="text-gray-500 text-sm text-center py-4">No genuine duplicates to remove.</p>
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
              : clashGroups.length + visibleBarcodeClashes.length > 0
                ? `${clashGroups.length + visibleBarcodeClashes.length} clash${clashGroups.length + visibleBarcodeClashes.length !== 1 ? "es" : ""} to fix · nothing to delete`
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
  // "duplicate" = two or more of OUR lots carry this barcode, so BC's single row
  // for it can't be attributed to one of them. Never imported.
  status:     "match" | "mismatch" | "not_found" | "our_only" | "duplicate"
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

  // ⚠ Map to a LIST, not a single lot. Keying straight to one lot silently
  // dropped the loser whenever two of our lots shared a barcode: BC's one row
  // matched whichever won, and the other lot appeared in no category at all —
  // not in the BC rows, and not in "in our system but not in BC" either, because
  // its barcode IS in the file. That is how F109 read "594 BC rows · 595 our
  // lots" with every count reconciling to 594 and nothing flagged.
  const byBarcode = useMemo(() => {
    const m = new Map<string, Lot[]>()
    for (const l of lots) {
      const key = (l.barcode ?? "").toLowerCase().trim()
      if (!key) continue
      const list = m.get(key)
      if (list) list.push(l)
      else m.set(key, [l])
    }
    return m
  }, [lots])

  /** Lots that can never be matched, because they carry no barcode at all. */
  const noBarcodeCount = useMemo(() => lots.filter(l => !(l.barcode ?? "").trim()).length, [lots])
  const ourBarcodedCount = useMemo(() => lots.filter(l => (l.barcode ?? "").trim()).length, [lots])

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
        const parsed: BCMatchRow[] = raw.flatMap((r): BCMatchRow[] => {
          const barcode    = String(r["Internal Barcode"] ?? "").trim()
          const bcReceipt  = String(r["Receipt No."]      ?? "").trim()
          const bcUniqueId = String(r["UniqueID"]         ?? "").trim()
          if (!barcode) return []
          const ours = byBarcode.get(barcode.toLowerCase()) ?? []
          if (ours.length === 0) {
            return [{ barcode, bcReceipt, bcUniqueId, ourReceipt: null, ourUniqueId: null, lotId: null, status: "not_found" as const }]
          }
          // Two of our lots on one barcode — BC's row can't be attributed to
          // either, so show BOTH and import neither. Guessing would write BC's
          // Unique ID onto the wrong lot, which is the exact class of mistake
          // the barcode-only rule exists to prevent.
          if (ours.length > 1) {
            return ours.map(lot => ({
              barcode, bcReceipt, bcUniqueId,
              ourReceipt: lot.receipt, ourUniqueId: lot.receiptUniqueId, lotId: lot.id,
              status: "duplicate" as const,
            }))
          }
          const lot = ours[0]
          const receiptMatch = (lot.receipt ?? "").trim().toUpperCase() === bcReceipt.toUpperCase()
          return [{ barcode, bcReceipt, bcUniqueId, ourReceipt: lot.receipt, ourUniqueId: lot.receiptUniqueId, lotId: lot.id, status: receiptMatch ? "match" as const : "mismatch" as const }]
        })

        // Reverse check — our lots whose barcode doesn't appear in the BC export at all
        const bcBarcodeSet = new Set(parsed.map(r => r.barcode.toLowerCase()))
        const ourOnly: BCMatchRow[] = lots
          .filter(l => (l.barcode ?? "").trim() && !bcBarcodeSet.has(l.barcode!.toLowerCase().trim()))
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
  const duplicate  = rows.filter(r => r.status === "duplicate")

  // ⚠ Make the arithmetic answer for itself. Every one of our barcoded lots must
  // land in exactly one bucket; if it doesn't, say so rather than leaving a
  // one-lot shortfall for someone to spot by eye. That shortfall is what Jordan
  // caught on F109 — "595 lots yet its only doing something with 594".
  const accountedLots = matched.length + mismatched.length + duplicate.length + ourOnly.length
  const unaccounted   = ourBarcodedCount - accountedLots

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
            {rows.length > 0 && <span className="text-xs text-gray-500">{rows.filter(r => r.status !== "our_only").length} BC rows · {ourBarcodedCount} our lots</span>}
          </div>

          {/* Anything that can't be matched at all, said plainly up front. */}
          {rows.length > 0 && (noBarcodeCount > 0 || unaccounted !== 0) && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3 text-sm text-amber-700 dark:text-amber-300 space-y-1">
              {noBarcodeCount > 0 && (
                <p>
                  <strong>{noBarcodeCount}</strong> {noBarcodeCount === 1 ? "lot has" : "lots have"} no barcode, so {noBarcodeCount === 1 ? "it can" : "they can"}&apos;t
                  be matched to BC at all and {noBarcodeCount === 1 ? "isn" : "aren"}&apos;t counted below.
                </p>
              )}
              {unaccounted !== 0 && (
                <p>
                  <strong>{Math.abs(unaccounted)}</strong> of our lots {unaccounted > 0 ? "don&apos;t appear" : "appear more than once"} in
                  the figures below. That shouldn&apos;t happen — please tell IT which sale this is.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3 text-sm text-red-700 dark:text-red-400">{error}</div>
          )}

          {rows.length > 0 && (
            <>
              {/* Summary cards — click to filter table */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {([
                  { status: "match"     as const, count: matched.length,    label: "Receipt matches — ready to import", active: "bg-green-100 dark:bg-green-900/60 ring-2 ring-green-500",  inactive: "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/50",  num: "text-green-700 dark:text-green-400",  txt: "text-green-600 dark:text-green-500"  },
                  { status: "duplicate" as const, count: duplicate.length,   label: "Same barcode on two lots — skipped", active: "bg-orange-100 dark:bg-orange-900/60 ring-2 ring-orange-500", inactive: "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/50", num: "text-orange-700 dark:text-orange-400", txt: "text-orange-600 dark:text-orange-500" },
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
                          {r.status === "duplicate" && <span className="text-orange-600 dark:text-orange-400 font-semibold" title="Two of our lots share this barcode, so there is no way to tell which one BC's row belongs to. Fix the barcode on one of them, then match again.">⚠ Barcode on 2 lots</span>}
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

export type SaleAccessUser = { id: string; name: string }
export type SaleAccessEntry = { userId: string; name: string; grantedBy: string | null }

export default function AuctionTabs({ auction, lots, userId, userName, userRole, showScanTimer, showLotTimer, timerRedMins, manualDescriptions, allAuctions, extraAccess = [], assignableUsers = [] }: { auction: Auction; lots: Lot[]; userId: string; userName: string; userRole: string; showScanTimer?: boolean; showLotTimer?: boolean; timerRedMins?: number; manualDescriptions?: boolean; allAuctions: AuctionSummary[]; extraAccess?: SaleAccessEntry[]; assignableUsers?: SaleAccessUser[] }) {
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

  function openLotInManager(id: string) {
    setTab("manage-lots")
    openLot(id)
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
    { id: "ai-upgrade",   label: "✨ AI Upgrade" },
    { id: "review",       label: "🔍 Review" },
    { id: "stats",        label: "📊 Statistics" },
    { id: "lot-history",    label: "📖 Lot History" },
    { id: "locking-check", label: "🔒 Locking Check" },
    { id: "tote-check",    label: "🧾 Tote Check" },
    { id: "bc-corrections", label: "🔧 BC Corrections" },
    { id: "bc-check",      label: "📋 BC Check" },
    { id: "catchup-sheet", label: "📄 Catch-up sheet" },
    { id: "bc-fill",       label: "📤 Push to BC" },
    { id: "settings",      label: "Auction Settings" },
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
      <div className="flex items-center gap-3 mb-5 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          <button onClick={() => router.push("/tools/cataloguing/auctions")}
            className="text-sm text-[#2AB4A6] hover:text-[#24a090] transition-colors flex-shrink-0">
            ← Auctions
          </button>
          <span className="text-gray-700 flex-shrink-0">/</span>
          <span className="font-mono font-bold text-[#2AB4A6] flex-shrink-0">{auction.code}</span>
          <span className="text-gray-600 dark:text-gray-300 font-medium flex-shrink-0">{auction.name}</span>
          {auction.catalogued  && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/50 text-blue-300 flex-shrink-0">Catalogued</span>}
          {auction.addedToBC   && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-900/50 text-orange-300 flex-shrink-0">Added to BC</span>}
          {auction.photography && <span className="text-xs px-2 py-0.5 rounded-full bg-purple-900/50 text-purple-300 flex-shrink-0">Photography</span>}
          {auction.aiRan       && <span className="text-xs px-2 py-0.5 rounded-full bg-pink-900/50 text-pink-300 flex-shrink-0">Ran through AI</span>}
          {auction.complete    && <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/50 text-green-300 flex-shrink-0">Complete</span>}
          {published && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-300 flex-shrink-0">● Live on Site</span>}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-shrink-0">
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
              // The lot's RECORDED condition, so the Copier can check it is
              // actually in the description rather than just reminding you.
              Condition:            l.condition || "",
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
      {/* Wraps rather than scrolls: with this many tabs the strip overflows on a
          normal window, and a hidden horizontal scroll just loses the last tabs
          off the edge where nobody finds them. */}
      <div className="flex-shrink-0 flex flex-wrap border-b border-gray-300 dark:border-gray-700 mb-6 -mx-6 px-6">
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
        {tab === "settings" && (
          <SettingsTab
            auction={auction}
            isAdmin={userRole === "ADMIN"}
            extraAccess={extraAccess}
            assignableUsers={assignableUsers}
          />
        )}

        <div className={tab === "add-lot" ? "" : "hidden"}>
          {bcLocked ? (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-orange-950/40 border border-orange-700/50 text-orange-300 text-sm max-w-lg">
              <span className="text-lg">🔒</span>
              <span>This auction is locked. Adding new lots is disabled. Contact an admin to make changes.</span>
            </div>
          ) : (
            <LotWizardTab auctionId={auction.id} auction={auction}
              userId={userId} userName={userName}
              onCreated={() => router.refresh()} showScanTimer={showScanTimer} showLotTimer={showLotTimer} timerRedMins={timerRedMins} manualDescriptions={manualDescriptions} />
          )}
        </div>

        {tab === "manage-lots" && (
          editingLotId
            ? <LotEditView key={editingLotId} lot={editingLot} auctionId={auction.id}
                allLots={lots} entryDir={navDir} onEdit={openLot} onDone={closeLot} />
            /* ⚠ onDelete is "reload the list", and it must be router.refresh() — NOT a push to
               the URL we are already on. The App Router dedupes a push to the current route, so
               the transition wrapping each bulk action never settled (every button stuck on
               "Updating…") and the client cache was never invalidated either, which is why the
               change only appeared after a manual reload despite the write having succeeded.
               One cause, both symptoms (Jordan, 2026-08-14). */
            : <ManageLotsTab lots={lots} auctionId={auction.id} auction={auction}
                allAuctions={allAuctions}
                bcLocked={bcLocked}
                onEdit={openLot}
                onDelete={() => router.refresh()}
                onTransfer={ids => setTransferLotIds(ids)} />
        )}

        {tab === "photo-only" && (
          <PhotoOnlyTab auctionId={auction.id} auctionCode={auction.code} onCreated={() => router.refresh()} />
        )}

        {tab === "import" && (
          <ImportTab auctionId={auction.id} auctionCode={auction.code} onImported={() => router.push(`/tools/cataloguing/auctions/${auction.id}`)} />
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
        {tab === "review" && <ReviewTab auctionId={auction.id} kpMode={auction.reviewKpMode === "relaxed" ? "relaxed" : "strict"} />}

        {tab === "locking-check" && (
          <LockingCheckTab
            lots={lots.map(l => ({
              id:              l.id,
              barcode:         l.barcode,
              receiptUniqueId: l.receiptUniqueId,
              title:           l.title,
              description:     l.description,
              condition:       l.condition,
              estimateLow:     l.estimateLow,
              estimateHigh:    l.estimateHigh,
              imageUrls:       l.imageUrls,
              aiExcluded:      l.aiExcluded,
              vendor:          l.vendor,
              tote:            l.tote,
              receipt:         l.receipt,
              category:        l.category,
              aiFlagNote:      l.aiFlagNote,
              reviewFlag:      l.reviewFlag,
            }))}
            auctionId={auction.id}
            onOpenLot={openLotInManager}
          />
        )}

        {tab === "tote-check" && (
          <ToteCheckTab auctionId={auction.id} onOpenLot={openLotInManager} />
        )}

        {tab === "bc-corrections" && <BcCorrectionsTab auctionId={auction.id} />}

        {tab === "catchup-sheet" && (
          <CatchupSheetTab
            auctionCode={auction.code}
            lots={lots.map(l => ({
              id:              l.id,
              barcode:         l.barcode,
              receipt:         l.receipt,
              receiptUniqueId: l.receiptUniqueId,
              title:           l.title,
            }))}
          />
        )}

        {tab === "bc-check" && (
          <BcCheckTab
            lots={lots.map(l => ({
              id:              l.id,
              barcode:         l.barcode,
              receiptUniqueId: l.receiptUniqueId,
              title:           l.title,
              estimateLow:     l.estimateLow,
              estimateHigh:    l.estimateHigh,
            }))}
          />
        )}

        {tab === "bc-fill" && (
          <BcFillTab
            lots={lots.map(l => ({
              receiptUniqueId: l.receiptUniqueId,
              title:           l.title,
              estimateLow:     l.estimateLow,
              estimateHigh:    l.estimateHigh,
              aiEstimateLow:   l.aiEstimateLow,
              aiEstimateHigh:  l.aiEstimateHigh,
              notes:           l.notes,
              category:        l.category,
              subCategory:     l.subCategory,
            }))}
          />
        )}

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

// Extra people on this sale — for someone working outside their department as a
// one-off. Never removes access, only adds it. Admins only (the parent decides).
function SaleAccessPanel({ auctionId, entries, users }: {
  auctionId: string
  entries: SaleAccessEntry[]
  users: SaleAccessUser[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [pick, setPick] = useState("")
  const [error, setError] = useState<string | null>(null)

  const already  = new Set(entries.map(e => e.userId))
  const available = users.filter(u => !already.has(u.id))

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return }
      setPick("")
      router.refresh()
    })
  }

  return (
    <div className="mt-10 border border-gray-300 dark:border-gray-700 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">Extra people on this sale</h3>
      <p className="text-xs text-gray-600 dark:text-gray-500 mb-3">
        Anyone in a department that covers this sale type already has access. Add someone here when
        they&apos;re working outside their own department on this sale as a one-off.
      </p>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}

      {entries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {entries.map(e => (
            <span key={e.userId} className="inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {e.name}
              {e.grantedBy && <span className="opacity-60">· added by {e.grantedBy}</span>}
              <button
                onClick={() => run(() => revokeAuctionAccess(auctionId, e.userId))}
                disabled={pending}
                title="Remove from this sale"
                className="text-red-400 hover:text-red-600 disabled:opacity-50"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <select
          value={pick}
          onChange={e => setPick(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
        >
          <option value="">Choose a person…</option>
          {available.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button
          onClick={() => pick && run(() => grantAuctionAccess(auctionId, pick))}
          disabled={!pick || pending}
          className="text-sm px-4 py-2 bg-[#2AB4A6] hover:bg-[#24a090] text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add to sale"}
        </button>
      </div>
    </div>
  )
}

function SettingsTab({ auction, isAdmin, extraAccess, assignableUsers }: {
  auction: Auction
  isAdmin: boolean
  extraAccess: SaleAccessEntry[]
  assignableUsers: SaleAccessUser[]
}) {
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
          <div>
            <label className={lbl}>Review tab key point matching</label>
            <select name="reviewKpMode" defaultValue={auction.reviewKpMode === "relaxed" ? "relaxed" : "strict"} className={input}>
              <option value="strict">Exact wording (e.g. trains)</option>
              <option value="relaxed">Relaxed wording (e.g. Dolls &amp; Bears)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Relaxed: a key point whose numbers, codes and sizes are all present but whose wording
              differs shows amber &ldquo;reworded — check wording&rdquo; instead of red. A missing
              number or code is still red in both modes.
            </p>
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

      {isAdmin && <SaleAccessPanel auctionId={auction.id} entries={extraAccess} users={assignableUsers} />}

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

// Manage Lots toolbar — one shared button look so the bar reads as a unit;
// colour comes through on hover / active states only.
const TB_LABEL   = "text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-600 px-0.5 select-none"
const TB_BTN     = "px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50 whitespace-nowrap"
const TB_NEUTRAL = `${TB_BTN} border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400`

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
  // Change Vendor panel — type a tote or receipt, confirm what it belongs to,
  // then apply it to the ticked lots.
  const [showVendorChange, setShowVendorChange] = useState(false)
  const [vendorQuery, setVendorQuery]           = useState("")
  const [vendorHit, setVendorHit]               = useState<Awaited<ReturnType<typeof lookupToteOrReceipt>> | null>(null)
  const [vendorLooking, startVendorLookup]      = useTransition()
  const [photoExporting, setPhotoExporting] = useState(false)
  const [photoMsg, setPhotoMsg]     = useState<string | null>(null)

  // Column sort
  type SortCol = "barcode" | "receiptUniqueId" | "title" | "vendor" | "receipt" | "tote" | "category" | "photos" | "addedBy" | "dateAdded"
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

  // Mark/unmark selected as AI excluded
  const [excludeMsg, setExcludeMsg] = useState<string | null>(null)
  const [excludePending, startExclude] = useTransition()

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

  // Bulk conditions / descriptions. All three respect the selection: they act on
  // the SELECTED lots when any are ticked, else the whole auction (the house
  // pattern). selectedIds() → the array to pass; scopeWord() → wording for the
  // confirm so it's always clear what will be hit.
  const [condMsg, setCondMsg]         = useState<string | null>(null)
  const [condPending, startCond]      = useTransition()

  const none = selected.size === 0
  const selectedIds = () => (selected.size > 0 ? Array.from(selected) : [])
  const scopeWord = () => (selected.size > 0 ? `the ${selected.size} selected lot${selected.size !== 1 ? "s" : ""}` : "every lot in this auction")

  function doVendorLookup() {
    const q = vendorQuery.trim()
    if (!q) return
    setVendorHit(null)
    startVendorLookup(async () => setVendorHit(await lookupToteOrReceipt(q)))
  }

  function applyVendorChange() {
    if (!vendorHit?.ok || selected.size === 0) return
    // Include the TOTE when a tote was looked up. It used to be left out, so typing a tote
    // moved the receipt and vendor but left the lot on its old tote — and if the receipt and
    // vendor were already right, nothing changed at all while the message still said "✓".
    const newTote = vendorHit.kind === "tote" ? (vendorHit.tote ?? "") : ""
    const who = `${newTote ? `tote ${newTote} · ` : ""}${vendorHit.receipt ?? "—"} / ${vendorHit.vendor ?? "—"}${vendorHit.vendorName ? ` (${vendorHit.vendorName})` : ""}`
    if (!confirm(`Put ${scopeWord()} onto ${who}?`)) return
    setFillMsg(null)
    startFill(async () => {
      const res = await setLotsVendorReceipt(auctionId, Array.from(selected), {
        vendor:  vendorHit.vendor  ?? "",
        receipt: vendorHit.receipt ?? "",
        tote:    newTote,
      })
      if (!res.ok) { setFillMsg(`⚠ ${res.error}`); return }
      // ⚠ 0 updated is NOT success — it means every ticked lot already held these values.
      // Saying "✓ Changed 0 lots" read as "done" and hid the fact nothing had happened.
      if (!res.updated) {
        setFillMsg(`⚠ Nothing changed — ${scopeWord()} already on ${who}.`)
        return
      }
      setFillMsg(`✓ Changed ${res.updated} lot${res.updated === 1 ? "" : "s"} to ${who}`)
      setShowVendorChange(false)
      setVendorHit(null)
      setVendorQuery("")
      setTimeout(() => setFillMsg(null), 5000)
      onDelete()   // parent refresh — the lots list has changed
    })
  }

  function handleBulkAddConditions() {
    const pool = selected.size > 0 ? lots.filter(l => selected.has(l.id)) : lots
    const withCond = pool.filter(l => l.condition?.trim()).length
    if (withCond === 0) { setCondMsg("No lots with a condition set in that scope."); setTimeout(() => setCondMsg(null), 3000); return }
    if (!confirm(`Append the condition to the description for ${scopeWord()} that has one (${withCond} with a condition; skips any that already have it). Continue?`)) return
    startCond(async () => {
      const { updated, skipped } = await bulkAddConditionsToDescriptions(auctionId, selectedIds())
      setCondMsg(`✓ ${updated} updated, ${skipped} skipped`)
      setTimeout(() => setCondMsg(null), 4000)
      await refreshUndos()
    })
  }

  function handleBulkRemoveConditions() {
    if (!confirm(`Remove the "Condition appears…" sentence from the description on ${scopeWord()} that has it. Continue?`)) return
    startCond(async () => {
      const { updated, skipped } = await bulkRemoveConditionsFromDescriptions(auctionId, selectedIds())
      setCondMsg(`✓ ${updated} updated, ${skipped} skipped`)
      setTimeout(() => setCondMsg(null), 4000)
      await refreshUndos()
    })
  }

  function handleClearDescriptions() {
    if (!confirm(`Clear the description on ${scopeWord()}. Lots excluded from AI keep their hand-typed descriptions and are left alone. This can be undone. Continue?`)) return
    startCond(async () => {
      const { updated, skippedExcluded } = await bulkClearDescriptions(auctionId, selectedIds())
      setCondMsg(`✓ ${updated} cleared${skippedExcluded ? `, ${skippedExcluded} AI-excluded left alone` : ""}`)
      setTimeout(() => setCondMsg(null), 5000)
      await refreshUndos()
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
  const [fAddedBy,       setFAddedBy]       = useState("")   // exact createdByName
  const [fDateAdded,     setFDateAdded]     = useState("")   // yyyy-mm-dd, matched in UK local time
  // One AI filter covering both flags: "" | "upgraded" | "not_upgraded" | "excluded" | "not_excluded"
  const [fAi,            setFAi]            = useState("")
  const [fAddedToBC,     setFAddedToBC]     = useState("")   // "yes" | "no" | ""
  const [fKeyPoints,     setFKeyPoints]     = useState("")   // "yes" | "no" | ""

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
      (fAi === "" ||
        (fAi === "upgraded"     ?  l.aiUpgraded :
         fAi === "not_upgraded" ? !l.aiUpgraded :
         fAi === "excluded"     ?  l.aiExcluded : !l.aiExcluded)) &&
      (fAddedToBC === ""  || (fAddedToBC  === "yes" ? l.addedToBC  : !l.addedToBC )) &&
      (fKeyPoints === ""  || (fKeyPoints  === "yes" ? !!l.keyPoints?.trim() : !l.keyPoints?.trim())) &&
      (fAddedBy === ""    || (l.createdByName ?? "") === fAddedBy) &&
      (fDateAdded === ""  || ukDay(l.createdAt) === fDateAdded)
    )
    return f.sort((a, b) => {
      let cmp = 0
      if (sortCol === "photos") {
        cmp = a.imageUrls.length - b.imageUrls.length
      } else if (sortCol === "dateAdded") {
        // Sorted as a real date, not the formatted string — "01 Aug" must not
        // land before "31 Jul".
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      } else {
        const getVal = (l: Lot) => {
          if (sortCol === "barcode")        return l.barcode
          if (sortCol === "receiptUniqueId") return l.receiptUniqueId
          if (sortCol === "title")          return l.title
          if (sortCol === "vendor")         return l.vendor
          if (sortCol === "receipt")        return l.receipt
          if (sortCol === "tote")           return l.tote
          if (sortCol === "category")       return l.category
          if (sortCol === "addedBy")        return l.createdByName
          return l.barcode
        }
        const va = getVal(a) ?? ""
        const vb = getVal(b) ?? ""
        cmp = va.localeCompare(vb, undefined, { numeric: true })
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [lots, fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fAi, fAddedToBC, fKeyPoints, fAddedBy, fDateAdded, sortCol, sortDir])

  // Everyone who has actually added a lot to THIS sale — a dropdown beats free text when the
  // question is "what did Keiran do", and it cannot be mistyped.
  const cataloguersInSale = useMemo(
    () => Array.from(new Set(lots.map(l => l.createdByName).filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b)),
    [lots],
  )

  const filtersActive = [fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fAi, fAddedToBC, fKeyPoints, fAddedBy, fDateAdded].some(f => f !== "")

  function clearFilters() {
    setFBarcode(""); setFUniqueId(""); setFTitle(""); setFVendor(""); setFReceipt("")
    setFTote(""); setFCategory(""); setFPhotos(""); setFAi(""); setFAddedToBC("")
    setFKeyPoints("")
  }

  // ── Filters + sort survive opening a lot ────────────────────────────────────
  // Opening a lot swaps this whole tab out for the editor (the ?lot= route), so
  // every filter/sort useState above is lost on the way back. Persist them in
  // sessionStorage per auction and restore on mount. Selection is deliberately
  // NOT persisted — a stale tick surviving a round-trip could drive a bulk action
  // at the wrong lots.
  const FILTER_KEY = `catalogue_filters_${auctionId}`
  const filtersRestored = useRef(false)
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const s = JSON.parse(sessionStorage.getItem(FILTER_KEY) || "null")
        if (s) {
          setFBarcode(s.fBarcode ?? ""); setFUniqueId(s.fUniqueId ?? ""); setFTitle(s.fTitle ?? "")
          setFVendor(s.fVendor ?? ""); setFReceipt(s.fReceipt ?? ""); setFTote(s.fTote ?? "")
          setFCategory(s.fCategory ?? ""); setFPhotos(s.fPhotos ?? "")
          // fAi is the combined filter; older saved shapes carried fAiUpgraded/fAiExcluded.
          setFAi(s.fAi ?? (s.fAiExcluded === "yes" ? "excluded" : s.fAiUpgraded === "yes" ? "upgraded" : ""))
          setFAddedToBC(s.fAddedToBC ?? ""); setFKeyPoints(s.fKeyPoints ?? "")
          setFAddedBy(s.fAddedBy ?? ""); setFDateAdded(s.fDateAdded ?? "")
          // s.sortCol may be the removed "status" column from an older session
          if (s.sortCol && s.sortCol !== "status") setSortCol(s.sortCol); if (s.sortDir) setSortDir(s.sortDir)
        }
      } catch {}
      filtersRestored.current = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!filtersRestored.current) return
    try {
      sessionStorage.setItem(FILTER_KEY, JSON.stringify({
        fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory,
        fPhotos, fAi, fAddedToBC, fKeyPoints, fAddedBy, fDateAdded, sortCol, sortDir,
      }))
    } catch {}
  }, [FILTER_KEY, fBarcode, fUniqueId, fTitle, fVendor, fReceipt, fTote, fCategory, fPhotos, fAi, fAddedToBC, fKeyPoints, fAddedBy, fDateAdded, sortCol, sortDir])

  // ── Undo stack (this user's recent mass actions on this auction) ────────────
  const [undos, setUndos] = useState<{ id: string; label: string; at: string }[]>([])
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoMsg, setUndoMsg] = useState<string | null>(null)
  async function refreshUndos() {
    try { setUndos(await listBulkUndos(auctionId)) } catch { /* leave as-is */ }
  }
  useEffect(() => { refreshUndos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function handleUndo() {
    const top = undos[0]
    if (!top || undoBusy) return
    if (!confirm(`Undo "${top.label}"? Any of those lots changed since will be left as they are.`)) return
    setUndoBusy(true); setUndoMsg(null)
    start(async () => {
      const r = await undoBulk(top.id)
      if (!r.ok) setUndoMsg(`✗ ${r.error}`)
      else setUndoMsg(`✓ Undid "${r.label}" — ${r.restored} restored${r.skipped ? `, ${r.skipped} skipped (changed since)` : ""}`)
      setTimeout(() => setUndoMsg(null), 6000)
      await refreshUndos()
      setUndoBusy(false)
      onDelete()   // re-pull lots so the list reflects the rollback
    })
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
      "Date Added":    fmtDateAdded(l.createdAt),
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
      await refreshUndos()
      setTimeout(() => setBcMsg(null), 3500)
    })
  }

  async function handleBulkToggleAiExcluded() {
    if (selected.size === 0) return
    const selectedLots = lots.filter(l => selected.has(l.id))
    const anyNotExcluded = selectedLots.some(l => !l.aiExcluded)
    const newValue = anyNotExcluded
    startExclude(async () => {
      const { count } = await bulkSetLotsAiExcluded(Array.from(selected), auctionId, newValue)
      setExcludeMsg(`${newValue ? "🚫 Excluded" : "✓ Unexcluded"} ${count} lot${count === 1 ? "" : "s"} from AI`)
      setSelected(new Set())
      onDelete()
      await refreshUndos()
      setTimeout(() => setExcludeMsg(null), 3500)
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
      {/* Toolbar — grouped so the bar reads at a glance: Tools / Descriptions /
          Export always visible, plus a teal selection bar underneath when lots
          are ticked (every button in it acts on the ticked lots). */}
      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 py-2">
          {/* Undo the most recent mass action (newest first — press again to step
              back). Only your own actions; a lot changed since is left alone. */}
          {!bcLocked && undos.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={TB_LABEL}>Undo</span>
              <button
                onClick={handleUndo}
                disabled={undoBusy || pending}
                title={`Undo: ${undos[0].label}`}
                className={`${TB_BTN} border-amber-500 text-amber-500 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 max-w-[16rem] truncate`}>
                {undoBusy ? "Undoing…" : `↶ ${undos[0].label}`}
              </button>
            </div>
          )}

          {/* Tools */}
          <div className="flex flex-col gap-1">
            <span className={TB_LABEL}>Tools</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => { setShowVendorChange(v => !v); setShowMassAdd(false); setShowBids(false); setFillMsg(null) }}
                className={showVendorChange ? `${TB_BTN} border-[#2AB4A6] text-[#2AB4A6] bg-[#2AB4A6]/10` : `${TB_NEUTRAL} hover:border-[#2AB4A6] hover:text-[#2AB4A6]`}>
                🏷 Change Vendor
              </button>
              {!bcLocked && (
                <button
                  onClick={() => { setShowMassAdd(v => !v); setShowBids(false) }}
                  className={showMassAdd ? `${TB_BTN} border-orange-500 text-orange-400 bg-orange-500/10` : `${TB_NEUTRAL} hover:border-orange-500 hover:text-orange-400`}>
                  ➕ Mass Add Lots
                </button>
              )}
              <button
                onClick={() => { setShowBids(v => !v); setShowMassAdd(false); setShowUniqueIdMatcher(false) }}
                className={showBids ? `${TB_BTN} border-green-500 text-green-400 bg-green-500/10` : `${TB_NEUTRAL} hover:border-green-500 hover:text-green-400`}>
                💰 Set Starting Bids
              </button>
              <button
                onClick={() => { setShowUniqueIdMatcher(v => !v); setUniqueIdPairs([]); setUniqueIdMsg(null); setShowBids(false); setShowMassAdd(false) }}
                className={showUniqueIdMatcher ? `${TB_BTN} border-cyan-500 text-cyan-400 bg-cyan-500/10` : `${TB_NEUTRAL} hover:border-cyan-500 hover:text-cyan-400`}>
                🔗 Unique ID Matcher
              </button>
            </div>
          </div>

          {/* Descriptions (bulk text actions — scoped to ticked lots when any are ticked) */}
          {!bcLocked && (
            <div className="flex flex-col gap-1 border-l border-gray-200 dark:border-gray-800 pl-5">
              <span className={TB_LABEL}>Descriptions{selected.size > 0 ? ` — ${selected.size} ticked` : " — all lots"}</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                <button onClick={handleBulkAddConditions} disabled={condPending}
                  className={`${TB_NEUTRAL} hover:border-[#2AB4A6] hover:text-[#2AB4A6]`}>
                  {condPending ? "Updating…" : "✚ Add Conditions"}
                </button>
                <button onClick={handleBulkRemoveConditions} disabled={condPending}
                  className={`${TB_NEUTRAL} hover:border-amber-500 hover:text-amber-400`}>
                  {condPending ? "Updating…" : "✖ Remove Conditions"}
                </button>
                <button onClick={handleClearDescriptions} disabled={condPending}
                  className={`${TB_NEUTRAL} hover:border-red-500 hover:text-red-400`}>
                  {condPending ? "Working…" : "🧹 Clear Descriptions"}
                </button>
              </div>
            </div>
          )}

          {/* Export */}
          <div className="flex flex-col gap-1 border-l border-gray-200 dark:border-gray-800 pl-5">
            <span className={TB_LABEL}>Export</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onClick={exportForAHK} className={`${TB_NEUTRAL} hover:border-purple-400 hover:text-purple-400`}>
                ⬇ BC Macro (Tote)
              </button>
              <button onClick={exportForAHKReceipt} className={`${TB_NEUTRAL} hover:border-purple-400 hover:text-purple-400`}>
                ⬇ BC Macro (Receipt)
              </button>
              <button onClick={exportPhotos} disabled={photoExporting}
                className={`${TB_NEUTRAL} hover:border-[#2AB4A6] hover:text-[#2AB4A6]`}>
                {photoExporting ? "⏳ Exporting…" : "📷 Photos (.zip)"}
              </button>
              <button onClick={exportExcel}
                className={`${TB_BTN} border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6] hover:text-black`}>
                ⬇ Excel
              </button>
            </div>
          </div>

          {/* Filter summary */}
          {filtersActive && (
            <span className="ml-auto self-center text-xs text-gray-600 dark:text-gray-500 whitespace-nowrap">
              {filtered.length} / {lots.length} lots
              <button onClick={clearFilters} className="ml-2 text-[#2AB4A6] hover:underline">clear</button>
            </span>
          )}
        </div>

        {/* Status messages from the last action, one tidy line */}
        {(undoMsg || fillMsg || bidsMsg || titlesMsg || massMsg || uniqueIdMsg || condMsg || bcMsg || excludeMsg || photoMsg) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1">
            {undoMsg && <span className="text-xs text-amber-400">{undoMsg}</span>}
            {fillMsg  && <span className="text-xs text-[#2AB4A6]">{fillMsg}</span>}
            {bidsMsg  && <span className="text-xs text-green-400">{bidsMsg}</span>}
            {titlesMsg && <span className="text-xs text-[#2AB4A6]">{titlesMsg}</span>}
            {massMsg  && <span className="text-xs text-orange-400">{massMsg}</span>}
            {uniqueIdMsg && <span className="text-xs text-cyan-400">{uniqueIdMsg}</span>}
            {condMsg && <span className="text-xs text-[#2AB4A6]">{condMsg}</span>}
            {bcMsg && <span className="text-xs text-emerald-400">{bcMsg}</span>}
            {excludeMsg && <span className="text-xs text-amber-400">{excludeMsg}</span>}
            {photoMsg && <span className="text-xs text-[#2AB4A6]">{photoMsg}</span>}
          </div>
        )}

        {/* Selection bar — ALWAYS shown (Jordan, 2026-08-14: "make the options that appear when
            you select just be visible at all times"). It used to appear only once lots were
            ticked, which is why people asked for actions that were already there — you cannot
            look for a button you have never seen. With nothing selected the buttons are simply
            disabled, so the row's height never changes and the table below it does not move. */}
        {!bcLocked && (
          <div className={`flex flex-wrap items-center gap-1.5 rounded-xl border px-3 py-2 transition-colors ${
            selected.size > 0 ? "border-[#2AB4A6]/50 bg-[#2AB4A6]/5" : "border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.02]"}`}>
            {/* ⚠ Nothing ticked = every button off. Several of these handlers fall back to
                "every lot in this auction" when the selection is empty, which was harmless
                while the row only existed during a selection and is emphatically not now. */}
            <span className={`text-xs font-bold rounded-lg px-2.5 py-1.5 whitespace-nowrap ${
              selected.size > 0 ? "text-[#2AB4A6] bg-[#2AB4A6]/15" : "text-gray-500 dark:text-gray-400 bg-gray-200/60 dark:bg-white/5"}`}>
              {selected.size > 0 ? `${selected.size} selected` : "Tick lots to use these"}
            </span>
            {(() => {
              const anyUnticked = lots.some(l => selected.has(l.id) && !l.addedToBC)
              return (
                <button onClick={handleToggleAddedToBC} disabled={bcPending || none}
                  className={`${TB_BTN} border-emerald-700 text-emerald-500 dark:text-emerald-400 hover:bg-emerald-500/10`}>
                  {bcPending ? "Updating…" : anyUnticked ? "📦 Mark added to BC" : "↺ Unmark added to BC"}
                </button>
              )
            })()}
            {(() => {
              const anyNotExcluded = lots.some(l => selected.has(l.id) && !l.aiExcluded)
              return (
                <button onClick={handleBulkToggleAiExcluded} disabled={excludePending || none}
                  className={`${TB_BTN} border-amber-700 text-amber-500 dark:text-amber-400 hover:bg-amber-500/10`}>
                  {excludePending ? "Updating…" : anyNotExcluded ? "🚫 Exclude from AI" : "✓ Unexclude from AI"}
                </button>
              )
            })()}
            <button onClick={handleGenerateTitles} disabled={titlesPending || none}
              className={`${TB_BTN} border-blue-700 text-blue-500 dark:text-blue-400 hover:bg-blue-500/10`}>
              {titlesPending ? "Generating…" : "✏️ Generate Titles"}
            </button>
            <button onClick={() => onTransfer(Array.from(selected))} disabled={none}
              className={`${TB_BTN} border-indigo-700 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-500/10`}>
              ↗ Transfer to another auction
            </button>
            <span className="mx-1 h-5 border-l border-[#2AB4A6]/30" />
            <button onClick={() => handleBulkClearPhotos(false)} disabled={photosClearing || none}
              className={`${TB_BTN} border-orange-700 text-orange-500 dark:text-orange-400 hover:bg-orange-500/10`}
              title="Removes photos from these lots but keeps files in storage">
              {photosClearing ? "Removing…" : "📷🔗 Unlink photos"}
            </button>
            <button onClick={() => handleBulkClearPhotos(true)} disabled={photosClearing || none}
              className={`${TB_BTN} border-red-700 text-red-500 dark:text-red-400 hover:bg-red-500/10`}
              title="Permanently deletes photo files from storage">
              {photosClearing ? "Removing…" : "📷🗑 Delete photos from storage"}
            </button>
            <button onClick={handleBulkDelete} disabled={bulkDeleting || none}
              className={`${TB_BTN} border-red-700 text-red-500 dark:text-red-400 hover:bg-red-500/10`}>
              {bulkDeleting ? "Deleting…" : "🗑 Delete lots"}
            </button>
          </div>
        )}
      </div>

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

      {/* ── Change Vendor panel ──
          Type a tote or a receipt, see who it belongs to in the BC tote data,
          then put that vendor/receipt onto the ticked lots. Deliberately
          selection-only: no "all lots" fallback for an action that moves lots
          onto a different vendor. */}
      {showVendorChange && (
        <div className="mb-4 bg-white dark:bg-[#1C1C1E] border border-[#2AB4A6]/40 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-[#2AB4A6]">Change Vendor</p>
          <p className="text-xs text-gray-600 dark:text-gray-500">
            Enter a <span className="font-semibold">tote</span> or a <span className="font-semibold">receipt</span> number — the vendor and receipt behind it are read from the BC tote data,
            the same source the lot wizard uses. Existing unique IDs are kept; one is only created where a lot hasn&apos;t got one.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={vendorQuery}
              onChange={e => { setVendorQuery(e.target.value); setVendorHit(null) }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doVendorLookup() } }}
              placeholder="Tote or receipt number…"
              className="w-56 bg-gray-100 dark:bg-[#2C2C2E] border border-gray-300 dark:border-gray-700 rounded px-3 py-1.5 text-sm font-mono text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[#2AB4A6]"
            />
            <button onClick={doVendorLookup} disabled={vendorLooking || !vendorQuery.trim()}
              className={`${TB_NEUTRAL} hover:border-[#2AB4A6] hover:text-[#2AB4A6] disabled:opacity-40`}>
              {vendorLooking ? "Looking up…" : "Look up"}
            </button>
          </div>

          {vendorHit && !vendorHit.ok && (
            <p className="text-xs text-red-400">{vendorHit.error}</p>
          )}

          {vendorHit?.ok && (
            <div className="rounded-lg bg-gray-100 dark:bg-[#2C2C2E] border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm space-y-1">
              <div>
                <span className="text-gray-500">Receipt </span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-100">{vendorHit.receipt ?? "—"}</span>
                <span className="text-gray-500"> · Vendor </span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-100">{vendorHit.vendor ?? "—"}</span>
                {vendorHit.vendorName && <span className="text-gray-500"> · {vendorHit.vendorName}</span>}
              </div>
              <p className="text-xs text-gray-500">
                {vendorHit.kind === "tote"
                  ? `Matched tote ${vendorHit.tote}.`
                  : `Matched receipt ${vendorHit.receipt}${vendorHit.toteCount ? ` across ${vendorHit.toteCount} tote${vendorHit.toteCount === 1 ? "" : "s"}` : ""}.`}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={applyVendorChange}
              disabled={fillPending || !vendorHit?.ok || selected.size === 0}
              className="px-4 py-1.5 text-sm font-semibold rounded transition-colors disabled:opacity-40"
              style={{ background: "#2AB4A6", color: "#1C1C1E" }}>
              {fillPending ? "Applying…" : `Apply to ${selected.size} selected lot${selected.size === 1 ? "" : "s"}`}
            </button>
            {selected.size === 0 && (
              <span className="text-xs text-amber-500">Tick the lots you want to change first.</span>
            )}
            <button onClick={() => { setShowVendorChange(false); setVendorHit(null); setVendorQuery("") }}
              className="text-xs text-gray-600 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">Cancel</button>
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
              {(["barcode","receiptUniqueId","title","vendor","receipt","tote","category","photos","addedBy","dateAdded"] as SortCol[]).map((col, i) => (
                <th key={col} onClick={() => toggleSort(col)}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-300 select-none whitespace-nowrap">
                  {["Barcode","Unique ID","Title","Vendor","Receipt","Tote","Category","Photos","Added By","Date Added"][i]}
                  {sortCol === col ? (sortDir === "asc" ? " ▲" : " ▼") : <span className="text-gray-700"> ⇅</span>}
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 dark:text-gray-500 uppercase tracking-wide whitespace-nowrap">KP</th>
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
                <select value={fAddedBy} onChange={e => setFAddedBy(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  {cataloguersInSale.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </td>
              <td className="px-2 py-1.5">
                {/* RULES rule 2: a native date control draws its picker in the BROWSER's
                    colours — color-scheme is what tells it we are dark. */}
                <input type="date" value={fDateAdded} onChange={e => setFDateAdded(e.target.value)}
                  className={`${COL_INPUT} dark:[color-scheme:dark]`} />
              </td>
              <td className="px-2 py-1.5">
                <select value={fKeyPoints} onChange={e => setFKeyPoints(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="yes">✓ Has KP</option>
                  <option value="no">— No KP</option>
                </select>
              </td>
              <td className="px-2 py-1.5">
                <select value={fAi} onChange={e => setFAi(e.target.value)} className={COL_SELECT}>
                  <option value="">All</option>
                  <option value="excluded">🚫 Excluded from AI</option>
                  <option value="not_excluded">Not excluded</option>
                  <option value="upgraded">✨ Upgraded</option>
                  <option value="not_upgraded">Not upgraded</option>
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
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
                  {lot.createdByName ?? "—"}
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-500 whitespace-nowrap">
                  {fmtDateAdded(lot.createdAt)}
                </td>
                <td className="px-4 py-3 text-center">
                  {lot.keyPoints?.trim()
                    ? <span className="text-green-500 text-xs" title="Has key points">✓</span>
                    : <span className="text-gray-700 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                  {lot.aiExcluded ? (
                    <button
                      onClick={() => toggleLotAiUpgraded(lot.id, auctionId, false)}
                      title="AI excluded — click to toggle AI upgraded status"
                      className="transition-opacity hover:opacity-60">
                      <span title="Excluded from AI runs">🚫</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleLotAiUpgraded(lot.id, auctionId, !lot.aiUpgraded)}
                      title={lot.aiUpgraded ? "Click to mark as not upgraded" : "Click to mark as AI upgraded"}
                      className="transition-opacity hover:opacity-60">
                      {lot.aiUpgraded
                        ? <span>✨</span>
                        : <span className="text-gray-700 text-xs">—</span>}
                    </button>
                  )}
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
              <tr><td colSpan={15} className="px-4 py-8 text-center text-gray-600 text-sm">No lots match your filters</td></tr>
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
  const photoRef    = useRef<HTMLInputElement>(null)
  const formRef     = useRef<HTMLFormElement>(null)
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear pending auto-save on unmount
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  function triggerAutoSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      if (!lot || !formRef.current) return
      const fd = new FormData(formRef.current)
      start(async () => {
        await updateLot(lot.id, auctionId, fd)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      })
    }, 800)
  }

  const [titleVal, setTitleVal] = useState(lot?.title ?? "")
  const [descVal,  setDescVal]  = useState(lot?.description ?? "")

  // Parse the stored condition into the item condition + optional box/packaging condition
  const initCond = parseCondition(lot?.condition)
  const [cond1, setCond1] = useState(initCond.cond1)
  const [cond2, setCond2] = useState(initCond.cond2)
  const [boxOn,           setBoxOn]           = useState(initCond.boxOn)
  const [boxPrefixMode,   setBoxPrefixMode]   = useState<BoxPrefixMode>(initCond.boxPrefixMode)
  const [boxCustomPrefix, setBoxCustomPrefix] = useState(initCond.boxCustomPrefix)
  const [boxCond1,        setBoxCond1]        = useState(initCond.boxCond1)
  const [boxCond2,        setBoxCond2]        = useState(initCond.boxCond2)
  const boxWordings = useConditionWordings()
  const condValue = buildCondition({ cond1, cond2, boxOn, boxPrefixMode, boxCustomPrefix, boxCond1, boxCond2 })

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
  const categoryMap = useCategoryMap()
  const mainCatList = Object.keys(categoryMap)
  const subCatList  = mainCat ? (categoryMap[mainCat] ?? []) : []
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
      const res = await uploadLotPhoto(lot.id, auctionId, fd)
      if (res.ok) setImageKeys(res.imageUrls)
      else alert(`Photo upload failed: ${res.error}`)
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
        <span className={`text-xs transition-opacity flex-shrink-0 ${pending ? "opacity-100 text-gray-500" : saved ? "opacity-100 text-[#2AB4A6]" : "opacity-0"}`}>
          {pending ? "Saving…" : "✓ Saved"}
        </span>
      </div>

      {/* Animated content */}
      <div ref={contentRef}>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-6">
          {/* Left */}
          <div className="space-y-4">
            <div>
              <label className={lbl}>Barcode</label>
              <input name="barcode" defaultValue={lot.barcode ?? ""} className={input} placeholder="BC internal barcode" onChange={triggerAutoSave} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={lbl} style={{margin:0}}>Title *</label>
                <span className={`text-xs ${titleVal.length > TITLE_LIMIT ? "text-red-400" : titleVal.length > TITLE_LIMIT * 0.9 ? "text-yellow-400" : "text-gray-600"}`}>
                  {titleVal.length}/{TITLE_LIMIT}
                </span>
              </div>
              <input name="title" required value={titleVal} onChange={e => { setTitleVal(e.target.value.slice(0, TITLE_LIMIT)); triggerAutoSave() }}
                maxLength={TITLE_LIMIT} className={input} />
            </div>
            <div>
              <label className={lbl}>Key Points</label>
              <textarea name="keyPoints" rows={4} defaultValue={lot.keyPoints}
                className={`${input} resize-none`} onChange={triggerAutoSave} />
            </div>
            <div>
              <label className="flex items-center gap-2 cursor-pointer w-fit">
                <input type="checkbox" name="aiExcluded" value="true" defaultChecked={lot.aiExcluded ?? false}
                  className="w-4 h-4 accent-amber-500" />
                <span className="text-sm text-gray-400">Exclude from AI — description typed manually</span>
              </label>
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
              <textarea name="description" rows={4} value={descVal} onChange={e => { setDescVal(e.target.value); triggerAutoSave() }}
                className={`${input} resize-none`} />
            </div>
            <div>
              <label className={lbl}>Extra Details <span className="text-gray-600 font-normal">(SEO paragraph — generated on Lot History tab)</span></label>
              <textarea name="extraDetails" rows={5} defaultValue={lot.extraDetails ?? ""}
                className={`${input} resize-none`} placeholder="No extra details yet — generate them on the Lot History tab." onChange={triggerAutoSave} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <label className={lbl} style={{ margin: 0 }}>Condition</label>
                {cond1 && <button type="button" onClick={() => setCond1("")} className="text-xs text-gray-600 dark:text-gray-500 hover:text-red-400 transition-colors leading-none">× clear</button>}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CONDITIONS.map(c => (
                  <button key={c} type="button" onClick={() => { setCond1(c); triggerAutoSave() }}
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
                  <button key={c} type="button" onClick={() => { setCond2(c); triggerAutoSave() }}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${cond2 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                    {c}
                  </button>
                ))}
              </div>

              {/* Optional separate box / packaging condition */}
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-800">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={boxOn} onChange={e => { setBoxOn(e.target.checked); triggerAutoSave() }}
                    className="w-4 h-4 accent-[#2AB4A6]" />
                  <span className={lbl} style={{ margin: 0 }}>Separate box / packaging condition</span>
                </label>
                {boxOn && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {boxWordings.map(p => (
                        <button key={p} type="button" onClick={() => { setBoxPrefixMode(p); triggerAutoSave() }}
                          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${boxPrefixMode === p ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                          {p}
                        </button>
                      ))}
                      <button type="button" onClick={() => { setBoxPrefixMode("custom"); triggerAutoSave() }}
                        className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${boxPrefixMode === "custom" ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                        Custom…
                      </button>
                    </div>
                    {boxPrefixMode === "custom" && (
                      <input value={boxCustomPrefix} onChange={e => { setBoxCustomPrefix(e.target.value); triggerAutoSave() }}
                        placeholder="e.g. Inner tray is" className={input} />
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-500">Packaging condition</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CONDITIONS.map(c => (
                        <button key={c} type="button" onClick={() => { setBoxCond1(v => v === c ? "" : c); triggerAutoSave() }}
                          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${boxCond1 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-500">Packaging condition to <span className="text-gray-600">(optional)</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {CONDITIONS.map(c => (
                        <button key={c} type="button" onClick={() => { setBoxCond2(v => v === c ? "" : c); triggerAutoSave() }}
                          className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${boxCond2 === c ? "border-[#2AB4A6] bg-[#2AB4A6]/20 text-[#2AB4A6]" : "border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-500"}`}>
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {condValue && <p className="text-xs text-[#2AB4A6] mt-1">{condValue}</p>}
              <input type="hidden" name="condition" value={condValue} />
            </div>
            <div>
              <label className={lbl}>Status</label>
              <select name="status" defaultValue={lot.status} className={input} onChange={triggerAutoSave}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Parcel Size</label>
              <div className="flex flex-wrap gap-1.5">
                {PARCEL_OPTIONS.map(opt => (
                  <button key={opt} type="button" onClick={() => { setParcel(v => v === opt ? "" : opt); triggerAutoSave() }}
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
                <input name="estimateLow" type="number" min="0" defaultValue={lot.estimateLow ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
              <div>
                <label className={lbl}>Estimate High (£)</label>
                <input name="estimateHigh" type="number" min="0" defaultValue={lot.estimateHigh ?? ""} className={input} onChange={triggerAutoSave} />
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
                <input name="startingBid" type="number" min="0" defaultValue={lot.startingBid ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
              <div>
                <label className={lbl}>Reserve (£)</label>
                <input name="reserve" type="number" min="0" defaultValue={lot.reserve ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Hammer Price (£)</label>
                <input name="hammerPrice" type="number" min="0" defaultValue={lot.hammerPrice ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
              <div />
            </div>
            <div>
              <label className={lbl}>Vendor</label>
              <input name="vendor" defaultValue={lot.vendor ?? ""} className={input} onChange={triggerAutoSave} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Tote</label>
                <input name="tote" defaultValue={lot.tote ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
              <div>
                <label className={lbl}>Receipt</label>
                <input name="receipt" defaultValue={lot.receipt ?? ""} className={input} onChange={triggerAutoSave} />
              </div>
            </div>
            <div>
              <label className={lbl}>Receipt Unique ID</label>
              <input name="receiptUniqueId" defaultValue={lot.receiptUniqueId ?? ""} className={input}
                placeholder="e.g. R007523-1 (auto-assigned on create)" onChange={triggerAutoSave} />
            </div>
            <div>
              <label className={lbl}>Category</label>
              <select value={mainCat} onChange={e => { setMainCat(e.target.value); setSubCat(""); triggerAutoSave() }} className={input}>
                <option value="">— Select —</option>
                {mainCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="category" value={mainCat} />
            </div>
            <div>
              <label className={lbl}>Sub-Category</label>
              <select value={subCat} onChange={e => { setSubCat(e.target.value); triggerAutoSave() }} className={input} disabled={!mainCat}>
                <option value="">— Select —</option>
                {subCatList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="hidden" name="subCategory" value={subCat} />
            </div>
            <div className="relative">
              <label className={lbl}>Brand</label>
              <input
                value={brandSearch}
                onChange={e => { setBrandSearch(e.target.value); setBrand(e.target.value); triggerAutoSave() }}
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
            {pending ? "Saving…" : saved ? "✓ Saved" : "Save"}
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
            {imageKeys.map((key, idx) => {
              const basename = key.split("/").pop() ?? key
              const nameMatch = basename.match(/^\d{10,}-(.+)$/)
              const displayName = nameMatch ? nameMatch[1] : basename
              return (
                <div key={key} className="relative group">
                  <div className="relative aspect-square">
                    {signedUrls[key] ? (
                      <a href={signedUrls[key]} target="_blank" rel="noopener noreferrer">
                        <img src={signedUrls[key]} alt="Lot photo" className={`w-full h-full object-cover rounded-lg border ${idx === 0 ? "border-[#2AB4A6]" : "border-gray-700"}`} />
                      </a>
                    ) : (
                      <div className="w-full h-full rounded-lg bg-gray-800 animate-pulse" />
                    )}
                    <button onClick={() => handlePhotoDelete(key)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-700 rounded-full text-white text-xs items-center justify-center hidden group-hover:flex">
                      ✕
                    </button>
                  </div>
                  <p className={`text-[9px] truncate mt-0.5 text-center ${idx === 0 ? "text-[#2AB4A6]" : "text-gray-600"}`} title={displayName}>
                    {displayName}
                  </p>
                </div>
              )
            })}
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
