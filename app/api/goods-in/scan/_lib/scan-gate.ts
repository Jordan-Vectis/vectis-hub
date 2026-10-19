import { NextResponse } from "next/server"
import { dropCardUnderHubLogin, resolveScanUser, type ScanUser } from "@/lib/goods-in/scanner-pass"

// The handheld scanner's routes' gate (a private `_lib` folder, so it is never a route). SERVER ONLY.
//
// ⚠ The ONLY gate that accepts a scanner sign-in card session, and it is used ONLY by
// /api/goods-in/scan/* — every other Goods In route uses gate() in ../../_lib/shared.ts, which
// takes the Hub session alone. A Hub session behaves exactly as gate("warehouse") did.
//
// With a Hub login, a card session left on the device from before it is ended here
// (dropCardUnderHubLogin), so it can't come back once that Hub login signs out.

export type ScanGate = { me: ScanUser; res?: undefined } | { me?: undefined; res: NextResponse }

/** The person using the scanner (Hub session, else a scanner card), or the response that refuses them. */
export async function scanGate(): Promise<ScanGate> {
  const who = await resolveScanUser()
  if (who.user) {
    if (who.user.via === "hub") await dropCardUnderHubLogin()
    return { me: who.user }
  }
  if (who.why === "no-access") {
    return { res: NextResponse.json({ ok: false, error: "Your account doesn't have Warehouse access." }, { status: 403 }) }
  }
  return { res: NextResponse.json({ ok: false, error: "You're not signed in — scan your sign-in card, or sign in again." }, { status: 401 }) }
}
