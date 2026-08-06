"use client"

// Cataloguing → Research → Valuations
//
// A customer emails photos asking what their things are worth. Drop the photos
// in, get a priced list to quote from, export it to Excel.
//
// ⚠ THE HOUSE MARGIN IS APPLIED HERE, IN THE CLIENT — deliberately. The API
// returns honest market figures and this file takes the percentage off, so the
// number is arithmetic on screen that the cataloguer can see and adjust. Putting
// it in the AI prompt instead would bury it somewhere it silently drifts away
// from what the business actually quotes.

import { useCallback, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"

type Archive = {
  count: number; median: number; low: number; high: number
  groupedExcluded: number; mostRecent: string | null
}
type Item = {
  id: string
  name: string
  maker: string | null
  model: string | null
  catalogueNumber: string | null
  variant: string | null
  quantity: number
  condition: string | null
  confidence: "high" | "medium" | "low"
  mixedLot: boolean
  photoIndex: number | null
  estimateLow: number
  estimateHigh: number
  basis: string | null
  archive: Archive | null
}
type Result = { items: Item[]; overallNotes: string; photoCount: number }

type Photo = { file: File; url: string }

const MAX_IMAGES = 20
const DEFAULT_MARGIN = 35

const money = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`

const CONFIDENCE_STYLE: Record<Item["confidence"], string> = {
  high:   "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low:    "bg-red-500/15 text-red-300 border-red-500/30",
}

export default function ValuationsTab() {
  const [photos, setPhotos]   = useState<Photo[]>([])
  const [note, setNote]       = useState("")
  const [margin, setMargin]   = useState(DEFAULT_MARGIN)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [data, setData]       = useState<Result | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback((list: FileList | File[]) => {
    const incoming = Array.from(list).filter(f => f.type.startsWith("image/"))
    if (incoming.length === 0) return
    setError(null)
    setPhotos(prev => {
      const room = MAX_IMAGES - prev.length
      if (room <= 0) {
        setError(`That's the limit — ${MAX_IMAGES} photos at a time.`)
        return prev
      }
      if (incoming.length > room) setError(`Only the first ${room} were added — ${MAX_IMAGES} photos at a time.`)
      return [...prev, ...incoming.slice(0, room).map(file => ({ file, url: URL.createObjectURL(file) }))]
    })
  }, [])

  function removePhoto(i: number) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, n) => n !== i)
    })
  }

  function clearAll() {
    photos.forEach(p => URL.revokeObjectURL(p.url))
    setPhotos([]); setData(null); setError(null); setNote("")
  }

  async function run() {
    if (photos.length === 0 || loading) return
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      photos.forEach(p => fd.append("images", p.file))
      if (note.trim()) fd.append("note", note.trim())
      const res  = await fetch("/api/research/valuation", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? res.statusText)
      setData(json)
    } catch (e: any) { setError(e.message); setData(null) }
    finally { setLoading(false) }
  }

  // ── Edits ────────────────────────────────────────────────────────────────
  // The cataloguer has the customer's email and their own experience; the AI
  // has a photo. They get the final say on every figure before it's exported.
  function patch(id: string, changes: Partial<Item>) {
    setData(d => d ? { ...d, items: d.items.map(it => it.id === id ? { ...it, ...changes } : it) } : d)
  }
  function removeItem(id: string) {
    setData(d => d ? { ...d, items: d.items.filter(it => it.id !== id) } : d)
  }

  const keep = 1 - margin / 100
  const safe = (n: number) => Math.round((n * keep) / 5) * 5   // to the nearest £5 — a quote, not an invoice

  const totals = useMemo(() => {
    const items = data?.items ?? []
    return {
      marketLow:  items.reduce((s, i) => s + i.estimateLow, 0),
      marketHigh: items.reduce((s, i) => s + i.estimateHigh, 0),
      safeLow:    items.reduce((s, i) => s + safe(i.estimateLow), 0),
      safeHigh:   items.reduce((s, i) => s + safe(i.estimateHigh), 0),
    }
  }, [data, margin]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportExcel() {
    if (!data) return
    const rows: Record<string, string | number>[] = data.items.map(i => ({
      "Item":            i.name,
      "Qty":             i.quantity,
      "Condition":       i.condition ?? "",
      "Confidence":      i.confidence,
      "Est. sale low":   i.estimateLow,
      "Est. sale high":  i.estimateHigh,
      [`Safe low (-${margin}%)`]:  safe(i.estimateLow),
      [`Safe high (-${margin}%)`]: safe(i.estimateHigh),
      "Sold before (ours)": i.archive ? `${i.archive.count} sold, median ${money(i.archive.median)}` : "",
      "Basis":           i.basis ?? "",
    }))
    rows.push({
      "Item": "TOTAL", "Qty": "", "Condition": "", "Confidence": "",
      "Est. sale low": totals.marketLow, "Est. sale high": totals.marketHigh,
      [`Safe low (-${margin}%)`]: totals.safeLow,
      [`Safe high (-${margin}%)`]: totals.safeHigh,
      "Sold before (ours)": "", "Basis": "",
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws["!cols"] = [{ wch: 52 }, { wch: 6 }, { wch: 28 }, { wch: 11 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 15 }, { wch: 26 }, { wch: 50 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Valuation")
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `vectis-valuation-${stamp}.xlsx`)
  }

  return (
    <div className="w-full max-w-6xl mx-auto">

      {/* ── Drop zone ── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        className={`rounded-2xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors ${
          dragging ? "border-[#2AB4A6] bg-[#2AB4A6]/5" : "border-gray-700 hover:border-gray-600 bg-[#1C1C1E]"
        }`}
      >
        <div className="text-5xl mb-3">📷</div>
        <p className="text-lg font-semibold text-white">Drop the customer&apos;s photos here</p>
        <p className="text-sm text-gray-500 mt-1">or click to choose them · up to {MAX_IMAGES} at a time</p>
        <input
          ref={fileRef} type="file" accept="image/*" multiple className="hidden"
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = "" }}
        />
      </div>

      {/* ── Thumbnails ── */}
      {photos.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider">{photos.length} photo{photos.length === 1 ? "" : "s"}</p>
            <button onClick={clearAll} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Clear all</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-700" />
                <span className="absolute bottom-0 left-0 px-1 text-[10px] bg-black/70 text-gray-300 rounded-tr">{i + 1}</span>
                <button
                  onClick={e => { e.stopPropagation(); removePhoto(i) }}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove photo"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Context + run ── */}
      {photos.length > 0 && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <label htmlFor="val-note" className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
              What did the customer say? <span className="text-gray-600 normal-case tracking-normal">(optional — it outranks a guess from a photo)</span>
            </label>
            <textarea
              id="val-note" value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="e.g. late father's collection, the trains are all runners, boxes are in the loft"
              className="w-full bg-[#2C2C2E] border border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
            />
          </div>
          <button
            onClick={run} disabled={loading}
            className="px-8 py-3.5 rounded-xl font-semibold text-base transition-colors disabled:opacity-40 whitespace-nowrap"
            style={{ background: "#2AB4A6", color: "#1C1C1E" }}
          >
            {loading ? "Valuing…" : `Value ${photos.length} photo${photos.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      {loading && (
        <p className="mt-4 text-sm text-gray-500">
          Identifying the items, checking references, and looking each one up against what we&apos;ve sold before. Give it a moment.
        </p>
      )}

      {error && (
        <p className="mt-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">{error}</p>
      )}

      {/* ── Results ── */}
      {data && (
        <div className="mt-8">

          {/* Margin control + totals */}
          <div className="rounded-2xl border border-gray-800 bg-[#1C1C1E] p-5 mb-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <div className="min-w-[16rem]">
                <label htmlFor="margin" className="block text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Safety margin — {margin}% under
                </label>
                <input
                  id="margin" type="range" min={0} max={50} step={5}
                  value={margin} onChange={e => setMargin(Number(e.target.value))}
                  className="w-full accent-[#2AB4A6]"
                />
                <p className="text-xs text-gray-600 mt-1">The house quotes 30–40% below what things really make.</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Est. sale total</p>
                <p className="text-xl font-semibold text-gray-400 line-through decoration-gray-700">
                  {money(totals.marketLow)} – {money(totals.marketHigh)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: "#2AB4A6" }}>Quote this</p>
                <p className="text-3xl font-bold text-white">
                  {money(totals.safeLow)} – {money(totals.safeHigh)}
                </p>
              </div>
              <button
                onClick={exportExcel}
                className="ml-auto px-5 py-3 rounded-xl text-sm font-semibold border border-gray-700 text-gray-300 hover:border-[#2AB4A6] hover:text-[#2AB4A6] transition-colors"
              >
                ⬇ Export to Excel
              </button>
            </div>
          </div>

          {data.overallNotes && (
            <p className="mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
              {data.overallNotes}
            </p>
          )}

          {data.items.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-[#1C1C1E] p-10 text-center">
              <div className="text-5xl mb-3">🤷</div>
              <p className="text-lg font-semibold text-white">Nothing valuable identified</p>
              <p className="text-sm text-gray-500 mt-1">Try clearer photos, or ones showing the makers&apos; marks and any boxes.</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-gray-800 overflow-hidden bg-[#1C1C1E]">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#141416] text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="text-left px-4 py-3 font-semibold">Item</th>
                      <th className="text-left px-4 py-3 font-semibold">Qty</th>
                      <th className="text-left px-4 py-3 font-semibold">What we&apos;ve sold</th>
                      <th className="text-right px-4 py-3 font-semibold">Est. sale</th>
                      <th className="text-right px-4 py-3 font-semibold" style={{ color: "#2AB4A6" }}>Quote</th>
                      <th className="px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {data.items.map(i => (
                      <tr key={i.id} className="align-top hover:bg-gray-800/20">
                        <td className="px-4 py-3">
                          <input
                            value={i.name}
                            onChange={e => patch(i.id, { name: e.target.value })}
                            className="w-full bg-transparent text-gray-100 font-medium focus:outline-none focus:bg-[#2C2C2E] rounded px-1 -mx-1"
                          />
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${CONFIDENCE_STYLE[i.confidence]}`}>
                              {i.confidence}
                            </span>
                            {i.mixedLot && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] border border-gray-700 text-gray-400">
                                rough guess — mixed lot
                              </span>
                            )}
                            {i.photoIndex !== null && (
                              <span className="text-[11px] text-gray-600">photo {i.photoIndex + 1}</span>
                            )}
                          </div>
                          {i.condition && <p className="text-xs text-gray-500 mt-1">{i.condition}</p>}
                          {i.basis && <p className="text-xs text-gray-600 mt-1 italic">{i.basis}</p>}
                        </td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{i.quantity}</td>
                        <td className="px-4 py-3">
                          {/* Our own hammer prices — the honest anchor. Group lots
                              are excluded from the median, so say when some were. */}
                          {i.archive ? (
                            <>
                              <p className="text-gray-300">
                                {i.archive.count} sold · median <span className="font-semibold text-white">{money(i.archive.median)}</span>
                              </p>
                              <p className="text-xs text-gray-600">
                                usually {money(i.archive.low)}–{money(i.archive.high)}
                                {i.archive.groupedExcluded > 0 && ` · ${i.archive.groupedExcluded} group lot${i.archive.groupedExcluded === 1 ? "" : "s"} ignored`}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-gray-600">{i.mixedLot ? "not looked up — mixed lot" : "nothing comparable in our archive"}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1 text-gray-400">
                            £<input
                              type="number" min={0} value={i.estimateLow}
                              onChange={e => patch(i.id, { estimateLow: Math.max(0, Number(e.target.value)) })}
                              className="w-16 bg-transparent text-right focus:outline-none focus:bg-[#2C2C2E] rounded"
                            />
                            <span>–£</span>
                            <input
                              type="number" min={0} value={i.estimateHigh}
                              onChange={e => patch(i.id, { estimateHigh: Math.max(0, Number(e.target.value)) })}
                              className="w-16 bg-transparent text-right focus:outline-none focus:bg-[#2C2C2E] rounded"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap font-semibold text-white">
                          {money(safe(i.estimateLow))} – {money(safe(i.estimateHigh))}
                        </td>
                        <td className="px-2 py-3">
                          <button
                            onClick={() => removeItem(i.id)}
                            className="text-gray-700 hover:text-red-400 transition-colors"
                            aria-label="Remove this row"
                          >×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#141416] font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-gray-300" colSpan={3}>Total</td>
                      <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">
                        {money(totals.marketLow)} – {money(totals.marketHigh)}
                      </td>
                      <td className="px-4 py-3 text-right text-white whitespace-nowrap">
                        {money(totals.safeLow)} – {money(totals.safeHigh)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-gray-600">
            A guide from photographs, not a formal valuation — the items haven&apos;t been handled. Anything that looks
            genuinely valuable is worth a proper look before you quote.
          </p>
        </div>
      )}
    </div>
  )
}
