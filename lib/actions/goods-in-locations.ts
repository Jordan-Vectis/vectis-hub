"use server"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { revalidatePath } from "next/cache"
import { GoodsInAccessError, requireGoodsIn } from "@/lib/goods-in/access"
import type { WarehouseRole } from "@/lib/apps"
import { LOCATION_KINDS, STATUS_FOR_KIND, normaliseCode, type LocationKind } from "@/lib/goods-in/model"
import { LOCATION_CODE_HELP, LOCATION_CODE_RULE, MAX_BULK_LOCATIONS, compareCodes, defaultLocationName } from "@/lib/goods-in/location-codes"
import type { Result } from "@/lib/actions/goods-in"

// Goods In → Locations: the many-at-once tools — add a run or a pasted list, remove, switch on or
// off, change kind or names, edit one, empty a location into another, and list what is at some
// locations for a spreadsheet. SERVER ONLY (server actions).
//
// ⚠ Each action RETURNS { ok, error } rather than throwing (a thrown server-action error is
// redacted in production — RULES.md). Changing locations is a manager's; moving goods and reading
// what is where is anyone's in Goods In. Nothing here reads or writes Business Central.
//
// ⚠⚠ GoodsInMovement keeps location codes as TEXT with no foreign key, so a location that has ever
// been used is never deleted — removing it switches it off and its history still reads. Only a
// location nothing has ever been to or from is really deleted, and one with goods there now is
// refused until they're moved.
//
// ⚠ Locks. Every statement that changes several locations locks their rows IN CODE ORDER first, so
// two managers changing overlapping lists queue rather than deadlock. moveEverything holds its
// target location FOR SHARE, so a remove or switch-off of that location waits for the move (and
// then sees the goods), or the move waits for it (and then finds it gone or switched off) — goods
// can never land at a location being deleted. (moveTo in goods-in.ts doesn't take that lock yet.)

export type BulkProblem = { code: string; reason: string }

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {}

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof Refusal || e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  const msg = String((e as { message?: string })?.message ?? e)
  if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2028") || /expired transaction|transaction already closed/i.test(msg)) {
    return { ok: false, error: "That took too long and nothing was changed — try again with fewer at once." }
  }
  // Two people changing the same locations at the same moment: Postgres stops one of them and
  // rolls it back, so "nothing was changed" is true — and Prisma's own wording means nothing here.
  if ((e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") || /40P01|deadlock detected|40001|could not serialize/i.test(msg)) {
    return { ok: false, error: "Someone else was changing the same locations at that moment — nothing was changed. Try again." }
  }
  if (/does not exist|relation .*GoodsIn/i.test(msg)) return { ok: false, error: "Goods In isn't set up on this environment yet — an admin needs to press Run Migrations." }
  console.error("goods-in locations action error:", e)
  return { ok: false, error: msg.length < 200 ? msg : "Something went wrong — please try again." }
}

const who = (minRole: WarehouseRole = "warehouse") => requireGoodsIn(minRole)

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

const KINDS = new Set<string>(LOCATION_KINDS.map(k => k.value))
const isKind = (k: unknown): k is LocationKind => typeof k === "string" && KINDS.has(k)
const KIND_HELP = "use storage, bench, shelf or other"

const count = (n: number) => n.toLocaleString("en-GB")
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`
const byCode = <T extends { code: string }>(a: T, b: T) => compareCodes(a.code, b.code)

/** The codes asked about, normalised and once each — or the reason there's nothing to do. */
function cleanCodes(raw: unknown, doing: string): { ok: true; codes: string[] } | { ok: false; error: string } {
  const list = Array.isArray(raw) ? raw : []
  const codes = [...new Set(list.filter((c): c is string => typeof c === "string").map(normaliseCode).filter(Boolean))]
  if (codes.length === 0) return { ok: false, error: "Choose at least one location first." }
  if (codes.length > MAX_BULK_LOCATIONS) {
    return { ok: false, error: `That's ${count(codes.length)} locations — no more than ${count(MAX_BULK_LOCATIONS)} can be ${doing} at once.` }
  }
  return { ok: true, codes }
}

type Goods = { totes: number; lots: number }

/**
 * What is at each of these locations NOW: totes and pallets whose location is the code and which
 * haven't gone back to the customer (a null status counts as there), and lots whose LATEST move was
 * to the code (a lot's shelf is its latest move). Only codes holding something are in the map.
 */
