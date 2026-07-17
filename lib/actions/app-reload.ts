"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// The AppReload row id="current" targets EVERYONE. A row keyed by a userId targets
// that one person. /api/app-reload combines both halves per user, so bumping either
// reloads the right people. See that route for the token scheme.
const EVERYONE_ID = "current"

// Returns rather than throws — a thrown server action is redacted to a generic
// message in production, and the admin needs to know whether the refresh landed.
type Result = { ok: boolean; error?: string }

// Shared write: bump the token on one AppReload row and nudge open tabs. `targetId`
// is "current" (everyone) or a userId (that person). The Socket.IO nudge is generic
// — every tab re-polls, but only those whose combined token actually changed reload,
// so a single event name serves both cases and the poll remains the real guarantee.
async function bumpReload(targetId: string, requestedByName: string): Promise<void> {
  const token = randomUUID()
  await prisma.appReload.upsert({
    where:  { id: targetId },
    update: { token, requestedByName },
    create: { id: targetId, token, requestedByName },
  })
  revalidatePath("/admin/refresh")
  try {
    ;(globalThis as { _io?: { emit: (event: string) => void } })._io?.emit("app:reload")
  } catch { /* socket unavailable under next dev — clients pick it up on their next poll */ }
}

// Push a reload to every open tab.
export async function forceReload(): Promise<Result> {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return { ok: false, error: "Unauthorised" }
    await bumpReload(EVERYONE_ID, session.user.name ?? session.user.email ?? "Admin")
    return { ok: true }
  } catch (e: any) {
    console.error("forceReload error:", e)
    return { ok: false, error: e?.message ?? "Could not push the refresh." }
  }
}

// Push a reload to just one person (every device they're signed in on).
export async function forceReloadUser(userId: string): Promise<Result> {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return { ok: false, error: "Unauthorised" }
    const id = (userId ?? "").trim()
    // Guard the sentinel: "current" through this path would refresh everyone.
    if (!id || id === EVERYONE_ID) return { ok: false, error: "Pick a valid user to refresh." }
    await bumpReload(id, session.user.name ?? session.user.email ?? "Admin")
    return { ok: true }
  } catch (e: any) {
    console.error("forceReloadUser error:", e)
    return { ok: false, error: e?.message ?? "Could not refresh that user." }
  }
}
