"use server"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getEffectiveSession } from "@/lib/impersonation"
import { bcApiUrl, bcODataUrl, getBCToken } from "@/lib/bc"
import { uploadBufferToR2 } from "@/lib/r2"
import { logLotPhoto } from "@/lib/lot-log"

// 📸 Pull photos (top of a sale page, admins only — 2026-11-18). Copies lots' photos out of Business Central onto
// the Hub lot with the same barcode, for lots that have NO photos in the Hub yet — for one sale, or for EVERY sale
// at once (2026-11-18, the same day: "upload them in mass … just checks all sales").
//
// Read off BC's own AL source (IT Tools → BC Source):
//   • BC keeps photos in "Advanced Media" (table 80433 EVO_MED_Entry), the files in Azure Blob Storage, each
//     tied to the record it belongs to by that record's SystemId — for a lot, its receipt line (table 75002).
//   • api/evo/base/v1.0 relatedMedia (page 75612, read-only) lists them: relatedSystemId, sortNo, mediaType,
//     filename, softDeleted, and publicMediaPath — the blob's address with the storage access key (SAS)
//     added by BC (codeunit 80450 GetPublicStorageUrl), so the Hub can download the full-size file.
//   • PTE_InternalBarcode is Code[20] (always capitals) and every one is also a key of PTE_PrePrintedBarcode,
//     so BC has a barcode on one receipt line at most.
//
// How a photo finds its Hub lot — BARCODE, as every BC↔Hub match (RULES.md):
//   Hub lot barcode → Receipt_Lines_Excel PTE_InternalBarcode (receipt no. + article no.) → the EvoMobile
//   receiptLines API (its systemId) → relatedMedia where tableNo = 75002 and relatedSystemId = that systemId.
//
// • BATCHES: one call handles up to BATCH_MAX lots with THREE BC requests in all (an "or" filter on each), so
//   checking every sale is a few hundred requests, not three per lot. The browser drives the batches (RULES.md
//   7b — a count that moves, and Stop).
// • READS from BC only — never writes to it — in BC_ENVIRONMENT (the environment every Hub read uses), as the
//   person pressing it (their own BC sign-in). Hub ADMINS only, read fresh, never while viewing as someone else.
// • Two steps: bcPhotoBatch(…, false) is read-only and only counts; bcPhotoBatch(…, true) finds each lot's photos
//   AGAIN in BC and copies, so nothing is copied from a stale list.
// • ⚠ Only lots with NO photos in the Hub are filled. A lot that has any photo of its own is left alone, so a lot
//   is never given the same pictures twice from two places. Photos copied from BC are stored as
//   lot-photos/<sale>/<lot>/bc-<BC photo id>.<ext>, so pressing it again only adds the ones not copied yet.
// • Every photo added is logged on the lot's change log (logLotPhoto, source "bc_photo_pull").
// ⚠ Each action RETURNS { ok, error } rather than throwing (production redacts thrown server-action errors).

const NO_BC_SIGN_IN = "NO_BC_SIGN_IN"
const TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_BYTES = 25 * 1024 * 1024
/** Lots per call. Kept small so each BC "or" filter stays well inside BC's URL limit. */
const BATCH_MAX = 12
/** Lots per call when copying — every photo is downloaded and stored inside the call. */
const COPY_MAX = 3
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SOURCE = "bc_photo_pull"

type Json = Record<string, unknown>
type Result<T> = { ok: true; data: T } | { ok: false; error: string }

class PullError extends Error {}

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof PullError) return { ok: false, error: e.message }
  console.error("bc-photo-pull error:", e)
  return { ok: false, error: String((e as { message?: string })?.message ?? e).slice(0, 300) }
}

async function checkAdmin(): Promise<{ token: string; userName: string }> {
  const session = await getEffectiveSession()
  if (!session) throw new PullError("Sign in first.")
  if (session.isImpersonating) throw new PullError("Stop viewing as someone else first — this reads Business Central as you.")
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, name: true, email: true } })
  if (me?.role !== "ADMIN") throw new PullError("Only an admin can pull photos from Business Central.")
  const token = await getBCToken()
  if (!token) throw new PullError(NO_BC_SIGN_IN)
  return { token, userName: me.name ?? me.email ?? "Unknown" }
}

