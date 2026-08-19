// Training → practice: choosing a real example, and marking the answer against live data.
//
// ⚠ The reason this file exists at all. A training task with a barcode typed into it is wrong
// the day that lot is deleted or that sale is archived — which is exactly how the induction
// PowerPoint rotted, and why the deck was moved into the DB. So a lookup task stores no
// answer: the server picks a lot that exists RIGHT NOW, and works the answer out from the same
// tables the Admin Centre reads. The task and its answer therefore cannot disagree.
//
// Server-only (imports prisma). Never import from a "use client" file.

import { prisma } from "@/lib/prisma"
import { parseParams, nameMatches, numberMatches, codeMatches, normalise, type ExerciseParams } from "@/lib/training"

export type Materialised = {
  /** What the task is about — a barcode, a receipt number, a sale code. */
  subject: string
  /** Filled into {{q}} in the brief. Same as subject; separate so a future kind can differ. */
  display: string
}

export type Marked = {
  correct: boolean
  /** The right answer, shown once they have had a go. */
  answer: string
  /** Extra context the panel itself shows — "F090 — Diecast Sale · 15 Aug 2026". */
  detail?: string
  /** Set when the task could not be marked at all, e.g. the lot was deleted mid-attempt. */
  unavailable?: boolean
}

// Deliberately small. This runs on a page load, and picking a random row out of a table with
// hundreds of thousands of lots by ordering randomly would be a sequential scan every time.
const PICK_POOL = 200

/** Random member of an array, or null. Kept in one place so the pick is obviously uniform. */
function sample<T>(rows: T[]): T | null {
  if (!rows.length) return null
  return rows[Math.floor(Math.random() * rows.length)]
}

/**
 * Recent lots that are actually usable as a training example: they must have a cataloguer
 * name and an identifier, or the task has no answer to mark against.
 *
 * ⚠ `createdByName` is the Hub's own record of who typed the lot. It is NOT Business Central's
 * cataloguedBy, which is the bulk-import stamp — see RULES.md and the lesson slide that makes
 * the same point.
 */
