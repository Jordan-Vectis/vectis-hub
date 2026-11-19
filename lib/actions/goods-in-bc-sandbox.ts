"use server"

import { prisma } from "@/lib/prisma"
import { GoodsInAccessError, getGoodsInUser, requireGoodsIn } from "@/lib/goods-in/access"
import { getEffectiveSession } from "@/lib/impersonation"
import { getBCToken } from "@/lib/bc"
import { isFromBc } from "@/lib/goods-in/source"
import {
  bcLiveRefusal, bcReceiptLinesUrl, bcSandboxConfigured, bcSandboxEnvironment, bcSandboxOffReason, bcWriteIsLive, lotPreview, readSentLines,
  receiptInBc, sendContainer, sendLot, sendReceiptHeader,
  type BcStep, type LotForBc, type LotPreview,
} from "@/lib/goods-in/bc-sandbox"
import { buildLotEventRow, writeLotEventsChecked } from "@/lib/lot-log"
import type { Result } from "@/lib/actions/goods-in"

// Goods In → a receipt → "Send to Business Central". The rules are in lib/goods-in/bc-sandbox.ts.
//
// The BROWSER drives it (RULES.md 7b): bcSandboxStart sends the receipt and returns the totes and
// pallets to send, then bcSandboxSendContainer is called once per tote, so the screen can count them
// off as they go and Stop between them.
//
// • Warehouse ADMINS only, read fresh from the database (requireGoodsIn), and never while an admin is
//   viewing as someone else — it writes to BC under the real person's own BC sign-in.
// • The BC environment in BC_WRITE_ENVIRONMENT: a copy or sandbox, or LIVE BC from the production Hub only
//   (bcWriteIsLive). Every LIVE write needs the typed confirmation, checked here on every call (liveGate).
// • Booked Hub receipts only: not a draft, not void, not one copied FROM BC, and it must carry a vendor
//   number (BC refuses a tote on a receipt without one).
// • The only thing it writes in the Hub: a lot sent to LIVE BC gets a "bc_sent" event on its change log
//   (noteLiveSend), so End of Day leaves it off the overnight sheet. What happened is shown on the screen
//   and in the server log.
// ⚠ Each action RETURNS { ok, error } rather than throwing (production redacts thrown server-action errors).

/** Shown with a link to /api/bc/auth when the person has no BC sign-in the Hub can use. */
const NO_BC_SIGN_IN = "NO_BC_SIGN_IN"

type Checked = { environment: string; token: string; userName: string | null; live: boolean }

async function check(): Promise<Checked> {
  const me = await requireGoodsIn("admin")
  const session = await getEffectiveSession()
  if (session?.isImpersonating) throw new GoodsInAccessError("Stop viewing as someone else first — this writes to Business Central as you.")
  const environment = bcSandboxEnvironment()
  if (!environment || !process.env.BC_TENANT_ID) throw new GoodsInAccessError(bcSandboxOffReason() ?? "Sending to Business Central is switched off on this server.")
  const token = await getBCToken()
  if (!token) throw new GoodsInAccessError(NO_BC_SIGN_IN)
  return { environment, token, userName: me.name, live: bcWriteIsLive() }
}

/** Every WRITE to live BC needs the person's typed confirmation (bcLiveRefusal) — on each call, not once. */
function liveGate(confirm: unknown, receiptId?: string) {
  const refusal = bcLiveRefusal(confirm, receiptId)
  if (refusal) throw new GoodsInAccessError(refusal)
}

/**
 * LIVE BC only: a lot whose line is now in BC on its receipt gets a "bc_sent" event on its change log, and
 * End of Day leaves it off the overnight sheet (app/api/catalogue/end-of-day/route.ts). The Hub's BC copy
 * won't have the lot until the next data sync, so without this the sheet would import it a SECOND time.
 * "In BC" = the lot's own step ("Lot …") made or found the line, even if a later step failed (a line without
 * its barcode is still a line). A note that can't be written is said on screen, never swallowed.
 *
 * ⚠ NEEDS AMENDING (2026-11-18 — a lot whose sale, details, tick or barcode failed was marked sent, left End of
 * Day, and was never seen again, half-made in BC). When any step after the line failed, the event's field is
 * AMEND_FIELD and its value says what failed, in BC's words. End of Day's Send to BC tab lists every lot whose
 * NEWEST bc_sent event is that (bcEodToAmend) until a later send goes through cleanly or someone marks it fixed.
 * The value always carries the sale it was sent for (" · sale X · "), so trying again can't move it to another.
 */
const SENT_FIELD = "Sent to Business Central"
const AMEND_FIELD = "Sent to Business Central — needs amending"

