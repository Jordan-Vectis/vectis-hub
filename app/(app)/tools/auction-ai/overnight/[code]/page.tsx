import RunClient from "./run-client"

export const dynamic = "force-dynamic"

// One overnight run, lot by lot — /tools/auction-ai/overnight/<sale code>
//
// The old panel gave you a single log blob and a progress bar, which told you a sale had
// finished but not what it had actually done. Everything needed to answer that is already
// stored per lot on PipelineLot (each stage's outcome, what Double Check contradicted, which
// key points were missing or added, and whether the text reached the catalogue) — this reads it.
//
// Access is inherited from app/(app)/tools/auction-ai/layout.tsx (AUCTION_AI).
export default async function OvernightRunPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return <RunClient code={decodeURIComponent(code).toUpperCase()} />
}