const quote = (v: string) => `'${v.replace(/'/g, "''")}'`

/** BC's own words out of an error body, else the status. */
function bcMessage(status: number, text: string): string {
  try {
    const m = (JSON.parse(text) as { error?: { message?: string } })?.error?.message?.trim()
    if (m) return m.slice(0, 400)
  } catch { /* not JSON */ }
  return `Business Central answered ${status}${text ? `: ${text.slice(0, 200)}` : ""}`
}

/** Every row of a BC read, following BC's next-page links (a handful of pages at most here). */
async function bcGetAll(token: string, firstUrl: string): Promise<Json[]> {
  const rows: Json[] = []
  let url: string | null = firstUrl
  for (let page = 0; url && page < 20; page++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (e) {
      const name = (e as { name?: string })?.name
      throw new PullError(name === "TimeoutError" || name === "AbortError" ? `Business Central didn't answer within ${TIMEOUT_MS / 1000} seconds.` : "Couldn't reach Business Central.")
    }
    const text = await res.text()
    if (!res.ok) {
      const msg = bcMessage(res.status, text)
      if (/no http resource was found/i.test(msg) && firstUrl.includes("relatedMedia")) {
        throw new PullError("This Business Central environment doesn't have the photo list (relatedMedia, api/evo/base/v1.0) — the Evo-auction Base extension there may be an older version.")
      }
      throw new PullError(msg)
    }
    let json: { value?: Json[]; "@odata.nextLink"?: string } = {}
    try { json = JSON.parse(text) } catch { /* empty */ }
    rows.push(...(json.value ?? []))
    url = json["@odata.nextLink"] ?? null
  }
  return rows
}

const isPicture = (mediaType: string, filename: string) =>
  /picture|image|photo/i.test(mediaType) || (!/video/i.test(mediaType) && /\.(jpe?g|png|webp|gif)$/i.test(filename))

/** Photos this tool copied have this in their key; any other key is a photo of the Hub's own. */
const bcKeyPart = (photoId: string) => `/bc-${photoId.toLowerCase()}.`
const isBcCopy = (key: string) => /\/bc-[0-9a-f-]{36}\.[a-z]+$/i.test(key)

// ── Which lots: one sale, or every sale ──────────────────────────────────────────────────────────

/** A lot that could take photos from BC: it has a barcode and no photos of its own in the Hub. */
export type BcPhotoLot = { id: string; auctionId: string; saleCode: string; barcode: string; title: string; receipt: string | null }

export type BcPhotoPlan = {
  /** The BC environment read from. */
  environment: string
  /** The lots to check, sale by sale. */
  lots: BcPhotoLot[]
  /** Sales those lots are on. */
  sales: number
  /** Lots left out before any BC call: no barcode, or photos of their own in the Hub already. */
  noBarcode: number
  hasPhotos: number
}

const BC_COPY_RE = "/bc-[0-9a-f-]{36}[.][a-z]+$"