async function noteLiveSend(
  lot: { id: string; auctionId: string; barcode: string | null; title: string; auction: { code: string | null } | null },
  receiptId: string, steps: BcStep[], environment: string, userName: string | null, source: string, saleCode: string | null,
): Promise<BcStep[]> {
  if (!steps.some(s => s.what.startsWith("Lot ") && s.outcome !== "failed")) return []
  const problems = steps
    .filter(s => s.outcome === "failed" && !s.what.startsWith("Hub note"))
    .map(s => `${s.what}: ${s.detail}`)
    .join(" | ")
  const value = `Receipt ${receiptId} · sale ${saleCode || "none"} · ${environment}${problems ? ` — ${problems}` : ""}`.slice(0, 2000)
  const ok = await writeLotEventsChecked([buildLotEventRow(
    { id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }, lot.auction?.code ?? "",
    "bc_sent", problems ? AMEND_FIELD : SENT_FIELD, "", value,
    { changedBy: userName ?? "?", source },
  )])
  return ok ? [] : [{
    what: `Hub note ${lot.barcode ?? ""}`.trim(),
    outcome: "failed",
    detail: "It's in BC, but the Hub couldn't note that — it will still be on tonight's End of Day sheet, so leave it out of the import.",
  }]
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

/** Sends the receipt to BC and returns the totes and pallets still to send. On LIVE BC, `confirm` must carry
 *  the receipt number typed on the screen. */
export async function bcSandboxStart(receiptId: string, confirm?: unknown): Promise<Result<BcSandboxStart>> {
  try {
    const { environment, token, userName } = await check()
    liveGate(confirm, receiptId)
    const r = await loadReceipt(receiptId)
    const receipt = await sendReceiptHeader(token, environment, { id: r.id, vendorNo: r.vendorNo })
    console.log(`[goods-in bc-sandbox] ${userName ?? "?"} → ${environment}: ${receipt.what} ${receipt.outcome}`)
    return { ok: true, data: { environment, receipt, containers: r.containers.map(c => ({ id: c.id, kind: c.kind })) } }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one tote or pallet (the tote record, then its line on the receipt) to BC. */
export async function bcSandboxSendContainer(receiptId: string, containerId: string, confirm?: unknown): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName } = await check()
    liveGate(confirm, receiptId)
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
  id: true, auctionId: true, barcode: true, title: true, description: true, estimateLow: true, estimateHigh: true, aiEstimateLow: true, aiEstimateHigh: true,
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
  /** Writes go to LIVE Business Central (the production Hub): the screen asks for the typed confirmation. */
  live: boolean
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
    const { environment, token, userName, live } = await check()
    const { mine, elsewhere } = await lotsOnReceipt(receiptId)
    const receipt = await receiptInBc(token, environment, receiptId)
    console.log(`[goods-in bc-lots] ${userName ?? "?"} → ${environment}: ${receipt.what} ${receipt.outcome}; ${mine.length} lots`)
    return {
      ok: true,
      data: {
        environment,
        live,
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

/** Sends one lot as a receipt line (on its receipt and its sale) to BC. On LIVE BC, `confirm` must carry the
 *  number of lots typed on the screen. */
export async function bcLotSend(receiptId: string, lotId: string, confirm?: unknown): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName, live } = await check()
    liveGate(confirm)
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: LOT_FOR_BC_SELECT })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if ((lot.receipt ?? "").trim().toUpperCase() !== receiptId.toUpperCase()) {
      return { ok: false, error: `This lot is catalogued onto ${lot.receipt || "no receipt"}, not ${receiptId}.` }
    }
    const forBc = lotForBc(lot)
    const steps = await sendLot(token, environment, receiptId, forBc)
    if (live) steps.push(...await noteLiveSend(lot, receiptId, steps, environment, userName, "bc_live_receipt", forBc.saleCode))
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
// • WHICH sale (2026-11-18 — the sale is chosen, not fixed): this sale, or ONE other sale code for every lot — the same BcEodSale choice as End of Day, checked by saleFor and applied by
//   lotForBcOnSale, for the preview and the send alike.
// • Lots BC ALREADY has on their receipt are left alone unless "Update lots BC already has" is ticked
//   (`update`) — then sendLot brings each up to date with the Hub, sending only what differs (updateLine in
//   lib/goods-in/bc-sandbox.ts).

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
  /** Writes go to LIVE Business Central (the production Hub): the screen asks for the typed confirmation. */
  live: boolean
  /** The sale the lots go on in BC — this sale's code, or the other sale chosen. */
  saleCode: string
  /** This sale's own code, to say when the lots are going on a different one. */
  ownSaleCode: string
  receipts: BcSaleReceipt[]
  /** Lots with no receipt in the Hub — they have nowhere to go in BC, so they're never sent. */
  noReceipt: ({ id: string } & LotPreview)[]
}

/** The sale choice from the sale page: none given (an older screen) = this sale. */
const saleChoice = (sale: unknown): BcEodSale => (sale === undefined || sale === null ? { mode: "own" } : saleFor(sale))

