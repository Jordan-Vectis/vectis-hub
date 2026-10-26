"use server"

import { createHash } from "node:crypto"
import { revalidatePath } from "next/cache"
import type { Prisma } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { getAccountsAccess } from "@/lib/accounts-auth"
import {
  CLOSED_REFUND_STATUSES, REFUNDS_ADMINS_ONLY, REFUNDS_NOT_READY, REFUNDS_PATH, REFUND_STATUS_META, type RefundResult,
} from "@/lib/refunds"
import { isMissingRefunds, matchCustomerId, nextRefundRef, tidyCustomerNo, writeRefundEvent } from "@/lib/refunds-server"
import {
  REFUND_LOG_MAX_CHARS, parseRefundLog, refundLogStatus, sortRefundLogRows,
  type ParsedRefundRow, type RefundLogImported, type RefundLogPreview, type RefundLogReopen, type RefundLogSkip,
} from "@/lib/refunds-import"
import { dayToStored, isDay } from "@/lib/uncollected"

// Accounts → Refunds → importing the old SharePoint refund log (the CSV saved from it). SERVER ONLY.
//
//  • ADMINS ONLY, like the rest of Refunds: both actions re-check with getAccountsAccess().
//  • The file is read by lib/refunds-import.ts (pure); each row's fingerprint is hashed here (sha256)
//    into Refund.importKey, which is unique — so importing the same file again, or a later export of
//    the log, only ever ADDS the rows that aren't in yet. A row already in is NEVER changed (staff may
//    have worked it since). A row that was imported but has had its total changed in SharePoint since
//    (same Date, name, email, lots and issue — sortRefundLogRows) is not imported a second time either:
//    it's listed as skipped, to be changed in the Hub.
//  • New requests are made oldest first (so their RF numbers run in the log's order), in transactions of
//    IMPORT_BATCH that each commit — a failure part-way keeps everything before it, says how many went
//    in, and pressing Import again carries on (the ones in are never added twice). The box asks for a
//    slice at a time (`max`) so its count moves (design rule 7b).
//  • ⚠ The imported text is kept as it was — it's already in SharePoint — with ONE exception: bank or
//    card details are taken out of every cell before anything is saved (withoutBankDetails, in
//    lib/refunds-import.ts — RULES: a customer's bank details are never stored or shown); the preview
//    says how many rows had some, and each one's timeline says so. Rather than refusing the row the way
//    a typed box is refused (the log can't be edited from here). And it is NEVER logged: a failure logs
//    the error's name, code and what went wrong — never a Prisma validation error's message, which
//    repeats the values it was given.
//  • Most of the log was dealt with ("Liv") but never given a Date processed or Complete for accounts.
//    The admin chooses in the preview whether those come in DONE (the ones that came in before a day
//    they pick — refundLogStatus) or open; the choice is sent with every slice, and each request's
//    timeline says when its status was the choice rather than the log. The box's default is "bring them
//    all in open" (Jack, 2026-10-26: "leave them unticked for now"), and reopenCountedDone undoes the
//    other choice for requests nobody has touched since.
//  • Missing tables → { ok: false, notReady: true } until Run Migrations.

type Who = { id: string; name: string }

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {}

async function requireAdmin(): Promise<Who> {
  const { session, isAdmin } = await getAccountsAccess()
  if (!session || !isAdmin) throw new Refusal(REFUNDS_ADMINS_ONLY)
  return { id: session.user.id, name: session.user.name || session.user.email || "Unknown" }
}

type Failure = { ok: false; error: string; notReady?: boolean }

/** The error's kind and the last line of its message (Prisma's says what went wrong there, after the
 *  code frame) — never a validation error's message, which repeats the row's values. */