async function recentNamedLots(take = PICK_POOL) {
  return prisma.catalogueLot.findMany({
    where: {
      createdByName: { not: null },
      OR: [{ barcode: { not: null } }, { receiptUniqueId: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      barcode: true, receiptUniqueId: true, receipt: true, vendor: true,
      createdByName: true,
      auction: { select: { code: true, name: true, auctionDate: true } },
    },
  })
}

/**
 * Choose what this attempt asks about. Returns null when the environment simply has no data
 * that fits — staging is thin, and an exercise that quietly asks about nothing is worse than
 * one that says it cannot run (RULES.md: never let "nothing happened" look like success).
 */
export async function pickSubject(kind: string, rawParams: unknown): Promise<Materialised | null> {
  const params = parseParams(rawParams)
  if (params.mode === "FIXED" && params.q) return { subject: params.q, display: params.q }

  try {
    switch (kind) {
      case "WHO_CATALOGUED":
      case "LOT_SALE": {
        const rows = await recentNamedLots()
        // LOT_SALE needs the lot to actually be in a sale with a code, or there is no answer.
        const usable = kind === "LOT_SALE" ? rows.filter(r => r.auction?.code) : rows
        const hit = sample(usable.filter(r => r.barcode || r.receiptUniqueId))
        if (!hit) return null
        const subject = hit.barcode || hit.receiptUniqueId || ""
        return subject ? { subject, display: subject } : null
      }

      case "LOT_COUNT":
      case "LOT_VENDOR": {
        const field = params.type ?? "receipt"
        const min   = kind === "LOT_COUNT" ? Math.max(1, params.min ?? 2) : 1
        const rows = await prisma.catalogueLot.findMany({
          orderBy: { createdAt: "desc" },
          take:    PICK_POOL * 5,
          select:  { receipt: true, tote: true, vendor: true },
        })
        // ⚠ Grouped in JS over a BOUNDED recent window rather than a GROUP BY over the whole
        // table: this runs on every practice page load, and there are hundreds of thousands of
        // lots. A receipt seen `min` times inside the window certainly has at least `min`
        // overall, which is all the pick needs — the ANSWER is counted properly at marking
        // time, against the full table.
        const tally = new Map<string, number>()
        for (const r of rows) {
          const v = (field === "tote" ? r.tote : field === "vendor" ? r.vendor : r.receipt) ?? ""
          if (v) tally.set(v, (tally.get(v) ?? 0) + 1)
        }
        const hit = sample([...tally.entries()].filter(([, n]) => n >= min).map(([value]) => value))
        return hit ? { subject: hit, display: hit } : null
      }

      case "SALE_TOP": {
        const min = Math.max(2, params.min ?? 2)
        const sales = await prisma.catalogueAuction.findMany({
          where:   { code: { not: "" } },
          orderBy: { createdAt: "desc" },
          take:    PICK_POOL,
          select:  { code: true, _count: { select: { lots: true } } },
        })
        const hit = sample(sales.filter(s => s.code && s._count.lots >= min))
        return hit ? { subject: hit.code, display: hit.code } : null
      }

      default:
        return null
    }
  } catch {
    // The tables arrive after the deploy that reads them. An empty practice pane with an
    // honest message beats a 500 in front of someone being trained.
    return null
  }
}

/** The lots behind a barcode / unique ID, newest first. Both identifier fields, per RULES.md. */
async function lotsFor(subject: string) {
  const ci = { equals: subject, mode: "insensitive" as const }
  return prisma.catalogueLot.findMany({
    where:   { OR: [{ barcode: ci }, { receiptUniqueId: ci }] },
    orderBy: { createdAt: "desc" },
    take:    5,
    select: {
      createdByName: true, vendor: true, receipt: true,
      auction: { select: { code: true, name: true } },
    },
  })
}

/**
 * Mark one answer. `given` is whatever the trainee typed; `subject` is what pickSubject chose
 * on the way in, sent back with the answer so the marking is against the SAME lot they were
 * looking at rather than a freshly picked one.
 */
export async function markAnswer(
  kind: string, subject: string, rawParams: unknown, given: string,
): Promise<Marked> {
  const params: ExerciseParams = parseParams(rawParams)
  const said = given.trim()

  if (kind === "CHOICE") {
    const idx = Number(said)
    const correctIdx = params.correct ?? -1
    const options = params.options ?? []
    return {
      correct: Number.isInteger(idx) && idx === correctIdx,
      answer:  options[correctIdx] ?? "—",
    }
  }

  if (kind === "FREE_TEXT") {
    const expected = String(params.q ?? "")
    return { correct: !!expected && normalise(said) === normalise(expected), answer: expected || "—" }
  }

  try {
    switch (kind) {
      case "WHO_CATALOGUED": {
        const lots = await lotsFor(subject)
        const names = [...new Set(lots.map(l => l.createdByName).filter((n): n is string => !!n && n !== "null"))]
        if (!names.length) return { correct: false, answer: "—", unavailable: true }
        // ⚠ A barcode is sale-scoped and can legitimately appear in more than one sale, so
        // ANY of the cataloguers who entered it is a right answer. Marking the second one
        // wrong would be marking the tool's own behaviour wrong.
        const correct = names.some(n => nameMatches(said, n))
        return { correct, answer: names.join(" or "), detail: lots[0]?.auction?.code ? `Sale ${lots[0].auction.code}` : undefined }
      }

      case "LOT_SALE": {
        const lots = await lotsFor(subject)
        const codes = [...new Set(lots.map(l => l.auction?.code).filter((c): c is string => !!c))]
        if (!codes.length) return { correct: false, answer: "—", unavailable: true }
        const correct = codes.some(c => codeMatches(said, c))
        const first = lots.find(l => l.auction?.code)
        return {
          correct,
          answer: codes.join(" or "),
          detail: first?.auction?.name ? `${first.auction.code} — ${first.auction.name}` : undefined,
        }
      }

      case "LOT_COUNT": {
        const field = params.type ?? "receipt"
        const where = field === "tote" ? { tote: subject } : field === "vendor" ? { vendor: subject } : { receipt: subject }
        const count = await prisma.catalogueLot.count({ where })
        if (!count) return { correct: false, answer: "0", unavailable: true }
        return { correct: numberMatches(said, count), answer: String(count), detail: `${count} lot${count === 1 ? "" : "s"} in the Hub` }
      }

      case "LOT_VENDOR": {
        const rows = await prisma.catalogueLot.findMany({
          where:  { receipt: subject, vendor: { not: null } },
          select: { vendor: true },
          take:   PICK_POOL,
        })
        const vendors = [...new Set(rows.map(r => r.vendor).filter((v): v is string => !!v))]
        if (!vendors.length) return { correct: false, answer: "—", unavailable: true }
        const correct = vendors.some(v => codeMatches(said, v))
        return { correct, answer: vendors.join(" or ") }
      }

      case "SALE_TOP": {
        const sale = await prisma.catalogueAuction.findFirst({
          where:  { code: { equals: subject, mode: "insensitive" } },
          select: { id: true, name: true },
        })
        if (!sale) return { correct: false, answer: "—", unavailable: true }
        const grouped = await prisma.catalogueLot.groupBy({
          by:      ["createdByName"],
          where:   { auctionId: sale.id, createdByName: { not: null } },
          _count:  { _all: true },
          orderBy: { _count: { createdByName: "desc" } },
          take:    20,
        })
        const clean = grouped.filter(g => g.createdByName && g.createdByName !== "null")
        if (!clean.length) return { correct: false, answer: "—", unavailable: true }
        const top = clean[0]
        // A genuine tie has more than one right answer, and marking the second one wrong is
        // marking the data, not the trainee.
        const tied = clean.filter(g => g._count._all === top._count._all)
        const correct = tied.some(g => nameMatches(said, g.createdByName!))
        return {
          correct,
          answer: tied.map(g => g.createdByName).join(" or "),
          detail: `${top._count._all} lot${top._count._all === 1 ? "" : "s"} in ${subject}`,
        }
      }

      default:
        return { correct: false, answer: "—", unavailable: true }
    }
  } catch {
    return { correct: false, answer: "—", unavailable: true }
  }
}
