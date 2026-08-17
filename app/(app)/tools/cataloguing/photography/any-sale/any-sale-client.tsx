"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import PhotoUploadTab from "../../auctions/[id]/photo-upload-tab"

type Lot = {
  id: string; barcode: string | null; receiptUniqueId: string | null
  imageUrls: string[]; auctionId: string; auctionCode: string
}
type Sale = { code: string; name: string; lots: number }

// The page is a server component and cannot hand a callback to a client component,
// so the refresh-after-upload lives here.
//
// ⚠ A photo whose code isn't a lot in any open sale is NOT saved and NOT kept anywhere
// (Jordan, 2026-08-17: "No dont store them if they dont match just forget about them").
// The uploader already lists those groups on the review and results screens so nothing is
// hidden — they simply don't upload. Don't reintroduce a holding area.
export default function AnySaleUploadClient({ lots, sales }: { lots: Lot[]; sales: Sale[] }) {
  const router = useRouter()
  const [showSales, setShowSales] = useState(false)

  return (
    <div className="space-y-6">
      {/* Which sales are being searched — so a short list of matches is never a mystery */}
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
                No sales are in progress, so nothing can match and nothing will save.
              </p>
            )}
          </div>
        )}
      </div>

      <PhotoUploadTab
        auctionId={null}
        lots={lots}
        onUploaded={() => router.refresh()}
      />
    </div>
  )
}
