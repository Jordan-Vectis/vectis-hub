import { getGoodsInUser } from "@/lib/goods-in/access"
import ScanApp from "./scan-app"

// /scan — the handheld scanner screen (Goods In). Put away / Move, Find, and Check a location, made
// for a Newland scanner held in one hand; works offline, sending its scans when the Wi-Fi is back.
// The layout has already checked Goods In access (and shows its own message without it).
// Nothing here touches Business Central.

export const dynamic = "force-dynamic"

export default async function ScanPage() {
  let user = null
  try {
    user = await getGoodsInUser()
  } catch {
    user = null // the layout says what went wrong
  }
  if (!user) return null
  return <ScanApp me={{ id: user.id, name: user.name || "Unknown", tier: user.whRole }} />
}
