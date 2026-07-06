// Gate for the secret /jordan pages + their API routes: the session user's
// username must be jordan.orange (case-insensitive). Everyone else sees a 404
// (pages) or 404 JSON (APIs) — the features simply don't exist for them.

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function isJordan(): Promise<boolean> {
  const session = await auth()
  if (!session) return false
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true },
  })
  return (user?.username ?? "").toLowerCase() === "jordan.orange"
}
