import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { londonYmd } from "../../../site-dates"
import { articlePicture, StoryCard, SITE, cleanHtml, teaser, type Article } from "../shared"

// One News & Stories article on the test website, laid out as vectis.co.uk lays out an article
// (2026-10-14): BACK TO ALL NEWS, the title centred, "Published on:", the copy at reading width,
// then three more stories. The text is the article PAGE's own HTML as the collector cleaned it
// (paragraphs, emojis, the pictures inside it — the feed's copy is flattened), with each picture
// served from our R2 copy once uploaded, else from the website. Older loads that only have the
// feed's text get it split back into paragraphs.

export const dynamic = "force-dynamic"

const COLS_BASIC = Prisma.sql`a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."introText", a."fullText", a."imagePath", a."imageKey"`
// The page's own HTML and its pictures arrived with Run Migrations (2026-09-23); until an
// environment has those columns the article is read without them and shows the feed's text.
const COLS = Prisma.sql`${COLS_BASIC}, a."bodyHtml", a."bodyImages", a."bodyImageKeys"`
const missingColumns = (e: unknown) => /bodyHtml|bodyImages|bodyImageKeys/i.test(String((e as { message?: string })?.message ?? ""))

async function loadArticle(alias: string): Promise<Article | null> {
  // The alias is unique on the site in practice (Joomla only enforces it per category) — newest wins.
  const run = (cols: Prisma.Sql) => prisma.$queryRaw<Article[]>`SELECT ${cols} FROM "SiteNewsArticle" a WHERE a."alias" = ${alias} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 1`
  let rows: Article[]
  try { rows = await run(COLS) }
  catch (e) { if (!missingColumns(e)) throw e; rows = await run(COLS_BASIC) }
  return rows[0] ?? null
}

// The address segment as typed: a stray "%" in a hand-typed one must be a 404, not a crash.
function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// "13/10/2026" — the live site's "Published on:" line, in Europe/London (the server runs in UTC).
const publishedOn = (d: Date) => londonYmd(d).split("-").reverse().join("/")

