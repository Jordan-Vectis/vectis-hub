import { prisma } from "@/lib/prisma"
import { isMissingTable } from "@/lib/prisma-errors"

// Goods In — a customer's standing agreement, read tolerantly. SERVER ONLY (a plain module, not
// "use server", so the customer page, Check in and booking can all import it).
//
// The Fees & agreement tab on a customer's page (Jack, 2026-10-16: "need a tab for fees and
// agreement and stuff … Tab on the customer's page") is set once there, and Check in just uses it.
// Their FEES live on GoodsInCustomer (commission, lotting / photography / unsold fee); the rest —
// their usual reserve, when they signed Vectis's vendor terms (and who recorded it) and any special
// arrangement in plain words — is one GoodsInAgreement row per contact. The editing is
// lib/actions/goods-in-agreement.ts.
//
// ⚠⚠ GoodsInAgreement needs Run Migrations, and code deploys first. So:
//  • Every read of it is its OWN query, here, inside try/catch, and never throws: a missing table
//    gives nulls (and `ready: false`), which means "standard reserve, not signed, no arrangement".
//  • NEVER `include` goodsInAgreement in a contact / customer query (CUSTOMER_INCLUDE or any other
//    that a screen depends on): between the deploy and Run Migrations it would break the customer
//    screens and Check in outright.
//  • NEVER read it inside a transaction. A failed query aborts the whole Postgres transaction
//    ("current transaction is aborted"), so a missing table would take the booking down with it.
//    Read it first, with the plain client, then open the transaction.

/** The GoodsInAgreement half of a customer's agreement. null = standard / not signed / none. */
export type AgreementTerms = {
  customerId: string
  /** Their usual reserve, a whole % of the bottom estimate. null = the standard one (DEFAULT_TERMS). */
  reservePercent: number | null
  /** ISO. Stored at 12:00 UTC on the London day they signed, so it reads as that day anywhere. */
  termsSignedAt: string | null
  termsRecordedBy: string | null
  specialArrangement: string | null
  updatedAt: string | null
  updatedByName: string | null
  /** false = GoodsInAgreement isn't on this environment yet (an admin needs to press Run Migrations). */
  ready: boolean
}

/** What the screens say while the table isn't there yet. */
export const AGREEMENT_NOT_READY = "Reserve, signed vendor terms and special arrangements need Run Migrations — an admin needs to press it."

/**
 * Booking in refuses with this when the agreement couldn't be read for a reason OTHER than the table
 * not being there yet: the receipt copies their special arrangement, and booking without it would
 * print a receipt that leaves off what was agreed, with nothing to show it.
 */
export const AGREEMENT_UNREAD = "Their Fees & agreement couldn't be read just now (the receipt needs any special arrangement on it), so nothing was booked in — press Book in again."

const SELECT = {
  customerId: true, reservePercent: true, termsSignedAt: true, termsRecordedBy: true,
  specialArrangement: true, updatedAt: true, updatedByName: true,
} as const

type Row = { customerId: string; reservePercent: number | null; termsSignedAt: Date | null; termsRecordedBy: string | null; specialArrangement: string | null; updatedAt: Date; updatedByName: string | null }

export const emptyAgreement = (customerId: string, ready: boolean): AgreementTerms => ({
  customerId, reservePercent: null, termsSignedAt: null, termsRecordedBy: null, specialArrangement: null, updatedAt: null, updatedByName: null, ready,
})

const fromRow = (r: Row): AgreementTerms => ({
  customerId: r.customerId,
  reservePercent: typeof r.reservePercent === "number" && Number.isFinite(r.reservePercent) ? r.reservePercent : null,
  termsSignedAt: r.termsSignedAt ? r.termsSignedAt.toISOString() : null,
  termsRecordedBy: r.termsRecordedBy,
  specialArrangement: r.specialArrangement && r.specialArrangement.trim() ? r.specialArrangement.trim() : null,
  updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
  updatedByName: r.updatedByName,
  ready: true,
})

/**
 * One customer's agreement, STRICTLY: `ready: false` (and nulls) when the table isn't there yet, but
 * a real database fault is thrown — for the actions, which answer it as an error, and for BOOKING IN
 * (bookInCheckIn, createReceipt), which refuses with AGREEMENT_UNREAD rather than copy "no special
 * arrangement" onto a receipt it couldn't check. Screens and autosaves use readAgreement /
 * readAgreements, which never throw (Book in copies the arrangement afresh anyway).
 */
export async function findAgreement(customerId: string): Promise<AgreementTerms> {
  try {
    const r = await prisma.goodsInAgreement.findUnique({ where: { customerId }, select: SELECT })
    return r ? fromRow(r) : emptyAgreement(customerId, true)
  } catch (e) {
    if (isMissingTable(e)) return emptyAgreement(customerId, false)
    throw e
  }
}

/** One customer's agreement. Never throws: no row, a missing table or a fault all give nulls. */
export async function readAgreement(customerId: string): Promise<AgreementTerms> {
  try {
    return await findAgreement(customerId)
  } catch (e) {
    console.error("goods-in agreement: couldn't read the agreement, using the standard terms:", e)
    return emptyAgreement(customerId, true)
  }
}

/**
 * Many customers' agreements, keyed by contact id — every id asked for is in the map (nulls when
 * they have none). Never throws, as readAgreement.
 */
export async function readAgreements(contactIds: string[]): Promise<Map<string, AgreementTerms>> {
  const ids = [...new Set(contactIds.filter(id => typeof id === "string" && id))]
  const out = new Map<string, AgreementTerms>()
  if (ids.length === 0) return out
  let ready = true
  try {
    const rows = await prisma.goodsInAgreement.findMany({ where: { customerId: { in: ids } }, select: SELECT })
    for (const r of rows) out.set(r.customerId, fromRow(r))
  } catch (e) {
    if (isMissingTable(e)) ready = false
    else console.error("goods-in agreement: couldn't read the agreements, using the standard terms:", e)
  }
  for (const id of ids) if (!out.has(id)) out.set(id, emptyAgreement(id, ready))
  return out
}
