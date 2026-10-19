import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { getWarehouseRole, type WarehouseRole } from "@/lib/apps"

// Who may use Goods In. SERVER ONLY.
//
// The Warehouse app's three tiers (warehouse < manager < admin), read FRESH from the database —
// a session token can be hours old, and access that has been taken away must not still open the
// door — and judged on the EFFECTIVE session, so an admin viewing as a member of staff sees and
// can do exactly what they could (RULES.md: getEffectiveSession, never auth(), for anything that
// decides what someone may see or do).

const ORDER: WarehouseRole[] = ["warehouse", "manager", "admin"]

export type GoodsInUser = { id: string; name: string | null; role: string; whRole: WarehouseRole }

export class GoodsInAccessError extends Error {}

/** The person and their Warehouse tier, or null when they have no Warehouse access at all. */
export async function getGoodsInUser(): Promise<GoodsInUser | null> {
  const session = await getEffectiveSession()
  if (!session) return null
  const db = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true, appPermissions: true, name: true } })
  if (!db) return null
  if (db.role !== "ADMIN" && !db.allowedApps.includes("WAREHOUSE")) return null
  const whRole = getWarehouseRole(db.role, db.appPermissions as Record<string, { role: string }> | null)
  if (!whRole) return null
  return { id: session.user.id, name: db.name ?? session.user.name ?? null, role: db.role, whRole }
}

/** As getGoodsInUser, but throws GoodsInAccessError (with a plain message) below the tier asked for. */
export async function requireGoodsIn(minRole: WarehouseRole = "warehouse"): Promise<GoodsInUser> {
  const u = await getGoodsInUser()
  if (!u) throw new GoodsInAccessError("Your account doesn't have Warehouse access.")
  if (ORDER.indexOf(u.whRole) < ORDER.indexOf(minRole)) {
    throw new GoodsInAccessError(minRole === "admin" ? "Only a Warehouse admin can do that." : "Only a Warehouse manager or admin can do that.")
  }
  return u
}

export const atLeast = (u: { whRole: WarehouseRole } | null, minRole: WarehouseRole) => !!u && ORDER.indexOf(u.whRole) >= ORDER.indexOf(minRole)
