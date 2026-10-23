import type { Prisma } from "@/app/generated/prisma/client"
import { STATUS_FOR_KIND, normaliseCode, type ContainerKind, type ContainerStatus, type LocationKind } from "@/lib/goods-in/model"
import { HUB_OWNS_WAREHOUSE } from "@/lib/customers/ownership"
import { isFromBc } from "@/lib/goods-in/source"

// Goods In — the ONE place a single tote, pallet or lot is moved to a location. SERVER ONLY (a
// plain module, not "use server": it takes a transaction and is called by server code only).
//
// Used by moveTo (lib/actions/goods-in.ts — Scan to move, Benches, Check what's here) and by the
// handheld scanner's sync (app/api/goods-in/scan/sync). ⚠⚠ Don't fork these rules into either
// caller: a scan from the handheld must do exactly what the same scan on Scan to move does.
//
// The rules (as moveTo has always had them):
//   • The location must exist and be switched on.
//   • The item is a tote or pallet by its number, else a lot by its barcode — the NEWEST lot with
//     that barcode (the one Find shows first; an older lot with it has moved on).
//   • Already at that location → refused, nothing written.
//   • A tote or pallet: a GoodsInMovement row (fromCode, note, who) and its location, kind and
//     movedAt on the container; its status becomes STATUS_FOR_KIND[kind] unless it is catalogued
//     or returned, which keep theirs. A tote on a check-in that isn't booked in yet (a draft) can
//     still be moved — its labels exist.
//   • A lot: a GoodsInMovement row only (with its barcode as it is now); its location is simply
//     its latest move.
// The scanner adds one rule of its own, switched on by `unlessMovedAfter`: a scan made offline is
// "stale" when the item has a recorded move NEWER than the scan — someone moved it since — and is
// not applied (`at` then stamps the move with the time it was scanned).
//
// ⚠ Locks: the target location is read FOR SHARE (a remove or switch-off of it waits for this move
// and then sees the goods, or this waits for it and finds it gone or off — as moveEverything does),
// and a tote or pallet row FOR UPDATE (Check in's saves and moveEverything lock the same rows), so
// two moves of the same tote or pallet queue rather than interleave. A lot has no Goods In row to
// lock (CatalogueLot itself is never locked or written here), so it takes a transaction-scoped
// advisory lock on its id — ⚠ that only queues moveItem against moveItem (Scan to move and the
// scanner's sync). moveEverything (lib/actions/goods-in-locations.ts) doesn't take it yet, so a
// scanner sync moving a lot at the same moment as Move everything from that lot's location can
// both commit, and the stale check can't see the other's uncommitted move. Taking the same lock
// there (`pg_advisory_xact_lock(hashtext('goods-in-lot:' || id))` for each lot, in id order, then
// re-reading the lots' latest moves) closes it. Order: location, then item — the same order
// moveEverything takes them in.
//
// Never throws for a refusal — it RETURNS one, so the caller's transaction (the scanner records its
// outcome in the same one) still commits.

export type Mover = { id: string; name: string | null }

export type MoveOptions = {
  note?: string | null
  /** When the move happened. Now, unless given (a scan made offline is stamped with its own time). */
  at?: Date
  /** The scanner's stale rule: refuse (stale) when the item has a recorded move newer than this. */
  unlessMovedAfter?: Date
}

export type MoveDone = {
  ok: true
  /** A tote/pallet number, or the lot's barcode as the lot has it. */
  item: string
  type: "container" | "lot"
  containerKind: ContainerKind | null
  locationCode: string
  kind: LocationKind
  fromCode: string | null
  /** A tote or pallet's status after the move; null for a lot. */
  status: ContainerStatus | null
}

export type MoveRefused = { ok: false; stale: false; error: string; item: string; locationCode: string }

export type MoveStale = {
  ok: false
  stale: true
  error: string
  item: string
  locationCode: string
  /** The newer move that made this one stale. */
  newer: { at: Date; to: string | null; by: string | null }
}

export type MoveResult = MoveDone | MoveRefused | MoveStale

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

/** "16 Oct, 10:05" — London time, as the warehouse reads a clock. */
export const londonWhen = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)

function staleMessage(what: string, wanted: string, newer: MoveStale["newer"], scannedAt: Date): string {
  const to = newer.to ? ` to ${newer.to}` : ""
  const by = newer.by ? ` by ${newer.by}` : ""
  return `${what} was moved${to}${by} at ${londonWhen(newer.at)}, after this scan (${londonWhen(scannedAt)}), so it wasn't moved to ${wanted}. Scan it again if it should go there.`
}