async function goodsAt(db: Prisma.TransactionClient, codes: string[]): Promise<Map<string, Goods>> {
  const out = new Map<string, Goods>()
  if (codes.length === 0) return out
  const containers = await db.goodsInContainer.groupBy({
    by: ["locationCode"],
    _count: { _all: true },
    where: { locationCode: { in: codes }, OR: [{ status: null }, { status: { not: "returned" } }] },
  })
  // Only lots that have ever been moved to one of these codes can have one as their latest move,
  // so the latest-move search is limited to them; the filter on the code comes AFTER DISTINCT ON —
  // before it, it would find every lot that was ever there.
  const lots = await db.$queryRaw<{ code: string; n: number }[]>`
    SELECT latest."locationCode" AS code, COUNT(*)::int AS n
    FROM (
      SELECT DISTINCT ON (m."lotId") m."lotId", m."locationCode"
      FROM "GoodsInMovement" m
      WHERE m."lotId" IN (
        SELECT "lotId" FROM "GoodsInMovement"
        WHERE "lotId" IS NOT NULL AND "locationCode" = ANY(${codes}::text[])
      )
      ORDER BY m."lotId", m."movedAt" DESC
    ) latest
    WHERE latest."locationCode" = ANY(${codes}::text[])
    GROUP BY latest."locationCode"`
  for (const c of containers) {
    if (c.locationCode && c._count._all > 0) out.set(c.locationCode, { totes: c._count._all, lots: 0 })
  }
  for (const l of lots) {
    const n = Number(l.n)
    if (n > 0) out.set(l.code, { totes: out.get(l.code)?.totes ?? 0, lots: n })
  }
  return out
}

const goodsWords = (g: Goods) =>
  [g.totes ? plural(g.totes, "tote or pallet", "totes or pallets") : null, g.lots ? plural(g.lots, "lot", "lots") : null].filter(Boolean).join(" and ")

/** Every one of these codes that anything has ever been moved to or from, or that any tote or pallet (even a returned one) was left at. */
async function everUsed(db: Prisma.TransactionClient, codes: string[]): Promise<Set<string>> {
  if (codes.length === 0) return new Set()
  const rows = await db.$queryRaw<{ code: string }[]>`
    SELECT "locationCode" AS code FROM "GoodsInMovement" WHERE "locationCode" = ANY(${codes}::text[])
    UNION
    SELECT "fromCode" AS code FROM "GoodsInMovement" WHERE "fromCode" = ANY(${codes}::text[])
    UNION
    SELECT "locationCode" AS code FROM "GoodsInContainer" WHERE "locationCode" = ANY(${codes}::text[])`
  return new Set(rows.map(r => r.code))
}

// ─── Adding ───────────────────────────────────────────────────────────────────────────────

/**
 * Manager+. Adds NEW locations only — a code that is already a location is listed in `already` and
 * left exactly as it is (name, kind and on/off untouched). Codes are normalised and must pass
 * LOCATION_CODE_RULE; the kind must be storage, bench, shelf or other; the name is trimmed, cut to
 * 120 characters, and blank means none. A code given twice is added once (the first wins). Rows that
 * can't be added are listed in `problems`. `added` keeps the order the rows came in.
 */