function logSafely(what: string, e: unknown) {
  const err = e as { name?: string; code?: string; message?: string } | null
  const lastLine = String(err?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? ""
  const message = err?.name === "PrismaClientValidationError" ? "(values not logged)" : lastLine.slice(0, 300)
  console.error(`refunds import ${what} error:`, JSON.stringify({ name: err?.name ?? null, code: err?.code ?? null, message }))
}

function fail(e: unknown, what: string, fallback: string): Failure {
  if (e instanceof Refusal) return { ok: false, error: e.message }
  if (isMissingRefunds(e)) return { ok: false, error: REFUNDS_NOT_READY, notReady: true }
  logSafely(what, e)
  return { ok: false, error: fallback }
}

const revalidate = () => revalidatePath(REFUNDS_PATH, "layout")

/** New requests per transaction: small enough that a slow moment never runs into the timeout, and
 *  that the public form (which waits on the same RF-number lock) is held up for a second or two at most. */
const IMPORT_BATCH = 25
const TX_OPTIONS = { maxWait: 15_000, timeout: 60_000 }

const NOT_THE_LOG = "That doesn't look like the old refund log — no row has its column names (Date, Title, Email, Issue, Total to refund…). Save the SharePoint Refund Log from Excel as CSV and choose that file."

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

type Planned = { row: ParsedRefundRow; key: string }
type Plan = {
  rows: number
  alreadyImported: number
  toImport: Planned[]
  skipped: RefundLogSkip[]
  repeats: number
}

/** Reads the file and sorts its rows into already in the Hub, skipped and to import (oldest first). */
async function plan(text: unknown): Promise<Plan> {
  if (typeof text !== "string" || !text.trim()) throw new Refusal("That file is empty — choose the CSV saved from the refund log.")
  if (text.length > REFUND_LOG_MAX_CHARS) {
    throw new Refusal(`That file is too big for the refund log — ${REFUND_LOG_MAX_CHARS.toLocaleString("en-GB")} characters at most. Check it's the right file.`)
  }
  const parsed = parseRefundLog(text)
  if (!parsed.headerFound) throw new Refusal(NOT_THE_LOG)

  const rows = parsed.rows.map((row) => ({ row, key: sha256(row.importKey) }))
  const existing = await prisma.refund.findMany({ where: { importKey: { not: null } }, select: { importKey: true, importedRaw: true } })
  const sorted = sortRefundLogRows(rows, existing)
  const skipped = [...parsed.skipped, ...sorted.changed].sort((a, b) => a.line - b.line)
  return { rows: rows.length, alreadyImported: sorted.alreadyImported, toImport: sorted.toImport, skipped, repeats: parsed.repeats }
}

/** "Check file": what importing this file would do — nothing is written. */
export async function previewRefundLog(text: string): Promise<RefundResult<RefundLogPreview>> {
  try {
    await requireAdmin()
    const p = await plan(text)
    const byStatus: Record<string, number> = {}
    const dealt: RefundLogPreview["dealt"] = []
    for (const { row } of p.toImport) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
      if (row.dealtNotDone && (row.status === "agreed" || row.status === "looking")) dealt.push({ receivedAt: row.receivedAt, status: row.status })
    }
    return {
      ok: true,
      data: {
        rows: p.rows,
        alreadyImported: p.alreadyImported,
        toImport: p.toImport.length,
        skipped: p.skipped,
        byStatus,
        repeats: p.repeats,
        datesFromProcessed: p.toImport.filter((t) => t.row.receivedFromProcessed).length,
        bankDetailsRemoved: p.toImport.filter((t) => t.row.bankDetailsRemoved > 0).length,
        dealt,
      },
    }
  } catch (e) {
    return fail(e, "preview", "The file couldn't be checked just now — please try again.")
  }
}

const IMPORTED_BY = "Old refund log"
/** Who "ticked" complete for accounts on a row counted done at import (the log never said). */
const COUNTED_DONE_BY = "Import (old log: dealt with)"
/** In the first timeline line of every request counted done at import (importedWords) — other notes,
 *  such as bank details taken out, can follow it, so it's looked for with `contains`. */
