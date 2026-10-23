"use server"

import { revalidatePath } from "next/cache"
import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getAccountsAccess } from "@/lib/accounts-auth"
import { getBCToken } from "@/lib/bc"
import { bcLotsForBuyer, salesOf, startUncollectedSync, stopUncollectedSync, uncollectedSyncNow } from "@/lib/uncollected-feed"
import {
  AGE_BANDS, BANK_DETAILS_REFUSED, BC_OWNED_FIELDS, CLOSED_STATUSES, FIELD_LABELS, OPEN_STATUSES, REACHED_OUT_KINDS,
  STATUS_META, UNCOLLECTED_ADMINS_ONLY, UNCOLLECTED_BC_NOT_CONNECTED, UNCOLLECTED_LIMITS, UNCOLLECTED_NOT_READY,
  UNCOLLECTED_RUN_STALE_MINUTES, UNCOLLECTED_STATUSES, UNCOLLECTED_SYNC_NOT_READY,
  ageBandFor, chaseState, dayToStored, daysWaiting, eventKindOf, formatDay, formatMoney, isAgeBandKey, isContactKind,
  isDay, isOpenRaw, isUncollectedSort, isUncollectedStatus, londonDay, looksLikeBankDetails, sentence, statusOf,
  type AgeBandKey, type ContactKind, type LogContactInput, type UncollectedBcLots,
  type UncollectedCase, type UncollectedCaseDetail, type UncollectedCheckState,
  type UncollectedField, type UncollectedFilter, type UncollectedInput, type UncollectedLastContact, type UncollectedList,
  type UncollectedPatch, type UncollectedResult, type UncollectedSort, type UncollectedStatus, type UncollectedSyncRunInfo,
  type UncollectedTotals,
} from "@/lib/uncollected"

// Accounts → Paid, not collected — every read and write. SERVER ONLY.
//
//  • ADMINS ONLY, like Accounts → Reserves: every action re-checks with getAccountsAccess() and
//    refuses anyone who isn't an admin, whatever the page showed them.
//  • Each action RETURNS { ok, error } (UncollectedResult) — a thrown server-action error is
//    redacted in production (RULES.md). Missing tables → { ok: false, notReady: true,
//    error: UNCOLLECTED_NOT_READY } until Run Migrations.
//  • Every write records who did it (byId/byName from the session) on the case's timeline
//    (UncollectedPaidEvent) and revalidates the whole Accounts section.
//  • Cases are added by hand here, or by the BC check (lib/uncollected-feed.ts → syncUncollected:
//    nightly from server.js, or "Check BC now" — checkBcNow below), which writes source "bc" rows
//    keyed by bcKey; the fields BC owns (BC_OWNED_FIELDS) can't be changed here on such a row, and a
//    BC row can't be deleted.
//  • ⚠ Business Central is READ ONLY. Only two things here go near it, both through the feed and
//    with the person's OWN BC sign-in (getBCToken): checkBcNow (starts the read-only check) and
//    bcLotsForCase (reads a buyer's lots in a sale for the case page). Nothing is written to BC.
//    ⚠ Customer personal data — never bank or card details (looksLikeBankDetails refuses the
//    obvious shapes in every box: names, numbers, notes, timeline text; the phone box takes at most
//    15 digits).
//  • One OPEN case per invoice, held under an advisory lock on the invoice (lockInvoice) by every
//    write that could break it: createCase, updateCase (a new invoice number), setStatus (reopening).

type Who = { id: string; name: string }

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {
  constructor(message: string, readonly existingId?: string) { super(message) }
}

const NOT_FOUND = "That case couldn't be found — it may have been deleted. Go back to the list."
const CHANGED_MEANWHILE = "Someone else changed this case a moment ago — open it again to see where it stands."

async function requireAdmin(): Promise<Who> {
  const { session, isAdmin } = await getAccountsAccess()
  if (!session || !isAdmin) throw new Refusal(UNCOLLECTED_ADMINS_ONLY)
  return { id: session.user.id, name: session.user.name || session.user.email || "Unknown" }
}

/** One of OUR two tables isn't there yet — never any other fault, which must still be seen. */
function isMissingUncollected(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null
  if (err?.code === "P2021" || err?.code === "42P01" || err?.meta?.code === "42P01") return true
  return /Uncollected(Paid|PaidEvent|SyncRun)\W{0,3}\s*does not exist/i.test(`${err?.message ?? ""} ${err?.meta?.message ?? ""}`)
}

type Failure = Extract<UncollectedResult, { ok: false }>

function fail(e: unknown, what: string, fallback: string): Failure {
  if (e instanceof Refusal) return e.existingId ? { ok: false, error: e.message, existingId: e.existingId } : { ok: false, error: e.message }
  if (isMissingUncollected(e)) return { ok: false, error: UNCOLLECTED_NOT_READY, notReady: true }
  if ((e as { code?: string } | null)?.code === "P2025") return { ok: false, error: NOT_FOUND }
  console.error(`uncollected ${what} error:`, e)
  return { ok: false, error: fallback }
}

const SAVE_FAILED = "Something went wrong and nothing was saved — please try again."
const READ_FAILED = "The cases couldn't be read just now — please try again."

const revalidate = () => revalidatePath("/tools/accounts", "layout")

// ─── Reading what was sent ──────────────────────────────────────────────────────────────────

const label = (f: UncollectedField) => FIELD_LABELS[f]
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** One line of text: trimmed, control characters and line breaks turned to spaces; "" → null.
 *  Refuses anything that looks like bank or card details (every box, not just the notes) — except
 *  the phone box, which has its own rule (a long international number can pass the card check). */
function line(v: unknown, f: UncollectedField, max: number, guard = true): string | null {
  if (v == null) return null
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
  if (!s) return null
  if (s.length > max) throw new Refusal(`${capital(label(f))} is too long — ${max} characters at most.`)
  if (guard && looksLikeBankDetails(s)) throw new Refusal(BANK_DETAILS_REFUSED)
  return s
}

/** Several lines (notes, the timeline): trimmed, Windows line ends tidied, tabs to spaces; "" → null.
 *  Refuses anything that looks like bank or card details. */
function prose(v: unknown, what: string, max: number): string | null {
  if (v == null) return null
  const s = String(v).replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim()
  if (!s) return null
  if (s.length > max) throw new Refusal(`${capital(what)} is too long — ${max.toLocaleString("en-GB")} characters at most.`)
  if (looksLikeBankDetails(s)) throw new Refusal(BANK_DETAILS_REFUSED)
  return s
}

