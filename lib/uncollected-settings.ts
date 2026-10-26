// Accounts → Paid, not collected — the storage charge settings, and the storage reads the panel and
// the BC check share. SERVER ONLY (Prisma).
//
// ⚠ NOT a "use server" file: nothing here can be called from a browser. The panel's server actions
// (lib/actions/uncollected.ts) check the person is an admin FIRST, then call these; the BC check
// (lib/uncollected-feed.ts) reads the settings once per run.
//
//  • UncollectedSettings is ONE row, id "default" (NEEDS Run Migrations). Every read is tolerant: a
//    missing table gives the standard charges (STORAGE_DEFAULTS — Jack's £2.00 per lot per week + VAT
//    after 28 free days; a saved row always wins, a blank column in it falls back to them) with
//    ready: false, and they can't be saved; any other fault gives the defaults with readFailed: true,
//    so the panel says the figures may be wrong and the BC check sets no storage start that run
//    (design rule 7 — "couldn't tell" never passes for the real settings).
//  • Money is never stored. storageCharge() in lib/uncollected.ts works it out live from these.
//  • Changing the free days moves the storage start of every OPEN case from BC whose start the rule
//    set (restampStorageStarts) — never a start a person set (storageStartOwner).
//  • ⚠ THE SETTINGS LOCK. Saving the settings writes the row holding a transaction-scoped advisory
//    lock EXCLUSIVELY; every case the BC check saves holds it SHARED and reads the free days inside
//    that same transaction (lockStorageSettingsShared + graceDaysInTx). So a check part-way through a
//    run can never save a case on the free days from before a change once the restamp has looked at
//    the cases (it either finished before the change was saved, so the restamp sees and moves it, or
//    it waits and reads the new free days). Only these two places take it — change them together.

import { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import {
  CLOSED_STATUSES, STORAGE_DEFAULTS, STORAGE_SETTINGS_NOT_READY, STORAGE_START_KINDS, STORAGE_SWITCH_KINDS, STORAGE_WAIVED,
  addStorage, dayToStored, londonDay, normaliseStorageSettings, paidExactFromText, parseStorageSettingsInput,
  ruleMaySetStart, storageCharge, storageRuleWords, storageStartDay, storageStartOwner, storageWaiverOf,
  type StorageSettings, type StorageSettingsInfo, type StorageSettingsInput, type StorageTotals, type StorageWaiver,
  type UncollectedResult,
} from "@/lib/uncollected"

const SETTINGS_ID = "default"

/** The BC check's side of the settings lock (see the top of this file): taken SHARED inside each
 *  case's save transaction, before graceDaysInTx. Touches no table, so it is safe before Run Migrations. */
export async function lockStorageSettingsShared(tx: Prisma.TransactionClient): Promise<void> {
  // $executeRaw: the lock returns void, which $queryRaw can't read.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext('uncollected-storage-settings'))`
}

/** The free days as they stand, read inside the caller's transaction (after lockStorageSettingsShared).
 *  ⚠ Only call it when the settings table is known to be there (readStorageSettings said `ready`): a
 *  missing table would abort the whole transaction. A blank or unusable value is the default. */
export async function graceDaysInTx(tx: Prisma.TransactionClient): Promise<number> {
  const row = await tx.uncollectedSettings.findUnique({
    where: { id: SETTINGS_ID },
    select: { graceDays: true, ratePence: true, period: true, vatPercent: true },
  })
  return normaliseStorageSettings(row).graceDays
}

/** Who set a case's storage start last (storageStartOwner over its newest event that mentions
 *  "storage charges from"): "rule", "person", or null (nobody, or a person cleared it). One small
 *  read — inside a transaction (the BC check) or not (the case page). Throws on a database fault. */
export async function readStorageStartOwner(
  db: Pick<Prisma.TransactionClient, "uncollectedPaidEvent">,
  caseId: string,
): Promise<"rule" | "person" | null> {
  const ev = await db.uncollectedPaidEvent.findFirst({
    where: { caseId, kind: { in: [...STORAGE_START_KINDS] }, text: { contains: "storage charges from", mode: "insensitive" } },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { kind: true, text: true },
  })
  return storageStartOwner(ev ? [ev] : [])
}

/** The settings table isn't there yet (Run Migrations) — never any other fault. */
function isMissingSettingsTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { code?: string; message?: string; modelName?: string } } | null
  if (err?.code === "P2021" || err?.code === "42P01" || err?.meta?.code === "42P01") return true
  return /UncollectedSettings\W{0,3}\s*does not exist/i.test(`${err?.message ?? ""} ${err?.meta?.message ?? ""}`)
}