/**
 * Move one tote, pallet or lot (scanned or typed as `rawItem`) to the location `rawLocation`,
 * inside the caller's transaction. See the rules above; the refusal messages are moveTo's own.
 */
export async function moveItem(tx: Prisma.TransactionClient, me: Mover, rawItem: string, rawLocation: string, opts: MoveOptions = {}): Promise<MoveResult> {
  const item = normaliseCode(rawItem)
  const locationCode = normaliseCode(rawLocation)
  const refuse = (error: string): MoveRefused => ({ ok: false, stale: false, error, item, locationCode })

  const [loc] = await tx.$queryRaw<{ code: string; kind: string | null; active: boolean | null }[]>`
    SELECT "code", "kind", "active" FROM "GoodsInLocation" WHERE "code" = ${locationCode} FOR SHARE`
  if (!loc) return refuse(`There's no location ${locationCode} — add it in Goods In → Locations first.`)
  if (loc.active === false) return refuse(`Location ${locationCode} is switched off.`)
  const kind = (loc.kind as LocationKind) ?? "storage"

  const at = opts.at ?? new Date()
  const after = opts.unlessMovedAfter
  const note = blank(opts.note)

  // ── A tote or pallet, by its number ──
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "GoodsInContainer" WHERE "id" = ${item} FOR UPDATE`
  const container = locked.length ? await tx.goodsInContainer.findUnique({ where: { id: item } }) : null
  if (container) {
    // Booked in BC: BC wouldn't know about a move made here, and the next copy would write BC's
    // location back over it — so until the Hub owns the warehouse records it is moved in BC.
    if (isFromBc(container.source) && !HUB_OWNS_WAREHOUSE) return refuse(`${item} was booked in Business Central — move it in BC until the Hub takes over (the Hub's copy follows at the next copy).`)
    if (container.locationCode === locationCode) return refuse(`${item} is already at ${locationCode}.`)
    const containerKind: ContainerKind = container.kind === "pallet" ? "pallet" : "tote"
    if (after) {
      const last = await tx.goodsInMovement.findFirst({ where: { containerId: item }, orderBy: { movedAt: "desc" }, select: { movedAt: true, locationCode: true, movedByName: true } })
      let newer: MoveStale["newer"] | null = null
      if (last && last.movedAt > after) newer = { at: last.movedAt, to: last.locationCode, by: last.movedByName }
      if (container.movedAt && container.movedAt > after && (!newer || container.movedAt > newer.at)) {
        newer = { at: container.movedAt, to: container.locationCode, by: null }
      }
      if (newer) {
        const what = `${containerKind === "pallet" ? "Pallet" : "Tote"} ${item}`
        return { ok: false, stale: true, error: staleMessage(what, locationCode, newer, after), item, locationCode, newer }
      }
    }
    const status = (container.status === "catalogued" || container.status === "returned" ? container.status : STATUS_FOR_KIND[kind]) as ContainerStatus
    await tx.goodsInMovement.create({ data: { containerId: item, locationCode, fromCode: container.locationCode, note, movedById: me.id, movedByName: me.name, movedAt: at } })
    await tx.goodsInContainer.update({ where: { id: item }, data: { locationCode, locationKind: kind, movedAt: at, status } })
    return { ok: true, item, type: "container", containerKind, locationCode, kind, fromCode: container.locationCode, status: status ?? null }
  }

  // ── A lot, by its barcode ── newest lot with the barcode — the one Find shows first; an older lot
  // with it has moved on.
  const lot = await tx.catalogueLot.findFirst({ where: { barcode: { equals: item, mode: "insensitive" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, barcode: true } })
  if (lot) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`goods-in-lot:${lot.id}`}::text))`
    const last = await tx.goodsInMovement.findFirst({ where: { lotId: lot.id }, orderBy: { movedAt: "desc" }, select: { locationCode: true, movedAt: true, movedByName: true } })
    if (last?.locationCode === locationCode) return refuse(`${item} is already at ${locationCode}.`)
    if (after && last && last.movedAt > after) {
      const newer = { at: last.movedAt, to: last.locationCode, by: last.movedByName }
      return { ok: false, stale: true, error: staleMessage(`Lot ${lot.barcode ?? item}`, locationCode, newer, after), item, locationCode, newer }
    }
    await tx.goodsInMovement.create({ data: { lotId: lot.id, barcode: lot.barcode, locationCode, fromCode: last?.locationCode ?? null, note, movedById: me.id, movedByName: me.name, movedAt: at } })
    return { ok: true, item: lot.barcode ?? item, type: "lot", containerKind: null, locationCode, kind, fromCode: last?.locationCode ?? null, status: null }
  }

  return refuse(`${item} isn't a tote, pallet or lot barcode the Hub knows.`)
}
