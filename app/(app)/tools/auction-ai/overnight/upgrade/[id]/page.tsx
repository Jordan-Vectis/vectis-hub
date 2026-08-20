import UpgradeRunClient from "./upgrade-run-client"

export const dynamic = "force-dynamic"

// One overnight AI Upgrade run — /tools/auction-ai/overnight/upgrade/<queue item id>
//
// Keyed by the queue item's id, not the sale code, because the same sale can also
// have a pipeline run queued (that one lives at /overnight/[code]).
//
// Access is inherited from app/(app)/tools/auction-ai/layout.tsx (AUCTION_AI).
export default async function OvernightUpgradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <UpgradeRunClient id={decodeURIComponent(id)} />
}