/** The sale's lots, grouped by the receipt each was catalogued onto, with exactly what each sends on the sale
 *  chosen. No BC call. */
export async function bcSaleLotsStart(auctionId: string, sale?: BcEodSale): Promise<Result<BcSaleLotsStart>> {
  try {
    const { environment, userName, live } = await checkAdmin()
    const chosen = saleChoice(sale)
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
      const preview = { id: l.id, ...lotPreview(lotForBcOnSale(l, chosen)) }
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
    const saleCode = chosen.mode === "one" ? chosen.code : auction.code
    console.log(`[goods-in bc-sale-lots] ${userName ?? "?"} → ${environment}: sale ${auction.code} — ${lots.length} lots on ${receipts.length} receipts, ${noReceipt.length} with no receipt, going on ${saleCode}`)
    return { ok: true, data: { environment, live, saleCode, ownSaleCode: auction.code, receipts, noReceipt } }
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

/** Sends one lot of the sale as a line on the receipt it was catalogued onto, allocated to the sale chosen. On
 *  LIVE BC, `confirm` must carry the number of lots typed on the screen. `opts.update` = bring a line BC already
 *  has up to date with the Hub, rather than leave it as it is. */
export async function bcSaleLotSend(auctionId: string, lotId: string, confirm?: unknown, opts?: { sale?: BcEodSale; update?: boolean }): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName, live } = await checkAdmin()
    liveGate(confirm)
    const chosen = saleChoice(opts?.sale)
    const updateExisting = opts?.update === true
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: SALE_LOT_SELECT })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if (lot.auctionId !== auctionId) return { ok: false, error: "This lot has moved to another sale since the list was made." }
    const receiptId = receiptOf(lot.receipt)
    if (!receiptId) return { ok: false, error: "This lot has no receipt in the Hub, so it has nowhere to go in BC." }
    const hub = await prisma.goodsInReceipt.findFirst({ where: { id: { equals: receiptId, mode: "insensitive" } }, select: { status: true } })
    const note = hubReceiptNote(hub?.status)
    if (note) return { ok: false, error: `${receiptId}: ${note}` }
    const forBc = lotForBcOnSale(lot, chosen)
    const steps = await sendLot(token, environment, receiptId, forBc, { updateExisting })
    if (live) steps.push(...await noteLiveSend(lot, receiptId, steps, environment, userName, "bc_live_sale", forBc.saleCode))
    console.log(`[goods-in bc-sale-lots] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}

// ── END OF DAY → BC: the sheet's lots → BC receipt lines (End of Day's "Send to BC (test)" tab) ──
//
// Jordan, 2026-11-13: the same send as the receipt and sale panels above, started from End of Day — by
// vendor or everything at once, with the sale chosen. It sits beside the sheet and the macro; it changes
// nothing about them.
// • WHICH lots: the ones on the End of Day sheet ON SCREEN. The browser hands over the sheet's barcodes
//   (as "Fix what BC can prove" does), so "not in BC yet" keeps ONE definition — the End of Day route's.
//   ⚠ Never work the pending list out again here: two definitions would drift.
// • WHICH sale: each lot's own (as every other send here), or ONE sale code for every lot sent.
//   lotForBcOnSale is the one place that is applied — the preview and the send both use it, so the list
//   shown before sending is exactly what goes.
// • Every guard of checkAdmin(): Hub admins only, never while viewing as someone else, signed in as the
//   person pressing it, live BC from the production Hub only and with the typed confirmation. A lot sent to
//   LIVE BC is noted on its change log (noteLiveSend), which takes it off the sheet until the next sync.
// • The browser drives it (RULES.md 7b): one call per receipt to check, one per lot to send.

/** Which sale the lots go on: each lot's own, or one sale code for every lot sent. */
export type BcEodSale = { mode: "own" } | { mode: "one"; code: string }

/** The sale choice as it arrived from the browser, checked. */
function saleFor(sale: unknown): BcEodSale {
  const s = sale as { mode?: unknown; code?: unknown } | null
  if (s?.mode === "own") return { mode: "own" }
  if (s?.mode === "one") {
    const code = typeof s.code === "string" ? s.code.trim() : ""
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,19}$/.test(code)) {
      throw new GoodsInAccessError("Type the code of the sale every lot should go on (up to 20 letters and numbers), or choose each lot's own sale.")
    }
    return { mode: "one", code }
  }
  throw new GoodsInAccessError("Choose which sale the lots go on first.")
}

/** A lot as it goes to BC on the sale chosen — End of Day's tab and the sale page's panel both use it. */
function lotForBcOnSale(lot: LotRow, sale: BcEodSale): LotForBc {
  const forBc = lotForBc(lot)
  return sale.mode === "one" ? { ...forBc, saleCode: sale.code } : forBc
}

/** A list of ids or barcodes as it arrived from the browser: strings only, trimmed, no repeats, capped. */
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map(x => x.trim()).filter(Boolean))].slice(0, 20000) : []

// Prisma `in` is case-sensitive, so original/upper/lower are asked for and compared in capitals in code.
const caseVariants = (vals: string[]) => [...new Set(vals.flatMap(v => [v, v.toUpperCase(), v.toLowerCase()]))]

export type BcEodAvailable = { environment: string | null; offReason: string | null; live: boolean }

/** Whether End of Day shows the tab to this person — the same test as the sale page's panel: the send
 *  is set up on this server (BC_WRITE_ENVIRONMENT) and they are a Hub admin not viewing as someone else. */
export async function bcEodAvailable(): Promise<BcEodAvailable | null> {
  try {
    if (!bcSandboxConfigured()) return null
    const session = await getEffectiveSession()
    if (!session || session.isImpersonating || session.user.role !== "ADMIN") return null
    return { environment: bcSandboxEnvironment(), offReason: bcSandboxOffReason(), live: bcWriteIsLive() }
  } catch {
    return null
  }
}

export type BcEodVendor = {
  /** The vendor number on the lots, in capitals — "" for lots with no vendor. */
  vendorNo: string
  vendorName: string
  receipts: string[]
  sales: string[]
  lotIds: string[]
}

export type BcEodList = {
  environment: string
  vendors: BcEodVendor[]
  lots: number
  /** Barcodes on the sheet that no Hub lot with a receipt carries now — the sheet is out of date. */
  notFound: number
  /** The Hub's open sales, offered when one sale is chosen for everything. */
  openSales: { code: string; name: string }[]
}

/** The sheet's lots grouped by vendor, to tick. No BC call. */
export async function bcEodList(barcodes: string[]): Promise<Result<BcEodList>> {
  try {
    const { environment, userName } = await checkAdmin()
    const wanted = cleanList(barcodes)
    const onSheet = new Set(wanted.map(b => b.toUpperCase()))
    const rows = wanted.length
      ? await prisma.catalogueLot.findMany({
          where: { barcode: { in: caseVariants(wanted) } },
          select: { id: true, barcode: true, receipt: true, vendor: true, auction: { select: { code: true } } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 20000,
        })
      : []
    const lots = rows.filter(l => onSheet.has((l.barcode ?? "").trim().toUpperCase()) && receiptOf(l.receipt))
    const found = new Set(lots.map(l => (l.barcode ?? "").trim().toUpperCase()))

    const vendorNos = [...new Set(lots.map(l => (l.vendor ?? "").trim()).filter(Boolean))]
    const named = vendorNos.length
      ? await prisma.warehouseItem.findMany({
          where: { vendorNo: { in: caseVariants(vendorNos) }, vendorName: { not: null } },
          select: { vendorNo: true, vendorName: true },
          distinct: ["vendorNo"],
        })
      : []
    const nameByNo = new Map(named.map(v => [(v.vendorNo ?? "").trim().toUpperCase(), (v.vendorName ?? "").trim()]))

    const groups = new Map<string, { vendorNo: string; vendorName: string; receipts: Set<string>; sales: Set<string>; lotIds: string[] }>()
    for (const l of lots) {
      const vendorNo = (l.vendor ?? "").trim().toUpperCase()
      let g = groups.get(vendorNo)
      if (!g) {
        g = { vendorNo, vendorName: nameByNo.get(vendorNo) ?? "", receipts: new Set(), sales: new Set(), lotIds: [] }
        groups.set(vendorNo, g)
      }
      g.receipts.add(receiptOf(l.receipt))
      if (l.auction?.code) g.sales.add(l.auction.code)
      g.lotIds.push(l.id)
    }
    const byNumber = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true })
    const vendors = [...groups.values()]
      .map(g => ({ ...g, receipts: [...g.receipts].sort(byNumber), sales: [...g.sales].sort(byNumber) }))
      // Named vendors by name, then unnamed by number; lots with no vendor at all go last.
      .sort((a, b) => Number(!a.vendorNo) - Number(!b.vendorNo) || Number(!a.vendorName) - Number(!b.vendorName) || a.vendorName.localeCompare(b.vendorName, "en") || byNumber(a.vendorNo, b.vendorNo))

    const openSales = await prisma.catalogueAuction.findMany({ where: { complete: false }, select: { code: true, name: true }, orderBy: { code: "asc" }, take: 500 })
    console.log(`[goods-in bc-eod] ${userName ?? "?"} → ${environment}: sheet of ${wanted.length} barcodes — ${lots.length} lots for ${vendors.length} vendors`)
    return { ok: true, data: { environment, vendors, lots: lots.length, notFound: wanted.filter(b => !found.has(b.toUpperCase())).length, openSales } }
  } catch (e) {
    return fail(e)
  }
}

export type BcEodLotsStart = {
  environment: string
  /** Writes go to LIVE Business Central (the production Hub): the screen asks for the typed confirmation. */
  live: boolean
  /** The one sale every lot goes on, or null when each goes on its own. */
  saleCode: string | null
  receipts: BcSaleReceipt[]
  /** Ticked lots that can't be sent now: gone from the Hub, or no longer carrying a barcode and a receipt. */
  unsendable: number
}

/** The ticked lots grouped by receipt, with exactly what each sends on the sale chosen. No BC call. */
export async function bcEodLotsStart(lotIds: string[], sale: BcEodSale): Promise<Result<BcEodLotsStart>> {
  try {
    const { environment, userName, live } = await checkAdmin()
    const chosen = saleFor(sale)
    const ids = cleanList(lotIds)
    if (!ids.length) return { ok: false, error: "Tick at least one vendor first." }
    const lots = await prisma.catalogueLot.findMany({
      where: { id: { in: ids } },
      select: SALE_LOT_SELECT,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
    const sendable = lots.filter(l => l.barcode?.trim() && receiptOf(l.receipt))
    const receiptIds = [...new Set(sendable.map(l => receiptOf(l.receipt)))]
    const hub = receiptIds.length
      ? await prisma.goodsInReceipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, status: true } }) // receipt numbers are kept in capitals
      : []
    const status = new Map(hub.map(r => [r.id.toUpperCase(), r.status]))
    const groups = new Map<string, BcSaleReceipt>()
    for (const l of sendable) {
      const receiptId = receiptOf(l.receipt)
      let g = groups.get(receiptId)
      if (!g) {
        g = { receiptId, hubNote: hubReceiptNote(status.get(receiptId)), bcLinesUrl: bcReceiptLinesUrl(environment, receiptId), lots: [] }
        groups.set(receiptId, g)
      }
      g.lots.push({ id: l.id, ...lotPreview(lotForBcOnSale(l, chosen)) })
    }
    const receipts = [...groups.values()].sort((a, b) => a.receiptId.localeCompare(b.receiptId, "en", { numeric: true }))
    console.log(`[goods-in bc-eod] ${userName ?? "?"} → ${environment}: ${sendable.length} lots on ${receipts.length} receipts, sale ${chosen.mode === "one" ? chosen.code : "each lot's own"}`)
    return { ok: true, data: { environment, live, saleCode: chosen.mode === "one" ? chosen.code : null, receipts, unsendable: ids.length - sendable.length } }
  } catch (e) {
    return fail(e)
  }
}

/** Is this receipt (one a Hub lot is catalogued onto) in the BC test environment? Read only. */
export async function bcEodReceiptCheck(receiptId: string): Promise<Result<BcStep>> {
  try {
    const { environment, token } = await checkAdmin()
    const id = receiptOf(typeof receiptId === "string" ? receiptId : "")
    const used = id ? await prisma.catalogueLot.findFirst({ where: { receipt: { equals: id, mode: "insensitive" } }, select: { id: true } }) : null
    if (!used) return { ok: false, error: `No lot in the Hub is catalogued onto ${id || "that receipt"}.` }
    return { ok: true, data: await receiptInBc(token, environment, id) }
  } catch (e) {
    return fail(e)
  }
}

/** Sends one lot from the End of Day sheet as a line on the receipt it was catalogued onto, on the sale chosen.
 *  On LIVE BC, `confirm` must carry the number of lots typed on the screen. `opts.update` (trying again from the
 *  "needs amending" list) brings a line BC already has up to date instead of leaving it as it is. */
export async function bcEodLotSend(lotId: string, sale: BcEodSale, confirm?: unknown, opts?: { update?: boolean }): Promise<Result<BcStep[]>> {
  try {
    const { environment, token, userName, live } = await checkAdmin()
    liveGate(confirm)
    const chosen = saleFor(sale)
    const lot = typeof lotId === "string" ? await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: SALE_LOT_SELECT }) : null
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if (!lot.barcode?.trim()) return { ok: false, error: "This lot has no barcode now, and the End of Day send goes by barcode." }
    const receiptId = receiptOf(lot.receipt)
    if (!receiptId) return { ok: false, error: "This lot has no receipt in the Hub, so it has nowhere to go in BC." }
    const hub = await prisma.goodsInReceipt.findFirst({ where: { id: { equals: receiptId, mode: "insensitive" } }, select: { status: true } })
    const note = hubReceiptNote(hub?.status)
    if (note) return { ok: false, error: `${receiptId}: ${note}` }
    const forBc = lotForBcOnSale(lot, chosen)
    // Trying a lot again from the "needs amending" list brings a line BC already has up to date (opts.update) —
    // otherwise a line whose sale or details failed would just be found by its barcode and left as it was.
    const steps = await sendLot(token, environment, receiptId, forBc, { updateExisting: opts?.update === true })
    if (live) steps.push(...await noteLiveSend(lot, receiptId, steps, environment, userName, "bc_live_eod", forBc.saleCode))
    console.log(`[goods-in bc-eod] ${userName ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: steps }
  } catch (e) {
    return fail(e)
  }
}

