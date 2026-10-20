"use server"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { revalidatePath } from "next/cache"
import { GoodsInAccessError, atLeast, requireGoodsIn } from "@/lib/goods-in/access"
import type { WarehouseRole } from "@/lib/apps"
import { NumberingNotSetError, takeNumbers } from "@/lib/goods-in/numbers"
import {
  COUNTERS, DEFAULT_TERMS, LABEL_GIVEN_UP_NOTE, THROWN_AWAY_NOTE, normaliseCode,
  type ContainerKind, type ContainerStatus, type CounterKey, type LocationKind, type ReceiptTerms,
} from "@/lib/goods-in/model"
import { LOCATION_CODE_HELP, LOCATION_CODE_RULE } from "@/lib/goods-in/location-codes"
import { CUSTOMER_INCLUDE, customerRow, snapshot } from "@/lib/goods-in/customer-row"
import { AGREEMENT_UNREAD, findAgreement } from "@/lib/goods-in/agreement"
import { moveItem } from "@/lib/goods-in/move-core"
import { findCode } from "@/lib/goods-in/lookup-core"

// Goods In — every write, and the reads the screens share. SERVER ONLY (server actions).
//
// ⚠ Each action RETURNS { ok, error } rather than throwing: a server action that throws is
// redacted in production, so the counter clerk would see "An error occurred in the Server
// Components render" instead of the reason (RULES.md). Nothing here reads or writes Business
// Central (Jack, 2026-10-15).

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof NumberingNotSetError || e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  const msg = String((e as { message?: string })?.message ?? e)
  if (/does not exist|relation .*GoodsIn/i.test(msg)) return { ok: false, error: "Goods In isn't set up on this environment yet — an admin needs to press Run Migrations." }
  console.error("goods-in action error:", e)
  return { ok: false, error: msg.length < 200 ? msg : "Something went wrong — please try again." }
}

const who = (minRole: WarehouseRole = "warehouse") => requireGoodsIn(minRole)

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
// A receipt with status "draft" is a check-in that hasn't been booked in yet (goods-in-checkin.ts
// owns it until Book in): nothing here may add to it or change it.
const NOT_BOOKED_YET = "This check-in hasn't been booked in yet — carry on with it in Check in."
const money = (v: unknown, dflt: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : dflt }

// ─── Customers ────────────────────────────────────────────────────────────────────────────

export type CustomerRow = {
  id: string; salutation: string | null; name: string; email: string | null; phone: string | null
  addressLine1: string | null; addressLine2: string | null; postcode: string | null; notes: string | null
  vendorNo: string | null; mobile: string | null; town: string | null; county: string | null; country: string | null
  vatRegNo: string | null; commission: number | null; lottingFee: number | null; photographyFee: number | null; unsoldFee: number | null
  receipts: number
}

// customerRow, CUSTOMER_INCLUDE and snapshot live in lib/goods-in/customer-row.ts: Check in's actions
// (goods-in-checkin.ts) use them too, and a "use server" file may only export async functions.

/** Find customers by name, vendor number, postcode, email or phone (a scanned or typed vendor number matches exactly first). */
export async function searchCustomers(q: string): Promise<Result<CustomerRow[]>> {
  try {
    await who()
    const s = q.trim()
    if (s.length < 2) return { ok: true, data: [] }
    const like = { contains: s, mode: "insensitive" as const }
    const digits = s.replace(/\D/g, "")
    const rows = await prisma.contact.findMany({
      where: {
        OR: [
          { name: like }, { email: like }, { postcode: like }, { addressLine1: like }, { id: { equals: s, mode: "insensitive" } },
          ...(digits.length >= 5 ? [{ phone: { contains: digits } }] : []),
          { goodsInCustomer: { is: { OR: [{ vendorNo: { equals: normaliseCode(s), mode: "insensitive" as const } }, ...(digits.length >= 5 ? [{ mobile: { contains: digits } }] : [])] } } },
        ],
      },
      include: CUSTOMER_INCLUDE,
      orderBy: { name: "asc" },
      take: 30,
    })
    return { ok: true, data: rows.map(customerRow) }
  } catch (e) { return fail(e) }
}

export async function getCustomer(id: string): Promise<Result<CustomerRow | null>> {
  try {
    await who()
    const c = await prisma.contact.findUnique({ where: { id }, include: CUSTOMER_INCLUDE })
    return { ok: true, data: c ? customerRow(c) : null }
  } catch (e) { return fail(e) }
}