export async function createLocations(
  rows: { code: string; name?: string | null; kind: LocationKind }[],
): Promise<Result<{ added: string[]; already: string[]; problems: BulkProblem[] }>> {
  try {
    await who("manager")
    const list = Array.isArray(rows) ? rows : []
    if (list.length === 0) return { ok: false, error: "There are no locations to add." }
    const codeOf = (r: unknown) => normaliseCode(typeof (r as { code?: unknown })?.code === "string" ? (r as { code: string }).code : "")
    const distinct = new Set(list.map(codeOf))
    if (distinct.size > MAX_BULK_LOCATIONS) {
      return { ok: false, error: `That's ${count(distinct.size)} locations — no more than ${count(MAX_BULK_LOCATIONS)} can be added at once.` }
    }

    const problems: BulkProblem[] = []
    const wanted = new Map<string, { code: string; name: string | null; kind: LocationKind; active: boolean }>()
    const refused = new Set<string>()
    for (const r of list) {
      const code = codeOf(r)
      if (wanted.has(code) || refused.has(code)) continue
      if (!code) { refused.add(code); problems.push({ code: "", reason: "One of them has no location code." }); continue }
      if (!LOCATION_CODE_RULE.test(code)) { refused.add(code); problems.push({ code, reason: LOCATION_CODE_HELP }); continue }
      if (!isKind(r.kind)) {
        refused.add(code)
        problems.push({ code, reason: r.kind ? `"${String(r.kind)}" isn't a kind of location — ${KIND_HELP}.` : `No kind was chosen for it — ${KIND_HELP}.` })
        continue
      }
      wanted.set(code, { code, name: blank(r.name)?.slice(0, 120) ?? null, kind: r.kind, active: true })
    }
    if (wanted.size === 0) return { ok: true, data: { added: [], already: [], problems } }

    // skipDuplicates leaves an existing location alone, and RETURNING says exactly which were made —
    // so a code someone else added a moment ago is reported as already there, never as added.
    const made = await prisma.goodsInLocation.createManyAndReturn({ data: [...wanted.values()], skipDuplicates: true, select: { code: true } })
    const madeSet = new Set(made.map(m => m.code))
    const added = [...wanted.keys()].filter(c => madeSet.has(c))
    const already = [...wanted.keys()].filter(c => !madeSet.has(c))
    if (added.length) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { added, already, problems } }
  } catch (e) { return fail(e) }
}

// ─── Removing ─────────────────────────────────────────────────────────────────────────────

/**
 * Manager+. For each location:
 *  - not a location → `blocked` ("There's no location X.") — and also listed in `missing`, so the
 *    screen can untick it
 *  - goods there now (a tote or pallet not returned, or a lot whose latest move is there) → `blocked`,
 *    saying how many and to move them first
 *  - ever used (a move into or out of it, or any tote or pallet — even a returned one — recorded
 *    there) → switched off and listed in `switchedOff`, so its history still reads (ones already off
 *    are listed too)
 *  - never used → deleted, listed in `removed`.
 * All in one transaction with the locations locked; the DELETE re-checks "never used" itself, so a
 * move that lands between the check and the delete turns a delete into a switch-off.
 */