function email(v: unknown): string | null {
  const s = line(v, "email", UNCOLLECTED_LIMITS.email)
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Refusal("That email address doesn't look right — check it and try again.")
  return s
}

/** No phone number anywhere has more than 15 digits (the international maximum), so a card number
 *  (16+) can't be kept here. The card check isn't used: some real international numbers pass it. */
const PHONE_MAX_DIGITS = 15

function phone(v: unknown): string | null {
  const s = line(v, "phone", UNCOLLECTED_LIMITS.phone, false)
  if (!s) return s
  const digits = (s.match(/\d/g) ?? []).length
  if (!/^[0-9+()\-./ ]+$/.test(s) || digits < 5) {
    throw new Refusal("That phone number doesn't look right — digits, spaces and + ( ) - only.")
  }
  if (digits > PHONE_MAX_DIGITS) {
    throw new Refusal(`That phone number has too many digits — ${PHONE_MAX_DIGITS} at most. Never put card details here.`)
  }
  return s
}

function lotsOf(v: unknown): number | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""))
  if (!Number.isInteger(n) || n < 1 || n > UNCOLLECTED_LIMITS.lots) throw new Refusal("Number of lots: a whole number, for example 3.")
  return n
}

function moneyOf(v: unknown): number | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null
  const n = typeof v === "number" ? v : Number(String(v).replace(/[£,\s]/g, ""))
  if (!Number.isFinite(n) || n < 0 || n > UNCOLLECTED_LIMITS.amountPaid) throw new Refusal("Amount paid: pounds and pence, for example 125.50.")
  return Math.round(n * 100) / 100
}

/** A date box's YYYY-MM-DD → the stored value (12:00 UTC that London day); "" → null. */
function dayOf(v: unknown, f: UncollectedField, today: string): Date | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null
  const s = String(v).trim()
  if (!isDay(s)) throw new Refusal(`${capital(label(f))}: pick a date from the calendar.`)
  if (f === "paidAt" && s > today) throw new Refusal("Paid on can't be in the future.")
  return dayToStored(s)
}

type Parsed = {
  buyerName?: string
  buyerNo?: string | null
  email?: string | null
  phone?: string | null
  saleCode?: string | null
  invoiceNo?: string | null
  lots?: number | null
  amountPaid?: number | null
  paidAt?: Date | null
  nextChaseAt?: Date | null
  storageFrom?: Date | null
  notes?: string | null
}

/** Reads every field that was SENT (undefined = not sent, left alone). */
function parseFields(input: UncollectedPatch, today: string): Parsed {
  const out: Parsed = {}
  const sent = (f: UncollectedField) => Object.prototype.hasOwnProperty.call(input, f) && input[f] !== undefined
  if (sent("buyerName")) {
    const n = line(input.buyerName, "buyerName", UNCOLLECTED_LIMITS.buyerName)
    if (!n) throw new Refusal("Type the buyer's name.")
    out.buyerName = n
  }
  if (sent("buyerNo")) out.buyerNo = line(input.buyerNo, "buyerNo", UNCOLLECTED_LIMITS.buyerNo)
  if (sent("email")) out.email = email(input.email)
  if (sent("phone")) out.phone = phone(input.phone)
  if (sent("saleCode")) out.saleCode = line(input.saleCode, "saleCode", UNCOLLECTED_LIMITS.saleCode)
  if (sent("invoiceNo")) out.invoiceNo = line(input.invoiceNo, "invoiceNo", UNCOLLECTED_LIMITS.invoiceNo)
  if (sent("lots")) out.lots = lotsOf(input.lots)
  if (sent("amountPaid")) out.amountPaid = moneyOf(input.amountPaid)
  if (sent("paidAt")) out.paidAt = dayOf(input.paidAt, "paidAt", today)
  if (sent("nextChaseAt")) out.nextChaseAt = dayOf(input.nextChaseAt, "nextChaseAt", today)
  if (sent("storageFrom")) out.storageFrom = dayOf(input.storageFrom, "storageFrom", today)
  if (sent("notes")) out.notes = prose(input.notes, "the notes", UNCOLLECTED_LIMITS.notes)
  return out
}

const DATE_FIELDS: UncollectedField[] = ["paidAt", "nextChaseAt", "storageFrom"]

/** Two values of one field are the same (dates by their London day). */
function same(f: UncollectedField, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  if (DATE_FIELDS.includes(f)) return londonDay(a as Date) === londonDay(b as Date)
  return a === b
}

/** How a change reads on the timeline. Dates and amounts say the new value; contact details and
 *  notes don't (the timeline mustn't keep an old phone number after it has been changed). */
function changePhrase(f: UncollectedField, v: unknown): string {
  if (DATE_FIELDS.includes(f)) return v ? `${label(f)} to ${formatDay(v as Date)}` : `${label(f)} cleared`
  if (f === "lots") return v == null ? "number of lots cleared" : `number of lots to ${v}`
  if (f === "amountPaid") return v == null ? "amount paid cleared" : `amount paid to ${formatMoney(v as number)}`
  return label(f)
}

/** The Hub's Customers record for a buyer number, when there is one. Tolerant: a missing table or
 *  a blip leaves the case unlinked rather than failing the save. Reads the Hub's own copy only. */
async function matchCustomer(buyerNo: string | null | undefined): Promise<string | null> {
  if (!buyerNo) return null
  try {
    const exact = await prisma.customer.findUnique({ where: { buyerNo }, select: { id: true } })
    if (exact) return exact.id
    const upper = buyerNo.toUpperCase()
    if (upper === buyerNo) return null
    return (await prisma.customer.findUnique({ where: { buyerNo: upper }, select: { id: true } }))?.id ?? null
  } catch (e) {
    if (!/does not exist|P2021|P2022/i.test(`${(e as { message?: string })?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`)) {
      console.error("uncollected customer match error:", e)
    }
    return null
  }
}

