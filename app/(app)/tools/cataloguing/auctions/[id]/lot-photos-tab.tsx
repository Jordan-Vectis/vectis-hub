"use client"

import { useState, useRef } from "react"
import { uploadLotPhoto, deleteLotPhoto, reorderLotPhotos } from "@/lib/actions/catalogue"

interface LotRow {
  id: string
  barcode: string | null
  receiptUniqueId: string | null
  title: string
  imageUrls: string[]
}

interface Props {
  auctionId: string
  lots: LotRow[]
}

export default function LotPhotosTab({ auctionId, lots: initialLots }: Props) {
  const [lots, setLots]               = useState<LotRow[]>(initialLots)
  const [expandedId, setExpandedId]   = useState<string | null>(null)
  const [signedUrls, setSignedUrls]   = useState<Record<string, string>>({})
  const [loadingId, setLoadingId]     = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [search, setSearch]           = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [activeUploadLotId, setActiveUploadLotId] = useState<string | null>(null)

  async function loadSignedUrls(keys: string[]) {
    const missing = keys.filter(k => !signedUrls[k])
    if (missing.length === 0) return
    const results = await Promise.all(
      missing.map(async key => {
        const res = await fetch(`/api/catalogue/signed-url?key=${encodeURIComponent(key)}`)
        const { url } = await res.json()
        return [key, url] as [string, string]
      })
    )
    setSignedUrls(prev => ({ ...prev, ...Object.fromEntries(results) }))
  }

  async function toggleLot(lot: LotRow) {
    if (expandedId === lot.id) { setExpandedId(null); return }
    setExpandedId(lot.id)
    if (lot.imageUrls.length > 0) {
      setLoadingId(lot.id)
      await loadSignedUrls(lot.imageUrls)
      setLoadingId(null)
    }
  }

  function triggerUpload(lotId: string) {
    setActiveUploadLotId(lotId)
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !activeUploadLotId) return
    e.target.value = ""

    const lotId = activeUploadLotId
    setUploadingId(lotId)
    try {
      const fd = new FormData()
      fd.set("photo", file)
      const updatedKeys = await uploadLotPhoto(lotId, auctionId, fd)
      setLots(prev => prev.map(l => l.id === lotId ? { ...l, imageUrls: updatedKeys } : l))
      const newKeys = updatedKeys.filter(k => !signedUrls[k])
      if (newKeys.length > 0) await loadSignedUrls(newKeys)
    } finally {
      setUploadingId(null)
      setActiveUploadLotId(null)
    }
  }

  async function handleDelete(lotId: string, key: string) {
    if (!confirm("Remove this photo?")) return
    const updatedKeys = await deleteLotPhoto(lotId, auctionId, key)
    setLots(prev => prev.map(l => l.id === lotId ? { ...l, imageUrls: updatedKeys } : l))
  }

  async function handleReverse(lot: LotRow) {
    const reversed = [...lot.imageUrls].reverse()
    setLots(prev => prev.map(l => l.id === lot.id ? { ...l, imageUrls: reversed } : l))
    await reorderLotPhotos(lot.id, auctionId, reversed)
  }

  const filtered = lots.filter(l =>
    search === "" ||
    (l.barcode ?? l.receiptUniqueId ?? "").toLowerCase().includes(search.toLowerCase()) ||
    l.title.toLowerCase().includes(search.toLowerCase())
  )

  if (lots.length === 0) {
    return (
      <div className="p-6 text-center py-16 text-gray-600">
        No lots yet — add lots first using the <span className="text-gray-400">Add Lot</span> tab.
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6">
      {/* Hidden file input shared across all lots */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Search */}
      <div className="mb-4 max-w-sm">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search lots…"
          className="w-full rounded-lg border border-gray-700 bg-[#2C2C2E] px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#2AB4A6]"
        />
      </div>

      <div className="space-y-2">
        {filtered.map(lot => {
          const isExpanded  = expandedId === lot.id
          const isLoading   = loadingId === lot.id
          const isUploading = uploadingId === lot.id

          return (
            <div key={lot.id} className="bg-[#1C1C1E] rounded-xl border border-gray-800 overflow-hidden">
              {/* Lot row header */}
              <button
                onClick={() => toggleLot(lot)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#2C2C2E] transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-sm font-semibold text-[#2AB4A6] flex-shrink-0">{lot.barcode ?? lot.receiptUniqueId ?? ""}</span>
                  <span className="text-sm text-gray-300 truncate">{lot.title}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                  {lot.imageUrls.length > 0 && (
                    <span className="text-xs bg-[#2AB4A6]/20 text-[#2AB4A6] px-2 py-0.5 rounded-full font-medium">
                      {lot.imageUrls.length} photo{lot.imageUrls.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span className={`text-gray-500 text-sm transition-transform ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                </div>
              </button>

              {/* Expanded photo panel */}
              {isExpanded && (
                <div className="border-t border-gray-800 px-4 py-4">
                  {isLoading && (
                    <p className="text-sm text-gray-500 py-2">Loading photos…</p>
                  )}

                  {!isLoading && lot.imageUrls.length === 0 && (
                    <p className="text-sm text-gray-600 mb-3">No photos yet.</p>
                  )}

                  {!isLoading && lot.imageUrls.length > 0 && (
                    <div className="mb-3">
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-2">
                        {lot.imageUrls.map((key, idx) => (
                          <div key={key} className="relative group">
                            <div className="relative aspect-square">
                              {signedUrls[key] ? (
                                <a href={signedUrls[key]} target="_blank" rel="noopener noreferrer">
                                  <img
                                    src={signedUrls[key]}
                                    alt="Lot photo"
                                    className={`w-full h-full object-cover rounded-lg border ${idx === 0 ? "border-[#2AB4A6]" : "border-gray-700"}`}
                                  />
                                </a>
                              ) : (
                                <div className="w-full h-full rounded-lg bg-gray-800 flex items-center justify-center">
                                  <span className="text-gray-600 text-xs">Loading</span>
                                </div>
                              )}
                              <button
                                onClick={() => handleDelete(lot.id, key)}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-700 rounded-full text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >✕</button>
                            </div>
                            <p className={`text-[10px] text-center mt-0.5 ${idx === 0 ? "text-[#2AB4A6] font-semibold" : "text-gray-600"}`}>
                              {idx === 0 ? "Main" : `Photo ${idx + 1}`}
                            </p>
                          </div>
                        ))}
                      </div>
                      {lot.imageUrls.length > 1 && (
                        <button
                          onClick={() => handleReverse(lot)}
                          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          ↕ Reverse order
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => triggerUpload(lot.id)}
                    disabled={isUploading}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600 hover:border-[#2AB4A6] text-gray-400 hover:text-[#2AB4A6] text-sm transition-colors disabled:opacity-50"
                  >
                    {isUploading ? (
                      <>⏳ Uploading…</>
                    ) : (
                      <>📷 Add photo</>
                    )}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && search && (
        <p className="text-center text-gray-600 py-8 text-sm">No lots match "{search}"</p>
      )}
    </div>
  )
}