// The article's own pictures: our copy when it has been uploaded (news-photos/<file>), else the
// website's file. Substituted BEFORE the general clean, while the paths are still as stored.
async function withOurPictures(html: string, a: Article): Promise<string> {
  const keys = new Set(a.bodyImageKeys ?? [])
  let out = html
  for (const im of a.bodyImages ?? []) {
    // The collector could not fetch it (the file is gone from the site, or its host is dead), so
    // there is nothing to show — not even a copy we hold, which would be an error page it saved
    // before it checked what it was given (2026-09-24).
    if (im.missing) {
      out = out.replace(new RegExp(`<img src="${escapeRe(im.path)}"[^>]*>`, "g"), "")
      continue
    }
    const key = `news-photos/${im.file}`
    const url = keys.has(key)
      ? await getSignedImageUrl(key, 3600).catch(() => null)
      : null
    if (!url && (im.path.startsWith("inline/") || /^https?:\/\//i.test(im.path))) {
      // Nothing to fall back to: a picture pasted into an older story as data exists only as the
      // collector's file, and one on another host is on the old site's dead image stores (measured
      // 2026-09-23: 220 on rackcdn.com answer 404, 124 on the old CloudFront store answer 202 and
      // nothing) — so it is left out rather than shown broken, until a copy is uploaded.
      out = out.replace(new RegExp(`<img src="${escapeRe(im.path)}"[^>]*>`, "g"), "")
      continue
    }
    const fallback = /^https?:\/\//i.test(im.path) ? im.path : SITE + im.path
    out = out.replace(new RegExp(`src="${escapeRe(im.path)}"`, "g"), `src="${url ?? fallback}"`)
  }
  return out
}

// A fallback for articles loaded before the page text was collected: the feed's flattened text,
// with its runs of spaces (where the paragraphs were) turned back into paragraphs and bare
// addresses made into links. The feed's text is already HTML-escaped (Game &amp; Watch).
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}|\s{3,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${p.replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" target="_blank" rel="noreferrer">$1</a>`)}</p>`)
    .join("\n")
}

// "Keep reading": three more stories — this one's category first (its first tag; the site's
// categories are its tags), the newest others making the three up. Never a throw: the story
// still reads without the row.
async function moreStories(a: Article): Promise<(Article & { photo: string | null })[]> {
  try {
    const rows: Article[] = a.category
      ? await prisma.$queryRaw<Article[]>`SELECT ${COLS_BASIC} FROM "SiteNewsArticle" a WHERE a."id" <> ${a.id} AND ${a.category} = ANY(a."tags") ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 3`
      : []
    if (rows.length < 3) {
      const seen = [a.id, ...rows.map(r => r.id)]
      const fill = await prisma.$queryRaw<Article[]>`SELECT ${COLS_BASIC} FROM "SiteNewsArticle" a WHERE a."id" NOT IN (${Prisma.join(seen)}) ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT ${3 - rows.length}`
      rows.push(...fill)
    }
    return await Promise.all(rows.map(async m => ({ ...m, photo: await articlePicture(m) })))
  } catch {
    return []
  }
}

export async function generateMetadata({ params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params
  const a = await loadArticle(safeDecode(alias)).catch(() => null)
  if (!a) return { title: "News & Stories" }
  return { title: `${a.title} — News & Stories`, description: teaser(a, 160) || undefined }
}

export default async function ArticlePage({ params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params
  const a = await loadArticle(safeDecode(alias))
  if (!a) notFound()

  const body = a.bodyHtml
    ? cleanHtml(await withOurPictures(a.bodyHtml, a))
    : paragraphs(a.fullText || a.introText || "")
  // The article's own picture is in the body when the page was collected; the cover only stands in when it isn't.
  const bodyHasPicture = /<img\b/i.test(body)
  const cover = bodyHasPicture ? null : await articlePicture(a)
  const more = await moreStories(a)
  const listHref = a.category ? `/news-stories/news?category=${encodeURIComponent(a.category)}` : "/news-stories/news"

  return (
    <div className="bg-white">
      <div className="vs-page">
        <div className="vs-container">
          <p className="mb-6"><Link href="/news-stories/news" className="vs-link vs-link-back vs-link-sm">Back to all news</Link></p>

          {/* The copy sits at reading width (760px), as on the live site; wide pictures inside it fit that width. */}
          <article className="max-w-[760px] mx-auto">
            <header className="text-center mb-8">
              {a.category && (
                <p className="mb-3"><Link href={listHref} className="vs-kicker vs-kicker-navy hover:underline">{a.category}</Link></p>
              )}
              <h1 className="vs-h2 mb-3">{a.title}</h1>
              {a.publishedAt && <p className="text-sm text-[var(--vs-muted)]">Published on: {publishedOn(a.publishedAt)}</p>}
            </header>

            {/* The cover is the first thing on the page, so it loads eagerly, unlike the cards' pictures. */}
            {cover && <img src={cover} alt="" className="block w-full h-auto mb-8" />}

            {body
              /* overflow-x-auto: a wide table or embed in a collected article scrolls inside the copy rather than widening a phone's page. */
              ? <div className="news-body overflow-x-auto" dangerouslySetInnerHTML={{ __html: body }} />
              : <p className="text-[var(--vs-muted)]">No text is held for this story.</p>}

            {a.tags.length > 0 && (
              <footer className="mt-10 pt-6 border-t border-[var(--vs-line)] flex flex-wrap items-center gap-2">
                <span className="vs-caps text-[var(--vs-muted)] mr-2">Tagged</span>
                {/* A tag is one of the site's categories, so it opens the listing filtered to it. */}
                {a.tags.map(t => (
                  <Link key={t} href={`/news-stories/news?category=${encodeURIComponent(t)}`} className="vs-btn vs-btn-outline min-h-11">{t}</Link>
                ))}
              </footer>
            )}
          </article>
        </div>
      </div>

      {more.length > 0 && (
        <section className="vs-section vs-band" aria-labelledby="keep-reading">
          <div className="vs-container">
            <h2 id="keep-reading" className="vs-h2 text-center mb-8">Keep reading</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {more.map(m => <StoryCard key={m.id} a={m} />)}
            </div>
            <p className="text-center mt-10">
              <Link href={listHref} className="vs-link">{a.category ? `More from ${a.category}` : "All news"}</Link>
            </p>
          </div>
        </section>
      )}
    </div>
  )
}
