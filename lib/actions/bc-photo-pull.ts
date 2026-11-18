"use server"

import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { bcApiUrl, bcODataUrl, getBCToken } from "@/lib/bc"
import { uploadBufferToR2 } from "@/lib/r2"
import { logLotPhoto } from "@/lib/lot-log"

// A sale → 📸 Pull photos (top of the sale page, admins only — 2026-11-18). Copies a lot's photos out of
// Business Central onto the Hub lot with the same barcode, for lots that have NO photos in the Hub yet.
//
// Read off BC's own AL source (IT Tools → BC Source):
//   • BC keeps photos in "Advanced Media" (table 80433 EVO_MED_Entry), the files in Azure Blob Storage, each
//     tied to the record it belongs to by that record's SystemId — for a lot, its receipt line (table 75002).
//   • api/evo/base/v1.0 relatedMedia (page 75612, read-only) lists them: relatedSystemId, sortNo, mediaType,
//     filename, softDeleted, and publicMediaPath — the blob's address with the storage access key (SAS)
//     added by BC (codeunit 80450 GetPublicStorageUrl), so the Hub can download the full-size file.
//
// How a photo finds its Hub lot — BARCODE, as every BC↔Hub match (RULES.md):
//   Hub lot barcode → Receipt_Lines_Excel PTE_InternalBarcode (receipt no. + article no.) → the EvoMobile
//   receiptLines API (its systemId) → relatedMedia where tableNo = 75002 and relatedSystemId = that systemId.
//
// • READS from BC only — never writes to it — in BC_ENVIRONMENT (the environment every Hub read uses), as the
//   person pressing it (their own BC sign-in). Hub ADMINS only, read fresh, never while viewing as someone else.
// • Two steps, both driven by the browser one lot at a time (RULES.md 7b): bcPhotoFind is read-only and only
//   counts; bcPhotoCopy does the finding again on the server and copies, so nothing is copied from a stale list.
// • ⚠ Only lots with NO photos in the Hub are filled. A lot that has any photo of its own is left alone, so a
//   lot is never given the same pictures twice from two places. Photos copied from BC are stored as
//   lot-photos/<sale>/<lot>/bc-<BC photo id>.<ext>, so pressing it again only adds the ones not copied yet.
// • Every photo added is logged on the lot's change log (logLotPhoto, source "bc_photo_pull").
// ⚠ Each action RETURNS { ok, error } rather than throwing (production redacts thrown server-action errors).

const NO_BC_SIGN_IN = "NO_BC_SIGN_IN"
const TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 60_000
const MAX_BYTES = 25 * 1024 * 1024
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

async function bcGet(token: string, url: string): Promise<Json[]> {
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
    if (/no http resource was found/i.test(msg) && url.includes("relatedMedia")) {
      throw new PullError("This Business Central environment doesn't have the photo list (relatedMedia, api/evo/base/v1.0) — the Evo-auction Base extension there may be an older version.")
    }
    throw new PullError(msg)
  }
  try { return ((JSON.parse(text) as { value?: Json[] }).value ?? []) } catch { return [] }
}

const isPicture = (mediaType: string, filename: string) =>
  /picture|image|photo/i.test(mediaType) || (!/video/i.test(mediaType) && /\.(jpe?g|png|webp|gif)$/i.test(filename))

type BcPhoto = { id: string; sortNo: number; filename: string; link: string }
type Found =
  | { kind: "found"; receiptNo: string; uniqueId: string; photos: BcPhoto[] }
  | { kind: "notInBc" }
  | { kind: "ambiguous"; lines: string[] }
  | { kind: "noLine"; uniqueId: string }

