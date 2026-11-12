"use server"

import { prisma } from "@/lib/prisma"
import { GoodsInAccessError, getGoodsInUser, requireGoodsIn } from "@/lib/goods-in/access"
import { getEffectiveSession } from "@/lib/impersonation"
import { getBCToken } from "@/lib/bc"
import { isFromBc } from "@/lib/goods-in/source"
import {
  bcReceiptLinesUrl, bcSandboxEnvironment, bcSandboxOffReason, lotPreview, receiptInBc, sendContainer, sendLot, sendReceiptHeader,
  type BcStep, type LotForBc, type LotPreview,
} from "@/lib/goods-in/bc-sandbox"
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

const LOT_FOR_BC_SELECT = {
  id: true, barcode: true, title: true, description: true, estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
  notes: true, category: true, subCategory: true, tote: true, receipt: true, auction: { select: { code: true } },
} as const

type LotRow = {
  barcode: string | null; title: string; description: string | null
  estimateLow: number | null; estimateHigh: number | null; aiEstimateLow: number | null; aiEstimateHigh: number | null
  notes: string | null; category: string | null; subCategory: string | null; tote: string | null
  auction: { code: string | null } | null
}

/** The ONE place a Hub lot becomes what goes to BC — the preview and the send both use it, so the list
 *  shown before sending is exactly what is sent. */
function lotForBc(lot: LotRow): LotForBc {
  return {
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
  }
}

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
    select: LOT_FOR_BC_SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 5000,
  })
  const mine = lots.filter(l => (l.receipt ?? "").trim().toUpperCase() === r.id.toUpperCase())
  return { receipt: r, mine, elsewhere: lots.length - mine.length }
}

export type BcLotsStart = {
  environment: string
  receipt: BcStep
  /** Each lot with exactly what it will send (lotPreview of the same lotForBc the send uses). */
  lots: ({ id: string } & LotPreview)[]
  /** Lots on this receipt's totes that are catalogued onto ANOTHER receipt — left out. */
  elsewhere: number
  /** BC's Receipt Lines list for this receipt in the test environment, to see the lines there. */
  bcLinesUrl: string | null
}

