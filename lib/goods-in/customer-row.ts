import type { Prisma } from "@/app/generated/prisma/client"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { CustomerSnapshot } from "./model"

// Goods In — reading a customer into the shape the screens use, and the copy of them a receipt keeps.
// Since 2026-10-23 a Goods In customer IS a row of the Hub's customer database (`Customer` — one
// record per person, copied from BC until switch day), plus its Goods In half (GoodsInCustomer: the
// fees, and a Hub-given vendor number once the Hub owns the numbers). Shared by lib/actions/goods-in.ts
// and lib/actions/goods-in-checkin.ts.
//
// ⚠ These live here, not in either actions file, because a "use server" file may only export async
// functions (and types) — exporting a plain function or an object from one breaks the build.
// (The CustomerRow TYPE itself stays in goods-in.ts, where the screens import it from.)

/** What every customer read includes. A receipt not booked in yet (a check-in still going, status
 *  "draft") isn't counted — "First time booking in with the Hub" must stay true until Book in. */
export const CUSTOMER_INCLUDE = {
  goodsInCustomer: true,
  _count: { select: { goodsInReceipts: { where: { OR: [{ status: null }, { status: { not: "draft" } }] } } } },
} satisfies Prisma.CustomerInclude

export type CustomerWithGoodsIn = Prisma.CustomerGetPayload<{ include: typeof CUSTOMER_INCLUDE }>

/** The name a Customer row shows: BC's name, else its second name line. */
export const customerName = (c: { name: string | null; name2: string | null } | null | undefined): string =>
  (c?.name?.trim() || c?.name2?.trim()) ?? ""

/** For receipt reads that select `person: PERSON_NAME`: its name, else the name printed on the receipt, else a plain marker. */
export const PERSON_NAME = { select: { name: true, name2: true } } as const
export function personName(p: { name: string | null; name2: string | null } | null | undefined, snapshot?: unknown): string {
  const n = customerName(p)
  if (n) return n
  const s = snapshot && typeof snapshot === "object" ? (snapshot as { name?: unknown }).name : null
  return typeof s === "string" && s.trim() ? s.trim() : "(customer not on record)"
}

/** Fields the receipt PDF and labels fall back to when a receipt has no snapshot. */
export const PERSON_FOR_PDF = { select: { name: true, name2: true, email: true, phone: true, mobile: true, address: true, address2: true, address3: true, city: true, county: true, postCode: true, countryCode: true, vatRegNo: true } } as const
export type PersonForPdf = { name: string | null; name2: string | null; email: string | null; phone: string | null; mobile: string | null; address: string | null; address2: string | null; address3: string | null; city: string | null; county: string | null; postCode: string | null; countryCode: string | null; vatRegNo: string | null }
/** The shape customerSnapshot() takes as its fallback. */
export function personFallback(p: PersonForPdf | null | undefined) {
  if (!p) return null
  return {
    salutation: null, name: customerName(p), email: p.email, phone: p.mobile || p.phone,
    addressLine1: p.address, addressLine2: [p.address2, p.address3].filter(Boolean).join(", ") || null, postcode: p.postCode,
  }
}

/** The effective vendor number: BC's, else one the Hub gave (only once the Hub owns the numbers). */
export const vendorNoOf = (c: { vendorNo: string | null; goodsInCustomer: { vendorNo: string | null } | null }) =>
  c.vendorNo ?? c.goodsInCustomer?.vendorNo ?? null

export const customerRow = (c: CustomerWithGoodsIn): CustomerRow => ({
  id: c.id, customerNo: c.contactNo ?? c.vendorNo ?? c.buyerNo ?? null, salutation: null, name: customerName(c) || "(no name)",
  email: c.email, phone: c.phone,
  addressLine1: c.address, addressLine2: [c.address2, c.address3].filter(Boolean).join(", ") || null, postcode: c.postCode, notes: null,
  vendorNo: vendorNoOf(c), mobile: c.mobile, town: c.city, county: c.county, country: c.countryCode, vatRegNo: c.vatRegNo,
  commission: c.goodsInCustomer?.commission ?? null, lottingFee: c.goodsInCustomer?.lottingFee ?? null,
  photographyFee: c.goodsInCustomer?.photographyFee ?? null, unsoldFee: c.goodsInCustomer?.unsoldFee ?? null,
  receipts: c._count.goodsInReceipts,
  fromBc: c.source !== "hub",
})

/**
 * The customer as a receipt prints them — copied onto the receipt so a reprint never changes.
 * `specialArrangement` is their Fees & agreement tab's special arrangement as it stands at booking
 * (read tolerantly, BEFORE the booking transaction — lib/goods-in/agreement.ts), printed on the
 * receipt under the terms.
 */
export function snapshot(c: CustomerRow, extra?: { specialArrangement?: string | null }): CustomerSnapshot {
  return {
    salutation: c.salutation, name: c.name, addressLine1: c.addressLine1, addressLine2: c.addressLine2, town: c.town, county: c.county,
    postcode: c.postcode, country: c.country, email: c.email, mobile: c.mobile, phone: c.phone, vatRegNo: c.vatRegNo, vendorNo: c.vendorNo,
    specialArrangement: extra?.specialArrangement?.trim() || null,
  }
}