/** The lots to check — `auctionId` for one sale, null for EVERY sale. No BC call. */
export async function bcPhotoPlan(auctionId: string | null): Promise<Result<BcPhotoPlan>> {
  try {
    await checkAdmin()
    if (auctionId !== null && typeof auctionId !== "string") return { ok: false, error: "Choose a sale, or every sale." }
    if (auctionId) {
      const auction = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { id: true } })
      if (!auction) return { ok: false, error: "That sale isn't in the Hub any more." }
    }
    const onSale = auctionId ? Prisma.sql`AND l."auctionId" = ${auctionId}` : Prisma.empty
    // "Own" photos = every photo that isn't one this tool copied from BC.
    const rows = await prisma.$queryRaw<{ id: string; auctionId: string; code: string; barcode: string | null; title: string; receipt: string | null; own: bigint }[]>`
      SELECT l.id, l."auctionId", a.code, l.barcode, l.title, l.receipt,
             (SELECT count(*) FROM unnest(l."imageUrls") k WHERE k !~* ${BC_COPY_RE}) AS own
      FROM "CatalogueLot" l
      JOIN "CatalogueAuction" a ON a.id = l."auctionId"
      WHERE TRUE ${onSale}
      ORDER BY a.code, l."createdAt", l.id`
    let noBarcode = 0
    let hasPhotos = 0
    const lots: BcPhotoLot[] = []
    for (const r of rows) {
      const barcode = (r.barcode ?? "").trim()
      if (!barcode) { noBarcode++; continue }
      if (Number(r.own) > 0) { hasPhotos++; continue }
      lots.push({ id: r.id, auctionId: r.auctionId, saleCode: r.code, barcode, title: r.title, receipt: r.receipt?.trim() || null })
    }
    return {
      ok: true,
      data: { environment: process.env.BC_ENVIRONMENT ?? "production", lots, sales: new Set(lots.map(l => l.auctionId)).size, noBarcode, hasPhotos },
    }
  } catch (e) {
    return fail(e)
  }
}

// ── A batch of lots: what BC has (and, with copy, copy it) ──────────────────────────────────────

/** The picture types the Hub shows, by the file's first bytes — so a storage error page is never saved as a photo. */
function pictureType(buf: Buffer): { ext: string; type: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", type: "image/jpeg" }
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" }
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return { ext: "webp", type: "image/webp" }
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("ascii"))) return { ext: "gif", type: "image/gif" }
  return null
}