export async function removeLocations(codes: string[]): Promise<Result<{ removed: string[]; switchedOff: string[]; blocked: BulkProblem[]; missing: string[] }>> {
  try {
    await who("manager")
    const asked = cleanCodes(codes, "removed")
    if (!asked.ok) return asked

    const out = await prisma.$transaction(async tx => {
      // Lock the rows (in code order, so two managers removing overlapping lists queue rather than
      // deadlock) — a concurrent edit or remove of the same location waits for this one.
      const found = await tx.$queryRaw<{ code: string }[]>`
        SELECT "code" FROM "GoodsInLocation" WHERE "code" = ANY(${asked.codes}::text[]) ORDER BY "code" FOR UPDATE`
      const exists = new Set(found.map(f => f.code))
      const here = [...exists]
      const goods = await goodsAt(tx, here)
      const used = await everUsed(tx, here)

      const blocked: BulkProblem[] = []
      const missing: string[] = []
      const toSwitchOff: string[] = []
      const toDelete: string[] = []
      for (const code of asked.codes) {
        const g = goods.get(code)
        if (!exists.has(code)) { blocked.push({ code, reason: `There's no location ${code}.` }); missing.push(code) }
        else if (g) {
          const n = g.totes + g.lots
          blocked.push({ code, reason: `${n === 1 ? "There's" : "There are"} still ${goodsWords(g)} at ${code} — move ${n === 1 ? "it" : "them"} somewhere else first.` })
        } else if (used.has(code)) toSwitchOff.push(code)
        else toDelete.push(code)
      }

      // Only a location nothing has ever been to or from — checked again by the DELETE itself.
      const deleted = toDelete.length
        ? await tx.$queryRaw<{ code: string }[]>`
            DELETE FROM "GoodsInLocation" l
            WHERE l."code" = ANY(${toDelete}::text[])
              AND NOT EXISTS (SELECT 1 FROM "GoodsInMovement" m WHERE m."locationCode" = l."code")
              AND NOT EXISTS (SELECT 1 FROM "GoodsInMovement" m WHERE m."fromCode" = l."code")
              AND NOT EXISTS (SELECT 1 FROM "GoodsInContainer" c WHERE c."locationCode" = l."code")
            RETURNING l."code" AS code`
        : []
      const removed = new Set(deleted.map(d => d.code))
      for (const code of toDelete) if (!removed.has(code)) toSwitchOff.push(code)

      const off = toSwitchOff.length
        ? await tx.$queryRaw<{ code: string }[]>`
            UPDATE "GoodsInLocation" SET "active" = false WHERE "code" = ANY(${toSwitchOff}::text[]) RETURNING "code" AS code`
        : []
      const switched = new Set(off.map(o => o.code))
      for (const code of toSwitchOff) if (!switched.has(code)) { blocked.push({ code, reason: `There's no location ${code}.` }); missing.push(code) }

      return {
        removed: [...removed].sort(compareCodes),
        switchedOff: [...switched].sort(compareCodes),
        blocked: blocked.sort(byCode),
        missing: missing.sort(compareCodes),
      }
    }, { timeout: 30_000 })

    if (out.removed.length || out.switchedOff.length) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}

// ─── Switching on and off, changing kind or names, editing one ────────────────────────────

/**
 * Manager+. Switch locations on or off. `changed` is every location found, now in that state
 * (including any that already were); `missing` the codes that aren't locations. When switching
 * OFF, `withGoods` lists the ones that still hold goods — they ARE switched off, as the single edit
 * form does, but the screen should warn that nothing new can be moved there.
 */
export async function setLocationsActive(
  codes: string[],
  active: boolean,
): Promise<Result<{ changed: string[]; withGoods: { code: string; totes: number; lots: number }[]; missing: string[] }>> {
  try {
    await who("manager")
    if (typeof active !== "boolean") return { ok: false, error: "Say whether to switch them on or off." }
    const asked = cleanCodes(codes, "changed")
    if (!asked.ok) return asked

    // Rows locked in code order first (see the note at the top), then changed.
    const rows = await prisma.$queryRaw<{ code: string }[]>`
      UPDATE "GoodsInLocation" l SET "active" = ${active}
      FROM (SELECT "code" FROM "GoodsInLocation" WHERE "code" = ANY(${asked.codes}::text[]) ORDER BY "code" FOR UPDATE) s
      WHERE l."code" = s."code"
      RETURNING l."code" AS code`
    const changed = rows.map(r => r.code).sort(compareCodes)
    const found = new Set(changed)
    const missing = asked.codes.filter(c => !found.has(c)).sort(compareCodes)

    let withGoods: { code: string; totes: number; lots: number }[] = []
    if (!active && changed.length) {
      const goods = await goodsAt(prisma, changed)
      withGoods = [...goods].map(([code, g]) => ({ code, totes: g.totes, lots: g.lots })).sort(byCode)
    }
    if (changed.length) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { changed, withGoods, missing } }
  } catch (e) { return fail(e) }
}

/**
 * Manager+. Change the kind of many locations at once. `changed` is every location found, now of
 * that kind (including any that already were); `missing` the codes that aren't locations. Totes and
 * pallets already there keep their status and recorded kind — exactly as the single edit form — and
 * take the new kind's status the next time they're moved.
 */
export async function setLocationsKind(codes: string[], kind: LocationKind): Promise<Result<{ changed: string[]; missing: string[] }>> {
  try {
    await who("manager")
    if (!isKind(kind)) return { ok: false, error: `That isn't a kind of location — ${KIND_HELP}.` }
    const asked = cleanCodes(codes, "changed")
    if (!asked.ok) return asked

    const rows = await prisma.$queryRaw<{ code: string }[]>`
      UPDATE "GoodsInLocation" l SET "kind" = ${kind}
      FROM (SELECT "code" FROM "GoodsInLocation" WHERE "code" = ANY(${asked.codes}::text[]) ORDER BY "code" FOR UPDATE) s
      WHERE l."code" = s."code"
      RETURNING l."code" AS code`
    const changed = rows.map(r => r.code).sort(compareCodes)
    const found = new Set(changed)
    const missing = asked.codes.filter(c => !found.has(c)).sort(compareCodes)
    if (changed.length) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { changed, missing } }
  } catch (e) { return fail(e) }
}

