"use server"

import { prisma } from "@/lib/prisma"
import { GoodsInAccessError, requireGoodsIn } from "@/lib/goods-in/access"
import { getEffectiveSession } from "@/lib/impersonation"
import { getBCToken } from "@/lib/bc"
import { isFromBc } from "@/lib/goods-in/source"
import { bcSandboxEnvironment, bcSandboxOffReason, receiptInBc, sendContainer, sendLot, sendReceiptHeader, type BcStep } from "@/lib/goods-in/bc-sandbox"
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

// ── Lots on this receipt → BC receipt lines (the "Send lots to BC test environment" panel) ──
//
// • The lots sent are the ones CATALOGUED ONTO this receipt (CatalogueLot.receipt = it). A lot that only
//   sits on one of its totes but carries another receipt is counted and left out — it belongs to that one.
// • Works for a receipt booked in BC ("From BC") as well as one booked in the Hub: the receipt must
//   already be in the BC test environment (checked first), since lines go onto it.
// • One call per lot, driven by the browser, so the count moves and Stop works between lots.

async function lotsOnReceipt(receiptId: string) {
  const r = await prisma.goodsInReceipt.findUnique({ where: { id: receiptId }, select: { id: true, status: true, containers: { select: { id: true } } } })
  if (!r) throw new GoodsInAccessError(`There's no receipt ${receiptId}.`)
  if (r.status === "draft") throw new GoodsInAccessError("This check-in hasn't been booked in yet — book it in first.")
  if (r.status === "void") throw new GoodsInAccessError("This receipt is void.")
  const totes = r.containers.map(c => c.id)
  const lots = await prisma.catalogueLot.findMany({
    where: {
      OR: [
        ...totes.map(t => ({ tote: { equals: t, mode: "insensitive" as const } })),
        { receipt: { equals: r.id, mode: "insensitive" as const } },
      ],
    },
    select: { id: true, barcode: true, title: true, receipt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 5000,
  })
  const mine = lots.filter(l => (l.receipt ?? "").trim().toUpperCase() === r.id.toUpperCase())
  return { receipt: r, mine, elsewhere: lots.length - mine.length }
}

export type BcLotsStart = {
  environment: string
  receipt: BcStep
  lots: { id: string; barcode: string | null; title: string }[]
  /** Lots on this receipt's totes that are catalogued onto ANOTHER receipt — left out. */
  elsewhere: number
}

/** Checks the receipt is in BC and returns the lots catalogued onto it, to send one by one. */
export async function bcLotsStart(receiptId: string): Promise<Result<BcLotsStart>> {
  try {
    const { environment, token, userName } = await check()
    const { mine, elsewhere } = await lotsOnReceipt(receiptId)
    const receipt = await receiptInBc(token, environment, receiptId)
    console.log(`[goods-in bc-lots] ${userName ?? "?"} → ${environment}: ${receipt.what} ${receipt.outcome}; ${mine.length} lots`)
    return { ok: true, data: { environment, receipt, lots: mine.map(l => ({ id: l.id, barcode: l.barcode, title: l.title })), elsewhere } }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one lot as a receipt line (on its receipt and its sale) to the BC test environment. */
export async function bcLotSend(receiptId: string, lotId: string): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName } = await check()
    const lot = await prisma.catalogueLot.findUnique({
      where: { id: lotId },
      select: {
        barcode: true, title: true, description: true, estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
        notes: true, category: true, subCategory: true, tote: true, receipt: true, auction: { select: { code: true } },
      },
    })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if ((lot.receipt ?? "").trim().toUpperCase() !== receiptId.toUpperCase()) {
      return { ok: false, error: `This lot is catalogued onto ${lot.receipt || "no receipt"}, not ${receiptId}.` }
    }
    const steps = await sendLot(token, environment, receiptId, {
      barcode: lot.barcode?.trim() || null,
      title: lot.title,
      description: lot.description ?? "",
      // The cataloguer's estimate, else the AI's — as the BC Fill tab does.
      estimateLow: lot.estimateLow ?? lot.aiEstimateLow ?? null,
      estimateHigh: lot.estimateHigh ?? lot.aiEstimateHigh ?? null,
      size: lot.notes, // the parcel size is kept in notes (Small / Medium / Large / Contact / Collection Only)
      category: lot.category?.trim() || null,
      subCategory: lot.subCategory?.trim() || null,
      tote: lot.tote?.trim() || null,
      saleCode: lot.auction?.code?.trim() || null,
    })
    console.log(`[goods-in bc-lots] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}