// ── Lots sent to LIVE BC that NEED AMENDING (End of Day → Send to BC, 2026-11-18) ──
//
// A lot whose line reached BC but whose sale, details, Cleared For Sale tick or barcode failed is off the
// overnight sheet (it IS in BC — importing it again would double it), so without this it was never seen again.
// The list is every lot whose NEWEST "bc_sent" event is AMEND_FIELD (noteLiveSend). It leaves the list when a
// later send goes through cleanly, or when someone marks it fixed after correcting it in BC by hand.
// • bcEodToAmend / bcEodMarkFixed write nothing to BC. Trying again is bcEodLotSend with `update`, on the sale it
//   was first sent for, with the usual typed confirmation.
// • Lots sent BEFORE this marker existed carry no record of a failure, so bcEodSentToCheck / bcEodCheckSent read
//   BC (only reads) for lots sent recently and mark any whose line is missing, on another receipt or sale, or not
//   cleared for sale.

/** Hub admins, not viewing as someone else — for the parts that don't touch BC. */
async function adminOnly(): Promise<{ userName: string | null }> {
  const u = await getGoodsInUser()
  if (u?.role !== "ADMIN") throw new GoodsInAccessError("Only an admin can see what was sent to Business Central.")
  const session = await getEffectiveSession()
  if (session?.isImpersonating) throw new GoodsInAccessError("Stop viewing as someone else first.")
  return { userName: u.name }
}

