import { redirect } from "next/navigation"

// The April prototype's location Lookup is replaced by Goods In → Find (scan any code: tote,
// pallet, receipt, lot barcode or location). Kept as a redirect so old bookmarks still work.
export const dynamic = "force-dynamic"

export default function OldLookupPage() {
  redirect("/tools/warehouse/find")
}
