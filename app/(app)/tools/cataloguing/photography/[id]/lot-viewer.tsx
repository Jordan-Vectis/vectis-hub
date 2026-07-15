"use client"

import { useMemo, useState } from "react"

export interface ViewerLot {
  id:              string
  barcode:         string | null
  receiptUniqueId: string | null
  title:           string
  keyPoints:       string
  description:     string
  condition:       string | null
  category:        string | null
  vendor:          string | null
  tote:            string | null
  imageUrls:       string[]
  labelPhotoUrl:   string | null
}

type Filter  = "all" | "with" | "without"
type Density = "detailed" | "compact"

// R2 keys are streamed through the proxy (the house rule — never fetch a raw
// key) and lazy-loaded, so a 500-lot sale only fetches what is on screen.
const src = (key: string) => `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`

export default function LotViewer({ lots }: { lots: ViewerLot[] }) {
  const [search, setSearch]   = useState("")
  const [filter, setFilter]   = useState<Filter>("all")
  const [density, setDensity] = useState<Density>("detailed")
  const [zoom, setZoom]       = useState<{ key: string; caption: string } | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const shown = useMemo(() => lots.filter(l => {
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = `${l.barcode ?? ""} ${l.receiptUniqueId ?? ""} ${l.title} ${l.vendor ?? ""} ${l.tote ?? ""} ${l.keyPoints}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (filter === "with"    && l.imageUrls.length === 0) return false
    if (filter === "without" && l.imageUrls.length > 0)   return false
    return true
  }), [lots, search, filter])

  const withPhotos = lots.filter(l => l.imageUrls.length > 0).length
  const withLabel  = lots.filter(l => l.labelPhotoUrl).length
  const totalPhotos = lots.reduce((n, l) => n + l.imageUrls.length, 0)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Lots in this sale", lots.length, "text-gray-900 dark:text-white"],
          ["With photos", withPhotos, "text-green-700 dark:text-green-400"],
          ["Still need photos", lots.length - withPhotos, (lots.length - withPhotos) > 0 ? "text-amber-700 dark:text-amber-400" : "text-gray-900 dark:text-white"],
          ["Photos in total", totalPhotos, "text-gray-900 dark:text-white"],
        ].map(([label, value, colour]) => (
          <div key={label as string} className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-4 py-3">
            <p className={`text-2xl font-bold ${colour as string}`}>{value as number}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{label as string}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search barcode, ID, title, key points, vendor or tote…"
          className="flex-1 min-w-[14rem] max-w-md rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="flex gap-1">
          {([["all", `All (${lots.length})`], ["with", `With photos (${withPhotos})`], ["without", `No photos (${lots.length - withPhotos})`]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === v ? "bg-purple-600 text-white"
                  : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-500"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {([["detailed", "Detailed"], ["compact", "Compact"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setDensity(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                density === v ? "bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900"
                  : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-500"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {search || filter !== "all" ? (
        <p className="text-xs text-gray-600 dark:text-gray-400">
          Showing {shown.length} of {lots.length} lots
          {withLabel > 0 ? ` · ${withLabel} have a barcode label photo` : ""}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {lots.length === 0 ? "This sale has no lots yet." : "No lots match."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(l => {
            const id    = l.barcode || l.receiptUniqueId || "—"
            const isOpen = expanded.has(l.id)
            const none   = l.imageUrls.length === 0

            if (density === "compact") {
              return (
                <div key={l.id}
                  className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 flex items-center gap-3">
                  {l.labelPhotoUrl ? (
                    <button onClick={() => setZoom({ key: l.labelPhotoUrl!, caption: `Barcode label — should read ${id}` })}
                      className="w-9 h-9 rounded border-2 border-amber-400 dark:border-amber-500/70 overflow-hidden flex-shrink-0" title="Barcode label photo">
                      <img src={src(l.labelPhotoUrl)} alt="Label" loading="lazy" className="w-full h-full object-cover" />
                    </button>
                  ) : <span className="w-9 h-9 rounded border border-dashed border-gray-300 dark:border-gray-700 flex-shrink-0" title="No label photo" />}
                  <span className="font-mono text-xs text-purple-700 dark:text-purple-400 w-28 flex-shrink-0">{id}</span>
                  <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate">{l.title || "Untitled"}</span>
                  <div className="flex gap-1 flex-shrink-0">
                    {l.imageUrls.slice(0, 5).map(k => (
                      <button key={k} onClick={() => setZoom({ key: k, caption: `${id} — ${l.title}` })}
                        className="w-9 h-9 rounded overflow-hidden border border-gray-300 dark:border-gray-700">
                        <img src={src(k)} alt="" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <span className={`text-xs w-16 text-right flex-shrink-0 ${none ? "text-amber-600 dark:text-amber-400" : "text-gray-600 dark:text-gray-400"}`}>
                    {none ? "none" : `${l.imageUrls.length} 📷`}
                  </span>
                </div>
              )
            }

            return (
              <div key={l.id}
                className={`bg-white dark:bg-[#1C1C1E] border rounded-xl p-4 ${
                  none ? "border-amber-300 dark:border-amber-700/50" : "border-gray-300 dark:border-gray-700"
                }`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-purple-700 dark:text-purple-400">{id}</span>
                      {l.barcode && l.receiptUniqueId && (
                        <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{l.receiptUniqueId}</span>
                      )}
                      {l.vendor && <span className="text-xs text-gray-600 dark:text-gray-400">Vendor {l.vendor}</span>}
                      {l.tote   && <span className="text-xs text-gray-600 dark:text-gray-400">Tote {l.tote}</span>}
                      {l.category && <span className="text-xs text-gray-600 dark:text-gray-400">{l.category}</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{l.title || "Untitled"}</p>
                  </div>
                  <span className={`text-xs whitespace-nowrap flex-shrink-0 rounded-full px-2 py-0.5 ${
                    none
                      ? "bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400"
                      : "bg-green-200 text-green-800 dark:bg-green-900/40 dark:text-green-400"
                  }`}>
                    {none ? "No photos" : `${l.imageUrls.length} photo${l.imageUrls.length !== 1 ? "s" : ""}`}
                  </span>
                </div>

                <div className="flex gap-4">
                  {/* Barcode label — the check aid */}
                  <div className="flex-shrink-0 w-24">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Label</p>
                    {l.labelPhotoUrl ? (
                      <button onClick={() => setZoom({ key: l.labelPhotoUrl!, caption: `Barcode label — should read ${id}` })}
                        className="w-24 h-24 rounded-lg overflow-hidden border-2 border-amber-400 dark:border-amber-500/70 hover:border-amber-500 transition-colors">
                        <img src={src(l.labelPhotoUrl)} alt="Barcode label" loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-24 h-24 rounded-lg border border-dashed border-gray-300 dark:border-gray-700 flex items-center justify-center p-1">
                        <p className="text-[10px] text-gray-500 dark:text-gray-500 text-center leading-tight">No label photo</p>
                      </div>
                    )}
                  </div>

                  {/* Photos + text */}
                  <div className="flex-1 min-w-0 space-y-3">
                    {none ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">This lot has no photos yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {l.imageUrls.map((k, i) => (
                          <button key={k} onClick={() => setZoom({ key: k, caption: `${id} — ${l.title}` })}
                            className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 hover:border-purple-500 transition-colors">
                            <img src={src(k)} alt={`Photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />
                            {i === 0 && (
                              <span className="absolute bottom-0 inset-x-0 bg-[#2AB4A6] text-black text-[8px] font-semibold text-center leading-tight py-0.5">Main</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {l.keyPoints.trim() && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Key points</p>
                        <p className={`text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap ${isOpen ? "" : "line-clamp-2"}`}>
                          {l.keyPoints}
                        </p>
                      </div>
                    )}
                    {l.description.trim() && (
                      <div>
                        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Description</p>
                        <p className={`text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap ${isOpen ? "" : "line-clamp-2"}`}>
                          {l.description}
                        </p>
                      </div>
                    )}
                    {l.condition && isOpen && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Condition:</span> {l.condition}
                      </p>
                    )}
                    {!l.keyPoints.trim() && !l.description.trim() && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 italic">No key points or description yet.</p>
                    )}
                    {(l.keyPoints.trim() || l.description.trim() || l.condition) && (
                      <button onClick={() => toggleExpand(l.id)}
                        className="text-xs text-purple-700 dark:text-purple-400 hover:underline font-medium">
                        {isOpen ? "▴ Show less" : "▾ Show more"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Full-size viewer */}
      {zoom && (
        <div onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-6 cursor-zoom-out">
          <img src={src(zoom.key)} alt={zoom.caption} className="max-w-full max-h-[85vh] object-contain rounded-lg" />
          <p className="text-white text-sm mt-3 font-mono">{zoom.caption}</p>
          <button onClick={() => setZoom(null)}
            className="absolute top-4 right-4 text-white text-2xl leading-none px-3 py-1">✕</button>
        </div>
      )}
    </div>
  )
}