/** Barcode → BC receipt line → its photos, in BC's photo order. Read only. */
async function findInBc(token: string, barcode: string, withLinks: boolean): Promise<Found> {
  const lines = await bcGet(token, `${bcODataUrl("Receipt_Lines_Excel")}?$filter=${encodeURIComponent(`PTE_InternalBarcode eq ${quote(barcode)}`)}&$select=EVA_ReceiptNo,EVA_ArticleNo,EVA_UniqueID&$top=2`)
  if (!lines.length) return { kind: "notInBc" }
  if (lines.length > 1) return { kind: "ambiguous", lines: lines.map(l => String(l.EVA_UniqueID ?? l.EVA_ReceiptNo ?? "?")) }
  const receiptNo = String(lines[0].EVA_ReceiptNo ?? "")
  const articleNo = Number(lines[0].EVA_ArticleNo)
  const uniqueId = String(lines[0].EVA_UniqueID ?? "")
  if (!receiptNo || !Number.isFinite(articleNo)) return { kind: "noLine", uniqueId }

  const rows = await bcGet(token, `${await bcApiUrl(token, "api/evo/mob/v2.0", "receiptLines")}?$filter=${encodeURIComponent(`receiptNo eq ${quote(receiptNo)} and articleNo eq ${articleNo}`)}&$select=systemId,uniqueID&$top=1`)
  const systemId = String(rows[0]?.systemId ?? "")
  if (!GUID.test(systemId)) return { kind: "noLine", uniqueId }

  const select = `systemId,sortNo,mediaType,filename,softDeleted${withLinks ? ",publicMediaPath" : ""}`
  const media = await bcGet(token, `${await bcApiUrl(token, "api/evo/base/v1.0", "relatedMedia")}?$filter=${encodeURIComponent(`tableNo eq 75002 and relatedSystemId eq ${systemId}`)}&$select=${select}`)
  const photos = media
    .filter(m => m.softDeleted !== true && isPicture(String(m.mediaType ?? ""), String(m.filename ?? "")) && GUID.test(String(m.systemId ?? "")))
    .map(m => ({ id: String(m.systemId), sortNo: Number(m.sortNo) || 0, filename: String(m.filename ?? ""), link: String(m.publicMediaPath ?? "") }))
    .sort((a, b) => a.sortNo - b.sortNo)
  return { kind: "found", receiptNo, uniqueId: uniqueId || String(rows[0]?.uniqueID ?? ""), photos }
}

/** Photos this tool copied have this in their key; any other key is a photo of the Hub's own. */
const bcKeyPart = (photoId: string) => `/bc-${photoId.toLowerCase()}.`
const isBcCopy = (key: string) => /\/bc-[0-9a-f-]{36}\.[a-z]+$/i.test(key)

// ── The sale's lots ──────────────────────────────────────────────────────────────────────────────

export type BcPhotoLot = { id: string; barcode: string | null; title: string; receipt: string | null; photos: number; fromBc: number }

export async function bcPhotoPullStart(auctionId: string): Promise<Result<{ saleCode: string; environment: string; lots: BcPhotoLot[] }>> {
  try {
    await checkAdmin()
    const auction = await prisma.catalogueAuction.findUnique({ where: { id: auctionId }, select: { code: true } })
    if (!auction) return { ok: false, error: "That sale isn't in the Hub any more." }
    const lots = await prisma.catalogueLot.findMany({
      where: { auctionId },
      select: { id: true, barcode: true, title: true, receipt: true, imageUrls: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5000,
    })
    return {
      ok: true,
      data: {
        saleCode: auction.code,
        environment: process.env.BC_ENVIRONMENT ?? "production",
        lots: lots.map(l => ({
          id: l.id, barcode: l.barcode?.trim() || null, title: l.title, receipt: l.receipt?.trim() || null,
          photos: l.imageUrls.length, fromBc: l.imageUrls.filter(isBcCopy).length,
        })),
      },
    }
  } catch (e) {
    return fail(e)
  }
}

// ── Step 1: what BC has for one lot (read only) ──────────────────────────────────────────────────

export type BcPhotoFind =
  | { outcome: "found"; uniqueId: string; receiptNo: string; photos: number; notCopied: number }
  | { outcome: "none"; uniqueId: string; receiptNo: string }
  | { outcome: "notInBc" }
  | { outcome: "skipped"; detail: string }

/** Is this lot in BC, and how many photos has BC got for it? Reads only — nothing is copied. */
export async function bcPhotoFind(auctionId: string, lotId: string): Promise<Result<BcPhotoFind>> {
  try {
    const { token } = await checkAdmin()
    const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { auctionId: true, barcode: true, imageUrls: true } })
    if (!lot || lot.auctionId !== auctionId) return { ok: false, error: "That lot isn't on this sale any more." }
    const barcode = lot.barcode?.trim()
    if (!barcode) return { ok: true, data: { outcome: "skipped", detail: "No barcode, so it can't be matched to BC." } }
    const own = lot.imageUrls.filter(k => !isBcCopy(k)).length
    if (own) return { ok: true, data: { outcome: "skipped", detail: `Already has ${own} photo${own === 1 ? "" : "s"} in the Hub — left alone.` } }

    const found = await findInBc(token, barcode, false)
    if (found.kind === "notInBc") return { ok: true, data: { outcome: "notInBc" } }
    if (found.kind === "ambiguous") return { ok: false, error: `BC has barcode ${barcode} on more than one line (${found.lines.join(", ")}), so it can't tell which is this lot.` }
    if (found.kind === "noLine") return { ok: false, error: `BC has barcode ${barcode}${found.uniqueId ? ` as ${found.uniqueId}` : ""}, but its receipt lines API didn't return the line.` }
    if (!found.photos.length) return { ok: true, data: { outcome: "none", uniqueId: found.uniqueId, receiptNo: found.receiptNo } }
    const notCopied = found.photos.filter(p => !lot.imageUrls.some(k => k.toLowerCase().includes(bcKeyPart(p.id)))).length
    return { ok: true, data: { outcome: "found", uniqueId: found.uniqueId, receiptNo: found.receiptNo, photos: found.photos.length, notCopied } }
  } catch (e) {
    return fail(e)
  }
}

