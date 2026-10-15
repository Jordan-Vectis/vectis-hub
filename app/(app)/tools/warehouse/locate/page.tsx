import { redirect } from "next/navigation"

// The April prototype's Locate (move a container) is replaced by Goods In → Move.
// Kept as a redirect so old bookmarks still work.
export const dynamic = "force-dynamic"

export default function OldLocatePage() {
  redirect("/tools/warehouse/move")
}
