import OvernightClient from "./overnight-client"

export const dynamic = "force-dynamic"

// Overnight AI runs — /tools/auction-ai/overnight
//
// The server-side queue used to be a panel bolted onto the bottom of the Auto Pipeline tab,
// which meant the thing you check in the morning lived inside the thing you drive by hand, and
// a queued sale silently inherited whatever that tab happened to be set to. It is its own page
// now: it owns its settings, lists every run, and each run opens up to show what actually
// happened lot by lot.
//
// ⚠ The MACHINERY is unchanged — lib/pipeline-runner.ts, the ~9-minute slices driven by
// server.js → /api/cron/pipeline-queue, the never-gives-up retries, the cron-auth guards. This
// is a different way to drive it, not a different way to run it.
//
// Access is inherited from app/(app)/tools/auction-ai/layout.tsx (AUCTION_AI) — do not add a
// second gate here.
export default function OvernightRunsPage() {
  return <OvernightClient />
}