type LatestSent = { lotId: string; field: string; newValue: string | null; changedAt: Date; changedBy: string }

/** Each lot's NEWEST bc_sent event — that alone says whether it needs amending now. */
async function latestSent(lotIds?: string[]): Promise<LatestSent[]> {
  if (lotIds && !lotIds.length) return []
  // `field` is indexed and `action` isn't: the change log is large, so filter on both.
  return lotIds
    ? prisma.$queryRaw<LatestSent[]>`
        SELECT DISTINCT ON ("lotId") "lotId", field, "newValue", "changedAt", "changedBy"
        FROM "CatalogueLotEvent"
        WHERE field IN (${SENT_FIELD}, ${AMEND_FIELD}) AND action = 'bc_sent' AND "lotId" = ANY(${lotIds})
        ORDER BY "lotId", "changedAt" DESC`
    : prisma.$queryRaw<LatestSent[]>`
        SELECT DISTINCT ON ("lotId") "lotId", field, "newValue", "changedAt", "changedBy"
        FROM "CatalogueLotEvent"
        WHERE field IN (${SENT_FIELD}, ${AMEND_FIELD}) AND action = 'bc_sent'
        ORDER BY "lotId", "changedAt" DESC`
}

/** "Receipt R · sale X · env — what failed" → its parts. Older events ("Receipt R in env") have no sale. */
function readSentValue(v: string | null): { receipt: string | null; sale: string | null; head: string; problem: string } {
  const s = v ?? ""
  const dash = s.indexOf(" — ")
  const head = dash >= 0 ? s.slice(0, dash) : s
  const sale = /· sale (\S+) ·/.exec(head)?.[1] ?? null
  return {
    receipt: /^Receipt (\S+)/.exec(head)?.[1] ?? null,
    sale: sale && sale !== "none" ? sale : null,
    head,
    problem: dash >= 0 ? s.slice(dash + 3) : "",
  }
}

