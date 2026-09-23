import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE } from "../news-stories/news/shared"

// The department pages on the test website, read from SiteDepartment (Databases → News — the
// website's department pages collected on an office machine). READ-ONLY.

export type Highlight = { title: string; hammer: string | null; meta: string | null; link: string | null; imagePath: string; file: string }
export type Department = {
  slug: string; name: string; order: number; pageTitle: string | null; heading: string | null
  heroPath: string | null; heroKey: string | null; tilePath: string | null; tileKey: string | null
  copyHtml: string | null; sideHtml: string | null
  extraImages: { path: string; file: string }[] | null; extraImageKeys: string[]
  highlights: Highlight[] | null; highlightKeys: string[]
  newsCategory: string | null; saleKeywords: string[]; siteSaleIds: number[]
}

const COLS = Prisma.sql`d."slug", d."name", d."order", d."pageTitle", d."heading", d."heroPath", d."heroKey", d."tilePath", d."tileKey", d."copyHtml", d."sideHtml", d."extraImages", d."extraImageKeys", d."highlights", d."highlightKeys", d."newsCategory", d."saleKeywords", d."siteSaleIds"`

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The pictures inside a department's copy or side box: our R2 copy where uploaded, else the
 * website's file — substituted while the paths are still as stored, before the general clean.
 */
export async function withDeptPictures(html: string, d: Department): Promise<string> {
  const keys = new Set(d.extraImageKeys ?? [])
  let out = html
  for (const im of d.extraImages ?? []) {
    const key = `news-photos/${im.file}`
    const url = keys.has(key) ? await getSignedImageUrl(key, 3600).catch(() => null) : null
    const fallback = /^https?:\/\//i.test(im.path) ? im.path : SITE + im.path
    out = out.replace(new RegExp(`src="${escapeRe(im.path)}"`, "g"), `src="${url ?? fallback}"`)
  }
  return out
}

/** Our R2 copy when the Hub has one (signed for an hour), else the website's own file. */
export async function sitePicture(key: string | null, path: string | null): Promise<string | null> {
  if (key) return getSignedImageUrl(key, 3600).catch(() => null)
  if (!path) return null
  return /^https?:\/\//i.test(path) ? path : SITE + path
}

export async function listDepartments(): Promise<(Department & { tile: string | null })[]> {
  try {
    const rows = await prisma.$queryRaw<Department[]>`SELECT ${COLS} FROM "SiteDepartment" d ORDER BY d."order", d."name"`
    return Promise.all(rows.map(async d => ({ ...d, tile: await sitePicture(d.tileKey ?? d.heroKey, d.tilePath ?? d.heroPath) })))
  } catch {
    return []
  }
}

export async function getDepartment(slug: string): Promise<Department | null> {
  const rows = await prisma.$queryRaw<Department[]>`SELECT ${COLS} FROM "SiteDepartment" d WHERE d."slug" = ${slug} LIMIT 1`
  return rows[0] ?? null
}

/** A highlighted lot's picture: our copy once uploaded, else the website's file. */
export async function highlightPicture(h: Highlight, keys: string[]): Promise<string | null> {
  const key = `news-photos/${h.file}`
  return sitePicture(keys.includes(key) ? key : null, h.imagePath)
}

/**
 * Where a highlighted lot lives on OUR results pages, found by the website's own lot id in the
 * link the site gave (…?el=327237): the ABC Database keys its rows on that id for old-system
 * sales, the BC Database's website half for Business Central ones. Lots we don't hold link to
 * the website instead.
 */
export async function ourLotLinks(highlights: Highlight[]): Promise<Map<number, string>> {
  const ids = highlights.map(h => Number((h.link ?? "").match(/[?&]el=(\d+)/)?.[1])).filter(n => Number.isFinite(n) && n > 0)
  const out = new Map<number, string>()
  if (!ids.length) return out
  const list = Prisma.sql`ARRAY(SELECT (jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::int)`
  try {
    const [abc, bc] = await Promise.all([
      prisma.$queryRaw<{ siteLotId: number; id: string; siteId: number | null }[]>`
        SELECT l."siteLotId", l."id", s."siteId" FROM "ArchiveLot" l LEFT JOIN "ArchiveSale" s ON s."auctionId" = l."auctionId"
        WHERE l."siteLotId" = ANY(${list})`,
      prisma.$queryRaw<{ siteLotId: number; uniqueId: string; siteSaleId: number | null }[]>`
        SELECT b."siteLotId", b."uniqueId", b."siteSaleId" FROM "BcLotWeb" b WHERE b."siteLotId" = ANY(${list})`,
    ])
    for (const r of abc) if (r.siteId) out.set(r.siteLotId, `/auctions/results/${r.siteId}/lot/${encodeURIComponent(r.id)}`)
    for (const r of bc) if (r.siteSaleId && !out.has(r.siteLotId)) out.set(r.siteLotId, `/auctions/results/${r.siteSaleId}/lot/${encodeURIComponent(r.uniqueId)}`)
  } catch { /* an environment without those tables — the website links stand */ }
  return out
}
