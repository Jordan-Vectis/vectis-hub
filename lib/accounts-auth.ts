// Access control for the Accounts tool.
//
// Accounts holds financial data, so it used to be hard-gated to ADMIN everywhere.
// It's now a grantable app (AppKey "ACCOUNTS"): admins keep full access, and a
// non-admin who's been granted the app gets in — but ONLY to the hand-holding
// Simple mode (the complex table/reconcile pages redirect non-admins to /simple).
//
// Use `getAccountsAccess()` in pages/routes to branch on canAccess/isAdmin, and
// `requireAccountsAccess()` in server actions/routes that Simple mode legitimately
// needs. Destructive/management actions (delete month, cardholder CRUD, reserves,
// move-between-months, CSV import) keep the stricter admin-only gate.

import type { Session } from "next-auth"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"

export type AccountsAccess = {
  session: Session | null
  canAccess: boolean
  isAdmin: boolean
}

export async function getAccountsAccess(): Promise<AccountsAccess> {
  const session = await auth()
  if (!session) return { session: null, canAccess: false, isAdmin: false }
  if (session.user.role === "ADMIN") return { session, canAccess: true, isAdmin: true }
  // Non-admin: the JWT role is enough to rule out admin, but the app grant lives in
  // the DB (allowedApps), so read it fresh — same pattern as the other app pages.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  const canAccess = hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "ACCOUNTS")
  return { session, canAccess, isAdmin: false }
}

export async function requireAccountsAccess(): Promise<AccountsAccess> {
  const a = await getAccountsAccess()
  if (!a.canAccess) throw new Error("Unauthorised")
  return a
}