export type BcAmendLot = {
  lotId: string
  barcode: string | null
  title: string
  /** The receipt and sale it was SENT for (trying again uses the same sale). */
  receipt: string | null
  saleCode: string | null
  /** What went wrong, in BC's words. */
  problem: string
  at: string
  by: string
}

/** Every lot sent to BC whose newest send left something to put right. No BC call. */
export async function bcEodToAmend(): Promise<Result<BcAmendLot[]>> {
  try {
    await adminOnly()
    const latest = (await latestSent()).filter(e => e.field === AMEND_FIELD)
    if (!latest.length) return { ok: true, data: [] }
    const lots = await prisma.catalogueLot.findMany({
      where: { id: { in: latest.map(e => e.lotId) } },
      select: { id: true, barcode: true, title: true, receipt: true },
    })
    const byId = new Map(lots.map(l => [l.id, l]))
    const data: BcAmendLot[] = []
    for (const e of latest.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())) {
      const l = byId.get(e.lotId)
      if (!l) continue // deleted from the Hub since
      const v = readSentValue(e.newValue)
      data.push({
        lotId: l.id, barcode: l.barcode, title: l.title, receipt: v.receipt ?? l.receipt,
        saleCode: v.sale, problem: v.problem || "Something didn't go through.", at: e.changedAt.toISOString(), by: e.changedBy,
      })
    }
    return { ok: true, data }
  } catch (e) {
    return fail(e)
  }
}