const CHOSEN_AT_IMPORT = "(chosen at import)"
/** In that line when the choice made it Paid (importedWords) — otherwise it was made Closed. */
const COUNTED_PAID_WORDS = "came in as Paid"
/** The words of the timeline line reopenCountedDone writes — how a later look counts it as done already. */
const BROUGHT_BACK_OPEN = "brought back open"
const REOPENED_WHY = ": the import had counted it as done, but the old log never said it was processed"

/** The timeline's first line: imported — and anything the import decided rather than the log said. */
function importedWords(r: ParsedRefundRow, s: ReturnType<typeof refundLogStatus>): string {
  const parts = ["Imported from the old refund log"]
  if (s.countedDone) {
    const by = r.dealtWithName ? `dealt with by ${r.dealtWithName}` : "dealt with"
    parts.push(s.status === "paid"
      ? `the log says ${by} but has no Date processed or Complete for accounts, so it ${COUNTED_PAID_WORDS} and complete for accounts ${CHOSEN_AT_IMPORT}`
      : `the log says ${by} but has no amount, Date processed or Complete for accounts, so it came in as Closed ${CHOSEN_AT_IMPORT}`)
  } else if (s.status === "declined") {
    parts.push("its Solution says there was no refund, so it came in as Declined")
  }
  if (r.bankDetailsRemoved) parts.push("bank or card details were taken out of it — they're never kept in the Hub")
  return parts.join(" — ")
}

/** One row as a new request: its lots (the money per lot only when there's exactly one — the request
 *  keeps the log's total either way, lib/refunds.ts refundTotalToSave), the old log's cells, and the
 *  timeline's first line. Days stored at 12:00 UTC of the London day (dayToStored). */
async function createFromRow(tx: Prisma.TransactionClient, p: Planned, customerId: string | null, who: Who, doneBefore: string | null): Promise<void> {
  const r = p.row
  const one = r.lots.length === 1
  const receivedAt = dayToStored(r.receivedAt)
  const processedAt = r.processedAt ? dayToStored(r.processedAt) : null
  const s = refundLogStatus(r, doneBefore)
  const countedPaid = s.countedDone && s.status === "paid"
  const ref = await nextRefundRef(tx)
  const created = await tx.refund.create({
    data: {
      ref,
      source: "import",
      importKey: p.key,
      receivedAt,
      name: r.name,
      email: r.email,
      customerNo: tidyCustomerNo(r.customerNo),
      customerId,
      party: r.party,
      auctionDate: r.auctionDate ? dayToStored(r.auctionDate) : null,
      lotsText: r.lotsText,
      reason: r.reason,
      details: r.details,
      status: s.status,
      solution: r.solution,
      percentText: r.percentText,
      hammerPence: r.hammerPence,
      commissionPence: r.commissionPence,
      postagePence: r.postagePence,
      totalPence: r.totalPence,
      refCode: r.refCode,
      dealtWithName: r.dealtWithName,
      processedAt,
      accountsDoneAt: r.accountsDone ? (processedAt ?? receivedAt) : countedPaid ? receivedAt : null,
      accountsDoneBy: r.accountsDone ? IMPORTED_BY : countedPaid ? COUNTED_DONE_BY : null,
      importedRaw: r.raw,
      // Closed (paid, declined, counted done) without a Date processed: closed on the day it came in,
      // so its days-open count stops rather than running on for ever.
      closedAt: CLOSED_REFUND_STATUSES.includes(s.status) ? (processedAt ?? receivedAt) : null,
      lots: {
        create: r.lots.map((lotNo, position) => ({
          position,
          lotNo,
          hammerPence: one ? r.hammerPence : null,
          commissionPence: one ? r.commissionPence : null,
          basis: one ? r.basis : "percent",
          percent: one ? r.percent : null,
          setAmountPence: one && r.basis === "set" ? r.setAmountPence : null,
        })),
      },
    },
    select: { id: true },
  })
  await writeRefundEvent(tx, created.id, "created", importedWords(r, s), who)
}

