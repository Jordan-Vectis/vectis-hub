"use server"

import { revalidatePath } from "next/cache"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

const APP_RELOAD_ID = "current"

// Returns rather than throws — a thrown server action is redacted to a generic
// message in production, and the admin needs to know whether the refresh landed.
type Result = { ok: boolean; error?: string }

// Push a reload to every open tab. Bumps the stored token (which clients poll)
// and fires a Socket.IO nudge so tabs on this replica react at once instead of
// waiting for their next poll.
export async function forceReload(): Promise<Result> {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") return { ok: false, error: "Unauthorised" }

    const token = randomUUID()
    const requestedByName = session.user.name ?? session.user.email ?? "Admin"

    await prisma.appReload.upsert({
      where:  { id: APP_RELOAD_ID },
      update: { token, requestedByName },
      create: { id: APP_RELOAD_ID, token, requestedByName },
    })
    revalidatePath("/admin/refresh")

    // Optional + try/catch: a no-op under `next dev` (no custom server), and the
    // poll is the guarantee anyway — this only makes it instant.
    try {
      ;(globalThis as { _io?: { emit: (event: string) => void } })._io?.emit("app:reload")
    } catch { /* socket unavailable — clients pick it up on their next poll */ }

    return { ok: true }
  } catch (e: any) {
    console.error("forceReload error:", e)
    return { ok: false, error: e?.message ?? "Could not push the refresh." }
  }
}
