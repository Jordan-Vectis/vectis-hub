import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { isMissingTable } from "@/lib/prisma-errors"
import { SALE_RE, type LabelRun, type LabelRunRow, type LabelSale } from "@/lib/barcode-labels"

// Server half of Admin & Operations → Barcode Labels (lib/barcode-labels.ts holds the rules): who may
// print, the sales to pick from, and the log of what has been made (BarcodeLabelRun) — so the next run
// for a sale carries on from the last number, and a run that would print numbers already made says so.

/** Who is asking, checked fresh from the database, and whether they hold the app. */
export async function requireBarcodes(): Promise<{ userId: string; name: string }> {
  const session = await getEffectiveSession()
  if (!session) throw Object.assign(new Error("You're not signed in — sign in to the Hub and try again."), { http: 401 })
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "BARCODES")) throw Object.assign(new Error("Your account doesn't have Barcode Labels."), { http: 403 })
  return { userId: session.user.id, name: u?.name || u?.email || "Unknown" }
}

/** YYYY-MM-DD, `days` from today (UTC is fine for a window this wide). */
const dayFrom = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/**
 * The sales to pick from: dated from four months ago to a year ahead — from the BC copy (every sale BC
 * has lots allocated to, upcoming ones included — the same rows as Databases → BC Database) and the
 * Hub's own sales (a new one may have no lots in BC yet). One per code, soonest first. Placeholder
 * sales (dated 2099 on) fall outside the window. A sale on neither can still be typed in.
 */
export async function salesForLabels(): Promise<LabelSale[]> {
  const from = dayFrom(-120), to = dayFrom(366)
  const [bc, hub] = await Promise.all([
    prisma.$queryRaw<{ code: string; name: string | null; date: string; lots: number }[]>`
      SELECT w."auctionCode" AS "code", max(w."auctionName") AS "name", min(w."auctionDate") AS "date", count(*)::int AS "lots"
      FROM "WarehouseItem" w
      WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" >= ${from} AND w."auctionDate" <= ${to}
      GROUP BY w."auctionCode"`.catch((e) => { if (isMissingTable(e)) return []; throw e }),
    prisma.catalogueAuction.findMany({
      where: { auctionDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T23:59:59Z`) } },
      select: { code: true, name: true, auctionDate: true },
    }),
  ])
  const byCode = new Map<string, LabelSale>()
  for (const r of bc) {
    const code = r.code.trim().toUpperCase(), date = String(r.date).slice(0, 10)
    if (SALE_RE.test(code) && /^\d{4}-\d{2}-\d{2}$/.test(date)) byCode.set(code, { code, name: (r.name ?? "").trim(), date, lots: Number(r.lots) || 0 })
  }
  for (const a of hub) {
    const code = a.code.trim().toUpperCase()
    if (!SALE_RE.test(code) || !a.auctionDate || byCode.has(code)) continue
    byCode.set(code, { code, name: a.name.trim(), date: a.auctionDate.toISOString().slice(0, 10), lots: 0 })
  }
  return [...byCode.values()].sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
}

const toRow = (r: { id: string; saleCode: string; saleDate: string | null; fromNo: number; toNo: number; count: number; startAt: number; madeByName: string; madeAt: Date }): LabelRunRow => ({
  id: r.id, sale: r.saleCode, date: r.saleDate, from: r.fromNo, to: r.toNo, count: r.count, startAt: r.startAt, byName: r.madeByName, at: r.madeAt.toISOString(),
})

/** The label runs made, newest first — for the page's list, the "carry on from" number and the "printed
 *  before" warning, so it's years of them (a sale is a run or three; the rows are tiny). `ready` false
 *  until Run Migrations (the labels still print; they just aren't remembered). */
export async function recentLabelRuns(take = 2000): Promise<{ ready: boolean; runs: LabelRunRow[] }> {
  try {
    const rows = await prisma.barcodeLabelRun.findMany({ orderBy: { madeAt: "desc" }, take })
    return { ready: true, runs: rows.map(toRow) }
  } catch (e) {
    if (isMissingTable(e)) return { ready: false, runs: [] }
    throw e
  }
}

/** Remembers a run that was made. Best effort: the PDF is what matters, so a log that can't be written
 *  (not migrated yet, or the database busy) never stops the labels — it's reported, not thrown. */
export async function logLabelRun(run: LabelRun, who: { userId: string; name: string }): Promise<boolean> {
  try {
    await prisma.barcodeLabelRun.create({
      data: {
        saleCode: run.sale, saleDate: run.date || null, fromNo: run.from, toNo: run.from + run.count - 1, count: run.count,
        startAt: run.startAt, madeById: who.userId, madeByName: who.name,
      },
    })
    return true
  } catch (e) {
    if (!isMissingTable(e)) console.error("barcode labels log error:", e)
    return false
  }
}
