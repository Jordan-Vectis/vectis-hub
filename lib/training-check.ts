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
import { bcPersonName } from "@/lib/cataloguer-directory"
import { parseParams, nameMatches, numberMatches, codeMatches, dateMatches, normalise, type ExerciseParams } from "@/lib/training"

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

/** "15 Aug 2026" — the format the panel itself prints sale dates in. */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London",
  })
}

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
      barcode: true, receiptUniqueId: true, receipt: true, vendor: true, tote: true,
      createdByName: true, createdAt: true,
      auction: { select: { code: true, name: true, auctionDate: true } },
    },
  })
}

/**
 * The lot kinds that ask about ONE lot, and what each needs to be present before that lot can
 * be used as an example. Keeping it in one table means a new question type cannot forget to
 * check that its own answer exists — which would set a task with no right answer.
 */
type Lot = Awaited<ReturnType<typeof recentNamedLots>>[number]

const LOT_NEEDS: Record<string, (l: Lot) => boolean> = {
  WHO_CATALOGUED:  l => !!l.createdByName,
  WHEN_CATALOGUED: l => !!l.createdAt,
  LOT_SALE:        l => !!l.auction?.code,
  // ⚠ Needs a sale WITH a date. A Hub lot always has an auction (auctionId is non-nullable),
  // but auctionDate is optional — and the panel prints "No date set yet" for those, which is
  // not something a trainee can be asked to type.
  LOT_SALE_DATE:   l => !!l.auction?.code && !!l.auction?.auctionDate,
  // Needs BOTH: the question is "here is the barcode, what is the unique ID?"
  LOT_UNIQUE_ID:   l => !!l.barcode && !!l.receiptUniqueId,
  LOT_RECEIPT:     l => !!l.receipt,
  LOT_TOTE:        l => !!l.tote,
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
      case "WHEN_CATALOGUED":
      case "LOT_SALE":
      case "LOT_SALE_DATE":
      case "LOT_UNIQUE_ID":
      case "LOT_RECEIPT":
      case "LOT_TOTE": {
        const rows  = await recentNamedLots()
        const needs = LOT_NEEDS[kind] ?? (() => true)
        const usable = rows.filter(needs)
        // ⚠ "Barcode in, unique ID out" must hand out the BARCODE — handing out the unique ID
        // would be asking a question whose answer is already on screen.
        const hit = sample(kind === "LOT_UNIQUE_ID"
          ? usable.filter(r => r.barcode)
          : usable.filter(r => r.barcode || r.receiptUniqueId))
        if (!hit) return null
        const subject = kind === "LOT_UNIQUE_ID"
          ? (hit.barcode ?? "")
          : (hit.barcode || hit.receiptUniqueId || "")
        return subject ? { subject, display: subject } : null
      }

      // Both of these ask about the BUSINESS CENTRAL side, so the example has to be picked from
      // the synced BC cache rather than from Hub lots — a Hub lot with no BC row has neither a
      // location nor a code behind its name.
      case "LOT_LOCATION": {
        const rows = await prisma.warehouseItem.findMany({
          where:   { barcode: { not: null }, location: { not: null } },
          orderBy: { updatedAt: "desc" },
          take:    PICK_POOL,
          select:  { barcode: true },
        })
        const hit = sample(rows.map(r => r.barcode).filter((b): b is string => !!b))
        return hit ? { subject: hit, display: hit } : null
      }

      case "BC_NAME": {
        // Needs SOMETHING recorded against it, or there is no person to name.
        const rows = await prisma.warehouseItem.findMany({
          where: {
            barcode: { not: null },
            OR: [{ cataloguedBy: { not: null } }, { cataloguedByUser: { not: null } }, { bcCreatedBy: { not: null } }],
          },
          orderBy: { updatedAt: "desc" },
          take:    PICK_POOL,
          select:  { barcode: true, cataloguedBy: true, cataloguedByUser: true, bcCreatedBy: true },
        })
        // ⚠ Only pick one the directory can actually resolve to a NAME. Setting a task whose
        // answer is a tidied-up username teaches the trainee that the tidied username is the
        // right answer, which is the opposite of the lesson.
        const usable = rows.filter(r =>
          r.barcode && bcPersonName(r.cataloguedBy, r.cataloguedByUser, r.bcCreatedBy).includes(" "))
        const hit = sample(usable.map(r => r.barcode).filter((b): b is string => !!b))
        return hit ? { subject: hit, display: hit } : null
      }

      case "VENDOR_SALE_COUNT": {
        const rows = await recentNamedLots(PICK_POOL * 5)
        // Only a customer whose lots genuinely span more than one sale — "1" is not a lesson.
        const byVendor = new Map<string, Set<string>>()
        for (const r of rows) {
          if (!r.vendor || !r.auction?.code) continue
          const set = byVendor.get(r.vendor) ?? new Set<string>()
          set.add(r.auction.code)
          byVendor.set(r.vendor, set)
        }
        const min = Math.max(2, params.min ?? 2)
        const hit = sample([...byVendor.entries()].filter(([, s]) => s.size >= min).map(([v]) => v))
        return hit ? { subject: hit, display: hit } : null
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

      case "SALE_TOP":
      case "SALE_COUNT":
      case "SALE_CATALOGUERS": {
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
      createdByName: true, createdAt: true, vendor: true, receipt: true,
      tote: true, barcode: true, receiptUniqueId: true,
      auction: { select: { code: true, name: true, auctionDate: true } },
    },
  })
}