export type CustomerInput = {
  id?: string | null
  salutation?: string | null; name: string; email?: string | null; phone?: string | null
  addressLine1?: string | null; addressLine2?: string | null; town?: string | null; county?: string | null
  postcode?: string | null; country?: string | null; mobile?: string | null; vatRegNo?: string | null; notes?: string | null
  vendorNo?: string | null
  /** Give a customer with no vendor number the next one from the series. */
  newVendorNo?: boolean
  commission?: number | null; lottingFee?: number | null; photographyFee?: number | null; unsoldFee?: number | null
}

// The CRM's own contact id scheme (c00001…), kept so a Goods In customer is the same kind of
// record the CRM makes. Retried on a clash, because two clerks can add a customer at once.
async function nextContactId(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: number | null }[]>`SELECT MAX(NULLIF(regexp_replace("id", '\\D', '', 'g'), '')::int) AS n FROM "Contact" WHERE "id" ~ '^c\\d+$'`
  return `c${String((Number(rows[0]?.n) || 0) + 1).padStart(5, "0")}`
}

/**
 * Create or update a customer — the CRM contact and its Goods In half together. Their fees are
 * changed on the Fees & agreement tab (saveAgreement); a fee that is sent is still saved, and one
 * left out is left alone.
 */
export async function saveCustomer(input: CustomerInput): Promise<Result<CustomerRow>> {
  try {
    await who()
    const name = blank(input.name)
    if (!name) return { ok: false, error: "The customer needs a name." }
    const vendorTyped = blank(input.vendorNo) ? normaliseCode(input.vendorNo!) : null
    const contact = {
      salutation: blank(input.salutation), name, email: blank(input.email)?.toLowerCase() ?? null, phone: blank(input.phone),
      addressLine1: blank(input.addressLine1), addressLine2: blank(input.addressLine2), postcode: blank(input.postcode)?.toUpperCase() ?? null,
      notes: blank(input.notes), isSeller: true,
    }
    // ⚠ A fee LEFT OUT is left as it is (undefined → Prisma doesn't touch it). The customer form no
    // longer has the fees — they live on the customer's Fees & agreement tab (saveAgreement in
    // goods-in-agreement.ts) — so writing a missing one as null would put every customer back on
    // the standard fees each time their address was edited. null still means "standard".
    const terms = (v: number | null | undefined) => (v === undefined ? undefined : v == null || !Number.isFinite(Number(v)) ? null : money(v, 0))
    const extra = {
      mobile: blank(input.mobile), town: blank(input.town), county: blank(input.county), country: blank(input.country),
      vatRegNo: blank(input.vatRegNo), commission: terms(input.commission), lottingFee: terms(input.lottingFee),
      photographyFee: terms(input.photographyFee), unsoldFee: terms(input.unsoldFee),
    }
    let saved: string | null = null
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
      try {
        saved = await prisma.$transaction(async tx => {
          let id = input.id ?? null
          if (id) {
            await tx.contact.update({ where: { id }, data: contact })
          } else {
            id = await nextContactId(tx)
            await tx.contact.create({ data: { id, ...contact } })
          }
          const existing = await tx.goodsInCustomer.findUnique({ where: { contactId: id }, select: { vendorNo: true } })
          let vendorNo = vendorTyped ?? existing?.vendorNo ?? null
          if (!vendorNo && input.newVendorNo && (await tx.goodsInCounter.findUnique({ where: { key: "vendor" }, select: { key: true } }))) {
            vendorNo = (await takeNumbers(tx, "vendor", 1))[0]
          }
          if (vendorNo && vendorNo !== existing?.vendorNo) {
            const clash = await tx.goodsInCustomer.findUnique({ where: { vendorNo }, select: { contactId: true } })
            if (clash && clash.contactId !== id) throw new Error(`Vendor number ${vendorNo} already belongs to another customer.`)
          }
          await tx.goodsInCustomer.upsert({ where: { contactId: id }, create: { contactId: id, vendorNo, ...extra }, update: { vendorNo, ...extra } })
          return id
        })
      } catch (e) {
        // A clash on the new contact id (someone else added a customer at the same moment) — try the next id.
        if (!input.id && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) continue
        throw e
      }
    }
    const c = await prisma.contact.findUnique({ where: { id: saved! }, include: CUSTOMER_INCLUDE })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: customerRow(c!) }
  } catch (e) { return fail(e) }
}

// ─── Receipts ─────────────────────────────────────────────────────────────────────────────

