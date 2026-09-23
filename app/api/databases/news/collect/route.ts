import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"

export const maxDuration = 300

// POST /api/databases/news/collect
// Takes vectis-news.json — what scripts/collect-news.mjs saved on an office machine — and writes
// every article into SiteNewsArticle.
//
// ⚠ Why a file: the website answers the Hub's Railway server with 202 and an empty body for every
// request, while the same request from the office works (measured 2026-09-09), so the server can
// never read the news feed itself. Same shape as the BC lots and the sale pictures.
//
// The site is the authority and overwrites ours on every load — the feed's fields AND the article
// page's own HTML (bodyHtml) with the list of pictures inside it (bodyImages). Our own copies of
// the pictures (imageKey for the cover, bodyImageKeys for the ones inside) are KEPT unless the
// site's files have changed, when they are cleared so the new ones are asked for again.
type Incoming = {
  id?: unknown; alias?: unknown; title?: unknown; sefLink?: unknown; categoryId?: unknown; category?: unknown
  tags?: unknown; featured?: unknown; hits?: unknown; introText?: unknown; fullText?: unknown
  publishedAt?: unknown; modifiedAt?: unknown; imagePath?: unknown; imageAlt?: unknown
  bodyHtml?: unknown; bodyImages?: unknown
}
type BodyImage = { path: string; file: string }
type Row = {
  id: number; alias: string; title: string; sefLink: string | null; categoryId: number | null; category: string | null
  tags: string[]; featured: boolean; hits: number; introText: string | null; fullText: string | null
  publishedAt: string | null; modifiedAt: string | null; imagePath: string | null; imageAlt: string | null
  bodyHtml: string | null; bodyImages: BodyImage[]
}

const CHUNK = 50
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null)
const stamp = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(v) ? v : null)
const FILE_NAME = /^\d+-\d+\.(jpe?g|png|webp|gif)$/i

