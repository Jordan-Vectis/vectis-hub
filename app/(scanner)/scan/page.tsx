import ScanApp from "./scan-app"
import { scanWho } from "./who"

// /scan — the handheld scanner screen (Goods In). Put away / Move, Find, and Check a location, made
// for a Newland scanner held in one hand; works offline, sending its scans when the Wi-Fi is back.
// The layout has already worked out who is scanning — a Hub login or a scanner sign-in card — and
// shows its own sign-in screen or message when nobody can (this renders nothing then).
// Nothing here touches Business Central.

export const dynamic = "force-dynamic"

export default async function ScanPage() {
  let user = null
  try {
    user = (await scanWho()).user
  } catch {
    user = null // the layout says what went wrong
  }
  if (!user) return null
  // Which build of the Hub this screen is, for Settings → About (Railway sets it; blank elsewhere).
  const build = (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim().slice(0, 7) || null
  return <ScanApp me={{ id: user.id, name: user.name || "Unknown", tier: user.tier, via: user.via }} build={build} />
}