export type ContainerInput = { kind: ContainerKind; category?: string | null; description?: string | null }
export type ReceiptInput = {
  contactId: string
  terms?: Partial<ReceiptTerms>
  containers: ContainerInput[]
  notes?: string | null
  ownerConfirmed?: boolean
  agentConfirmed?: boolean
}

/**
 * Book a customer's goods in: one receipt number, one number per tote and pallet, all in one
 * transaction — either the whole receipt exists or none of it does. A customer with no vendor
 * number is given the next one if the vendor series has been set up.
 */
export async function createReceipt(input: ReceiptInput): Promise<Result<{ receiptId: string; containerIds: string[] }>> {
  try {
    const me = await who()
    const rows = (input.containers ?? []).filter(r => r && (r.kind === "tote" || r.kind === "pallet"))
    if (rows.length === 0) return { ok: false, error: "Add at least one tote or pallet before booking in." }
    if (rows.length > 200) return { ok: false, error: "That's more than 200 totes on one receipt — split it into two receipts." }
    const cust = await prisma.contact.findUnique({ where: { id: input.contactId }, include: CUSTOMER_INCLUDE })
    if (!cust) return { ok: false, error: "That customer couldn't be found — search for them again." }
    const c = customerRow(cust)
    // Their usual reserve and special arrangement (the Fees & agreement tab) — read BEFORE the
    // transaction (GoodsInAgreement needs Run Migrations, and a failed query inside the transaction
    // would abort the booking) and strictly: a missing table is "standard reserve, no arrangement",
    // but any other fault refuses, rather than book a receipt that silently leaves off what was agreed.
    const a = await findAgreement(c.id).catch((e: unknown) => {
      console.error("goods-in createReceipt: couldn't read the customer's agreement:", e)
      return null
    })
    if (!a) return { ok: false, error: AGREEMENT_UNREAD }
    const usualReserve = a.reservePercent ?? DEFAULT_TERMS.reservePercent
    const reserve = Number(input.terms?.reservePercent ?? usualReserve)
    const t: ReceiptTerms = {
      commission: money(input.terms?.commission ?? c.commission, DEFAULT_TERMS.commission),
      lottingFee: money(input.terms?.lottingFee ?? c.lottingFee, DEFAULT_TERMS.lottingFee),
      photographyFee: money(input.terms?.photographyFee ?? c.photographyFee, DEFAULT_TERMS.photographyFee),
      unsoldFee: money(input.terms?.unsoldFee ?? c.unsoldFee, DEFAULT_TERMS.unsoldFee),
      reservePercent: Math.min(100, Math.max(0, Math.round(Number.isFinite(reserve) ? reserve : usualReserve))),
    }

    const made = await prisma.$transaction(async tx => {
      // A vendor number is given only when an admin has deliberately set that series up: BC still
      // hands out C-numbers for website sign-ups, so carrying the C-series on in the Hub could give
      // two customers the same number. With no series set the receipt simply carries none.
      let vendorNo = c.vendorNo
      if (!vendorNo && (await tx.goodsInCounter.findUnique({ where: { key: "vendor" }, select: { key: true } }))) {
        vendorNo = (await takeNumbers(tx, "vendor", 1))[0]
        await tx.goodsInCustomer.upsert({ where: { contactId: c.id }, create: { contactId: c.id, vendorNo }, update: { vendorNo } })
      }
      const [receiptId] = await takeNumbers(tx, "receipt", 1)
      const totes = rows.filter(r => r.kind === "tote").length
      const pallets = rows.length - totes
      const toteNos = totes ? await takeNumbers(tx, "tote", totes) : []
      const palletNos = pallets ? await takeNumbers(tx, "pallet", pallets) : []
      await tx.goodsInReceipt.create({
        data: {
          id: receiptId, contactId: c.id, vendorNo, customer: { ...snapshot(c, { specialArrangement: a.specialArrangement }), vendorNo } as unknown as Prisma.InputJsonValue,
          ...t, ownerConfirmed: !!input.ownerConfirmed, agentConfirmed: !!input.agentConfirmed,
          notes: blank(input.notes), status: "open", createdById: me.id, createdByName: me.name,
        },
      })
      const ids: string[] = []
      let ti = 0, pi = 0
      for (const r of rows) {
        const id = r.kind === "tote" ? toteNos[ti++] : palletNos[pi++]
        ids.push(id)
        await tx.goodsInContainer.create({
          data: { id, receiptId, kind: r.kind, category: blank(r.category), description: blank(r.description), status: "booked", createdByName: me.name },
        })
      }
      return { receiptId, containerIds: ids }
    }, { timeout: 20_000 })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: made }
  } catch (e) { return fail(e) }
}