// ─── One open case per invoice ──────────────────────────────────────────────────────────────
// A second open case for the same invoice would be chased twice, and the future BC feed adopts THE
// open manual case for an invoice (RULES.md). So every write that can leave two open cases on one
// invoice — adding a case, changing an open case's invoice number, reopening a closed one — takes a
// transaction-scoped advisory lock on the invoice (lower case) FIRST, then checks, then writes, all
// in one transaction. Two people doing it at once queue on the lock; the second sees the first's
// case and is refused. ⚠ Always the advisory lock before any row lock (updateCase takes the row
// with FOR UPDATE after it), so these writes can never deadlock each other.

async function lockInvoice(tx: Prisma.TransactionClient, invoiceNo: string): Promise<void> {
  // $executeRaw: the lock returns void, which $queryRaw can't read (RULES.md, Goods In).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('uncollected-invoice:' || lower(${invoiceNo}::text)))`
}

/** The OPEN case (anything but collected / closed) already holding this invoice, other than `exceptId`. */
async function openCaseForInvoice(
  tx: Prisma.TransactionClient,
  invoiceNo: string,
  exceptId?: string,
): Promise<{ id: string; buyerName: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; buyerName: string }[]>`
    SELECT u."id", u."buyerName" FROM "UncollectedPaid" u
    WHERE lower(u."invoiceNo") = lower(${invoiceNo}::text)
      AND u."status" NOT IN (${Prisma.join(CLOSED_STATUSES)})
      ${exceptId ? Prisma.sql`AND u."id" <> ${exceptId}` : Prisma.empty}
    ORDER BY u."createdAt" ASC
    LIMIT 1`
  return rows[0] ?? null
}

// ─── Shaping rows for the screens ───────────────────────────────────────────────────────────