/**
 * Manager+. Give many locations their usual name ("usual": A10A1 → "Aisle 10, Bay A, Shelf 1",
 * BENCH3 → "Bench 3", CAB5E → "Cabinet 5, Shelf E") or take their names away ("clear"). A named
 * area (RETURNED, DISPOSAL…) has no usual name, so with "usual" it is left alone and listed in
 * `skipped`. `changed` is every location found that now has that name (including any that already
 * had); `missing` the codes that aren't locations.
 */
export async function setLocationsName(codes: string[], mode: "usual" | "clear"): Promise<Result<{ changed: string[]; skipped: string[]; missing: string[] }>> {
  try {
    await who("manager")
    if (mode !== "usual" && mode !== "clear") return { ok: false, error: "Say whether to give them their usual names or clear them." }
    const asked = cleanCodes(codes, "changed")
    if (!asked.ok) return asked

    const skipped: string[] = []
    const targets: string[] = []
    // "" stands for no name in the array sent to Postgres (NULLIF below) — no nulls inside a text[] parameter.
    const names: string[] = []
    for (const code of asked.codes) {
      const name = mode === "usual" ? defaultLocationName(code) : null
      if (mode === "usual" && !name) { skipped.push(code); continue }
      targets.push(code)
      names.push(name ?? "")
    }
    if (targets.length === 0) return { ok: true, data: { changed: [], skipped: skipped.sort(compareCodes), missing: [] } }

    const rows = await prisma.$queryRaw<{ code: string }[]>`
      UPDATE "GoodsInLocation" l SET "name" = NULLIF(v.name, '')
      FROM (SELECT "code" FROM "GoodsInLocation" WHERE "code" = ANY(${targets}::text[]) ORDER BY "code" FOR UPDATE) s,
           unnest(${targets}::text[], ${names}::text[]) AS v(code, name)
      WHERE l."code" = s."code" AND v.code = l."code"
      RETURNING l."code" AS code`
    const changed = rows.map(r => r.code).sort(compareCodes)
    const found = new Set(changed)
    const missing = targets.filter(c => !found.has(c)).sort(compareCodes)
    if (changed.length) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { changed, skipped: skipped.sort(compareCodes), missing } }
  } catch (e) { return fail(e) }
}

/**
 * Manager+. Change ONE existing location — only the fields given are written, so changing the
 * kind never puts back a name someone else has just changed. It never makes a location: if the code
 * has gone (someone removed it a moment ago) nothing is written and `found` is false. (saveLocation
 * in goods-in.ts is an upsert, which would quietly bring a removed location back.)
 */
export async function updateLocation(input: { code: string; name?: string | null; kind?: LocationKind; active?: boolean }): Promise<Result<{ found: boolean }>> {
  try {
    await who("manager")
    const code = normaliseCode(typeof input?.code === "string" ? input.code : "")
    if (!code) return { ok: false, error: "Which location?" }
    const data: { name?: string | null; kind?: LocationKind; active?: boolean } = {}
    if (input.name !== undefined) data.name = blank(input.name)?.slice(0, 120) ?? null
    if (input.kind !== undefined) {
      if (!isKind(input.kind)) return { ok: false, error: `That isn't a kind of location — ${KIND_HELP}.` }
      data.kind = input.kind
    }
    if (input.active !== undefined) {
      if (typeof input.active !== "boolean") return { ok: false, error: "Say whether it is in use." }
      data.active = input.active
    }
    if (Object.keys(data).length === 0) return { ok: true, data: { found: true } }
    const r = await prisma.goodsInLocation.updateMany({ where: { code }, data })
    if (r.count > 0) revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: { found: r.count > 0 } }
  } catch (e) { return fail(e) }
}

// ─── Emptying a location into another ─────────────────────────────────────────────────────

/**
 * Any Goods In user (the same as Scan to move). Moves every tote and pallet at `fromCode` that
 * hasn't gone back to the customer, and every lot whose latest move is to `fromCode`, to `toCode` —
 * one movement each, noted "Moved everything from {from}" (plus the note given), with who and when.
 * A tote's status follows moveTo's rule: catalogued (or returned) keeps its status, anything else
 * takes the status for the new location's kind. `toCode` must be a location, switched on, and not
 * `fromCode`; `fromCode` may be switched off — emptying it is the point. One transaction: either
 * everything moves or nothing does. No more than MAX_BULK_LOCATIONS items at once.
 */