/**
 * Imports the file's new rows (all of them, or the first `max` — the box asks 50 at a time so its
 * count moves). Rows already in are never changed. Answers how many went in, how many were in already
 * and how many are left; if something fails part-way, how many went in before it.
 *
 * `doneBefore` (YYYY-MM-DD) is the admin's choice for rows dealt with but never processed: those that
 * came in before that day come in done (refundLogStatus); null brings every one in open.
 */
export async function importRefundLog(text: string, max?: number, doneBefore?: string | null): Promise<RefundResult<RefundLogImported>> {
  let imported = 0
  let todo = 0
  try {
    const who = await requireAdmin()
    if (doneBefore != null && (typeof doneBefore !== "string" || !isDay(doneBefore))) {
      throw new Refusal("The day for counting old rows as done doesn't read — pick it again from the calendar.")
    }
    const p = await plan(text)
    const limit = typeof max === "number" && Number.isInteger(max) && max > 0 ? Math.min(max, 1000) : p.toImport.length
    const slice = p.toImport.slice(0, limit)
    todo = slice.length

    // The customers first, outside the transactions (matchCustomerId never throws) — once per C-number.
    const customers = new Map<string, string | null>()
    for (const { row } of slice) {
      const no = tidyCustomerNo(row.customerNo)
      if (no && !customers.has(no)) customers.set(no, await matchCustomerId(no))
    }

    let raced = 0
    for (let i = 0; i < slice.length; i += IMPORT_BATCH) {
      const batch = slice.slice(i, i + IMPORT_BATCH)
      const made = await prisma.$transaction(async (tx) => {
        // One import at a time: a second admin's import waits here, then finds these rows already in.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('refund-import'))`
        const inAlready = new Set(
          (await tx.refund.findMany({ where: { importKey: { in: batch.map((b) => b.key) } }, select: { importKey: true } })).map((r) => r.importKey),
        )
        let n = 0
        for (const b of batch) {
          if (inAlready.has(b.key)) continue
          const no = tidyCustomerNo(b.row.customerNo)
          await createFromRow(tx, b, no ? customers.get(no) ?? null : null, who, doneBefore ?? null)
          n++
        }
        raced += batch.length - n
        return n
      }, TX_OPTIONS)
      imported += made
    }

    if (imported) revalidate()
    return {
      ok: true,
      data: {
        imported,
        alreadyImported: p.alreadyImported + raced,
        skipped: p.skipped.length,
        remaining: p.toImport.length - slice.length,
      },
    }
  } catch (e) {
    if (imported > 0) {
      revalidate()
      logSafely("import (part-way)", e)
      return {
        ok: false,
        error: `${imported.toLocaleString("en-GB")} of ${todo.toLocaleString("en-GB")} went in, then something went wrong and the rest didn't. Press Import again to add the rest — the ones already in are never added twice.`,
      }
    }
    return fail(e, "import", "Nothing was imported — something went wrong. Please try again.")
  }
}

/**
 * Undoes "Count them as done" (2026-10-26: the first import on staging went in with it while Jack
 * wanted those rows left open). An imported request whose status was the import's CHOICE rather than
 * the log's — its first timeline line contains CHOSEN_AT_IMPORT, and says which (COUNTED_PAID_WORDS or
 * Closed) — goes back to the status the log gave it, but ONLY while it's untouched: still in the very
 * status the import chose, as the import left it (Paid with the import's own accounts tick, or Closed
 * with none; no date processed), and nothing at all on its timeline since. Counted Paid → To pay
 * (complete for accounts comes off); counted Closed → Being looked at. Each one's timeline says so — and
 * that line (BROUGHT_BACK_OPEN … REOPENED_WHY) is how a later look counts it as done already, never as
 * changed. Each row is locked first and its timeline counted afresh, so something done to it at the
 * same moment (a note, an edit) is seen and the row left alone.
 * Anything a person has touched is left alone and counted. `apply` false only counts — nothing written.
 */
