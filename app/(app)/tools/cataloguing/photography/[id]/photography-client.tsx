"use client"

import { useRouter } from "next/navigation"
import PhotoUploadTab from "../../auctions/[id]/photo-upload-tab"

interface Props {
  auctionId: string
  lots: { id: string; barcode: string | null; receiptUniqueId?: string | null }[]
}

// Thin client wrapper: the page is a server component and cannot hand a
// callback to a client component, so the refresh-after-upload lives here.
export default function PhotographyClient({ auctionId, lots }: Props) {
  const router = useRouter()
  return (
    <PhotoUploadTab
      auctionId={auctionId}
      lots={lots}
      onUploaded={() => router.refresh()}
    />
  )
}