export async function moveEverything(fromCode: string, toCode: string, note?: string | null): Promise<Result<{ totes: string[]; lots: number; to: string }>> {
  try {
    const me = await who()
    const from = normaliseCode(typeof fromCode === "string" ? fromCode : "")
    const to = normaliseCode(typeof toCode === "string" ? toCode : "")
    if (!from) return { ok: false, error: "Which location are the goods coming from?" }
    if (!to) return { ok: false, error: "Scan or type the location to move everything to." }
    if (from === to) return { ok: false, error: `Everything is already at ${from} — choose a different location to move it to.` }
    const userNote = blank(note)?.slice(0, 500) ?? null
    const movementNote = userNote ? `Moved everything from ${from} — ${userNote}` : `Moved everything from ${from}`

    const out = await prisma.$transaction(async tx => {
      // FOR SHARE: a remove or switch-off of the target waits until this move is done (and then
      // sees the goods), or this waits for it — and then finds it gone or switched off.
      const [loc] = await tx.$queryRaw<{ code: string; kind: string | null; active: boolean | null }[]>`
        SELECT "code", "kind", "active" FROM "GoodsInLocation" WHERE "code" = ${to} FOR SHARE`
      if (!loc) throw new Refusal(`There's no location ${to} — add it in Goods In → Locations first.`)
      if (loc.active === false) throw new Refusal(`Location ${to} is switched off — choose another, or switch it on first.`)
      const kind: LocationKind = isKind(loc.kind) ? loc.kind : "storage"

      // Locked, so a tote someone moves at the same moment is moved once, not twice.
      const containers = await tx.$queryRaw<{ id: string; status: string | null }[]>`
        SELECT "id", "status" FROM "GoodsInContainer"
        WHERE "locationCode" = ${from} AND ("status" IS NULL OR "status" <> 'returned')
        ORDER BY "id"
        FOR UPDATE`
      // Lots whose LATEST move is to `from` (a lot's shelf is its latest move). Each new move carries
      // the lot's barcode as it is NOW — as moveTo records it — so a barcode corrected in the lot
      // editor since it was shelved is the one History finds.
      const lots = await tx.$queryRaw<{ lotId: string; barcode: string | null }[]>`
        SELECT latest."lotId", COALESCE(cl."barcode", latest."barcode") AS "barcode"
        FROM (
          SELECT DISTINCT ON (m."lotId") m."lotId", m."barcode", m."locationCode"
          FROM "GoodsInMovement" m
          WHERE m."lotId" IN (
            SELECT "lotId" FROM "GoodsInMovement" WHERE "lotId" IS NOT NULL AND "locationCode" = ${from}
          )
          ORDER BY m."lotId", m."movedAt" DESC
        ) latest
        LEFT JOIN "CatalogueLot" cl ON cl."id" = latest."lotId"
        WHERE latest."locationCode" = ${from}`

      const total = containers.length + lots.length
      if (total === 0) throw new Refusal(`There's nothing at ${from} to move.`)
      if (total > MAX_BULK_LOCATIONS) {
        throw new Refusal(`There are ${count(total)} totes, pallets and lots at ${from} — no more than ${count(MAX_BULK_LOCATIONS)} can be moved in one go. Move some of them with Scan to move first.`)
      }

      const now = new Date()
      const keeps = (s: string | null) => s === "catalogued" || s === "returned"
      const keepIds = containers.filter(c => keeps(c.status)).map(c => c.id)
      const restatusIds = containers.filter(c => !keeps(c.status)).map(c => c.id)
      if (keepIds.length) {
        await tx.goodsInContainer.updateMany({ where: { id: { in: keepIds } }, data: { locationCode: to, locationKind: kind, movedAt: now } })
      }
      if (restatusIds.length) {
        await tx.goodsInContainer.updateMany({ where: { id: { in: restatusIds } }, data: { locationCode: to, locationKind: kind, movedAt: now, status: STATUS_FOR_KIND[kind] } })
      }
      const by = { locationCode: to, fromCode: from, note: movementNote, movedById: me.id, movedByName: me.name, movedAt: now }
      await tx.goodsInMovement.createMany({
        data: [
          ...containers.map(c => ({ ...by, containerId: c.id })),
          ...lots.map(l => ({ ...by, lotId: l.lotId, barcode: l.barcode })),
        ],
      })
      return { totes: containers.map(c => c.id).sort(compareCodes), lots: lots.length, to }
    }, { timeout: 30_000 })

    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: out }
  } catch (e) { return fail(e) }
}

