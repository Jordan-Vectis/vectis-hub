"use client"

import { useEffect, useMemo, useState } from "react"

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

type Filter = "all" | "with" | "without"

// One signed-URL cache for the whole viewer — R2 keys are signed on demand.
function useSignedUrls() {
  const [urls, setUrls] = useState<Record<string, string>>({})
  async function load(keys: string[]) {
    const missing = keys.filter(k => k && !urls[k])
    if (missing.length === 0) return
    const pairs = await Promise.all(missing.map(async key => {
      try {
        const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
        const d = await res.json()
        return [key, d.url as string] as const
      } catch { return [key, ""] as const }
    }))
    setUrls(prev => ({ ...prev, ...Object.fromEntries(pairs.filter(([, u]) => u)) }))
  }
  return { urls, load }
}

export default function LotViewer({ lots }: { lots: ViewerLot[] }) {
  const [search, setSearch]   = useState("")
  const [filter, setFilter]   = useState<Filter>("all")
  const [openId, setOpenId]   = useState<string | null>(null)
  const [zoom, setZoom]       = useState<string | null>(null)   // signed url of a photo to show full size
  const { urls, load }        = useSignedUrls()

  const shown = useMemo(() => lots.filter(l => {
    const q = search.trim().toLowerCase()
    if (q) {
      const hay = `${l.barcode ?? ""} ${l.receiptUniqueId ?? ""} ${l.title} ${l.vendor ?? ""} ${l.tote ?? ""}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (filter === "with"    && l.imageUrls.length === 0) return false
    if (filter === "without" && l.imageUrls.length > 0)   return false
    return true
  }), [lots, search, filter])

  const open = shown.find(l => l.id === openId) ?? null

  // Sign the open lot's photos (and its label photo) as it is opened.
  useEffect(() => {
    if (!open) return
    load([...open.imageUrls, ...(open.labelPhotoUrl ? [open.labelPhotoUrl] : [])])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId])

  const withPhotos = lots.filter(l => l.imageUrls.length > 0).length

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search barcode, ID, title, vendor or tote…"
          className="flex-1 min-w-[14rem] max-w-md rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <div className="flex gap-1">
          {([["all", `All (${lots.length})`], ["with", `With photos (${withPhotos})`], ["without", `No photos (${lots.length - withPhotos})`]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === v
                  ? "bg-purple-600 text-white"
                  : "border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-500"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-10 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400">No lots match.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lot list */}
          <div className="lg:col-span-1 bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl overflow-hidden max-h-[36rem] overflow-y-auto">
            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {shown.map(l => {
                const active = l.id === openId
                return (
                  <button key={l.id} onClick={() => setOpenId(l.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      active ? "bg-purple-100 dark:bg-purple-900/25" : "hover:bg-gray-100 dark:hover:bg-gray-800/60"
                    }`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-purple-700 dark:text-purple-400">
                        {l.barcode || l.receiptUniqueId || "—"}
                      </span>
                      <span className={`text-xs ml-auto ${l.imageUrls.length > 0 ? "text-green-600 dark:text-green-400" : "text-gray-500 dark:text-gray-500"}`}>
                        {l.imageUrls.length > 0 ? `${l.imageUrls.length} 📷` : "no photos"}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-300 mt-1 line-clamp-2">{l.title || "Untitled"}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Detail */}
          <div className="lg:col-span-2">
            {!open ? (
              <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl px-6 py-16 text-center">
                <p className="text-3xl mb-2">👈</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">Pick a lot to see its photos, key points and description.</p>
              </div>
            ) : (
              <div className="bg-white dark:bg-[#1C1C1E] border border-gray-300 dark:border-gray-700 rounded-xl p-5 space-y-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-semibold text-purple-700 dark:text-purple-400">
                      {open.barcode || open.receiptUniqueId || "—"}
                    </span>
                    {open.receiptUniqueId && open.barcode && (
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{open.receiptUniqueId}</span>
                    )}
                    {open.vendor && <span className="text-xs text-gray-600 dark:text-gray-400">Vendor {open.vendor}</span>}
                    {open.tote   && <span className="text-xs text-gray-600 dark:text-gray-400">Tote {open.tote}</span>}
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mt-1">{open.title || "Untitled"}</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Photos */}
                  <div className="md:col-span-2">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Photos on this lot ({open.imageUrls.length})
                    </p>
                    {open.imageUrls.length === 0 ? (
                      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-4 py-8 text-center">
                        <p className="text-xs text-gray-600 dark:text-gray-400">No photos yet.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {open.imageUrls.map((k, i) => (
                          <button key={k} onClick={() => urls[k] && setZoom(urls[k])}
                            className="relative aspect-square rounded-lg overflow-hidden border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 hover:border-purple-500 transition-colors">
                            {urls[k]
                              ? <img src={urls[k]} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                              : <span className="text-xs text-gray-500">…</span>}
                            {i === 0 && (
                              <span className="absolute bottom-0 inset-x-0 bg-[#2AB4A6] text-black text-[9px] font-semibold text-center py-0.5">Main</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Barcode label photo — the check aid */}
                  <div>
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Barcode label</p>
                    {open.labelPhotoUrl ? (
                      <>
                        <button onClick={() => open.labelPhotoUrl && urls[open.labelPhotoUrl] && setZoom(urls[open.labelPhotoUrl])}
                          className="w-full aspect-square rounded-lg overflow-hidden border-2 border-amber-400 dark:border-amber-500/70 bg-gray-100 dark:bg-gray-800 hover:border-amber-500 transition-colors">
                          {urls[open.labelPhotoUrl]
                            ? <img src={urls[open.labelPhotoUrl]} alt="Barcode label" className="w-full h-full object-cover" />
                            : <span className="text-xs text-gray-500">…</span>}
                        </button>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                          The label that put these photos on this lot. Check it reads{" "}
                          <span className="font-mono">{open.barcode || open.receiptUniqueId}</span>.
                        </p>
                      </>
                    ) : (
                      <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg px-3 py-6 text-center">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          No label photo — this lot was photographed before label photos were kept, or matched by filename.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Key points */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Key points</p>
                  {open.keyPoints.trim() ? (
                    <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2">
                      {open.keyPoints}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-500 italic">None entered.</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Description</p>
                  {open.description.trim() ? (
                    <p className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-[#141416] border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 max-h-48 overflow-y-auto">
                      {open.description}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-500 italic">Not written yet.</p>
                  )}
                </div>

                {(open.condition || open.category) && (
                  <div className="flex gap-4 flex-wrap">
                    {open.category && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Category:</span> {open.category}
                      </p>
                    )}
                    {open.condition && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">Condition:</span> {open.condition}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-size viewer */}
      {zoom && (
        <div onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out">
          <img src={zoom} alt="Full size" className="max-w-full max-h-full object-contain rounded-lg" />
          <button onClick={() => setZoom(null)}
            className="absolute top-4 right-4 text-white text-2xl leading-none px-3 py-1">✕</button>
        </div>
      )}
    </div>
  )
}
