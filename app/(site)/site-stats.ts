import { prisma } from "@/lib/prisma"

// The figures on the home page's stats band — counted from what the Hub holds, never typed in.
// The band shipped with template numbers (500k+ lots, 180+ countries); Jordan asked for the same
// four stats with the real figures (2026-09-24). A figure that isn't counted yet comes back null
// and the page shows "—" for it — never a made-up number.
//
// Counted once and kept for six hours in this process: the lot count reads two large tables
// (ArchiveLot is ~956k rows — the partial index ArchiveLot_sold_idx is what makes counting its
// sold rows cheap), which is not a per-visit query. A stale copy is served while a fresh one is
// counted behind it; only the first visit after a start waits, and never past the timeout.
export type SiteStats = {
  /** Years since Vectis was founded (1988, Isle of Wight). */
  years: number
  /** Lots with a hammer price, pre-BC (ArchiveLot) and BC (WarehouseItem) together; null when it couldn't be counted. */
  lotsSold: number | null
  /** Sales in the last 365 days, from the collected sale list (ArchiveSale). */
  auctionsLastYear: number | null
  /** Department pages collected from the website. */
  departments: number | null
}

const FOUNDED = 1988
const KEEP_MS = 6 * 60 * 60 * 1000       // a good count lasts six hours
const RETRY_MS = 5 * 60 * 1000           // a count that failed is tried again after five minutes
const TIMEOUT_MS = 8000                  // no visitor waits past this (only the first after a start waits at all)

let cached: { at: number; ttl: number; stats: SiteStats } | null = null
let counting: Promise<SiteStats> | null = null

export async function getSiteStats(): Promise<SiteStats> {
  const fresh = cached && Date.now() - cached.at < cached.ttl
  if (cached && fresh) return cached.stats
  if (!counting) counting = count().finally(() => { counting = null })
  // Stale but present: hand it over now and let the recount finish behind the page.
  if (cached) { counting.catch(() => {}); return cached.stats }
  return counting
}

// One statement under its own timeout; null if it would not come, so one slow table never
// takes the others (or the page) with it.
async function timed<T>(run: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T | null> {
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = ${TIMEOUT_MS}`
      return run(tx)
    })
  } catch {
    return null
  }
}

async function count(): Promise<SiteStats> {
  const [lots, sales, depts] = await Promise.all([
    // ⚠ The ArchiveLot predicate is written exactly as ArchiveLot_sold_idx's, so the planner can count from the index.
    timed(tx => tx.$queryRaw<{ n: bigint }[]>`
      SELECT (SELECT count(*) FROM "ArchiveLot" WHERE "hammerPrice" > 0 OR "siteHammerPrice" > 0)
           + (SELECT count(*) FROM "WarehouseItem" WHERE "hammerPrice" > 0) AS n`),
    timed(tx => tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "ArchiveSale" WHERE "saleDate" > now() - interval '365 days' AND "saleDate" <= now()`),
    timed(tx => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SiteDepartment"`),
  ])
  const num = (r: { n: bigint }[] | null) => { const n = r ? Number(r[0]?.n ?? 0) : 0; return n > 0 ? n : null }
  const stats: SiteStats = {
    years: new Date().getFullYear() - FOUNDED,
    lotsSold: num(lots),
    auctionsLastYear: num(sales),
    departments: num(depts),
  }
  const allCounted = stats.lotsSold != null && stats.auctionsLastYear != null && stats.departments != null
  cached = { at: Date.now(), ttl: allCounted ? KEEP_MS : RETRY_MS, stats }
  return stats
}
