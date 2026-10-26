// Accounts → Refunds: the server-side pieces the public form, the staff panel and the old-log import
// all share. Server only (Prisma) — NOT a "use server" file, so it may export plain helpers.

import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"

type Tx = Prisma.TransactionClient

/** One of the refund tables isn't there yet (Run Migrations) — never any other fault. */
export function isMissingRefunds(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null
  if (err?.code === "P2021" || err?.code === "42P01" || err?.meta?.code === "42P01") return true
  return /"?Refund(Lot|Event)?"?\W{0,3}\s*does not exist/i.test(`${err?.message ?? ""} ${err?.meta?.message ?? ""}`)
}

/**
 * The next request number, inside the transaction that creates the request: a transaction-scoped
 * advisory lock first, so two requests at once queue and never get the same number (Refund.ref is
 * unique as well). Numbers start at 1; a deleted request's number is never handed out again only if it
 * wasn't the highest — that is accepted (it's a reference, not an accounts sequence).
 */
export async function nextRefundRef(tx: Tx): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refund-ref'))`
  const rows = await tx.$queryRaw<{ next: number }[]>`SELECT (COALESCE(MAX("ref"), 0) + 1)::int AS "next" FROM "Refund"`
  return Number(rows[0]?.next ?? 1)
}

/** A C-number tidied ("c123456 " → "C123456"), or null when it isn't one. */
export function tidyCustomerNo(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "")
  return /^[A-Z]\d{3,9}$/.test(s) ? s : null
}

/** The Hub's Customers record for a C-number (its contact, buyer or seller number) — null when none,
 *  or when the Customers table isn't there yet. Never throws. */
export async function matchCustomerId(customerNo: string | null): Promise<string | null> {
  if (!customerNo) return null
  try {
    const c = await prisma.customer.findFirst({
      where: { OR: [{ contactNo: customerNo }, { buyerNo: customerNo }, { vendorNo: customerNo }] },
      select: { id: true },
    })
    return c?.id ?? null
  } catch {
    return null
  }
}

/** Writes one timeline line. `tx` when inside a transaction. */
export async function writeRefundEvent(
  db: Tx | typeof prisma,
  refundId: string,
  kind: string,
  text: string | null,
  by: { id: string | null; name: string | null },
): Promise<void> {
  await db.refundEvent.create({ data: { refundId, kind, text: text ? text.slice(0, 4000) : null, byId: by.id, byName: by.name } })
}
