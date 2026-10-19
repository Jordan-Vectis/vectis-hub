import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/app/generated/prisma/client"
import { COUNTERS, formatNumber, type CounterKey } from "./model"

// Goods In numbering. SERVER ONLY.
//
// Each series (receipts, totes, pallets, vendor numbers) is one row in GoodsInCounter. Numbers are
// taken with a single UPDATE … RETURNING, which Postgres runs one at a time per row, so two clerks
// booking in at the same moment can never be handed the same number — the read-the-highest-and-
// add-one scheme the old prototype used could. Numbers carry on from BC's series (Jack, 2026-10-15);
// an admin sets where each starts on the day BC stops (Goods In → Settings), and until then
// booking in refuses with a plain message rather than guessing a number.
//
// A number that somehow already exists in Goods In (typed in by hand, a series set too low) is
// skipped, never reused.

type Tx = Prisma.TransactionClient

export class NumberingNotSetError extends Error {
  constructor(public key: CounterKey) {
    super(`The ${COUNTERS[key].label.toLowerCase()} numbering hasn't been set up yet — an admin sets the starting number in Goods In → Settings.`)
  }
}

async function exists(tx: Tx, key: CounterKey, n: string): Promise<boolean> {
  if (key === "receipt") return !!(await tx.goodsInReceipt.findUnique({ where: { id: n }, select: { id: true } }))
  if (key === "vendor") return !!(await tx.goodsInCustomer.findUnique({ where: { vendorNo: n }, select: { contactId: true } }))
  return !!(await tx.goodsInContainer.findUnique({ where: { id: n }, select: { id: true } }))
}

/** Take `count` numbers from a series, inside the caller's transaction. Throws NumberingNotSetError if the series isn't set. */
export async function takeNumbers(tx: Tx, key: CounterKey, count = 1): Promise<string[]> {
  const out: string[] = []
  for (let guard = 0; out.length < count && guard < count + 200; guard++) {
    const rows = await tx.$queryRaw<{ prefix: string; next: number; width: number }[]>`
      UPDATE "GoodsInCounter" SET "next" = "next" + 1, "updatedAt" = now()
      WHERE "key" = ${key}
      RETURNING "prefix", "next" - 1 AS "next", "width"`
    const r = rows[0]
    if (!r) throw new NumberingNotSetError(key)
    const n = formatNumber(r.prefix, Number(r.next), Number(r.width))
    if (!(await exists(tx, key, n)) && !out.includes(n)) out.push(n)
  }
  if (out.length < count) throw new Error(`Couldn't find a free ${COUNTERS[key].label.toLowerCase()} number — check the series in Goods In → Settings.`)
  return out
}

export type CounterRow = { key: CounterKey; prefix: string; next: number; width: number; updatedAt: Date | null; updatedBy: string | null; nextNumber: string }

/** Every series as it stands, with the next number it will hand out. Unset series are absent. */
export async function readCounters(): Promise<CounterRow[]> {
  const rows = await prisma.goodsInCounter.findMany()
  return rows
    .filter(r => r.key in COUNTERS)
    .map(r => ({ key: r.key as CounterKey, prefix: r.prefix, next: r.next, width: r.width, updatedAt: r.updatedAt, updatedBy: r.updatedBy, nextNumber: formatNumber(r.prefix, r.next, r.width) }))
}