/** Takes a lot off the "needs amending" list after it was put right in BC by hand. Writes only the Hub's note. */
export async function bcEodMarkFixed(lotId: string): Promise<Result<null>> {
  try {
    const { userName } = await adminOnly()
    const [e] = typeof lotId === "string" ? await latestSent([lotId]) : []
    if (!e || e.field !== AMEND_FIELD) return { ok: true, data: null } // already off the list
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { id: true, auctionId: true, barcode: true, title: true, auction: { select: { code: true } } } })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    const ok = await writeLotEventsChecked([buildLotEventRow(
      { id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }, lot.auction?.code ?? "",
      "bc_sent", SENT_FIELD, "", `${readSentValue(e.newValue).head} — marked as fixed in BC by hand`,
      { changedBy: userName ?? "?", source: "bc_amend_fixed" },
    )])
    return ok ? { ok: true, data: null } : { ok: false, error: "The Hub couldn't save that — try again." }
  } catch (e) {
    return fail(e)
  }
}

/** Lots sent to BC in the last `days` days whose newest send looked clean — the ones "Check lots already sent"
 *  reads BC for. No BC call. */
export async function bcEodSentToCheck(days = 14): Promise<Result<{ lotId: string; barcode: string }[]>> {
  try {
    await adminOnly()
    const since = Date.now() - Math.min(Math.max(Number(days) || 14, 1), 90) * 86_400_000
    const latest = (await latestSent()).filter(e => e.field === SENT_FIELD && e.changedAt.getTime() >= since)
    if (!latest.length) return { ok: true, data: [] }
    const lots = await prisma.catalogueLot.findMany({ where: { id: { in: latest.map(e => e.lotId) } }, select: { id: true, barcode: true } })
    return { ok: true, data: lots.filter(l => l.barcode?.trim()).map(l => ({ lotId: l.id, barcode: l.barcode!.trim() })) }
  } catch (e) {
    return fail(e)
  }
}

/** Up to 12 lots sent earlier: does BC have each line as it should be? READS BC only; a lot that isn't right is
 *  put on the "needs amending" list (a Hub note). Returns what was found per lot. */
export async function bcEodCheckSent(lotIds: string[]): Promise<Result<{ lotId: string; problem: string | null }[]>> {
  try {
    const { environment, token, userName } = await checkAdmin()
    const ids = cleanList(lotIds).slice(0, 12)
    if (!ids.length) return { ok: true, data: [] }
    const lots = await prisma.catalogueLot.findMany({
      where: { id: { in: ids } },
      select: { id: true, auctionId: true, barcode: true, title: true, auction: { select: { code: true } } },
    })
    const latest = new Map((await latestSent(lots.map(l => l.id))).map(e => [e.lotId, e]))
    const found = await readSentLines(token, environment, lots.map(l => l.barcode ?? "").filter(Boolean))
    const rows: ReturnType<typeof buildLotEventRow>[] = []
    const out: { lotId: string; problem: string | null }[] = []
    for (const l of lots) {
      const e = latest.get(l.id)
      if (!e || e.field !== SENT_FIELD || !l.barcode?.trim()) { out.push({ lotId: l.id, problem: null }); continue }
      const sent = readSentValue(e.newValue)
      const lines = found.get(l.barcode.trim().toUpperCase()) ?? []
      const line = lines[0]
      const problems: string[] = []
      if (!line) problems.push(`BC has no line with barcode ${l.barcode.trim()} — its barcode step may not have finished, or the line was deleted in BC`)
      else {
        if (lines.length > 1) problems.push(`BC has barcode ${l.barcode.trim()} on ${lines.length} lines (${lines.map(x => x.uniqueId).join(", ")})`)
        if (sent.receipt && line.receiptNo.toUpperCase() !== sent.receipt.toUpperCase()) problems.push(`BC has it on receipt ${line.receiptNo}, not ${sent.receipt}`)
        if (sent.sale && line.sale.toUpperCase() !== sent.sale.toUpperCase()) problems.push(`BC has it on ${line.sale ? `sale ${line.sale}` : "no sale"}, not ${sent.sale}`)
        if (!line.cleared) problems.push(`${line.uniqueId || "It"} isn't ticked Cleared For Sale in BC`)
      }
      const problem = problems.length ? `Check: ${problems.join(" | ")}` : null
      out.push({ lotId: l.id, problem })
      if (problem) {
        // A send from before the sale was recorded ("Receipt R in env") has none — record the sale BC has it on
        // NOW, so trying again keeps it there rather than moving it to the lot's own sale.
        const head = sent.sale
          ? sent.head
          : `Receipt ${sent.receipt ?? line?.receiptNo ?? "?"} · sale ${line?.sale || "none"} · ${environment}`
        rows.push(buildLotEventRow(
          { id: l.id, auctionId: l.auctionId, barcode: l.barcode, title: l.title }, l.auction?.code ?? "",
          "bc_sent", AMEND_FIELD, "", `${head} — ${problem}`.slice(0, 2000),
          { changedBy: userName ?? "?", source: "bc_sent_check" },
        ))
      }
    }
    if (rows.length && !(await writeLotEventsChecked(rows))) {
      return { ok: false, error: "BC was checked, but the Hub couldn't note which lots need amending — try again." }
    }
    return { ok: true, data: out }
  } catch (e) {
    return fail(e)
  }
}

