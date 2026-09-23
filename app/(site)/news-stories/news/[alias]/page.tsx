import { notFound } from "next/navigation"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { articlePicture, gbDate, StoryCard, SITE, type Article } from "../shared"

// One News & Stories article on the test website. The text is the site's own HTML, given a light
// clean (no scripts, no inline event handlers) and its relative picture and link addresses made
// absolute to vectis.co.uk, then rendered as it was written. Its own design, not the live site's.

export const dynamic = "force-dynamic"

const COLS = Prisma.sql`a."id", a."alias", a."title", a."category", a."tags", a."featured", a."publishedAt", a."introText", a."fullText", a."imagePath", a."imageKey"`

async function loadArticle(alias: string): Promise<Article | null> {
  // The alias is unique on the site in practice (Joomla only enforces it per category) — newest wins.
  const rows = await prisma.$queryRaw<Article[]>`SELECT ${COLS} FROM "SiteNewsArticle" a WHERE a."alias" = ${alias} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 1`
  return rows[0] ?? null
}

// The site's HTML as served, made safe enough for the test site: scripts, styles and inline event
// handlers out; pictures and links that point at the site's own root made absolute so they still
// load from here.
function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/(src|href)="(?:\/)?(images\/)/gi, `$1="${SITE}$2`)
    .replace(/(src|href)="\/(?!\/)/gi, `$1="${SITE}`)
}

export async function generateMetadata({ params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params
  const a = await loadArticle(decodeURIComponent(alias)).catch(() => null)
  return { title: a ? `${a.title} — News & Stories` : "News & Stories" }
}

export default async function ArticlePage({ params }: { params: Promise<{ alias: string }> }) {
  const { alias } = await params
  const a = await loadArticle(decodeURIComponent(alias))
  if (!a) notFound()

  const photo = await articlePicture(a)
  const body = cleanHtml(a.fullText || a.introText || "")
  // Three more stories — from the same category when there is one.
  const sameCategory = a.category ? Prisma.sql`AND a."category" = ${a.category}` : Prisma.empty
  const moreRows = await prisma.$queryRaw<Article[]>`SELECT ${COLS} FROM "SiteNewsArticle" a WHERE a."id" <> ${a.id} ${sameCategory} ORDER BY a."publishedAt" DESC NULLS LAST, a."id" DESC LIMIT 3`
  const more = await Promise.all(moreRows.map(async m => ({ ...m, photo: await articlePicture(m) })))
  const listHref = a.category ? `/news-stories/news?category=${encodeURIComponent(a.category)}` : "/news-stories/news"

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* ── Top bar ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/news-stories/news" className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#32348A] hover:text-[#DB0606] transition-colors">
            <span aria-hidden="true">←</span> All news
          </Link>
          {a.category && (
            <>
              <span className="hidden sm:inline text-gray-300">|</span>
              <Link href={listHref} className="text-xs font-black uppercase tracking-[0.2em] text-[#2AB4A6] hover:underline">{a.category}</Link>
            </>
          )}
          {a.publishedAt && <span className="ml-auto text-[11px] text-gray-400 uppercase tracking-wide">{gbDate(a.publishedAt)}</span>}
        </div>
      </div>

      <article className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-3xl sm:text-4xl font-black text-[#32348A] leading-tight mb-5">{a.title}</h1>

        {photo && (
          <div className="bg-white border border-gray-200 p-3 mb-8">
            <img src={photo} alt="" className="w-full max-h-[560px] object-contain bg-gray-100" />
          </div>
        )}

        <div className="bg-white border border-gray-200 p-6 sm:p-8">
          {body
            ? <div className="news-body" dangerouslySetInnerHTML={{ __html: body }} />
            : <p className="text-gray-400">No text is held for this story.</p>}
          {a.tags.length > 0 && (
            <div className="mt-8 pt-5 border-t border-gray-200 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500 mr-1">Tagged</span>
              {a.tags.map(t => (
                <Link key={t} href={`/news-stories/news?search=${encodeURIComponent(t)}`} className="text-[11px] font-bold uppercase tracking-wider text-[#32348A] border border-[#32348A]/30 px-2 py-1 hover:bg-[#32348A] hover:text-white transition-colors">{t}</Link>
              ))}
            </div>
          )}
        </div>
      </article>

      {more.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-14">
          <div className="mb-5">
            <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">Keep reading</p>
            <h2 className="text-2xl font-black text-[#32348A] uppercase tracking-tight">{a.category ? `More from ${a.category}` : "More stories"}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {more.map(m => <StoryCard key={m.id} a={m} />)}
          </div>
        </section>
      )}
    </div>
  )
}