// ── Step 2: copy one lot's photos onto it ────────────────────────────────────────────────────────

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

export type BcPhotoCopy = {
  uniqueId: string
  added: number
  /** Photos BC has that were already on the lot from an earlier pull. */
  already: number
  /** One line per photo that couldn't be copied, in plain words. */
  problems: string[]
  /** Why nothing was done at all (the lot has photos of its own now, isn't in BC, …), or null. */
  skipped: string | null
}

/** Finds the lot's photos in BC again (never from the browser's list) and copies the ones it hasn't got. */
export async function bcPhotoCopy(auctionId: string, lotId: string): Promise<Result<BcPhotoCopy>> {
  try {
    const { token, userName } = await checkAdmin()
    const lot = await prisma.catalogueLot.findUnique({
      where: { id: lotId },
      select: { id: true, auctionId: true, barcode: true, title: true, imageUrls: true, auction: { select: { code: true } } },
    })
    if (!lot || lot.auctionId !== auctionId) return { ok: false, error: "That lot isn't on this sale any more." }
    const barcode = lot.barcode?.trim()
    const none = (skipped: string, uniqueId = ""): Result<BcPhotoCopy> => ({ ok: true, data: { uniqueId, added: 0, already: 0, problems: [], skipped } })
    if (!barcode) return none("No barcode, so it can't be matched to BC.")
    const own = lot.imageUrls.filter(k => !isBcCopy(k)).length
    if (own) return none(`It has ${own} photo${own === 1 ? "" : "s"} of its own in the Hub now — left alone.`)

    const found = await findInBc(token, barcode, true)
    if (found.kind === "notInBc") return none("BC doesn't have this barcode.")
    if (found.kind === "ambiguous") return { ok: false, error: `BC has barcode ${barcode} on more than one line (${found.lines.join(", ")}), so it can't tell which is this lot.` }
    if (found.kind === "noLine") return { ok: false, error: `BC has barcode ${barcode}, but its receipt lines API didn't return the line.` }
    if (!found.photos.length) return none("BC has no photos for it.", found.uniqueId)

    const has = (id: string) => lot.imageUrls.some(k => k.toLowerCase().includes(bcKeyPart(id)))
    const todo = found.photos.filter(p => !has(p.id))
    const keys: string[] = []
    const added: string[] = []
    const problems: string[] = []
    for (const p of todo) {
      const name = p.filename || `photo ${p.sortNo}`
      try {
        const buf = await download(p.link)
        const kind = pictureType(buf)
        if (!kind) { problems.push(`${name}: not a JPEG, PNG, WebP or GIF picture, so it wasn't copied.`); continue }
        keys.push(await uploadBufferToR2(buf, `lot-photos/${auctionId}/${lot.id}/bc-${p.id.toLowerCase()}.${kind.ext}`, kind.type))
        added.push(name)
      } catch (e) {
        problems.push(`${name}: ${e instanceof PullError ? e.message : "couldn't be copied."}`)
        if (!(e instanceof PullError)) console.error("bc-photo-pull copy error:", e)
      }
    }
    if (keys.length) {
      await prisma.catalogueLot.update({ where: { id: lot.id }, data: { imageUrls: { push: keys } } })
      const ref = { id: lot.id, auctionId: lot.auctionId, barcode: lot.barcode, title: lot.title }
      for (const name of added) {
        await logLotPhoto(ref, lot.auction?.code ?? "", "photo_added", { changedBy: userName, source: SOURCE }, `${name} (from BC ${found.uniqueId || barcode})`)
      }
    }
    console.log(`[bc-photo-pull] ${userName} → ${lot.auction?.code ?? "?"} ${barcode}: ${keys.length} added, ${found.photos.length - todo.length} already, ${problems.length} problems`)
    return { ok: true, data: { uniqueId: found.uniqueId, added: keys.length, already: found.photos.length - todo.length, problems, skipped: null } }
  } catch (e) {
    return fail(e)
  }
}