/** Checks the receipt is in BC and returns the lots catalogued onto it, to send one by one. */
export async function bcLotsStart(receiptId: string): Promise<Result<BcLotsStart>> {
  try {
    const { environment, token, userName } = await check()
    const { mine, elsewhere } = await lotsOnReceipt(receiptId)
    const receipt = await receiptInBc(token, environment, receiptId)
    console.log(`[goods-in bc-lots] ${userName ?? "?"} → ${environment}: ${receipt.what} ${receipt.outcome}; ${mine.length} lots`)
    return {
      ok: true,
      data: {
        environment,
        receipt,
        lots: mine.map(l => ({ id: l.id, ...lotPreview(lotForBc(l)) })),
        elsewhere,
        bcLinesUrl: bcReceiptLinesUrl(environment, receiptId),
      },
    }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one lot as a receipt line (on its receipt and its sale) to the BC test environment. */
export async function bcLotSend(receiptId: string, lotId: string): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName } = await check()
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: LOT_FOR_BC_SELECT })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if ((lot.receipt ?? "").trim().toUpperCase() !== receiptId.toUpperCase()) {
      return { ok: false, error: `This lot is catalogued onto ${lot.receipt || "no receipt"}, not ${receiptId}.` }
    }
    const steps = await sendLot(token, environment, receiptId, lotForBc(lot))
    console.log(`[goods-in bc-lots] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}

// ── A SALE's lots → BC receipt lines (the sale page's Push to BC tab, "Send lots to BC") ──
//
// Jack, 2026-11-12: the same send as the receipt panel above, started from the sale. Each lot goes onto
// the receipt it was CATALOGUED ONTO (CatalogueLot.receipt) and is allocated to this sale, exactly as
// sendLot does from a receipt — nothing about a lot's line differs.
// • Hub ADMINS only (Jack: "needs to be admin only"), read fresh from the database on the effective
//   session, and never while viewing as someone else — then every guard of check() above.
// • A lot with no receipt has nowhere to go: listed, never sent. So is a lot on a Hub receipt that isn't
//   booked in or is void. A receipt BC doesn't have is found by the per-receipt check before anything is
//   sent, and its lots are left out.
// • The browser drives it, one call per receipt to check and one per lot to send (RULES.md 7b).

async function checkAdmin(): Promise<Checked> {
  const u = await getGoodsInUser()
  if (u?.role !== "ADMIN") throw new GoodsInAccessError("Only an admin can send a sale's lots to Business Central.")
  return check()
}

const SALE_LOT_SELECT = { ...LOT_FOR_BC_SELECT, auctionId: true } as const

const receiptOf = (receipt: string | null | undefined) => (receipt ?? "").trim().toUpperCase()

/** Why a Hub receipt can't take lines — or null when it can (or the Hub has no record of it: BC decides). */
function hubReceiptNote(status: string | null | undefined): string | null {
  if (status === "draft") return "This check-in hasn't been booked in yet — book it in first."
  if (status === "void") return "This receipt is void."
  return null
}

export type BcSaleReceipt = {
  receiptId: string
  /** Why the Hub won't send this receipt's lots (not booked in, void), or null. */
  hubNote: string | null
  /** BC's Receipt Lines list for this receipt in the test environment. */
  bcLinesUrl: string | null
  lots: ({ id: string } & LotPreview)[]
}

export type BcSaleLotsStart = {
  environment: string
  saleCode: string
  receipts: BcSaleReceipt[]
  /** Lots with no receipt in the Hub — they have nowhere to go in BC, so they're never sent. */
  noReceipt: ({ id: string } & LotPreview)[]
}

/** The sale's lots, grouped by the receipt each was catalogued onto, with exactly what each sends. No BC call. */
export async function bcSaleLotsStart(auctionId: string): Promise<Result<BcSaleLotsStart>> {
  try {
    const { environment, userName } = await checkAdmin()
    const auction = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { code: true } })
    if (!auction) return { ok: false, error: "That sale isn't in the Hub any more." }
    const lots = await prisma.catalogueLot.findMany({
      where: { auctionId },
      select: SALE_LOT_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    })
    const ids = [...new Set(lots.map(l => receiptOf(l.receipt)).filter(Boolean))]
    const hub = ids.length
      ? await prisma.goodsInReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } }) // receipt numbers are kept in capitals
      : []
    const status = new Map(hub.map(r => [r.id.toUpperCase(), r.status]))
    const groups = new Map<string, BcSaleReceipt>()
    const noReceipt: BcSaleLotsStart["noReceipt"] = []
    for (const l of lots) {
      const preview = { id: l.id, ...lotPreview(lotForBc(l)) }
      const receiptId = receiptOf(l.receipt)
      if (!receiptId) { noReceipt.push(preview); continue }
      let g = groups.get(receiptId)
      if (!g) {
        g = { receiptId, hubNote: hubReceiptNote(status.get(receiptId)), bcLinesUrl: bcReceiptLinesUrl(environment, receiptId), lots: [] }
        groups.set(receiptId, g)
      }
      g.lots.push(preview)
    }
    const receipts = [...groups.values()].sort((a, b) => a.receiptId.localeCompare(b.receiptId, "en", { numeric: true }))
    console.log(`[goods-in bc-sale-lots] ${userName ?? "?"} → ${environment}: sale ${auction.code} — ${lots.length} lots on ${receipts.length} receipts, ${noReceipt.length} with no receipt`)
    return { ok: true, data: { environment, saleCode: auction.code, receipts, noReceipt } }
  } catch (e) {
    return fail(e)
  }
}

/** Is this receipt (one the sale's lots were catalogued onto) in the BC test environment? Read only. */
export async function bcSaleReceiptCheck(auctionId: string, receiptId: string): Promise<Result<BcStep>> {
  try {
    const { environment, token } = await checkAdmin()
    const id = receiptOf(receiptId)
    const onSale = await prisma.catalogueLot.findFirst({ where: { auctionId, receipt: { equals: id, mode: "insensitive" } }, select: { id: true } })
    if (!onSale) return { ok: false, error: `No lot on this sale is catalogued onto ${id}.` }
    return { ok: true, data: await receiptInBc(token, environment, id) }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one lot of the sale as a line on the receipt it was catalogued onto, allocated to the sale. */
export async function bcSaleLotSend(auctionId: string, lotId: string): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName } = await checkAdmin()
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: SALE_LOT_SELECT })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if (lot.auctionId !== auctionId) return { ok: false, error: "This lot has moved to another sale since the list was made." }
    const receiptId = receiptOf(lot.receipt)
    if (!receiptId) return { ok: false, error: "This lot has no receipt in the Hub, so it has nowhere to go in BC." }
    const hub = await prisma.goodsInReceipt.findFirst({ where: { id: { equals: receiptId, mode: "insensitive" } }, select: { status: true } })
    const note = hubReceiptNote(hub?.status)
    if (note) return { ok: false, error: `${receiptId}: ${note}` }
    const steps = await sendLot(token, environment, receiptId, lotForBc(lot))
    console.log(`[goods-in bc-sale-lots] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}
