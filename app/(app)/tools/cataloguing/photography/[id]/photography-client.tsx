"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import PhotoUploadTab from "../../auctions/[id]/photo-upload-tab"
import LotViewer, { type ViewerLot } from "./lot-viewer"

interface Props {
  auctionId: string
  lots: ViewerLot[]
}

type Tab = "upload" | "view"

// The page is a server component and cannot hand a callback to a client
// component, so the tab state and the refresh-after-upload live here.
export default function PhotographyClient({ auctionId, lots }: Props) {
  const router = useRouter()
  // ?tab=view lets the auction list's "View lots" button land straight on the
  // viewer instead of the upload screen.
  const params = useSearchParams()
  const [tab, setTab] = useState<Tab>(params.get("tab") === "view" ? "view" : "upload")

  const withPhotos = lots.filter(l => l.imageUrls.length > 0).length

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800 mb-5">
        {([
          ["upload", "📷 Upload photos"],
          ["view",   `🔍 View lots (${withPhotos}/${lots.length})`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-purple-500 text-purple-700 dark:text-purple-400"
                : "border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "upload" ? (
        <PhotoUploadTab
          auctionId={auctionId}
          lots={lots.map(l => ({ id: l.id, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId }))}
          onUploaded={() => router.refresh()}
        />
      ) : (
        <LotViewer lots={lots} />
      )}
    </div>
  )
}