type CaseRow = {
  id: string; source: string; bcKey: string | null; buyerNo: string | null; customerId: string | null
  buyerName: string; email: string | null; phone: string | null; saleCode: string | null; invoiceNo: string | null
  lots: number | null; amountPaid: number | null; paidAt: Date | null; status: string; nextChaseAt: Date | null
  storageFrom: Date | null; notes: string | null; createdByName: string | null; createdAt: Date; updatedAt: Date
  closedAt: Date | null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

function toCase(r: CaseRow, last: UncollectedLastContact | null, today: string): UncollectedCase {
  const status = statusOf(r.status)
  const days = daysWaiting(r.paidAt, r.closedAt, today)
  return {
    id: r.id,
    source: r.source === "bc" ? "bc" : "manual",
    bcKey: r.bcKey,
    buyerNo: r.buyerNo,
    customerId: r.customerId,
    buyerName: r.buyerName,
    email: r.email,
    phone: r.phone,
    saleCode: r.saleCode,
    invoiceNo: r.invoiceNo,
    lots: r.lots,
    amountPaid: r.amountPaid,
    paidAt: iso(r.paidAt),
    status,
    nextChaseAt: iso(r.nextChaseAt),
    storageFrom: iso(r.storageFrom),
    notes: r.notes,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    closedAt: iso(r.closedAt),
    daysWaiting: days,
    ageBand: ageBandFor(days)?.key ?? null,
    chase: chaseState(r.nextChaseAt, status, today),
    lastContact: last,
  }
}

function lastContactOf(e: { kind: string; at: Date; text: string | null; byName: string | null } | undefined): UncollectedLastContact | null {
  if (!e || !isContactKind(e.kind)) return null
  return { kind: e.kind, at: e.at.toISOString(), text: e.text, byName: e.byName }
}

// ─── The list ───────────────────────────────────────────────────────────────────────────────

/** A London calendar date of one of the case's timestamp(3) (UTC) columns — BST-safe. */
const londonDateOf = (col: "paidAt" | "closedAt" | "nextChaseAt") =>
  Prisma.raw(`((u."${col}" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::date`)

/** ⚠ The same rule as daysWaiting() in lib/uncollected.ts: London days from the day they paid to
 *  today, or to the day the case closed; never negative; NULL with no paid date. */
const daysSql = (today: string) => Prisma.sql`CASE WHEN u."paidAt" IS NULL THEN NULL
  ELSE GREATEST(0, COALESCE(${londonDateOf("closedAt")}, ${today}::date) - ${londonDateOf("paidAt")}) END`

/** The age band of c."days", built from AGE_BANDS so the bands live in one place. */
const bandSql = Prisma.sql`CASE WHEN c."days" IS NULL THEN 'none' ${Prisma.join(
  AGE_BANDS.map((b) => b.max == null
    ? Prisma.sql`WHEN c."days" >= ${b.min}::int THEN ${b.key}::text`
    : Prisma.sql`WHEN c."days" BETWEEN ${b.min}::int AND ${b.max}::int THEN ${b.key}::text`),
  " ",
)} END`

/** ⚠ Fixed strings only — they are put into the SQL as written. The id at the end keeps the
 *  order stable between two reads. */
const ORDER_BY: Record<UncollectedSort, string> = {
  waiting: `b."days" DESC NULLS LAST, b."createdAt" ASC, b."id" ASC`,
  recent: `b."paidAt" DESC NULLS LAST, b."createdAt" DESC, b."id" ASC`,
  chase: `b."nextChaseAt" ASC NULLS LAST, b."days" DESC NULLS LAST, b."id" ASC`,
  amount: `b."amountPaid" DESC NULLS LAST, b."days" DESC NULLS LAST, b."id" ASC`,
  name: `lower(b."buyerName") ASC, b."createdAt" ASC, b."id" ASC`,
  added: `b."createdAt" DESC, b."id" ASC`,
}

const likeWord = (w: string) => `%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`

/**
 * The panel's list: up to 500 cases matching the filter, the counts beside each status and age
 * band, and the totals for the tiles (over every open case, whatever the filters).
 */
export async function listCases(filter: UncollectedFilter = {}): Promise<UncollectedResult<UncollectedList>> {
  try {
    await requireAdmin()
    const today = londonDay()

    const statuses = (Array.isArray(filter.statuses) ? filter.statuses : []).filter(isUncollectedStatus)
    const picked: UncollectedStatus[] = statuses.length ? UNCOLLECTED_STATUSES.filter((s) => statuses.includes(s)) : [...OPEN_STATUSES]
    const age: AgeBandKey | null = isAgeBandKey(filter.age) ? filter.age : null
    const q = typeof filter.q === "string" ? filter.q.trim().slice(0, UNCOLLECTED_LIMITS.search) : ""
    const sort: UncollectedSort = isUncollectedSort(filter.sort) ? filter.sort : "waiting"

    const words = q.split(/\s+/).filter(Boolean).slice(0, 8)
    const searchSql = words.length
      ? Prisma.join(words.map((w) => {
          const p = likeWord(w)
          return Prisma.sql`(u."buyerName" ILIKE ${p} OR u."buyerNo" ILIKE ${p} OR u."email" ILIKE ${p}
            OR u."saleCode" ILIKE ${p} OR u."invoiceNo" ILIKE ${p})`
        }), " AND ")
      : Prisma.sql`TRUE`

    // A status that isn't one of the six (a future feed's typo) reads as "waiting" here exactly as
    // statusOf() reads it on the screen — so it is listed, counted and filtered as Waiting rather
    // than vanishing from every chip. totals.unknownStatus says how many there are.
    const base = Prisma.sql`
      WITH c AS (
        SELECT u."id",
               CASE WHEN u."status" IN (${Prisma.join(UNCOLLECTED_STATUSES)}) THEN u."status" ELSE 'waiting' END AS "status",
               u."buyerName", u."paidAt", u."nextChaseAt", u."amountPaid", u."createdAt",
               ${daysSql(today)} AS "days"
        FROM "UncollectedPaid" u
        WHERE ${searchSql}
      ), b AS (
        SELECT c.*, ${bandSql} AS "band" FROM c
      )`
    const statusWhere = Prisma.sql`b."status" IN (${Prisma.join(picked)})`
    const ageWhere = age ? Prisma.sql`b."band" = ${age}` : Prisma.sql`TRUE`

    const [statusRows, ageRows, idRows, totalsRows] = await Promise.all([
      prisma.$queryRaw<{ status: string; n: number }[]>`${base}
        SELECT b."status" AS "status", COUNT(*)::int AS "n" FROM b WHERE ${ageWhere} GROUP BY b."status"`,
      prisma.$queryRaw<{ band: string; n: number }[]>`${base}
        SELECT b."band" AS "band", COUNT(*)::int AS "n" FROM b WHERE ${statusWhere} GROUP BY b."band"`,
      prisma.$queryRaw<{ id: string }[]>`${base}
        SELECT b."id" AS "id" FROM b WHERE ${statusWhere} AND ${ageWhere}
        ORDER BY ${Prisma.raw(ORDER_BY[sort])} LIMIT ${Prisma.raw(String(UNCOLLECTED_LIMITS.list + 1))}`,
      // Open = anything but collected / closed, so an unknown status counts as the waiting it reads as.
      prisma.$queryRaw<{
        open: number; lots: number; lotsUnknown: number; money: number; moneyUnknown: number
        oldestDays: number | null; chasesToday: number; chasesOverdue: number; unknownStatus: number
      }[]>`
        SELECT COUNT(*)::int AS "open",
               (COUNT(*) FILTER (WHERE u."status" NOT IN (${Prisma.join(UNCOLLECTED_STATUSES)})))::int AS "unknownStatus",
               COALESCE(SUM(u."lots"), 0)::float8 AS "lots",
               (COUNT(*) FILTER (WHERE u."lots" IS NULL))::int AS "lotsUnknown",
               COALESCE(SUM(u."amountPaid"), 0)::float8 AS "money",
               (COUNT(*) FILTER (WHERE u."amountPaid" IS NULL))::int AS "moneyUnknown",
               MAX(${daysSql(today)})::int AS "oldestDays",
               (COUNT(*) FILTER (WHERE u."nextChaseAt" IS NOT NULL AND ${londonDateOf("nextChaseAt")} = ${today}::date))::int AS "chasesToday",
               (COUNT(*) FILTER (WHERE u."nextChaseAt" IS NOT NULL AND ${londonDateOf("nextChaseAt")} < ${today}::date))::int AS "chasesOverdue"
        FROM "UncollectedPaid" u
        WHERE u."status" NOT IN (${Prisma.join(CLOSED_STATUSES)})`,
    ])

    const statusCounts = Object.fromEntries(UNCOLLECTED_STATUSES.map((s) => [s, 0])) as Record<UncollectedStatus, number>
    for (const r of statusRows) if (isUncollectedStatus(r.status)) statusCounts[r.status] = Number(r.n)
    const ageCounts = Object.fromEntries([...AGE_BANDS.map((b) => b.key), "none"].map((k) => [k, 0])) as Record<AgeBandKey | "none", number>
    for (const r of ageRows) if (r.band in ageCounts) ageCounts[r.band as AgeBandKey | "none"] = Number(r.n)
    const matched = picked.reduce((n, s) => n + statusCounts[s], 0)

    const truncated = idRows.length > UNCOLLECTED_LIMITS.list
    const ids = idRows.slice(0, UNCOLLECTED_LIMITS.list).map((r) => r.id)

    const [rows, contacts] = ids.length
      ? await Promise.all([
          prisma.uncollectedPaid.findMany({ where: { id: { in: ids } } }),
          prisma.uncollectedPaidEvent.findMany({
            where: { caseId: { in: ids }, kind: { in: REACHED_OUT_KINDS } },
            orderBy: [{ caseId: "asc" }, { at: "desc" }],
            distinct: ["caseId"],
            select: { caseId: true, kind: true, at: true, text: true, byName: true },
          }),
        ])
      : [[], []]
    const byId = new Map(rows.map((r) => [r.id, r]))
    const lastBy = new Map(contacts.map((e) => [e.caseId, e]))
    const cases = ids.flatMap((id) => {
      const r = byId.get(id)
      return r ? [toCase(r, lastContactOf(lastBy.get(id)), today)] : []   // deleted between the reads
    })

    const t = totalsRows[0]
    const totals: UncollectedTotals = {
      open: Number(t?.open ?? 0),
      lots: Number(t?.lots ?? 0),
      lotsUnknown: Number(t?.lotsUnknown ?? 0),
      money: Math.round(Number(t?.money ?? 0) * 100) / 100,
      moneyUnknown: Number(t?.moneyUnknown ?? 0),
      oldestDays: t?.oldestDays == null ? null : Number(t.oldestDays),
      chasesToday: Number(t?.chasesToday ?? 0),
      chasesOverdue: Number(t?.chasesOverdue ?? 0),
      chasesDue: Number(t?.chasesToday ?? 0) + Number(t?.chasesOverdue ?? 0),
      unknownStatus: Number(t?.unknownStatus ?? 0),
    }

    return {
      ok: true,
      data: { cases, matched, truncated, statusCounts, ageCounts, totals, today, filter: { statuses: picked, age, q, sort } },
    }
  } catch (e) {
    return fail(e, "list", READ_FAILED)
  }
}

/**
 * How many cases are open, for the link card on the Accounts page. Never fails, and never passes off
 * "couldn't tell" as a calm 0 (design rule 7): `ready: false` before Run Migrations, `error: true`
 * when it couldn't be read (the card says which). 0 for anyone who isn't an admin (they never see
 * the card).
 */
export async function countOpenCases(): Promise<{ open: number; ready: boolean; error?: boolean }> {
  try {
    const { isAdmin } = await getAccountsAccess()
    if (!isAdmin) return { open: 0, ready: true }
    const open = await prisma.uncollectedPaid.count({ where: { status: { notIn: CLOSED_STATUSES } } })
    return { open, ready: true }
  } catch (e) {
    if (isMissingUncollected(e)) return { open: 0, ready: false }
    console.error("uncollected count error:", e)
    return { open: 0, ready: true, error: true }
  }
}

// ─── One case ───────────────────────────────────────────────────────────────────────────────

/** A case with its whole timeline, newest first. */
export async function getCase(id: string): Promise<UncollectedResult<UncollectedCaseDetail>> {
  try {
    await requireAdmin()
    if (typeof id !== "string" || !id) throw new Refusal(NOT_FOUND)
    const r = await prisma.uncollectedPaid.findUnique({
      where: { id },
      include: { events: { orderBy: [{ at: "desc" }, { id: "desc" }], take: 1000 } },
    })
    if (!r) throw new Refusal(NOT_FOUND)
    const today = londonDay()
    const last = r.events.find((e) => (REACHED_OUT_KINDS as string[]).includes(e.kind))
    return {
      ok: true,
      data: {
        ...toCase(r, lastContactOf(last), today),
        events: r.events.map((e) => ({ id: e.id, kind: eventKindOf(e.kind), text: e.text, byName: e.byName, at: e.at.toISOString() })),
      },
    }
  } catch (e) {
    return fail(e, "get", "That case couldn't be read just now — please try again.")
  }
}

/** Adds a buyer by hand. Only the name is needed; everything else can be filled in later. */
export async function createCase(input: UncollectedInput): Promise<UncollectedResult<{ id: string }>> {
  try {
    const who = await requireAdmin()
    if (!input || typeof input !== "object") throw new Refusal("Type the buyer's name.")
    const today = londonDay()
    const f = parseFields({ ...input, buyerName: input.buyerName ?? "" }, today)
    if (!f.buyerName) throw new Refusal("Type the buyer's name.")

    const customerId = await matchCustomer(f.buyerNo)
    const created = await prisma.$transaction(async (tx) => {
      // One open case per invoice — checked under the invoice's lock, in the same transaction as the
      // insert, so two people adding the same invoice at once can't both get through.
      if (f.invoiceNo) {
        await lockInvoice(tx, f.invoiceNo)
        const dupe = await openCaseForInvoice(tx, f.invoiceNo)
        if (dupe) throw new Refusal(`There's already an open case for invoice ${f.invoiceNo} (${dupe.buyerName}) — open that one instead.`, dupe.id)
      }
      const c = await tx.uncollectedPaid.create({
        data: {
          source: "manual",
          buyerName: f.buyerName!,
          buyerNo: f.buyerNo ?? null,
          customerId,
          email: f.email ?? null,
          phone: f.phone ?? null,
          saleCode: f.saleCode ?? null,
          invoiceNo: f.invoiceNo ?? null,
          lots: f.lots ?? null,
          amountPaid: f.amountPaid ?? null,
          paidAt: f.paidAt ?? null,
          status: "waiting",
          nextChaseAt: f.nextChaseAt ?? null,
          storageFrom: f.storageFrom ?? null,
          notes: f.notes ?? null,
          createdById: who.id,
          createdByName: who.name,
        },
        select: { id: true },
      })
      await tx.uncollectedPaidEvent.create({
        data: { caseId: c.id, kind: "created", text: "Added by hand.", byId: who.id, byName: who.name },
      })
      return c
    })
    revalidate()
    return { ok: true, data: { id: created.id } }
  } catch (e) {
    return fail(e, "create", SAVE_FAILED)
  }
}

/**
 * Changes a case's details — only the fields sent; null or "" clears one (never the name).
 * Answers which fields really changed (none = nothing was written). On a case from BC the fields
 * BC owns are refused. An open case can't be given an invoice number another open case holds
 * (refused with that case's id as existingId).
 */
export async function updateCase(id: string, patch: UncollectedPatch): Promise<UncollectedResult<{ changed: UncollectedField[] }>> {
  try {
    const who = await requireAdmin()
    if (!patch || typeof patch !== "object") return { ok: true, data: { changed: [] } }
    const today = londonDay()
    const f = parseFields(patch, today)

    const current = await prisma.uncollectedPaid.findUnique({ where: { id } })
    if (!current) throw new Refusal(NOT_FOUND)

    const changed = (Object.keys(f) as UncollectedField[]).filter((k) => !same(k, f[k], current[k]))
    if (!changed.length) return { ok: true, data: { changed: [] } }

    if (current.source === "bc") {
      const locked = changed.filter((k) => BC_OWNED_FIELDS.includes(k))
      if (locked.length) {
        throw new Refusal(`This case came from BC, so its ${locked.map(label).join(", ")} can't be changed here — change ${locked.length === 1 ? "it" : "them"} in BC.`)
      }
    }

    const data: Record<string, unknown> = {}
    for (const k of changed) data[k] = f[k] ?? null
    if (changed.includes("buyerNo")) data.customerId = await matchCustomer(f.buyerNo)
    const newInvoice = changed.includes("invoiceNo") ? (f.invoiceNo ?? null) : null

    await prisma.$transaction(async (tx) => {
      // A new invoice number on an OPEN case mustn't be one another open case already holds: the
      // invoice's lock first, then the row (FOR UPDATE — a status change meanwhile waits for this
      // write and then sees it), then the check, then the write.
      if (newInvoice) await lockInvoice(tx, newInvoice)
      const [row] = await tx.$queryRaw<{ status: string }[]>`
        SELECT "status" FROM "UncollectedPaid" WHERE "id" = ${id} FOR UPDATE`
      // Still there? A delete meanwhile isn't brought back.
      if (!row) throw new Refusal(NOT_FOUND)
      if (newInvoice && isOpenRaw(row.status)) {
        const dupe = await openCaseForInvoice(tx, newInvoice, id)
        if (dupe) {
          throw new Refusal(`Invoice ${newInvoice} already has an open case (${dupe.buyerName}) — open that one instead. Nothing was saved.`, dupe.id)
        }
      }
      const n = await tx.uncollectedPaid.updateMany({ where: { id }, data: data as Prisma.UncollectedPaidUpdateManyMutationInput })
      if (n.count === 0) throw new Refusal(NOT_FOUND)
      await tx.uncollectedPaidEvent.create({
        data: {
          caseId: id, kind: "edit", byId: who.id, byName: who.name,
          text: `Changed ${changed.map((k) => changePhrase(k, f[k] ?? null)).join(", ")}.`,
        },
      })
    })
    revalidate()
    return { ok: true, data: { changed } }
  } catch (e) {
    return fail(e, "update", SAVE_FAILED)
  }
}

/**
 * Moves a case to another status, on its timeline. Collected or Closed another way closes it
 * (closedAt); "Closed another way" needs a reason; going back to an open status reopens it
 * (closedAt cleared). "Storage charges apply" with no storage date yet starts the charges today.
 */
export async function setStatus(
  id: string,
  status: UncollectedStatus,
  note?: string | null,
): Promise<UncollectedResult<{ changed: boolean; status: UncollectedStatus }>> {
  try {
    const who = await requireAdmin()
    if (!isUncollectedStatus(status)) throw new Refusal("That isn't one of this panel's statuses.")
    const reason = prose(note, "the reason", UNCOLLECTED_LIMITS.eventText)
    if (STATUS_META[status].needsReason && !reason) {
      throw new Refusal("Say why it's being closed — for example \"Refunded\" or \"Re-offered in the next sale\".")
    }
    const today = londonDay()

    const result = await prisma.$transaction(async (tx) => {
      const c = await tx.uncollectedPaid.findUnique({ where: { id }, select: { status: true, closedAt: true, storageFrom: true, invoiceNo: true } })
      if (!c) throw new Refusal(NOT_FOUND)
      const from = statusOf(c.status)
      if (c.status === status) return { changed: false }

      const closing = CLOSED_STATUSES.includes(status)
      // Reopening a closed case whose invoice has had another case opened since would leave two
      // open cases on one invoice — refused, under the invoice's lock (see lockInvoice).
      if (!closing && !isOpenRaw(c.status) && c.invoiceNo) {
        await lockInvoice(tx, c.invoiceNo)
        const dupe = await openCaseForInvoice(tx, c.invoiceNo, id)
        if (dupe) {
          throw new Refusal(`Invoice ${c.invoiceNo} already has another open case (${dupe.buyerName}), so this one can't be reopened as well — carry on with that one.`, dupe.id)
        }
      }
      const data: Prisma.UncollectedPaidUpdateManyMutationInput = {
        status,
        // Switching between Collected and Closed keeps the day it first closed.
        closedAt: closing ? (c.closedAt ?? new Date()) : null,
      }
      const startsStorage = status === "storage" && !c.storageFrom
      if (startsStorage) data.storageFrom = dayToStored(today)

      // Only if it is still where we read it — same status AND same invoice — so two people changing
      // it at once can't both win, and an invoice changed meanwhile isn't reopened unchecked.
      const n = await tx.uncollectedPaid.updateMany({ where: { id, status: c.status, invoiceNo: c.invoiceNo }, data })
      if (n.count === 0) throw new Refusal(CHANGED_MEANWHILE)

      const parts = [`${STATUS_META[from].label} → ${STATUS_META[status].label}`]
      if (reason) parts.push(reason)
      if (startsStorage) parts.push(`storage charges from ${formatDay(dayToStored(today))}`)
      await tx.uncollectedPaidEvent.create({
        data: { caseId: id, kind: "status", text: parts.join(" — "), byId: who.id, byName: who.name },
      })
      return { changed: true }
    })
    if (result.changed) revalidate()
    return { ok: true, data: { changed: result.changed, status } }
  } catch (e) {
    return fail(e, "status", SAVE_FAILED)
  }
}

/**
 * Records a call, email, letter or note on the case's timeline, optionally setting (or clearing)
 * the next chase date. A call, email or letter on a case still "Paid — waiting to collect" moves it
 * to "We've been in touch" (answered as statusChangedTo, so the page can say so).
 */
export async function logContact(id: string, input: LogContactInput): Promise<UncollectedResult<{ statusChangedTo: UncollectedStatus | null }>> {
  try {
    const who = await requireAdmin()
    const kind: ContactKind | null = isContactKind(input?.kind) ? input.kind : null
    if (!kind) throw new Refusal("Pick call, email, letter or note.")
    const text = prose(input.text, "what happened", UNCOLLECTED_LIMITS.eventText)
    if (kind === "note" && !text) throw new Refusal("Write the note first.")
    const today = londonDay()
    const chaseSent = input.nextChaseAt !== undefined
    const nextChase = chaseSent ? dayOf(input.nextChaseAt, "nextChaseAt", today) : undefined

    const statusChangedTo = await prisma.$transaction(async (tx) => {
      const c = await tx.uncollectedPaid.findUnique({ where: { id }, select: { status: true, nextChaseAt: true } })
      if (!c) throw new Refusal(NOT_FOUND)

      const chaseChanged = chaseSent && !same("nextChaseAt", nextChase ?? null, c.nextChaseAt)
      const parts = [text ?? ""].filter(Boolean)
      if (chaseChanged) parts.push(nextChase ? `next chase ${formatDay(nextChase)}` : "next chase date cleared")
      await tx.uncollectedPaidEvent.create({
        data: { caseId: id, kind, text: parts.join(" — ") || null, byId: who.id, byName: who.name },
      })

      let moved: UncollectedStatus | null = null
      if (REACHED_OUT_KINDS.includes(kind) && c.status === "waiting") {
        const n = await tx.uncollectedPaid.updateMany({ where: { id, status: "waiting" }, data: { status: "contacted" } })
        if (n.count === 1) {
          moved = "contacted"
          await tx.uncollectedPaidEvent.create({
            data: {
              caseId: id, kind: "status", byId: who.id, byName: who.name,
              text: `${STATUS_META.waiting.label} → ${STATUS_META.contacted.label} — after the ${kind === "call" ? "phone call" : kind}`,
            },
          })
        }
      }
      // Always touch the case, so "last changed" and the list's order notice the contact.
      await tx.uncollectedPaid.update({
        where: { id },
        data: { updatedAt: new Date(), ...(chaseChanged ? { nextChaseAt: nextChase ?? null } : {}) },
      })
      return moved
    })
    revalidate()
    return { ok: true, data: { statusChangedTo } }
  } catch (e) {
    return fail(e, "contact", SAVE_FAILED)
  }
}

/** Deletes a case entered by hand, with its timeline. The page confirms first. A case from BC
 *  can't be deleted (the feed would only bring it back) — it is closed instead.
 *  The timeline goes with the case, so the deletion itself is written to the server's log — who,
 *  when, the case id, its buyer number and invoice (never contact details). Accounts has no audit
 *  table of its own and none was added. */
export async function deleteCase(id: string): Promise<UncollectedResult> {
  try {
    const who = await requireAdmin()
    const c = await prisma.uncollectedPaid.findUnique({ where: { id }, select: { source: true, buyerNo: true, invoiceNo: true } })
    if (!c) throw new Refusal(NOT_FOUND)
    if (c.source !== "manual") {
      throw new Refusal("This case came from BC, so it can't be deleted — close it instead (Closed another way), saying why.")
    }
    const n = await prisma.uncollectedPaid.deleteMany({ where: { id, source: "manual" } })
    if (n.count === 0) throw new Refusal(NOT_FOUND)
    console.info(`uncollected case deleted: ${JSON.stringify({
      id, source: c.source, buyerNo: c.buyerNo, invoiceNo: c.invoiceNo, byId: who.id, byName: who.name, at: new Date().toISOString(),
    })}`)
    revalidate()
    return { ok: true, data: undefined }
  } catch (e) {
    return fail(e, "delete", "Something went wrong and the case wasn't deleted — please try again.")
  }
}

// ─── The BC check: Check BC now, and where it stands ────────────────────────────────────────
// The check is the feed's (lib/uncollected-feed.ts) — the same one the nightly run uses, with its own
// one-at-a-time lock and its own UncollectedSyncRun row. A run takes minutes, longer than Railway's
// proxy lets a request live, so Check BC now STARTS it (startUncollectedSync answers once the run's
// row is written, or with why it couldn't start) and answers at once, as the database backup does.
// The panel then asks lastSyncRun() every couple of seconds and shows what the check says it is
// doing (uncollectedSyncNow: "Reading invoices — 120 of 312 buyers") with the time so far (design
// rule 7b), and the result in numbers from the run's row when it finishes.
// ⚠ Check BC now reads BC with the ADMIN'S OWN BC sign-in (getBCToken), never the background one.
// Read only — nothing is written to BC.

type SyncRunRow = {
  id: string; startedAt: Date; finishedAt: Date | null; trigger: string; byName: string | null; ok: boolean | null
  lotsSeen: number | null; buyers: number | null; found: number | null; added: number | null; updated: number | null
  closed: number | null; note: string | null; error: string | null
}

const runInfo = (r: SyncRunRow): UncollectedSyncRunInfo => ({
  id: r.id, startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt), trigger: r.trigger, byName: r.byName,
  ok: r.ok, lotsSeen: r.lotsSeen, buyers: r.buyers, found: r.found, added: r.added, updated: r.updated, closed: r.closed,
  note: r.note, error: r.error,
})