// ── A lot saved in the Add Lot wizard → straight into BC on sales allocation X999 (a STAGING TEST) ──
//
// Jack, 2026-11-16: "when a cataloguer saves a lot it automatically sends on the API down BC so it instantly
// creates lots but they all upon save need to go to X999" — "just a test for staging", on each cataloguer's
// OWN BC sign-in.
// • The wizard saves the lot first (createLot) and then calls this without waiting for it, so BC never slows or
//   stops a save. What happened is shown in a box at the foot of the wizard, lot by lot.
// • The SAME sendLot as every other panel, onto the receipt the lot was catalogued onto, with the sales
//   allocation X999 for every lot (AUTO_SEND_SALE) whatever sale it was catalogued in.
// • The person's OWN BC sign-in (getBCToken), never the background one. Not signed in → nothing is sent and the
//   wizard says so, with the sign-in link.
// • Only the person who saved the lot can send it this way (their timing log for it) — it isn't a way to send
//   any lot by its id.
// • A staging test: it never writes to LIVE BC. On the production Hub (bcWriteIsLive) it sends nothing and the
//   wizard shows nothing — taking it live is Jack's call.

const AUTO_SEND_SALE = "X999"

export type BcAutoSend = {
  environment: string
  receiptId: string
  /** The sales allocation every lot goes on (X999). */
  saleCode: string
  steps: BcStep[]
}

/** Whether the wizard sends each lot it saves to BC here (the send is set up on this server and isn't live). */
export async function bcAutoSendAvailable(): Promise<{ environment: string; saleCode: string } | null> {
  try {
    const environment = bcSandboxEnvironment()
    if (!environment || !process.env.BC_TENANT_ID || bcWriteIsLive()) return null
    if (!(await getEffectiveSession())) return null
    return { environment, saleCode: AUTO_SEND_SALE }
  } catch {
    return null
  }
}

/** Sends the lot this person has just saved to BC on X999. `data: null` = not set up here (or live): show nothing. */
export async function bcAutoSendLot(lotId: string): Promise<Result<BcAutoSend | null>> {
  try {
    const environment = bcSandboxEnvironment()
    if (!environment || !process.env.BC_TENANT_ID || bcWriteIsLive()) return { ok: true, data: null }
    const session = await getEffectiveSession()
    if (!session) return { ok: false, error: "You're not signed in to the Hub." }
    if (session.isImpersonating) return { ok: false, error: "Not sent — you're viewing as someone else, and this writes to Business Central as you." }
    const id = typeof lotId === "string" ? lotId : ""
    const saved = id
      ? await prisma.catalogueTimingLog.findFirst({ where: { lotId: id, userId: session.user.id }, select: { id: true } })
      : null
    if (!saved) return { ok: false, error: "Only the person who saved a lot can send it to BC this way." }
    const token = await getBCToken()
    if (!token) return { ok: false, error: NO_BC_SIGN_IN }

    const lot = await prisma.catalogueLot.findUnique({ where: { id }, select: SALE_LOT_SELECT })
    if (!lot) return { ok: false, error: "That lot isn't in the Hub any more." }
    if (!lot.barcode?.trim()) return { ok: false, error: "It has no barcode, and BC finds a lot by its barcode." }
    const receiptId = receiptOf(lot.receipt)
    if (!receiptId) return { ok: false, error: "It has no receipt, so it has nowhere to go in BC." }
    const hub = await prisma.goodsInReceipt.findFirst({ where: { id: { equals: receiptId, mode: "insensitive" } }, select: { status: true } })
    const note = hubReceiptNote(hub?.status)
    if (note) return { ok: false, error: `${receiptId}: ${note}` }

    const receipt = await receiptInBc(token, environment, receiptId)
    const steps = receipt.outcome === "failed"
      ? [receipt]
      : [receipt, ...await sendLot(token, environment, receiptId, { ...lotForBc(lot), saleCode: AUTO_SEND_SALE })]
    console.log(`[goods-in bc-auto] ${session.user.name ?? "?"} → ${environment}: ${steps.map(s => `${s.what} ${s.outcome}`).join("; ")}`)
    return { ok: true, data: { environment, receiptId, saleCode: AUTO_SEND_SALE, steps } }
  } catch (e) {
    return fail(e)
  }
}
