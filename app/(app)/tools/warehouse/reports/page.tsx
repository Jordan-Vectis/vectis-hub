import { redirect } from "next/navigation"

// The April prototype's Reports page is replaced by Goods In → History (every move, filterable).
// Kept as a redirect so old bookmarks still land somewhere useful.
export const dynamic = "force-dynamic"

export default function OldReportsPage() {
  redirect("/tools/warehouse/history")
}