/** Where the BC check stands. Throws when its table isn't there (the callers say "Run Migrations"). */
async function readCheckState(): Promise<UncollectedCheckState> {
  const [latest, lastOk, openFromBc] = await Promise.all([
    prisma.uncollectedSyncRun.findFirst({ orderBy: [{ startedAt: "desc" }, { id: "desc" }] }),
    prisma.uncollectedSyncRun.findFirst({ where: { ok: true, finishedAt: { not: null } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }),
    prisma.uncollectedPaid.count({ where: { source: "bc", status: { notIn: CLOSED_STATUSES } } }).catch(() => null),
  ])
  const now = Date.now()
  // ⚠ RUNNING = this server holds the run's lock. One instance on Railway, and the nightly run (the
  // cron route) and Check BC now both run inside it, so a check that is really going is always here.
  const live = uncollectedSyncNow()
  // An unfinished row from since this server started, under UNCOLLECTED_RUN_STALE_MINUTES old, with
  // no lock held: a run whose end couldn't be recorded — NOT running (no ticking spinner for half an
  // hour over nothing). The feed still won't start another until it's stale (its own guard).
  const bootedAt = now - process.uptime() * 1000
  const unfinished = !live && !!latest && !latest.finishedAt
    && latest.startedAt.getTime() >= Math.max(now - UNCOLLECTED_RUN_STALE_MINUTES * 60_000, bootedAt)
  return {
    running: !!live,
    startedAt: live?.startedAt ?? null,
    trigger: live?.trigger ?? null,
    byName: live?.byName ?? null,
    progress: live?.progress ?? null,
    stopBy: live?.stopBy ?? null,
    stuckSince: unfinished ? latest!.startedAt.toISOString() : null,
    openFromBc,
    latest: latest ? runInfo(latest) : null,
    lastOk: lastOk ? runInfo(lastOk) : null,
    now: new Date(now).toISOString(),
  }
}

/**
 * Where the BC check stands: is one running (and what it's doing), the newest run, and the newest
 * one that worked — for the panel's "Last checked from BC" line, asked every couple of seconds while
 * a check runs. Admins only. Before Run Migrations → notReady with UNCOLLECTED_SYNC_NOT_READY.
 */
export async function lastSyncRun(): Promise<UncollectedResult<UncollectedCheckState>> {
  try {
    await requireAdmin()
    return { ok: true, data: await readCheckState() }
  } catch (e) {
    if (isMissingUncollected(e)) return { ok: false, error: UNCOLLECTED_SYNC_NOT_READY, notReady: true }
    return fail(e, "sync state", "Couldn't read when BC was last checked — please try again.")
  }
}

/**
 * Check BC now: starts the BC check straight away with the admin's own BC sign-in and answers as
 * soon as it is under way, with where it stands. `started` false = a check was already running (the
 * nightly one, or another admin's) — the panel follows that one instead. Not connected to BC →
 * needsBc. Nothing is written to BC.
 */
export async function checkBcNow(): Promise<UncollectedResult<{ started: boolean; state: UncollectedCheckState }>> {
  try {
    const who = await requireAdmin()
    // The free step first: the run table must be there before BC is asked anything.
    const before = await readCheckState()
    if (before.running) return { ok: true, data: { started: false, state: before } }

    const token = await getBCToken()
    if (!token) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }

    const start = await startUncollectedSync({
      trigger: "manual",
      byName: who.name,
      token,
      // Renews the admin's own sign-in if BC answers 401 part-way. It may run after this request has
      // answered, where reading the session can fail — that just means no renewal.
      refreshToken: () => getBCToken().catch(() => null),
    })
    if (!start.started) {
      const r = start.result
      if (r.busy) {
        // Two admins pressing at once, or the nightly run just begun: follow that one.
        const state = await readCheckState()
        if (state.running) return { ok: true, data: { started: false, state } }
        // Refused over a run that never recorded its end (see readCheckState) — say so, and when.
        const from = state.stuckSince ? new Date(Date.parse(state.stuckSince) + UNCOLLECTED_RUN_STALE_MINUTES * 60_000) : null
        return {
          ok: false,
          error: `${sentence(r.error)} It looks to have stopped without recording its end${from ? ` — Check BC now can run again from ${from.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}` : ""}.`,
        }
      }
      if (r.notReady) return { ok: false, error: UNCOLLECTED_SYNC_NOT_READY, notReady: true }
      return { ok: false, error: r.error || "The BC check couldn't be started — please try again." }
    }
    // It carries on after this answer. `done` never rejects, and the run's row says how it went.
    void start.done
    return { ok: true, data: { started: true, state: await readCheckState() } }
  } catch (e) {
    if (isMissingUncollected(e)) return { ok: false, error: UNCOLLECTED_SYNC_NOT_READY, notReady: true }
    return fail(e, "check BC now", "The BC check couldn't be started — please try again.")
  }
}

