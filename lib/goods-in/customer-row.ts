import type { Prisma } from "@/app/generated/prisma/client"
import type { CustomerRow } from "@/lib/actions/goods-in"
import type { CustomerSnapshot } from "./model"

// Goods In — reading a customer (a CRM contact plus its Goods In half) into the shape the screens
// use, and the copy of them a receipt keeps. Shared by lib/actions/goods-in.ts and
// lib/actions/goods-in-checkin.ts.
//
// ⚠ These live here, not in either actions file, because a "use server" file may only export async
// functions (and types) — exporting a plain function or an object from one breaks the build.
// (The CustomerRow TYPE itself stays in goods-in.ts, where the screens import it from.)

/** What every customer read includes. A receipt not booked in yet (a check-in still going, status
 *  "draft") isn't counted — "First time booking in with the Hub" must stay true until Book in. */
export const CUSTOMER_INCLUDE = {
  goodsInCustomer: true,
  _count: { select: { goodsInReceipts: { where: { OR: [{ status: null }, { status: { not: "draft" } }] } } } },
} satisfies Prisma.ContactInclude

export type ContactWithGoodsIn = Prisma.ContactGetPayload<{ include: typeof CUSTOMER_INCLUDE }>

export const customerRow = (c: ContactWithGoodsIn): CustomerRow => ({
  id: c.id, salutation: c.salutation, name: c.name, email: c.email, phone: c.phone,
  addressLine1: c.addressLine1, addressLine2: c.addressLine2, postcode: c.postcode, notes: c.notes,
  vendorNo: c.goodsInCustomer?.vendorNo ?? null, mobile: c.goodsInCustomer?.mobile ?? null, town: c.goodsInCustomer?.town ?? null,
  county: c.goodsInCustomer?.county ?? null, country: c.goodsInCustomer?.country ?? null, vatRegNo: c.goodsInCustomer?.vatRegNo ?? null,
  commission: c.goodsInCustomer?.commission ?? null, lottingFee: c.goodsInCustomer?.lottingFee ?? null,
  photographyFee: c.goodsInCustomer?.photographyFee ?? null, unsoldFee: c.goodsInCustomer?.unsoldFee ?? null,
  receipts: c._count.goodsInReceipts,
})

/** The customer as a receipt prints them — copied onto the receipt so a reprint never changes. */
export function snapshot(c: CustomerRow): CustomerSnapshot {
  return {
    salutation: c.salutation, name: c.name, addressLine1: c.addressLine1, addressLine2: c.addressLine2, town: c.town, county: c.county,
    postcode: c.postcode, country: c.country, email: c.email, mobile: c.mobile, phone: c.phone, vatRegNo: c.vatRegNo, vendorNo: c.vendorNo,
  }
}
