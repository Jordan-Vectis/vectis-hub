"use server"

// Server actions behind the Auto Pipeline queue panel.
//
// ⚠ Every action RETURNS its error rather than throwing (RULES: a thrown server
// action is redacted in a production build, so the user would see the generic
// "An error occurred…" instead of the reason).

import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import type { QueueSettings } from "@/lib/pipeline-queue"

export type QueueResult = { ok: boolean; error?: string; id?: string }

async function requireUser() {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")
  return session
}

const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max)

/** Add a sale to the back of the queue, with its own settings. */
export async function addToPipelineQueue(code: string, settings: QueueSettings): Promise<QueueResult> {
  try {
    const session = await requireUser()
    const upper = str(code, 40).toUpperCase()
    if (!upper) return { ok: false, error: "Pick a sale first." }

    // Queueing the same sale twice would have two slices fighting over the same
    // lots — the second would find everything already done, but the run would
    // still look wrong. Block it plainly instead.
    const existing = await prisma.pipelineQueueItem.findFirst({
      where: { code: upper, status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
      select: { status: true },
    })
    if (existing) return { ok: false, error: `${upper} is already in the queue (${existing.status.toLowerCase()}).` }

    const last = await prisma.pipelineQueueItem.findFirst({ orderBy: { position: "desc" }, select: { position: true } })
    const row = await prisma.pipelineQueueItem.create({
      data: {
        code:  upper,
        position: (last?.position ?? -1) + 1,
        preset:         str(settings.preset, 80),
        model:          str(settings.model, 80),
        fallbackModel:  str(settings.fallbackModel, 80),
        grounded:       !!settings.grounded,
        autoApply:      !!settings.autoApply,
        onlyWithPhotos: !!settings.onlyWithPhotos,
        skipHasDesc:    !!settings.skipHasDesc,
        kpRelaxed:      !!settings.kpRelaxed,
        addedBy: session.user.name ?? session.user.email ?? null,
      },
    })
    return { ok: true, id: row.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not add the sale to the queue" }
  }
}

/** Move a waiting sale up or down the order. */
export async function movePipelineQueueItem(id: string, direction: "up" | "down"): Promise<QueueResult> {
  try {
    await requireUser()
    const item = await prisma.pipelineQueueItem.findUnique({ where: { id } })
    if (!item) return { ok: false, error: "Not in the queue any more." }
    if (item.status === "RUNNING") return { ok: false, error: "That sale is running — it can't be moved." }

    const neighbour = await prisma.pipelineQueueItem.findFirst({
      where: {
        status: { in: ["QUEUED", "PAUSED"] },
        position: direction === "up" ? { lt: item.position } : { gt: item.position },
      },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
    })
    if (!neighbour) return { ok: true } // already at the end it was heading for

    await prisma.$transaction([
      prisma.pipelineQueueItem.update({ where: { id: item.id }, data: { position: neighbour.position } }),
      prisma.pipelineQueueItem.update({ where: { id: neighbour.id }, data: { position: item.position } }),
    ])
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not reorder the queue" }
  }
}

/** Hold a sale back without losing its place or its progress. */
export async function setPipelineQueuePaused(id: string, paused: boolean): Promise<QueueResult> {
  try {
    await requireUser()
    const item = await prisma.pipelineQueueItem.findUnique({ where: { id }, select: { status: true } })
    if (!item) return { ok: false, error: "Not in the queue any more." }
    if (paused && item.status === "DONE") return { ok: false, error: "That sale has already finished." }
    // A RUNNING item pauses at the end of its current slice: the runner only
    // ever picks up QUEUED or RUNNING rows, so PAUSED simply stops being chosen.
    await prisma.pipelineQueueItem.update({
      where: { id },
      data: { status: paused ? "PAUSED" : "QUEUED", retryAfter: null },
    })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not change the queue" }
  }
}

/** Take a sale off the queue. Anything already written to the catalogue stays —
 *  this stops further work, it does not undo what has run. */
export async function removeFromPipelineQueue(id: string): Promise<QueueResult> {
  try {
    await requireUser()
    await prisma.pipelineQueueItem.delete({ where: { id } })
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not remove the sale" }
  }
}

/** Clear the finished/cancelled rows out of the list. */
export async function clearFinishedQueueItems(): Promise<QueueResult & { removed?: number }> {
  try {
    await requireUser()
    const res = await prisma.pipelineQueueItem.deleteMany({ where: { status: { in: ["DONE", "CANCELLED"] } } })
    if (res.count === 0) return { ok: false, error: "There was nothing finished to clear." }
    return { ok: true, removed: res.count }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not clear the queue" }
  }
}