function clean(a: Incoming): Row | null {
  const id = Math.round(Number(a.id))
  if (!Number.isFinite(id) || id <= 0) return null
  const catId = Number(a.categoryId)
  const bodyImages: BodyImage[] = Array.isArray(a.bodyImages)
    ? a.bodyImages
        .filter((x): x is BodyImage => !!x && typeof x === "object" && typeof (x as BodyImage).path === "string" && typeof (x as BodyImage).file === "string" && FILE_NAME.test((x as BodyImage).file) && (x as BodyImage).file.startsWith(`${id}-`))
        .map(x => ({ path: x.path, file: x.file.toLowerCase() }))
        .slice(0, 100)
    : []
  return {
    id,
    alias: str(a.alias) ?? String(id),
    title: str(a.title) ?? "(untitled)",
    sefLink: str(a.sefLink),
    categoryId: Number.isFinite(catId) && catId > 0 ? Math.round(catId) : null,
    category: str(a.category),
    tags: Array.isArray(a.tags) ? a.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 50) : [],
    featured: a.featured === true,
    hits: Number.isFinite(Number(a.hits)) ? Math.max(0, Math.round(Number(a.hits))) : 0,
    introText: str(a.introText),
    fullText: str(a.fullText),
    publishedAt: stamp(a.publishedAt),
    modifiedAt: stamp(a.modifiedAt),
    imagePath: str(a.imagePath)?.replace(/^\/+/, "") ?? null,
    imageAlt: str(a.imageAlt),
    bodyHtml: str(a.bodyHtml),
    bodyImages,
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const form = await req.formData()
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return NextResponse.json({ error: "No file was chosen." }, { status: 400 })

    let written = 0, skipped = 0, withBody = 0
    const problems: string[] = []
    for (const file of files) {
      let parsed: any
      try { parsed = JSON.parse(await file.text()) }
      catch { problems.push(`${file.name}: not a file this page can read — it should be the vectis-news.json the collector saved.`); continue }
      const list: Incoming[] = Array.isArray(parsed?.articles) ? parsed.articles : []
      if (!list.length) { problems.push(`${file.name}: no articles in it.`); continue }
      const rows: Row[] = []
      for (const a of list) { const r = clean(a); if (r) rows.push(r); else skipped++ }
      withBody += rows.filter(r => r.bodyHtml).length

      // The site's dates are its own wall-clock times ("2026-09-22T11:53:57") and are stored as given —
      // cast from text, never through a JS Date, which would shift them by the BST hour.
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK)
        const values = Prisma.join(chunk.map(r => Prisma.sql`(
          ${r.id}::int, ${r.alias}, ${r.title}, ${r.sefLink}, ${r.categoryId}::int, ${r.category},
          ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(r.tags)}::jsonb)),
          ${r.featured}::boolean, ${r.hits}::int, ${r.introText}, ${r.fullText},
          ${r.publishedAt}::timestamp, ${r.modifiedAt}::timestamp, ${r.imagePath}, ${r.imageAlt},
          ${r.bodyHtml}, ${JSON.stringify(r.bodyImages)}::jsonb, now()
        )`))
        written += await prisma.$executeRaw`
          INSERT INTO "SiteNewsArticle" ("id", "alias", "title", "sefLink", "categoryId", "category", "tags", "featured", "hits",
                                         "introText", "fullText", "publishedAt", "modifiedAt", "imagePath", "imageAlt",
                                         "bodyHtml", "bodyImages", "pulledAt")
          VALUES ${values}
          ON CONFLICT ("id") DO UPDATE SET
            "alias" = EXCLUDED."alias", "title" = EXCLUDED."title", "sefLink" = EXCLUDED."sefLink",
            "categoryId" = EXCLUDED."categoryId", "category" = EXCLUDED."category", "tags" = EXCLUDED."tags",
            "featured" = EXCLUDED."featured", "hits" = EXCLUDED."hits", "introText" = EXCLUDED."introText",
            "fullText" = EXCLUDED."fullText", "publishedAt" = EXCLUDED."publishedAt", "modifiedAt" = EXCLUDED."modifiedAt",
            "imageAlt" = EXCLUDED."imageAlt",
            "imageKey" = CASE WHEN "SiteNewsArticle"."imagePath" IS DISTINCT FROM EXCLUDED."imagePath" THEN NULL ELSE "SiteNewsArticle"."imageKey" END,
            "imageAt"  = CASE WHEN "SiteNewsArticle"."imagePath" IS DISTINCT FROM EXCLUDED."imagePath" THEN NULL ELSE "SiteNewsArticle"."imageAt" END,
            "imagePath" = EXCLUDED."imagePath",
            "bodyHtml" = EXCLUDED."bodyHtml",
            "bodyImageKeys" = CASE WHEN "SiteNewsArticle"."bodyImages" IS DISTINCT FROM EXCLUDED."bodyImages" THEN ARRAY[]::text[] ELSE "SiteNewsArticle"."bodyImageKeys" END,
            "bodyImages" = EXCLUDED."bodyImages",
            "pulledAt" = now()`
      }
    }

    const [agg] = await prisma.$queryRaw<{ n: bigint; covers: bigint; inside: bigint }[]>`
      SELECT count(*)::bigint AS n,
             count(*) FILTER (WHERE "imagePath" IS NOT NULL AND "imageKey" IS NULL)::bigint AS covers,
             coalesce(sum(greatest(jsonb_array_length(coalesce("bodyImages", '[]'::jsonb)) - cardinality("bodyImageKeys"), 0)), 0)::bigint AS inside
      FROM "SiteNewsArticle"`
    const held = Number(agg?.n ?? 0), toUpload = Number(agg?.covers ?? 0) + Number(agg?.inside ?? 0)

    // ⚠ Said in numbers, not "Done" — a silent success on an import is how nobody notices it read nothing.
    return NextResponse.json({
      ok: true, written, skipped, held, toUpload,
      problems: problems.length ? problems : undefined,
      message: written === 0
        ? "Nothing was loaded — the file held no articles this page could read."
        : `Loaded ${written.toLocaleString()} article${written === 1 ? "" : "s"} (${withBody.toLocaleString()} with the article page's own text)${skipped ? `, ${skipped} unreadable rows skipped` : ""}; the Hub now holds ${held.toLocaleString()}. ${toUpload ? `${toUpload.toLocaleString()} picture${toUpload === 1 ? "" : "s"} still to upload — choose the collector's pictures below.` : "Every picture is already in the Hub."}`,
    })
  } catch (e: any) {
    console.error("databases/news/collect error:", e)
    const msg = String(e?.message ?? "")
    return NextResponse.json({ error: /does not exist|relation|column/i.test(msg) ? "The news table isn't up to date on this environment — press Run Migrations first." : (msg || "Could not read the file") }, { status: 500 })
  }
}
