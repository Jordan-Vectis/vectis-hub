"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import PhotoUploadTab from "../../auctions/[id]/photo-upload-tab"
import { holdLotPhoto, sweepHeldPhotos, discardHeldPhoto } from "@/lib/actions/catalogue"

type Lot = {
  id: string; barcode: string | null; receiptUniqueId: string | null
  imageUrls: string[]; auctionId: string; auctionCode: string
}
type Sale = { code: string; name: string; lots: number }
type Held = { id: string; code: string; fileName: string; r2Key: string; uploadedBy: string | null; createdAt: string }

const proxyUrl = (key: string) => `/api/catalogue/photo-proxy?key=${encodeURIComponent(key)}`

// The page is a server component, so the callbacks the uploader needs live here.
export default function AnySaleUploadClient({ lots, sales, held }: { lots: Lot[]; sales: Sale[]; held: Held[] }) {
  const router = useRouter()
  const [showSales, setShowSales] = useState(false)
  const [holding, setHolding]     = useState<{ done: number; total: number } | null>(null)
  const [holdNote, setHoldNote]   = useState<string | null>(null)
  const [sweepNote, setSweepNote] = useState<string | null>(null)
  const [pending, start] = useTransition()

  // Photos whose code isn't a lot in any open sale. Kept rather than dropped — see
  // lib/held-photos.ts. Sequential on purpose: each one is a file upload, and a
  // photographer's folder can be large.
  async function holdUnmatched(groups: { code: string; photos: File[] }[]) {
    const total = groups.reduce((n, g) => n + g.photos.length, 0)
    if (total === 0) return
    setHoldNote(null)
    setHolding({ done: 0, total })
    let done = 0, ok = 0, attached = 0
    const errors: string[] = []
    for (const g of groups) {
      for (const photo of g.photos) {
        try {
          const fd = new FormData()
          fd.set("photo", photo)
          const res = await holdLotPhoto(g.code, fd)
          if (res.ok) { ok++; attached += res.attached } else errors.push(`${photo.name} — ${res.error}`)
        } catch {
          errors.push(`${photo.name} — could not be held`)
        }
        done++
        setHolding({ done, total })
      }
    }
    setHolding(null)
    setHoldNote(
      errors.length
        ? `Held ${ok} of ${total} photo${total === 1 ? "" : "s"}. ${errors.length} failed: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}`
        : `Held ${ok} photo${ok === 1 ? "" : "s"} until their lots exist${attached > 0 ? ` — ${attached} attached straight away` : ""}.`,
    )
    router.refresh()
  }

  function checkNow() {
    setSweepNote(null)
    start(async () => {
      const res = await sweepHeldPhotos()
      if (!res.ok) { setSweepNote(res.error ?? "Could not check."); return }
      setSweepNote(res.attached > 0
        ? `✓ Attached ${res.attached} photo${res.attached === 1 ? "" : "s"}. ${res.stillWaiting} still waiting.`
        : `Nothing to attach yet — ${res.stillWaiting} still waiting for their lots.`)
      router.refresh()
    })
  }

  function discard(id: string) {
    start(async () => {
      const res = await discardHeldPhoto(id)
      if (!res.ok) setSweepNote(res.error ?? "Could not discard it.")
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Which sales are being searched — so a short list is never a mystery */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] px-4 py-3">
        <button onClick={() => setShowSales(v => !v)}
          className="text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-purple-600 dark:hover:text-purple-400">
          {showSales ? "▾" : "▸"} Searching {sales.length} sale{sales.length === 1 ? "" : "s"} still in progress
        </button>
        {showSales && (
          <div className="mt-3 flex flex-wrap gap-2">
            {sales.map(s => (
              <span key={s.code} title={`${s.name} — ${s.lots} lots`}
                className="text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2.5 py-1">
                <span className="font-mono text-purple-700 dark:text-purple-400">{s.code}</span> · {s.lots}
              </span>
            ))}
            {sales.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No sales are in progress, so nothing can match. Every photo you upload will wait for its lot.
              </p>
            )}
          </div>
        )}
      </div>

      <PhotoUploadTab
        auctionId={null}
        lots={lots}
        onUploaded={() => router.refresh()}
        onUnmatched={holdUnmatched}
      />

      {holding && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Keeping the photos that had no lot… {holding.done} of {holding.total}
          </p>
        </div>
      )}
      {holdNote && (
        <div className="rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-300">{holdNote}</p>
        </div>
      )}

      {/* ── Waiting for their lot ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            ⏳ Waiting for their lot {held.length > 0 && <span className="text-gray-500 font-normal">({held.length})</span>}
          </h2>
          <button onClick={checkNow} disabled={pending}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold bg-gray-100 dark:bg-[#2C2C2E] text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white disabled:opacity-50">
            {pending ? "Checking…" : "↻ Check now"}
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Photos whose barcode or unique ID isn&apos;t on a lot yet. They attach themselves as soon as one turns
          up — including when 🔗 BC Match fills the unique IDs in after End of Day — so there is normally nothing
          to do here.
        </p>
        {sweepNote && <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{sweepNote}</p>}

        {held.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Nothing waiting — every photo found its lot.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(held.reduce<Record<string, Held[]>>((acc, h) => {
              (acc[h.code] ??= []).push(h); return acc
            }, {})).map(([code, rows]) => (
              <div key={code} className="rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="font-mono text-sm font-semibold text-amber-700 dark:text-amber-400">{code}</span>
                  <span className="text-xs text-gray-500">{rows.length} photo{rows.length === 1 ? "" : "s"}</span>
                  <span className="text-xs text-gray-500">
                    · {new Date(rows[rows.length - 1].createdAt).toLocaleDateString("en-GB")}
                    {rows[0].uploadedBy ? ` · ${rows[0].uploadedBy}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map(h => (
                    <div key={h.id} className="relative group">
                      <img src={proxyUrl(h.r2Key)} alt={h.fileName} title={h.fileName} loading="lazy"
                        className="w-16 h-16 rounded-md object-cover border border-gray-300 dark:border-gray-700" />
                      <button onClick={() => discard(h.id)} disabled={pending}
                        title="Throw this photo away — the code was misread, or the lot is never coming"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
