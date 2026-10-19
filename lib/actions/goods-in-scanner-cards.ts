"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { GoodsInAccessError, atLeast, requireGoodsIn } from "@/lib/goods-in/access"
import type { WarehouseRole } from "@/lib/apps"
import type { Result } from "@/lib/actions/goods-in"
import { CARDS_NOT_SET_UP, isMissingTable, warehouseTierOf } from "@/lib/goods-in/scanner-pass"

// Goods In → Scanner cards: the list of sign-in cards, cancelling one, and the people a manager
// may make one for. SERVER ONLY (server actions). A card is MADE by POST /api/goods-in/scanner-cards
// (it answers the card's PDF — the only time its code exists outside the scanner).
//
// ⚠ These go on the normal Hub session (requireGoodsIn — fresh from the database, effective
// session), NEVER a scanner card session: a card signs in to the scanner only. Nothing here ever
// returns a card's code or its hash. Each action RETURNS { ok, error } rather than throwing (a thrown
// server-action error is redacted in production — RULES.md). Nothing here touches Business Central.

export type ScannerCardRow = {
  id: string
  /** Whose card it is. */
  userId: string
  userName: string | null
  label: string | null
  createdAt: Date
  createdByName: string | null
  lastUsedAt: Date | null
  /** Set once the card has been cancelled — it no longer signs anyone in. */
  revokedAt: Date | null
  revokedByName: string | null
  /** True when it is the caller's own card. */
  mine: boolean
}

export type WarehouseUserOption = { id: string; name: string; tier: WarehouseRole }

const MAX_LIST = 1000

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  if (isMissingTable(e)) return { ok: false, error: CARDS_NOT_SET_UP }
  console.error("goods-in scanner cards action error:", (e as Error)?.message ?? e)
  const msg = String((e as { message?: string })?.message ?? e)
  return { ok: false, error: msg.length < 200 ? msg : "Something went wrong — please try again." }
}

/** The caller's own cards; a Warehouse manager or admin sees everyone's. Newest first, cancelled ones included. */
export async function listScannerCards(): Promise<Result<ScannerCardRow[]>> {
  try {
    const me = await requireGoodsIn("warehouse")
    const rows = await prisma.goodsInScannerPass.findMany({
      where: atLeast(me, "manager") ? {} : { userId: me.id },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: MAX_LIST,
      select: {
        id: true, userId: true, userName: true, label: true, createdAt: true, createdByName: true,
        lastUsedAt: true, revokedAt: true, revokedByName: true,
      },
    })
    return { ok: true, data: rows.map(r => ({ ...r, mine: r.userId === me.id })) }
  } catch (e) { return fail(e) }
}

/** Cancel a card (it stops signing anyone in at once, on every scanner). Your own, or a manager+ any. */
export async function cancelScannerCard(id: string): Promise<Result> {
  try {
    const me = await requireGoodsIn("warehouse")
    const cardId = typeof id === "string" ? id.trim() : ""
    if (!cardId || cardId.length > 64) return { ok: false, error: "That card isn't there any more — refresh the list." }
    const card = await prisma.goodsInScannerPass.findUnique({ where: { id: cardId }, select: { userId: true, revokedAt: true } })
    if (!card) return { ok: false, error: "That card isn't there any more — refresh the list." }
    if (card.userId !== me.id && !atLeast(me, "manager")) {
      return { ok: false, error: "Only a Warehouse manager or admin can cancel someone else's card." }
    }
    if (!card.revokedAt) {
      // An admin viewing as someone may cancel (it only takes access away), but the record says who
      // really did it.
      const session = await getEffectiveSession()
      const by = session?.isImpersonating ? `${session.adminName} (viewing as ${me.name ?? "someone"})` : me.name
      await prisma.goodsInScannerPass.updateMany({
        where: { id: cardId, revokedAt: null },
        data: { revokedAt: new Date(), revokedByName: by },
      })
    }
    revalidatePath("/tools/warehouse/scanner-cards")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

/**
 * Manager+: everyone with Warehouse access at or below the caller's own tier (a manager isn't
 * offered admins — POST /api/goods-in/scanner-cards refuses those too), for "Print a card for…". By name.
 */
export async function listWarehouseUsers(): Promise<Result<WarehouseUserOption[]>> {
  try {
    const me = await requireGoodsIn("manager")
    const users = await prisma.user.findMany({
      where: { OR: [{ role: "ADMIN" }, { allowedApps: { has: "WAREHOUSE" } }] },
      select: { id: true, name: true, role: true, allowedApps: true, appPermissions: true },
      orderBy: { name: "asc" },
    })
    const out: WarehouseUserOption[] = []
    for (const u of users) {
      const tier = warehouseTierOf(u)
      if (tier && atLeast(me, tier)) out.push({ id: u.id, name: u.name, tier })
    }
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}