const defaultsInfo = (over: Partial<StorageSettingsInfo>): StorageSettingsInfo => ({
  ...STORAGE_DEFAULTS, ready: true, saved: false, updatedByName: null, updatedAt: null, readFailed: false, ...over,
})

/**
 * The storage charge settings. Never throws: before Run Migrations → the defaults, `ready: false`;
 * no row yet → the defaults, `saved: false`; a fault → the defaults, `readFailed: true`.
 */
/** The test site this Hub is (RAILWAY_ENVIRONMENT_NAME "staging" or "sandbox"), or null — on
 *  production, a dev machine or anything not named. "Start again from BC" exists only where this
 *  answers a name: an ALLOWLIST, so an unknown or missing name can never wipe a live list. */
export function startAgainSite(): string | null {
  const env = (process.env.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase()
  return env === "staging" || env === "sandbox" ? env : null
}

export async function readStorageSettings(): Promise<StorageSettingsInfo> {
  try {
    const row = await prisma.uncollectedSettings.findUnique({ where: { id: SETTINGS_ID } })
    if (!row) return defaultsInfo({})
    return {
      ...normaliseStorageSettings(row),
      ready: true, saved: true, readFailed: false,
      updatedByName: row.updatedByName ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }
  } catch (e) {
    if (isMissingSettingsTable(e)) return defaultsInfo({ ready: false })
    console.error("uncollected storage settings read error:", e)
    return defaultsInfo({ readFailed: true })
  }
}

const same = (a: StorageSettings, b: StorageSettings) =>
  a.graceDays === b.graceDays && a.ratePence === b.ratePence && a.period === b.period && a.vatPercent === b.vatPercent

/**
 * Saves the storage charges from the panel's settings box. ⚠ The CALLER checks the person is an admin
 * first (this is not a server action). Checks every value (plain-English refusals), writes the one
 * row with who changed it, and — when the free days changed — moves the storage start of the open
 * cases from BC whose start the rule set (restampStorageStarts; never a start a person set).
 * Nothing changed → nothing written (who last changed it stays). Before Run Migrations → notReady.
 */
export async function saveStorageSettings(
  input: StorageSettingsInput,
  who: { id: string; name: string },
): Promise<UncollectedResult<StorageSettingsSaved>> {
  const parsed = parseStorageSettingsInput(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const value = parsed.value

  const before = await readStorageSettings()
  if (!before.ready) return { ok: false, error: STORAGE_SETTINGS_NOT_READY, notReady: true }
  if (before.saved && !before.readFailed && same(before, value)) {
    return { ok: true, data: { settings: before, changed: false, moved: 0, notMoved: 0, startsUnread: false } }
  }

  let settings: StorageSettingsInfo
  try {
    const data = { ...value, updatedByName: who.name }
    // Under the settings lock, EXCLUSIVELY (see the top of this file): every BC-check save in flight
    // finishes first, and every one after it reads these values.
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('uncollected-storage-settings'))`
      return tx.uncollectedSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID, ...data },
        update: data,
      })
    }, { maxWait: 10_000, timeout: 30_000 })
    settings = {
      ...normaliseStorageSettings(row), ready: true, saved: true, readFailed: false,
      updatedByName: row.updatedByName ?? null, updatedAt: row.updatedAt.toISOString(),
    }
  } catch (e) {
    if (isMissingSettingsTable(e)) return { ok: false, error: STORAGE_SETTINGS_NOT_READY, notReady: true }
    console.error("uncollected storage settings save error:", e)
    return { ok: false, error: "The storage charges couldn't be saved — nothing was changed. Please try again." }
  }

  // The free days moved (or what they were couldn't be read): bring the rule's starts into line.
  let moved = 0
  let notMoved = 0
  let startsUnread = false
  if (before.readFailed || before.graceDays !== settings.graceDays) {
    const r = await restampStorageStarts(settings.graceDays, who, before.readFailed ? null : before.graceDays)
    moved = r.moved
    notMoved = r.failed
    startsUnread = r.unread
  }
  return { ok: true, data: { settings, changed: true, moved, notMoved, startsUnread } }
}

/** What a save answers: the settings now, whether anything changed, and — when the free days changed —
 *  how many storage starts were moved, how many couldn't be, and whether the cases couldn't even be
 *  read (startsUnread: the next BC check moves them instead; the box says so — never a calm "saved"). */
export type StorageSettingsSaved = {
  settings: StorageSettingsInfo
  changed: boolean
  moved: number
  notMoved: number
  startsUnread: boolean
}

type RestampRow = { id: string; paidAt: Date; storageFrom: Date | null; evKind: string | null; evText: string | null }

/** Every OPEN case from BC with a paid date, its storage start and the newest event about who set it.
 *  Throws on a database fault. */
async function openBcStartRows(): Promise<RestampRow[]> {
  return prisma.$queryRaw<RestampRow[]>`
    SELECT u."id", u."paidAt", u."storageFrom", ev."kind" AS "evKind", ev."text" AS "evText"
    FROM "UncollectedPaid" u
    LEFT JOIN LATERAL (
      SELECT e."kind", e."text" FROM "UncollectedPaidEvent" e
      WHERE e."caseId" = u."id" AND e."kind" IN (${Prisma.join([...STORAGE_START_KINDS])})
        AND e."text" ILIKE ${"%storage charges from%"}
      ORDER BY e."at" DESC, e."id" DESC
      LIMIT 1
    ) ev ON TRUE
    WHERE u."source" = 'bc' AND u."status" NOT IN (${Prisma.join(CLOSED_STATUSES)}) AND u."paidAt" IS NOT NULL`
}

/** The new start for one row under `graceDays`, or null when the rule may not move it (a person set
 *  it) or it is already there. ⚠ restampStorageStarts and countStartMoves both use this — one rule. */
function restampDay(r: RestampRow, graceDays: number): { day: string; cur: string | null } | null {
  const owner = storageStartOwner(r.evKind ? [{ kind: r.evKind, text: r.evText }] : [])
  if (!ruleMaySetStart(owner, r.storageFrom)) return null
  const day = storageStartDay(r.paidAt, graceDays)
  const cur = r.storageFrom ? londonDay(r.storageFrom) : null
  return !day || day === cur ? null : { day, cur }
}

/**
 * How many open cases from BC would have their storage start moved (each with a timeline line) if the
 * free days became `graceDays` — for the settings box's "are you sure?". Read only. null when it
 * couldn't be counted (the box then says so rather than "none").
 */
export async function countStartMoves(graceDays: number): Promise<number | null> {
  try {
    return (await openBcStartRows()).filter((r) => restampDay(r, graceDays)).length
  } catch (e) {
    console.error("uncollected storage start count error:", e)
    return null
  }
}

/**
 * Moves the storage start of every OPEN case from BC whose start the rule set — or that has none
 * yet — to the day the rule now gives (storageStartDay with `graceDays`). A start a person set is
 * never touched. Each move is its own small write (only if the start is still what was read, so a
 * person's change meanwhile wins) with a line on the case's timeline, signed by `who`, carrying
 * STORAGE_RULE_MARK so the rule still owns it. Never throws; answers how many moved and failed, and
 * `unread: true` when the cases couldn't be read at all (nothing was moved).
 * Run AFTER the new settings are saved (under the settings lock): a BC-check save that read the old
 * free days has finished by then, so it is in what this reads.
 */
export async function restampStorageStarts(
  graceDays: number,
  who: { id: string; name: string },
  previousGraceDays: number | null,
): Promise<{ moved: number; failed: number; unread: boolean }> {
  let rows: RestampRow[]
  try {
    rows = await openBcStartRows()
  } catch (e) {
    console.error("uncollected storage restamp read error:", e)
    return { moved: 0, failed: 0, unread: true }
  }

  const why = previousGraceDays == null
    ? `the storage charges were changed (now ${graceDays} free days)`
    : `the free days were changed from ${previousGraceDays} to ${graceDays}`
  let moved = 0
  let failed = 0
  for (const r of rows) {
    const next = restampDay(r, graceDays)
    if (!next) continue
    const { day, cur } = next
    try {
      const done = await prisma.$transaction(async (tx) => {
        const n = await tx.uncollectedPaid.updateMany({
          where: { id: r.id, source: "bc", storageFrom: r.storageFrom, status: { notIn: CLOSED_STATUSES } },
          data: { storageFrom: dayToStored(day) },
        })
        if (n.count !== 1) return false   // changed meanwhile — whoever changed it wins
        await tx.uncollectedPaidEvent.create({
          data: { caseId: r.id, kind: "edit", byId: who.id, byName: who.name, text: `Changed ${storageRuleWords(day, graceDays, cur)} — ${why}.` },
        })
        return true
      })
      if (done) moved++
    } catch (e) {
      failed++
      console.error("uncollected storage restamp error:", e)
    }
  }
  return { moved, failed, unread: false }
}

// ─── Per case: the storage switch, and whether the paid date is BC's own ────────────────────

export type CaseStorageFlags = {
  /** The latest storage_waived / storage_resumed event; null = never waived. */
  waiver: StorageWaiver | null
  /** true = paidAt is BC's own paid date (the check's latest line about it says so). */
  paidExact: boolean
}

const chunk = <T,>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Whether each case's paid date is BC's own (EVA_DatePaidByBuyer) or the settled-date stand-in: the
 * BC check's newest line about it (byId null, "created" / "edit", FIRST line only — lot lists follow)
 * says "paid on … (BC's own paid date)" or "paid by …". A case with no such line → false. Throws on
 * a database fault (the callers already handle them).
 */
export async function readPaidExact(ids: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>()
  for (const part of chunk([...new Set(ids)], 500)) {
    if (!part.length) continue
    const rows = await prisma.$queryRaw<{ caseId: string; head: string | null }[]>`
      SELECT DISTINCT ON (e."caseId") e."caseId", split_part(e."text", E'\n', 1) AS "head"
      FROM "UncollectedPaidEvent" e
      WHERE e."caseId" IN (${Prisma.join(part)}) AND e."byId" IS NULL AND e."kind" IN ('created', 'edit')
        AND (split_part(e."text", E'\n', 1) ILIKE ${"%paid by%"} OR strpos(split_part(e."text", E'\n', 1), ${"BC's own paid date"}) > 0)
      ORDER BY e."caseId", e."at" DESC, e."id" DESC`
    for (const r of rows) out.set(r.caseId, paidExactFromText(r.head) === true)
  }
  return out
}

/**
 * For the panel's list and case page: each case's storage switch and paid-date kind, in two queries
 * (any number of ids). Cases missing from the answer have neither (never waived; not BC's own date).
 */
export async function readCaseStorageFlags(ids: string[]): Promise<Map<string, CaseStorageFlags>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, CaseStorageFlags>(unique.map((id) => [id, { waiver: null, paidExact: false }]))
  if (!unique.length) return out
  for (const part of chunk(unique, 500)) {
    const evs = await prisma.uncollectedPaidEvent.findMany({
      where: { caseId: { in: part }, kind: { in: [...STORAGE_SWITCH_KINDS] } },
      orderBy: [{ caseId: "asc" }, { at: "desc" }, { id: "desc" }],
      distinct: ["caseId"],
      select: { caseId: true, kind: true, text: true, byName: true, at: true },
    })
    for (const e of evs) out.get(e.caseId)!.waiver = storageWaiverOf([e])
  }
  for (const [id, exact] of await readPaidExact(unique)) out.get(id)!.paidExact = exact
  return out
}

/**
 * Storage owed today over EVERY open case (the panel's tile, whatever the filters): each case's
 * storage start (or the rule from its paid date), lots still uncollected and storage switch, summed
 * with addStorage. One query. Throws on a database fault.
 */
export async function storageOwedOnOpenCases(settings: StorageSettings, today: string = londonDay()): Promise<StorageTotals> {
  const rows = await prisma.$queryRaw<{ paidAt: Date | null; storageFrom: Date | null; closedAt: Date | null; lots: number | null; switchKind: string | null }[]>`
    SELECT u."paidAt", u."storageFrom", u."closedAt", u."lots", w."kind" AS "switchKind"
    FROM "UncollectedPaid" u
    LEFT JOIN LATERAL (
      SELECT e."kind" FROM "UncollectedPaidEvent" e
      WHERE e."caseId" = u."id" AND e."kind" IN (${Prisma.join([...STORAGE_SWITCH_KINDS])})
      ORDER BY e."at" DESC, e."id" DESC
      LIMIT 1
    ) w ON TRUE
    WHERE u."status" NOT IN (${Prisma.join(CLOSED_STATUSES)})`
  return addStorage(rows.map((r) => storageCharge({
    paidAt: r.paidAt, storageFrom: r.storageFrom, closedAt: r.closedAt,
    lots: r.lots == null ? null : Number(r.lots), waived: r.switchKind === STORAGE_WAIVED,
  }, settings, today)))
}