/**
 * The "one lot in, one field out" questions all mark the same way: pull the lot, collect the
 * distinct values of one field, accept any of them.
 *
 * ⚠ ANY of them, not the first. A barcode is sale-scoped and can legitimately appear in more
 * than one sale, so a lot genuinely has more than one right answer — marking the second one
 * wrong would be marking the tool's own behaviour wrong.
 */
async function markLotField(
  subject: string,
  pick: (l: Awaited<ReturnType<typeof lotsFor>>[number]) => string | null | undefined,
  match: (given: string, correct: string) => boolean,
  given: string,
  detailOf?: (l: Awaited<ReturnType<typeof lotsFor>>[number]) => string | undefined,
): Promise<Marked> {
  const lots = await lotsFor(subject)
  const values = [...new Set(
    lots.map(pick).filter((v): v is string => !!v && v !== "null"),
  )]
  if (!values.length) return { correct: false, answer: "—", unavailable: true }
  return {
    correct: values.some(v => match(given, v)),
    answer:  values.join(" or "),
    detail:  detailOf ? detailOf(lots[0]) : undefined,
  }
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
      case "WHO_CATALOGUED":
        return markLotField(subject, l => l.createdByName, nameMatches, said,
          l => (l?.auction?.code ? `Sale ${l.auction.code}` : undefined))

      case "WHEN_CATALOGUED":
        return markLotField(subject, l => l.createdAt?.toISOString(), dateMatches, said,
          l => (l?.createdByName ? `Catalogued by ${l.createdByName}` : undefined))

      case "LOT_UNIQUE_ID":
        return markLotField(subject, l => l.receiptUniqueId, codeMatches, said,
          () => "The unique ID stays with the item for life; the barcode belongs to the sale.")

      case "LOT_RECEIPT":
        return markLotField(subject, l => l.receipt, codeMatches, said)

      case "LOT_TOTE":
        return markLotField(subject, l => l.tote, codeMatches, said)

      case "LOT_LOCATION": {
        const rows = await prisma.warehouseItem.findMany({
          where:  { barcode: { equals: subject, mode: "insensitive" }, location: { not: null } },
          select: { location: true },
          take:   5,
        })
        const places = [...new Set(rows.map(r => r.location).filter((l): l is string => !!l))]
        if (!places.length) return { correct: false, answer: "—", unavailable: true }
        return { correct: places.some(p => codeMatches(said, p)), answer: places.join(" or ") }
      }

      case "BC_NAME": {
        const row = await prisma.warehouseItem.findFirst({
          where:  { barcode: { equals: subject, mode: "insensitive" } },
          select: { cataloguedBy: true, cataloguedByUser: true, bcCreatedBy: true },
        })
        if (!row) return { correct: false, answer: "—", unavailable: true }
        const name = bcPersonName(row.cataloguedBy, row.cataloguedByUser, row.bcCreatedBy)
        if (!name) return { correct: false, answer: "—", unavailable: true }
        // What BC literally stored, so the explanation can show the code they were reading.
        const raw = [row.cataloguedBy, row.cataloguedByUser, row.bcCreatedBy].filter(Boolean).join(" · ")
        return {
          correct: nameMatches(said, name),
          answer:  name,
          detail:  raw ? `Business Central stored: ${raw}` : undefined,
        }
      }

      case "LOT_SALE_DATE": {
        const lots = await lotsFor(subject)
        const dated = lots.filter(l => l.auction?.auctionDate)
        if (!dated.length) return { correct: false, answer: "—", unavailable: true }
        // ⚠ The Hub's auction date, because that is exactly what the panel shows: resolveSale
        // is Hub-first and never falls back to BC's date for a lot the Hub holds.
        const correct = dated.some(l => dateMatches(said, l.auction!.auctionDate!))
        const first = dated[0].auction!
        return {
          correct,
          answer: formatDate(first.auctionDate!),
          detail: [first.code, first.name].filter(Boolean).join(" — ") || undefined,
        }
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

      case "VENDOR_SALE_COUNT": {
        const rows = await prisma.catalogueLot.findMany({
          where:  { vendor: subject },
          select: { auction: { select: { code: true } } },
          take:   PICK_POOL * 10,
        })
        const codes = [...new Set(rows.map(r => r.auction?.code).filter((c): c is string => !!c))]
        if (!codes.length) return { correct: false, answer: "0", unavailable: true }
        return {
          correct: numberMatches(said, codes.length),
          answer:  String(codes.length),
          detail:  codes.slice(0, 8).join(", ") + (codes.length > 8 ? "…" : ""),
        }
      }

      case "SALE_COUNT": {
        const sale = await prisma.catalogueAuction.findFirst({
          where:  { code: { equals: subject, mode: "insensitive" } },
          select: { name: true, _count: { select: { lots: true } } },
        })
        if (!sale) return { correct: false, answer: "—", unavailable: true }
        const n = sale._count.lots
        return { correct: numberMatches(said, n), answer: String(n), detail: sale.name || undefined }
      }

      case "SALE_CATALOGUERS": {
        const sale = await prisma.catalogueAuction.findFirst({
          where:  { code: { equals: subject, mode: "insensitive" } },
          select: { id: true },
        })
        if (!sale) return { correct: false, answer: "—", unavailable: true }
        const grouped = await prisma.catalogueLot.groupBy({
          by:     ["createdByName"],
          where:  { auctionId: sale.id, createdByName: { not: null } },
          _count: { _all: true },
        })
        const names = grouped.map(g => g.createdByName).filter((n): n is string => !!n && n !== "null")
        if (!names.length) return { correct: false, answer: "0", unavailable: true }
        return {
          correct: numberMatches(said, names.length),
          answer:  String(names.length),
          detail:  names.slice(0, 8).join(", ") + (names.length > 8 ? "…" : ""),
        }
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