/**
 * Stop (design rule 7b): asks the running BC check — Check BC now or the nightly one — to stop. It
 * stops within seconds, keeps every case it has already saved, and its run says "Stopped by <name>"
 * with what it kept. Admins only. Nothing is written to BC.
 */
export async function stopBcCheck(): Promise<UncollectedResult<{ stopping: boolean; state: UncollectedCheckState }>> {
  try {
    const who = await requireAdmin()
    const stopping = stopUncollectedSync(who.name)
    return { ok: true, data: { stopping, state: await readCheckState() } }
  } catch (e) {
    if (isMissingUncollected(e)) return { ok: false, error: UNCOLLECTED_SYNC_NOT_READY, notReady: true }
    return fail(e, "stop BC check", "The check couldn't be asked to stop — please try again.")
  }
}

// ─── A case's lots, read live from BC ───────────────────────────────────────────────────────
// The simplest honest way to list a case's lots: ask BC when the case is opened, rather than keep a
// copy that goes stale (notes stay the staff's; the timeline keeps what the check found on the day).
// The feed's bcLotsForBuyer — the buyer's lots in the case's sale from BC's auction lines, with its
// retries — read with the admin's own BC sign-in. Read only.

/** A buyer or sale number fit to ask BC about (BC's numbers are letters, digits, - _ / .). */
const BC_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,39}$/