async function download(link: string): Promise<Buffer> {
  if (!/^https:\/\//i.test(link)) throw new PullError("BC gave no download link for it.")
  let res: Response
  try {
    res = await fetch(link, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch {
    throw new PullError("Couldn't download it from BC's photo storage.")
  }
  if (!res.ok) {
    throw new PullError(res.status === 403 || res.status === 401
      ? "BC's photo storage refused the download (no access key on the link) — IT would need to give BC's storage container an access key."
      : `BC's photo storage answered ${res.status}.`)
  }
  const size = Number(res.headers.get("content-length") ?? 0)
  if (size > MAX_BYTES) throw new PullError(`It's ${Math.round(size / 1048576)} MB — over the 25 MB a lot photo may be.`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new PullError("It's over the 25 MB a lot photo may be.")
  return buf
}

export type BcPhotoResult = {
  lotId: string
  /** found = BC has photos · none = in BC, no photos · notInBc = BC hasn't the barcode · skipped = left alone · failed */
  outcome: "found" | "none" | "notInBc" | "skipped" | "failed"
  uniqueId: string
  receiptNo: string
  /** Pictures BC has for the lot. */
  photos: number
  /** Of those, how many the lot hadn't got before this call. */
  notCopied: number
  /** Copied onto the lot by this call (copy only). */
  added: number
  /** One line per photo that couldn't be copied, in plain words. */
  problems: string[]
  /** Why it was skipped or failed, in plain words. */
  detail: string
}

const blank = (lotId: string, outcome: BcPhotoResult["outcome"], detail: string): BcPhotoResult =>
  ({ lotId, outcome, uniqueId: "", receiptNo: "", photos: 0, notCopied: 0, added: 0, problems: [], detail })

/**
 * Up to BATCH_MAX lots (COPY_MAX when copying): finds each in BC by barcode and counts its photos — three BC
 * requests for the whole batch. With `copy`, also downloads the photos each lot hasn't got and adds them.
 * A BC request that fails fails the whole call (the screen marks the batch and carries on).
 */
export async function bcPhotoBatch(lotIds: string[], copy: boolean): Promise<Result<BcPhotoResult[]>> {
  try {
    const { token, userName } = await checkAdmin()
    const ids = Array.isArray(lotIds) ? [...new Set(lotIds.filter((x): x is string => typeof x === "string" && !!x))] : []
    if (!ids.length) return { ok: true, data: [] }
    if (ids.length > (copy ? COPY_MAX : BATCH_MAX)) return { ok: false, error: `At most ${copy ? COPY_MAX : BATCH_MAX} lots at a time.` }

    const lots = await prisma.catalogueLot.findMany({
      where: { id: { in: ids } },
      select: { id: true, auctionId: true, barcode: true, title: true, imageUrls: true, auction: { select: { code: true } } },
    })
    const byId = new Map(lots.map(l => [l.id, l]))
    const results = new Map<string, BcPhotoResult>()
    const eligible: typeof lots = []
    for (const id of ids) {
      const l = byId.get(id)
      if (!l) { results.set(id, blank(id, "failed", "That lot isn't in the Hub any more.")); continue }
      const barcode = (l.barcode ?? "").trim().toUpperCase()
      const own = l.imageUrls.filter(k => !isBcCopy(k)).length
      if (!barcode) results.set(id, blank(id, "skipped", "No barcode, so it can't be matched to BC."))
      else if (own) results.set(id, blank(id, "skipped", `Has ${own} photo${own === 1 ? "" : "s"} of its own in the Hub — left alone.`))
      else if (barcode.length > 20) results.set(id, blank(id, "notInBc", "The barcode is longer than BC allows, so BC can't have it."))
      else eligible.push(l)
    }

    if (eligible.length) {
      // 1. Barcode → receipt line.
      const barcodes = [...new Set(eligible.map(l => l.barcode!.trim().toUpperCase()))]
      const lineRows = await bcGetAll(token, `${bcODataUrl("Receipt_Lines_Excel")}?$filter=${encodeURIComponent(barcodes.map(b => `PTE_InternalBarcode eq ${quote(b)}`).join(" or "))}&$select=PTE_InternalBarcode,EVA_ReceiptNo,EVA_ArticleNo,EVA_UniqueID`)
      const linesByBarcode = new Map<string, Json[]>()
      for (const r of lineRows) {
        const b = String(r.PTE_InternalBarcode ?? "").trim().toUpperCase()
        linesByBarcode.set(b, [...(linesByBarcode.get(b) ?? []), r])
      }

      // 2. Receipt line → its SystemId (the API page; the web service doesn't publish it).
      const keyOf = (receiptNo: string, articleNo: number) => `${receiptNo.toUpperCase()}|${articleNo}`
      const wanted = new Map<string, { receiptNo: string; articleNo: number }>()
      for (const b of barcodes) {
        const ls = linesByBarcode.get(b) ?? []
        if (ls.length !== 1) continue
        const receiptNo = String(ls[0].EVA_ReceiptNo ?? "")
        const articleNo = Number(ls[0].EVA_ArticleNo)
        if (receiptNo && Number.isFinite(articleNo)) wanted.set(keyOf(receiptNo, articleNo), { receiptNo, articleNo })
      }
      const systemIdOf = new Map<string, string>()
      if (wanted.size) {
        const filter = [...wanted.values()].map(w => `(receiptNo eq ${quote(w.receiptNo)} and articleNo eq ${w.articleNo})`).join(" or ")
        const apiRows = await bcGetAll(token, `${await bcApiUrl(token, "api/evo/mob/v2.0", "receiptLines")}?$filter=${encodeURIComponent(filter)}&$select=systemId,receiptNo,articleNo`)
        for (const r of apiRows) {
          const sid = String(r.systemId ?? "")
          if (GUID.test(sid)) systemIdOf.set(keyOf(String(r.receiptNo ?? ""), Number(r.articleNo)), sid.toLowerCase())
        }
      }

      // 3. SystemId → photos.
      type Photo = { id: string; sortNo: number; filename: string; link: string }
      const photosOf = new Map<string, Photo[]>()
      const sids = [...new Set(systemIdOf.values())]
      if (sids.length) {
        const select = `systemId,relatedSystemId,sortNo,mediaType,filename,softDeleted${copy ? ",publicMediaPath" : ""}`
        const filter = `tableNo eq 75002 and (${sids.map(s => `relatedSystemId eq ${s}`).join(" or ")})`
        const media = await bcGetAll(token, `${await bcApiUrl(token, "api/evo/base/v1.0", "relatedMedia")}?$filter=${encodeURIComponent(filter)}&$select=${select}`)
        for (const m of media) {
          const id = String(m.systemId ?? "")
          if (m.softDeleted === true || !GUID.test(id) || !isPicture(String(m.mediaType ?? ""), String(m.filename ?? ""))) continue
          const rel = String(m.relatedSystemId ?? "").toLowerCase()
          photosOf.set(rel, [...(photosOf.get(rel) ?? []), { id: id.toLowerCase(), sortNo: Number(m.sortNo) || 0, filename: String(m.filename ?? ""), link: String(m.publicMediaPath ?? "") }])
        }
        for (const list of photosOf.values()) list.sort((a, b) => a.sortNo - b.sortNo)
      }

      // Each lot.
      for (const l of eligible) {
        const barcode = l.barcode!.trim().toUpperCase()
        const ls = linesByBarcode.get(barcode) ?? []
        if (!ls.length) { results.set(l.id, blank(l.id, "notInBc", "BC doesn't have this barcode.")); continue }
        if (ls.length > 1) {
          results.set(l.id, blank(l.id, "failed", `BC has barcode ${barcode} on more than one line (${ls.map(x => String(x.EVA_UniqueID ?? "?")).join(", ")}), so it can't tell which is this lot.`))
          continue
        }
        const receiptNo = String(ls[0].EVA_ReceiptNo ?? "")
        const uniqueId = String(ls[0].EVA_UniqueID ?? "")
        const sid = systemIdOf.get(keyOf(receiptNo, Number(ls[0].EVA_ArticleNo)))
        if (!sid) {
          results.set(l.id, { ...blank(l.id, "failed", `BC has barcode ${barcode}${uniqueId ? ` as ${uniqueId}` : ""}, but its receipt lines API didn't return the line.`), uniqueId, receiptNo })
          continue
        }
        const photos = photosOf.get(sid) ?? []
        if (!photos.length) { results.set(l.id, { ...blank(l.id, "none", "In BC, with no photos."), uniqueId, receiptNo }); continue }
        const has = (id: string) => l.imageUrls.some(k => k.toLowerCase().includes(bcKeyPart(id)))
        const todo = photos.filter(p => !has(p.id))
        const r: BcPhotoResult = { lotId: l.id, outcome: "found", uniqueId, receiptNo, photos: photos.length, notCopied: todo.length, added: 0, problems: [], detail: "" }
        results.set(l.id, r)
        if (!copy || !todo.length) continue

        // Copy the ones the lot hasn't got, in BC's order.
        const keys: string[] = []
        const names: string[] = []
        for (const p of todo) {
          const name = p.filename || `photo ${p.sortNo}`
          try {
            const buf = await download(p.link)
            const kind = pictureType(buf)
            if (!kind) { r.problems.push(`${name}: not a JPEG, PNG, WebP or GIF picture, so it wasn't copied.`); continue }
            keys.push(await uploadBufferToR2(buf, `lot-photos/${l.auctionId}/${l.id}/bc-${p.id}.${kind.ext}`, kind.type))
            names.push(name)
          } catch (e) {
            r.problems.push(`${name}: ${e instanceof PullError ? e.message : "couldn't be copied."}`)
            if (!(e instanceof PullError)) console.error("bc-photo-pull copy error:", e)
          }
        }
        if (keys.length) {
          await prisma.catalogueLot.update({ where: { id: l.id }, data: { imageUrls: { push: keys } } })
          const ref = { id: l.id, auctionId: l.auctionId, barcode: l.barcode, title: l.title }
          for (const name of names) {
            await logLotPhoto(ref, l.auction?.code ?? "", "photo_added", { changedBy: userName, source: SOURCE }, `${name} (from BC ${uniqueId || barcode})`)
          }
          r.added = keys.length
        }
        console.log(`[bc-photo-pull] ${userName} → ${l.auction?.code ?? "?"} ${barcode}: ${keys.length} added, ${photos.length - todo.length} already, ${r.problems.length} problems`)
      }
    }
    return { ok: true, data: ids.map(id => results.get(id) ?? blank(id, "failed", "Not checked.")) }
  } catch (e) {
    return fail(e)
  }
}
