"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

// Admin → Saved AI Flags.
//
// ⚠ WHY. The AI pipeline overwrites CatalogueLot.aiFlagNote with a bare update, so re-running it
// replaces whatever the last run said and leaves no record of it — not even in the lot change
// log, which every other mutation path writes to. Jack, 2026-08-19: "we are about to overwrite
// them but we cant loose the data". This takes a frozen copy first.
//
// Actions RETURN their error rather than throwing — production redacts thrown server-action
// messages (RULES.md), and "an error occurred in the Server Components render" is no use to
// somebody about to start an overnight run.

type Res = { ok: true; saved: number; batchId: string } | { ok: false; error: string }

/**
 * ⚠ SAVING is open to any signed-in user, DELETING is admin-only, and that asymmetry is
 * deliberate. The whole point is that flags do not get lost, so anybody looking at the Review
 * tab should be able to protect them without hunting down an admin — a snapshot only copies
 * data that person can already see on that page. Destroying an archive is the dangerous
 * direction, so that stays with admins.
 */
async function requireSignedIn() {
  const session = await auth()
  if (!session) throw new Error("Not signed in")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { role: true, name: true, email: true },
  })
  return {
    id: session.user.id,
    name: dbUser?.name || dbUser?.email || "Unknown",
    isAdmin: dbUser?.role === "ADMIN",
  }
}

async function requireAdmin() {
  const me = await requireSignedIn()
  if (!me.isAdmin) throw new Error("Only an admin can delete a saved archive")
  return me
}

/** Everything the Review tab puts on a flagged lot's card, so the archive can render the same. */
const LOT_SELECT = {
  id: true, barcode: true, receiptUniqueId: true, title: true,
  keyPoints: true, description: true, condition: true, category: true, subCategory: true,
  brand: true, estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
  imageUrls: true, createdByName: true,
  aiFlagNote: true, reviewFlag: true, reviewFlaggedBy: true, reviewFlaggedAt: true,
  kpFixNote: true, kpFixedBy: true, kpFixedAt: true,
  auctionId: true,
  // reviewKpMode decides how key points are matched, so the archive has to keep it or it would
  // redraw an old verdict under today's rules.
  auction: { select: { code: true, name: true, reviewKpMode: true } },
} as const

/**
 * Freeze every currently-flagged lot into a new batch.
 *
 * `auctionId` of "ALL" takes every sale — which is what you want before an overnight run that
 * touches more than one.
 *
 * ⚠ Captures a lot with EITHER an AI flag or a human review flag. Capturing more than asked for
 * is the right way round when the alternative is losing it: the archive can filter afterwards,
 * a missed row cannot be recovered.
 */
export async function saveAiFlagSnapshot(auctionId: string, label: string): Promise<Res> {
  try {
    const me = await requireSignedIn()
    const scope = auctionId.trim()
    if (!scope) return { ok: false, error: "Choose a sale, or All sales" }

    const lots = await prisma.catalogueLot.findMany({
      where: {
        ...(scope === "ALL" ? {} : { auctionId: scope }),
        OR: [
          { AND: [{ aiFlagNote: { not: null } }, { aiFlagNote: { not: "" } }] },
          { AND: [{ reviewFlag: { not: null } }, { reviewFlag: { not: "" } }] },
        ],
      },
      select: LOT_SELECT,
      orderBy: { createdAt: "asc" },
    })

    // ⚠ Never let "nothing happened" look like success (RULES.md design rule 7). An empty save
    // would otherwise sit in the list looking like a completed backup.
    if (lots.length === 0) {
      return { ok: false, error: "There are no flagged lots to save in that scope — nothing was written." }
    }

    const batchId = randomUUID()
    await prisma.savedAiFlag.createMany({
      data: lots.map(l => ({
        batchId,
        label: label.trim().slice(0, 200),
        auctionId:   l.auctionId,
        auctionCode: l.auction?.code ?? "",
        auctionName: l.auction?.name ?? "",
        lotId: l.id, barcode: l.barcode, receiptUniqueId: l.receiptUniqueId,
        title: l.title ?? "",
        keyPoints: l.keyPoints, description: l.description,
        condition: l.condition, category: l.category, subCategory: l.subCategory, brand: l.brand,
        estimateLow: l.estimateLow, estimateHigh: l.estimateHigh,
        aiEstimateLow: l.aiEstimateLow, aiEstimateHigh: l.aiEstimateHigh,
        imageUrls: l.imageUrls ?? [],
        cataloguedBy: l.createdByName,
        aiFlagNote: l.aiFlagNote, reviewFlag: l.reviewFlag,
        reviewFlaggedBy: l.reviewFlaggedBy, reviewFlaggedAt: l.reviewFlaggedAt,
        kpFixNote: l.kpFixNote, kpFixedBy: l.kpFixedBy, kpFixedAt: l.kpFixedAt,
        kpMode: l.auction?.reviewKpMode === "relaxed" ? "relaxed" : "strict",
        savedById: me.id, savedByName: me.name,
      })),
    })

    revalidatePath("/admin/ai-flags")
    return { ok: true, saved: lots.length, batchId }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save the flags" }
  }
}

/** How many lots a save would capture, so the button can say so before it is pressed. */
export async function countFlaggedLots(auctionId: string): Promise<number> {
  try {
    await requireSignedIn()
    const scope = auctionId.trim()
    if (!scope) return 0
    return await prisma.catalogueLot.count({
      where: {
        ...(scope === "ALL" ? {} : { auctionId: scope }),
        OR: [
          { AND: [{ aiFlagNote: { not: null } }, { aiFlagNote: { not: "" } }] },
          { AND: [{ reviewFlag: { not: null } }, { reviewFlag: { not: "" } }] },
        ],
      },
    })
  } catch { return 0 }
}

export async function deleteAiFlagBatch(batchId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireAdmin()
    const { count } = await prisma.savedAiFlag.deleteMany({ where: { batchId } })
    if (!count) return { ok: false, error: "That archive has already been deleted" }
    revalidatePath("/admin/ai-flags")
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete that archive" }
  }
}