/** What a failed BC read means, in words. The feed's message is already short and plain. */
function bcFailure(e: unknown): Failure {
  const m = String((e as { message?: string })?.message ?? "")
  if (/\b401\b/.test(m)) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }
  if (/\b403\b/.test(m)) return { ok: false, error: "Your BC sign-in isn't allowed to read the auction lines — ask whoever looks after BC permissions." }
  if (/\b(429|503)\b/.test(m)) return { ok: false, error: "BC is busy just now — try again in a minute." }
  console.error("uncollected BC lots error:", e)
  return { ok: false, error: m ? `BC couldn't be read — ${m.slice(0, 200)}` : "BC couldn't be read just now — try again in a minute." }
}

/**
 * The lots BC shows as sold to this case's buyer in this case's sale(s) (hammer over £0, not
 * withdrawn), collected and not — read live, not collected first. Needs a buyer number and a sale.
 * A case from BC whose invoice covered more than one sale holds them all ("F067, F068"); each is read
 * (salesOf — the feed reads the first few, and says how many it left out).
 */
export async function bcLotsForCase(id: string): Promise<UncollectedResult<UncollectedBcLots>> {
  let buyerNo: string
  let saleCode: string
  try {
    await requireAdmin()
    if (typeof id !== "string" || !id) throw new Refusal(NOT_FOUND)
    const c = await prisma.uncollectedPaid.findUnique({ where: { id }, select: { buyerNo: true, saleCode: true } })
    if (!c) throw new Refusal(NOT_FOUND)
    if (!c.buyerNo || !c.saleCode) throw new Refusal("This case needs a buyer number and a sale before its lots can be looked up in BC.")
    const sales = salesOf(c.saleCode)
    if (!BC_CODE_RE.test(c.buyerNo.trim()) || !sales.length || !sales.every((s) => BC_CODE_RE.test(s))) {
      throw new Refusal("The buyer number or sale on this case doesn't look like BC's, so BC can't be asked for its lots.")
    }
    buyerNo = c.buyerNo.trim()
    saleCode = c.saleCode.trim()
  } catch (e) {
    return fail(e, "bc lots", "That case couldn't be read just now — please try again.")
  }

  const token = await getBCToken().catch(() => null)
  if (!token) return { ok: false, error: UNCOLLECTED_BC_NOT_CONNECTED, needsBc: true }

  try {
    const data = await bcLotsForBuyer(token, saleCode, buyerNo)
    // Not collected first, then sale by sale in the case's order, then by lot number (366 before
    // 366A before 1001).
    const saleOrder = (s: string | null) => { const i = data.sales.indexOf((s ?? "").toUpperCase()); return i < 0 ? data.sales.length : i }
    const lots = [...data.lots].sort((a, b) =>
      Number(a.collected) - Number(b.collected) || saleOrder(a.saleCode) - saleOrder(b.saleCode) || a.lotNo.localeCompare(b.lotNo, "en", { numeric: true }))
    return { ok: true, data: { ...data, lots } }
  } catch (e) {
    return bcFailure(e)
  }
}
