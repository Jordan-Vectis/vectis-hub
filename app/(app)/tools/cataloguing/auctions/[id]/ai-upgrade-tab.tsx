"use client"

import { useRouter } from "next/navigation"

interface Props {
  auctionId: string
  auctionCode: string
  lots: any[]
  onDone: () => void
}

export default function AiUpgradeTab({ auctionCode }: Props) {
  const router = useRouter()

  function goToPipeline() {
    try {
      localStorage.setItem("pipeline_preload", JSON.stringify({ auctionCode }))
    } catch {}
    router.push("/tools/auction-ai?tab=pipeline")
  }

  return (
    <div className="max-w-lg space-y-4 py-2">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">AI Upgrade</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          AI upgrades are now handled in the <strong>Auto Pipeline</strong> in Auction AI — which runs Batch,
          Double Check and Key Points in one go, ensuring the latest instructions are always used.
        </p>
      </div>
      <button
        onClick={goToPipeline}
        className="px-5 py-3 bg-[#C8A96E] hover:bg-[#d4b87a] text-black font-semibold rounded-xl transition-colors text-sm"
      >
        🔄 Go to Auto Pipeline for {auctionCode}
      </button>
    </div>
  )
}