// ─── What is at some locations, for a spreadsheet ─────────────────────────────────────────

/** One thing at a location now — a tote or pallet, or a lot whose latest move is there. */
export type GoodsHere = {
  location: string
  type: "tote" | "pallet" | "lot"
  /** The tote or pallet number, or the lot's barcode. */
  code: string
  /** A tote's status (booked, stored…) or a lot's (ENTERED, SOLD…). */
  status: string | null
  receipt: string | null
  customer: string | null
  /** A tote's category and description, or a lot's title. */
  what: string | null
  /** A lot's sale code. */
  sale: string | null
  /** ISO — when it was put there. */
  since: string | null
  /** Who put a lot there. */
  by: string | null
}

const MAX_EXPORT_ROWS = 20_000

/**
 * Any Goods In user (it reads only what the location pages already show). Everything at these
 * locations now — every tote and pallet there that hasn't gone back to the customer, and every lot
 * whose latest move is there — for the "export what's there" spreadsheets. At most 20,000 of each;
 * `truncated` says when there were more.
 */
export async function goodsAtLocations(codes: string[]): Promise<Result<{ rows: GoodsHere[]; truncated: boolean }>> {
  try {
    await who()
    const asked = cleanCodes(codes, "exported")
    if (!asked.ok) return asked
    const [containers, lots] = await Promise.all([
      prisma.goodsInContainer.findMany({
        where: { locationCode: { in: asked.codes }, OR: [{ status: null }, { status: { not: "returned" } }] },
        select: { id: true, kind: true, status: true, category: true, description: true, movedAt: true, locationCode: true, receiptId: true, receipt: { select: { contact: { select: { name: true } } } } },
        orderBy: [{ locationCode: "asc" }, { id: "asc" }],
        take: MAX_EXPORT_ROWS + 1,
      }),
      prisma.$queryRaw<{ location: string; lotId: string; barcode: string | null; movedAt: Date | null; movedByName: string | null; title: string | null; status: string | null; sale: string | null }[]>`
        SELECT cur."locationCode" AS "location", cur."lotId", COALESCE(l."barcode", cur."barcode") AS "barcode", cur."movedAt", cur."movedByName",
               l."title", l."status", a."code" AS "sale"
        FROM (
          SELECT DISTINCT ON (m."lotId") m."lotId", m."barcode", m."locationCode", m."movedAt", m."movedByName"
          FROM "GoodsInMovement" m
          WHERE m."lotId" IN (
            SELECT "lotId" FROM "GoodsInMovement" WHERE "lotId" IS NOT NULL AND "locationCode" = ANY(${asked.codes}::text[])
          )
          ORDER BY m."lotId", m."movedAt" DESC
        ) cur
        LEFT JOIN "CatalogueLot" l ON l."id" = cur."lotId"
        LEFT JOIN "CatalogueAuction" a ON a."id" = l."auctionId"
        WHERE cur."locationCode" = ANY(${asked.codes}::text[])
        ORDER BY cur."locationCode", cur."movedAt" DESC
        LIMIT ${MAX_EXPORT_ROWS + 1}`,
    ])
    const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)
    const rows: GoodsHere[] = [
      ...containers.slice(0, MAX_EXPORT_ROWS).map(c => ({
        location: c.locationCode ?? "",
        type: (c.kind === "pallet" ? "pallet" : "tote") as GoodsHere["type"],
        code: c.id,
        status: c.status,
        receipt: c.receiptId,
        customer: c.receipt.contact.name,
        what: [c.category, c.description].filter(Boolean).join(" — ") || null,
        sale: null,
        since: iso(c.movedAt),
        by: null,
      })),
      ...lots.slice(0, MAX_EXPORT_ROWS).map(l => ({
        location: l.location,
        type: "lot" as const,
        code: l.barcode ?? "",
        status: l.status,
        receipt: null,
        customer: null,
        what: l.title ?? "This lot is no longer in the Hub",
        sale: l.sale,
        since: iso(l.movedAt),
        by: l.movedByName,
      })),
    ].sort((a, b) => compareCodes(a.location, b.location))
    return { ok: true, data: { rows, truncated: containers.length > MAX_EXPORT_ROWS || lots.length > MAX_EXPORT_ROWS } }
  } catch (e) { return fail(e) }
}
