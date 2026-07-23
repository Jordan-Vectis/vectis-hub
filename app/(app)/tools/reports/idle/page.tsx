import { redirect } from "next/navigation"

// Old URL — the page moved when "idle" was removed from user-facing URLs
// (2026-07-23). Kept as a redirect so bookmarks and stale links still work.
export default async function OldIdleReportRedirect({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const { range } = await searchParams
  redirect(range ? `/tools/reports/activity?range=${encodeURIComponent(range)}` : "/tools/reports/activity")
}
