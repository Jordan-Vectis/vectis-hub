import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"

// Who may use Customers: anyone with the CUSTOMERS app (admins automatically). Judged on the
// EFFECTIVE session — an admin viewing as someone is that someone — with their permissions read
// fresh from the database, never from the session token (RULES.md → the Help box's three guards).

export type CustomersUser = { id: string; name: string; role: string; isAdmin: boolean }

export async function getCustomersUser(): Promise<CustomersUser | null> {
  const session = await getEffectiveSession()
  if (!session) return null
  const db = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true, name: true } })
  if (!db || !hasAppAccess(db.role, db.allowedApps, "CUSTOMERS")) return null
  return { id: session.user.id, name: db.name || session.user.name, role: db.role, isAdmin: db.role === "ADMIN" }
}

export async function requireCustomers(): Promise<CustomersUser> {
  const u = await getCustomersUser()
  if (!u) throw new Error("You don't have access to Customers.")
  return u
}