/** Add more totes or pallets to an existing receipt (a customer who brings a second car-load). */
export async function addContainers(receiptId: string, containers: ContainerInput[]): Promise<Result<string[]>> {
  try {
    const me = await who()
    const rows = (containers ?? []).filter(r => r && (r.kind === "tote" || r.kind === "pallet"))
    if (rows.length === 0) return { ok: false, error: "Nothing to add." }
    if (rows.length > 200) return { ok: false, error: "That's more than 200 totes and pallets at once — add them in two goes." }
    const ids = await prisma.$transaction(async tx => {
      const r = await tx.goodsInReceipt.findUnique({ where: { id: receiptId }, select: { status: true } })
      if (!r) throw new Error("That receipt couldn't be found.")
      if (r.status === "void") throw new Error("That receipt has been voided.")
      if (r.status === "draft") throw new Error(NOT_BOOKED_YET)
      const out: string[] = []
      for (const row of rows) {
        const [id] = await takeNumbers(tx, row.kind, 1)
        await tx.goodsInContainer.create({ data: { id, receiptId, kind: row.kind, category: blank(row.category), description: blank(row.description), status: "booked", createdByName: me.name } })
        out.push(id)
      }
      return out
      // Three round trips per tote (number, free check, create) — 200 at once is far past Prisma's
      // default 5-second transaction, so this gets createReceipt's allowance.
    }, { timeout: 20_000 })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: ids }
  } catch (e) { return fail(e) }
}

