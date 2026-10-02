import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"

// Facilities → Vans. Three collection vans: what's due, what's been done, who has it out.
// Deliberately small (Jordan, 2026-10-02: "we only use 3 vans so its not some massive vehicle
// management system just something basic"). Built from the /jordan garage with the personal
// bits (valuer, advert, watch list) left out and a sign-out added.

export const VAN_RECORD_KINDS = ["MOT", "SERVICE", "REPAIR", "TAX", "INSURANCE", "OTHER"] as const
export const VAN_FILE_PREFIX = "vans/"

/** Who is asking, checked fresh from the database (a token can be hours old), and whether
 *  they hold the VANS app. Returns the person's name for "recorded by" stamps. */
export async function requireVans(): Promise<{ userId: string; name: string }> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("Not signed in"), { http: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "VANS")) throw Object.assign(new Error("No access to Vans"), { http: 403 })
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown" }
}

export function missingTable(e: any): boolean {
  return /does not exist|relation .* does not exist|P2021|P2022/i.test(String(e?.message ?? e))
}

/** "" / undefined → null, so a cleared date really clears. A blank must never become "today":
 *  "no MOT recorded" and "MOT due today" have to look different on the page. */
export const day = (v: any): Date | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? "").trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
export const int = (v: any): number | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? "").replace(/[^\d-]/g, "")
  return s ? parseInt(s, 10) : null
}
export const str = (v: any, max = 200) => (v === undefined ? undefined : String(v ?? "").trim().slice(0, max))
/** "£1,234.56" → 123456 pence, so an invoice adds up exactly. */
export const pence = (v: any): number | null | undefined => {
  if (v === undefined) return undefined
  const s = String(v ?? "").replace(/[^\d.]/g, "")
  if (!s) return null
  const n = Math.round(parseFloat(s) * 100)
  return isNaN(n) ? null : n
}