export async function reopenCountedDone(apply: boolean): Promise<RefundResult<RefundLogReopen>> {
  let reopened = 0
  try {
    const who = await requireAdmin()
    const marked = await prisma.refundEvent.findMany({
      where: { kind: "created", text: { contains: CHOSEN_AT_IMPORT }, refund: { source: "import" } },
      select: { refundId: true, text: true },
    })
    const chosen = new Map(marked.map((m) => [m.refundId, (m.text ?? "").includes(COUNTED_PAID_WORDS) ? "paid" as const : "closed" as const]))
    const found = chosen.size
      ? await prisma.refund.findMany({
        where: { id: { in: [...chosen.keys()] } },
        select: {
          id: true, status: true, processedAt: true, accountsDoneBy: true,
          events: { where: { kind: { not: "created" } }, select: { kind: true, text: true } },
        },
      })
      : []
    const asLeft = (r: (typeof found)[number]) => {
      const choice = chosen.get(r.id)
      return r.events.length === 0 && r.status === choice && r.processedAt == null
        && r.accountsDoneBy === (choice === "paid" ? COUNTED_DONE_BY : null)
    }
    const alreadyReopened = found.filter((r) => r.events.some((ev) => ev.kind === "status"
      && (ev.text ?? "").includes(BROUGHT_BACK_OPEN) && (ev.text ?? "").endsWith(REOPENED_WHY))).length
    const todo = found.filter(asLeft)
    const changed = found.length - todo.length - alreadyReopened
    if (apply !== true) return { ok: true, data: { reopen: todo.length, changedSince: changed, alreadyReopened } }

    for (let i = 0; i < todo.length; i += IMPORT_BATCH) {
      const batch = todo.slice(i, i + IMPORT_BATCH)
      reopened += await prisma.$transaction(async (tx) => {
        let n = 0
        for (const r of batch) {
          const from = chosen.get(r.id) === "paid" ? "paid" : "closed"
          const to = from === "paid" ? "agreed" : "looking"
          // The same test again, under the row's lock: the lock waits out anything being saved to it right
          // now, and the count after it sees that (each statement reads afresh) — so it's left alone.
          await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${r.id} FOR UPDATE`
          if (await tx.refundEvent.count({ where: { refundId: r.id, kind: { not: "created" } } }) > 0) continue
          const done = await tx.refund.updateMany({
            where: {
              id: r.id, status: from, processedAt: null, accountsDoneBy: from === "paid" ? COUNTED_DONE_BY : null,
              events: { none: { kind: { not: "created" } } },
            },
            data: { status: to, closedAt: null, accountsDoneAt: null, accountsDoneBy: null },
          })
          if (done.count === 0) continue
          const tick = from === "paid" ? ", complete for accounts taken off" : ""
          await writeRefundEvent(tx, r.id, "status",
            `${REFUND_STATUS_META[from].label} → ${REFUND_STATUS_META[to].label} — ${BROUGHT_BACK_OPEN}${tick}${REOPENED_WHY}`, who)
          n++
        }
        return n
      }, TX_OPTIONS)
    }
    if (reopened) revalidate()
    return { ok: true, data: { reopen: reopened, changedSince: changed + (todo.length - reopened), alreadyReopened } }
  } catch (e) {
    if (reopened > 0) {
      revalidate()
      logSafely("reopen (part-way)", e)
      return { ok: false, error: `${reopened.toLocaleString("en-GB")} were brought back open, then something went wrong. Press Find them again for the rest — one already brought back is never changed twice.` }
    }
    return fail(e, "reopen", "Nothing was changed — something went wrong. Please try again.")
  }
}
