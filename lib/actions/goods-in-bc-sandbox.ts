"use server"

import { prisma } from "@/lib/prisma"
import { GoodsInAccessError, requireGoodsIn } from "@/lib/goods-in/access"
import { getEffectiveSession } from "@/lib/impersonation"
import { getBCToken } from "@/lib/bc"
import { isFromBc } from "@/lib/goods-in/source"
import { bcSandboxEnvironment, bcSandboxOffReason, sendContainer, sendReceiptHeader, type BcStep } from "@/lib/goods-in/bc-sandbox"
import type { Result } from "@/lib/actions/goods-in"

// Goods In → a receipt → "Send to BC sandbox (test)". The rules are in lib/goods-in/bc-sandbox.ts.
//
// The BROWSER drives it (RULES.md 7b): bcSandboxStart sends the receipt and returns the totes and
// pallets to send, then bcSandboxSendContainer is called once per tote, so the screen can count them
// off as they go and Stop between them.
//
// • Warehouse ADMINS only, read fresh from the database (requireGoodsIn), and never while an admin is
//   viewing as someone else — it writes to BC under the real person's own BC sign-in.
// • A BC test environment only (BC_WRITE_ENVIRONMENT), never the live one; refused with the reason.
// • Booked Hub receipts only: not a draft, not void, not one copied FROM BC, and it must carry a vendor
//   number (BC refuses a tote on a receipt without one).
// • It writes NOTHING in the Hub. What happened is shown on the screen and in the server log.
// ⚠ Each action RETURNS { ok, error } rather than throwing (production redacts thrown server-action errors).

/** Shown with a link to /api/bc/auth when the person has no BC sign-in the Hub can use. */
const NO_BC_SIGN_IN = "NO_BC_SIGN_IN"

type Checked = { environment: string; token: string; userName: string | null }

async function check(): Promise<Checked> {
  const me = await requireGoodsIn("admin")
  const session = await getEffectiveSession()
  if (session?.isImpersonating) throw new GoodsInAccessError("Stop viewing as someone else first — this writes to Business Central as you.")
  const environment = bcSandboxEnvironment()
  if (!environment || !process.env.BC_TENANT_ID) throw new GoodsInAccessError(bcSandboxOffReason() ?? "Sending to a BC test environment is switched off on this server.")
  const token = await getBCToken()
  if (!token) throw new GoodsInAccessError(NO_BC_SIGN_IN)
  return { environment, token, userName: me.name }
}

async function loadReceipt(receiptId: string) {
  const r = await prisma.goodsInReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true, status: true, source: true, vendorNo: true,
      containers: { select: { id: true, kind: true, category: true, description: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  })
  if (!r) throw new GoodsInAccessError(`There's no receipt ${receiptId}.`)
  if (isFromBc(r.source)) throw new GoodsInAccessError("This receipt was copied FROM Business Central — it's already there.")
  if (r.status === "draft") throw new GoodsInAccessError("This check-in hasn't been booked in yet — book it in first.")
  if (r.status === "void") throw new GoodsInAccessError("This receipt is void.")
  const vendorNo = (r.vendorNo ?? "").trim()
  if (!vendorNo) throw new GoodsInAccessError("This receipt has no vendor number, and Business Central refuses a tote on a receipt without one. Use a receipt for a customer who has a vendor number.")
  return { ...r, vendorNo }
}

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  console.error("goods-in bc-sandbox error:", e)
  return { ok: false, error: String((e as { message?: string })?.message ?? e).slice(0, 300) }
}

export type BcSandboxStart = {
  environment: string
  receipt: BcStep
  containers: { id: string; kind: string }[]
}

/** Sends the receipt to the BC sandbox and returns the totes and pallets still to send. */
export async function bcSandboxStart(receiptId: string): Promise<Result<BcSandboxStart>> {
  try {
    const { environment, token, userName } = await check()
    const r = await loadReceipt(receiptId)
    const receipt = await sendReceiptHeader(token, environment, { id: r.id, vendorNo: r.vendorNo })
    console.log(`[goods-in bc-sandbox] ${userName ?? "?"} → ${environment}: ${receipt.what} ${receipt.outcome}`)
    return { ok: true, data: { environment, receipt, containers: r.containers.map(c => ({ id: c.id, kind: c.kind })) } }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one tote or pallet (the tote record, then its line on the receipt) to the BC sandbox. */
export async function bcSandboxSendContainer(receiptId: string, containerId: string): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName } = await check()
    const r = await loadReceipt(receiptId)
    const c = r.containers.find(x => x.id === containerId)
    if (!c) return { ok: false, error: `${containerId} isn't on receipt ${receiptId} any more.` }
    const steps = await sendContainer(token, environment, r.id, c)
    console.log(`[goods-in bc-sandbox] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}
