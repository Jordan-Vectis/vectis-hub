"use server"

import { revalidatePath } from "next/cache"
import { requireGoodsIn } from "@/lib/goods-in/access"
import { mirrorBcPage, mirrorStatus, stopMirrorRun, type MirrorPage, type MirrorPageResult, type MirrorStatus } from "@/lib/goods-in/bc-mirror"

// Goods In → Settings → "Business Central's receipts & totes": the admin-driven copy. One page per
// call so the panel can show a count that moves and offer Stop (design rule 7b). Warehouse admins only.

export async function copyBcPage(page: MirrorPage): Promise<MirrorPageResult> {
  try {
    await requireGoodsIn("admin")
    const res = await mirrorBcPage(page)
    if (res.ok && !res.more) revalidatePath("/tools/warehouse", "layout")
    return res
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}

export async function stopBcCopy(runId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await requireGoodsIn("admin")
    await stopMirrorRun(runId, me.name)
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}

export async function bcCopyStatus(): Promise<MirrorStatus> {
  await requireGoodsIn("warehouse")
  return mirrorStatus()
}