export async function updateContainer(id: string, patch: { category?: string | null; description?: string | null; status?: ContainerStatus }): Promise<Result> {
  try {
    await who()
    // A tote on a check-in that isn't booked in yet belongs to the Check in screen: its next save
    // would write over a category or description changed here, and it can't be catalogued or
    // returned before it's booked in. (Moving it is still allowed — that's moveTo.)
    const cur = await prisma.goodsInContainer.findUnique({ where: { id }, select: { receipt: { select: { status: true } } } })
    if (!cur) return { ok: false, error: `${id} couldn't be found.` }
    if (cur.receipt.status === "draft") return { ok: false, error: NOT_BOOKED_YET }
    await prisma.goodsInContainer.update({
      where: { id },
      data: {
        ...(patch.category !== undefined ? { category: blank(patch.category) } : {}),
        ...(patch.description !== undefined ? { description: blank(patch.description) } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      },
    })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

/**
 * Change a receipt's notes or status. Voiding a receipt, and bringing a void one back (open or
 * closed), are a manager's; everything else is anyone in Goods In. `appendNote` adds one line to
 * the END of the notes on the server, so a note someone else saved since the page loaded is kept
 * (sending the whole notes text from the browser would write over it).
 */
export async function updateReceipt(id: string, patch: { notes?: string | null; status?: "open" | "closed" | "void"; appendNote?: string | null }): Promise<Result> {
  try {
    const me = await who()
    if (patch.status && !["open", "closed", "void"].includes(patch.status)) return { ok: false, error: "Unknown receipt status." }
    const cur = await prisma.goodsInReceipt.findUnique({ where: { id }, select: { status: true, notes: true } })
    if (!cur) return { ok: false, error: "That receipt couldn't be found." }
    // Nothing here — notes, close, void — changes a check-in that isn't booked in yet; Check in
    // throws one away instead (discardCheckIn in goods-in-checkin.ts).
    if (cur.status === "draft") return { ok: false, error: NOT_BOOKED_YET }
    // A check-in thrown away after a label was printed is kept as void for the record. It was never
    // booked in, so it can't be brought back as if it had been.
    const thrownAway = cur.status === "void" && (cur.notes ?? "").includes(THROWN_AWAY_NOTE)
    if (thrownAway && patch.status && patch.status !== "void") {
      return { ok: false, error: "This check-in was thrown away before it was booked in, so it can't be reopened — check the goods in again." }
    }
    // Its notes are the record of it (and of the labels printed for it, so a stray labelled tote can
    // be traced) — and what tells it apart from a booked receipt a manager voided. They can be added
    // to, never have that record taken out.
    if (thrownAway && patch.notes !== undefined) {
      const next = blank(patch.notes) ?? ""
      const record = (cur.notes ?? "").split(/\r?\n/).map(l => l.trim()).filter(l => l.includes(THROWN_AWAY_NOTE) || l.startsWith(LABEL_GIVEN_UP_NOTE))
      if (record.some(l => !next.includes(l))) {
        return { ok: false, error: "The note saying this check-in was thrown away, and which labels had been printed, has to stay — you can add to the notes, but not take that out." }
      }
    }
    const was = cur.status ?? "open"
    const managerOnly = patch.status === "void" || (was === "void" && !!patch.status)
    if (managerOnly && !atLeast(me, "manager")) return { ok: false, error: "Only a Warehouse manager or admin can do that." }
    const line = blank(patch.appendNote)
    const changed = await prisma.$transaction(async tx => {
      // Only if the status is still what the decision above was made on — someone else may have
      // voided or restored it a moment ago.
      const r = await tx.goodsInReceipt.updateMany({
        where: { id, status: cur.status },
        data: { updatedAt: new Date(), ...(patch.notes !== undefined ? { notes: blank(patch.notes) } : {}), ...(patch.status ? { status: patch.status } : {}) },
      })
      if (r.count === 0) return false
      if (line) {
        await tx.$executeRaw`UPDATE "GoodsInReceipt" SET "notes" = concat_ws(chr(10), NULLIF("notes", ''), ${line}::text) WHERE "id" = ${id}`
      }
      return true
    })
    if (!changed) return { ok: false, error: "Someone else has just changed this receipt — refresh the page and try again." }
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

/** Record that the receipt (or its labels) went out — shown on the receipt page. */
export async function markReceiptSent(id: string, how: { printed?: boolean; emailedTo?: string | null; labels?: boolean }): Promise<Result> {
  try {
    await who()
    const cur = await prisma.goodsInReceipt.findUnique({ where: { id }, select: { status: true } })
    if (!cur) return { ok: false, error: "That receipt couldn't be found." }
    if (cur.status === "draft") return { ok: false, error: NOT_BOOKED_YET }
    const now = new Date()
    if (how.printed || how.emailedTo) {
      await prisma.goodsInReceipt.update({ where: { id }, data: { ...(how.printed ? { printedAt: now } : {}), ...(how.emailedTo ? { emailedAt: now, emailedTo: how.emailedTo } : {}) } })
    }
    if (how.labels) await prisma.goodsInContainer.updateMany({ where: { receiptId: id }, data: { labelPrintedAt: now } })
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

// ─── Locations and moves ──────────────────────────────────────────────────────────────────

export type LocationRow = { code: string; name: string | null; kind: LocationKind; active: boolean; containers: number }

export async function listLocations(): Promise<Result<LocationRow[]>> {
  try {
    await who()
    const [locs, counts] = await Promise.all([
      prisma.goodsInLocation.findMany({ orderBy: { code: "asc" } }),
      prisma.goodsInContainer.groupBy({ by: ["locationCode"], _count: { _all: true }, where: { locationCode: { not: null } } }),
    ])
    const n = new Map(counts.map(c => [c.locationCode, c._count._all]))
    return { ok: true, data: locs.map(l => ({ code: l.code, name: l.name, kind: (l.kind as LocationKind) ?? "storage", active: l.active !== false, containers: n.get(l.code) ?? 0 })) }
  } catch (e) { return fail(e) }
}

export async function saveLocation(input: { code: string; name?: string | null; kind: LocationKind; active?: boolean }): Promise<Result> {
  try {
    await who("manager")
    const code = normaliseCode(input.code ?? "")
    if (!LOCATION_CODE_RULE.test(code)) return { ok: false, error: LOCATION_CODE_HELP }
    await prisma.goodsInLocation.upsert({
      where: { code },
      create: { code, name: blank(input.name), kind: input.kind, active: input.active !== false },
      update: { name: blank(input.name), kind: input.kind, active: input.active !== false },
    })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

export type ScanHit =
  | { type: "container"; id: string; kind: ContainerKind; receiptId: string; customer: string; category: string | null; description: string | null; status: string | null; locationCode: string | null }
  | { type: "lot"; lotId: string; barcode: string; title: string; auction: string | null; tote: string | null; receipt: string | null; locationCode: string | null }
  | { type: "receipt"; id: string; customer: string; containers: number; createdAt: Date }
  | { type: "location"; code: string; name: string | null; kind: LocationKind }
  | { type: "customer"; id: string; name: string; vendorNo: string | null }

/** What a scanned or typed code is — a tote/pallet, a lot barcode, a receipt, a location or a vendor number. */
// The reading itself lives in lib/goods-in/lookup-core.ts (findCode), shared with the handheld
// scanner's Find — change the rules there, so Code lookup and the scanner always agree.
export async function lookupCode(raw: string): Promise<Result<ScanHit | null>> {
  try {
    await who()
    return { ok: true, data: await findCode(raw) }
  } catch (e) { return fail(e) }
}

/**
 * Move a tote, pallet or single lot (by its barcode) to a location. Moving a tote to a BENCH
 * marks it as being catalogued; to storage, as stored. A lot's location is simply its latest move.
 *
 * ⚠ The rules themselves are moveItem in lib/goods-in/move-core.ts, shared with the handheld
 * scanner's sync (app/api/goods-in/scan/sync) — change them THERE, never by forking them here.
 */
export async function moveTo(rawItem: string, rawLocation: string, note?: string | null): Promise<Result<{ item: string; locationCode: string; kind: LocationKind }>> {
  try {
    const me = await who()
    const r = await prisma.$transaction(tx => moveItem(tx, me, rawItem, rawLocation, { note }), { timeout: 15_000 })
    if (!r.ok) return { ok: false, error: r.error }
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { item: r.item, locationCode: r.locationCode, kind: r.kind } }
  } catch (e) { return fail(e) }
}

/**
 * Fill Goods In's locations from the warehouse's full location list (lib/goods-in/location-list.json —
 * 3,920 codes from the warehouse's own spreadsheet, Jack 2026-10-20: every aisle, bay, shelf and
 * half-shelf in both the A10A1 and 10A1 forms, cages, benches and named areas; cataloguing benches
 * marked). Adds the missing ones only; a location already here keeps its name, kind and on/off
 * setting. A static file in the repo — nothing is asked of Business Central.
 * ⚠ Goods In's own copy on purpose: lib/warehouse-locations.json feeds the BC warehouse heat-maps
 * and stays as it was. To refresh this list, rebuild the JSON from a new spreadsheet export.
 */
export async function importLocationList(): Promise<Result<{ added: number; already: number }>> {
  try {
    await who("manager")
    const list = (await import("@/lib/goods-in/location-list.json")).default as { code: string; name: string | null; cataloguingBench: boolean }[]
    const rows = list
      .map(l => ({ code: normaliseCode(l.code), name: l.name || null, kind: (l.cataloguingBench ? "bench" : "storage") as LocationKind, active: true }))
      .filter(l => LOCATION_CODE_RULE.test(l.code))
    const r = await prisma.goodsInLocation.createMany({ data: rows, skipDuplicates: true })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { added: r.count, already: rows.length - r.count } }
  } catch (e) { return fail(e) }
}

// ─── Settings: the number series ──────────────────────────────────────────────────────────

/** Set where a number series carries on from (admins). The next number handed out is exactly what is set. */
export async function setCounter(key: CounterKey, input: { prefix: string; next: number; width: number }): Promise<Result> {
  try {
    const me = await who("admin")
    if (!(key in COUNTERS)) return { ok: false, error: "Unknown number series." }
    const prefix = normaliseCode(input.prefix ?? "")
    const next = Math.floor(Number(input.next))
    const width = Math.floor(Number(input.width))
    if (!/^[A-Z]{1,3}$/.test(prefix)) return { ok: false, error: "The prefix is one to three letters." }
    if (!Number.isFinite(next) || next < 1) return { ok: false, error: "The next number must be 1 or more." }
    if (!Number.isFinite(width) || width < 3 || width > 9) return { ok: false, error: "The number of digits must be between 3 and 9." }
    await prisma.goodsInCounter.upsert({ where: { key }, create: { key, prefix, next, width, updatedBy: me.name }, update: { prefix, next, width, updatedBy: me.name } })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}

/**
 * Switch the VENDOR number series off again (admins) — for a series set by mistake. Vendor numbers
 * already given stay on their customers; from now on a customer without one simply gets none, as
 * before it was set. Only the vendor series can be switched off: receipts and totes must always
 * have one, or booking in stops.
 */
export async function clearCounter(key: CounterKey): Promise<Result> {
  try {
    await who("admin")
    if (key !== "vendor") return { ok: false, error: "Only the vendor number series can be switched off." }
    await prisma.goodsInCounter.deleteMany({ where: { key } })
    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: undefined }
  } catch (e) { return fail(e) }
}
