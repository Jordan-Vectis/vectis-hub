import { signOut } from "next-auth/react"
import { endCardSession } from "@/lib/goods-in/scan-client/card"
import { forgetOfflineCopy } from "@/lib/goods-in/scan-client/offline"

// Signing in and out on the handheld scanner, both kinds: a Hub login (NextAuth) and a scanner
// sign-in card's session (lib/goods-in/scan-client/card.ts). Wherever it happens, it ends back on
// /scan's own sign-in screen — never /login, never /hub (the devices are shared, and the next person
// signs in right here). Browser only.

/** Sign out of the scanner: the card session and the Hub login (whichever there are), then /scan's own sign-in screen. */
export async function signOutOfScanner(): Promise<{ ok: true } | { ok: false; message: string }> {
  // The saved copy of the screen is this person's.
  try { await forgetOfflineCopy() } catch { /* nothing saved */ }
  const card = await endCardSession()
  let hub = true
  try {
    // Harmless with no Hub login: NextAuth just answers that there was nothing to end.
    await signOut({ redirect: false })
  } catch {
    hub = false
  }
  if (!card || !hub) return { ok: false, message: "Signing out needs the Wi-Fi — try again when it's back." }
  window.location.replace("/scan")
  return { ok: true }
}

/**
 * A card has just been accepted (its cookie is set): end any Hub login on this device — the card's
 * person is who scans now, and a Hub login would otherwise still count first — forget the last
 * person's saved copy of the screen, and open the scanner as them. Returns a message when the Hub
 * login couldn't be ended (then the scanner would still open as the last person, so it doesn't).
 */
export async function finishCardSignIn(hubSignedIn: boolean, beforeLeave?: () => Promise<void> | void): Promise<string | null> {
  try {
    await signOut({ redirect: false })
  } catch {
    if (hubSignedIn) return "The card was accepted, but the last person couldn't be signed out — check the Wi-Fi and scan the card again."
  }
  try { await beforeLeave?.() } catch { /* the page reloads anyway */ }
  try { await forgetOfflineCopy() } catch { /* nothing saved */ }
  window.location.replace("/scan")
  return null
}
