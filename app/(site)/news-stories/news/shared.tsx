import Link from "next/link"
import { getSignedImageUrl } from "@/lib/r2"
import { htmlToText } from "@/lib/html-text"
import { dateShort } from "../../site-dates"

// Shared by the News & Stories list and article pages on the test website. (A page file may only
// export its page, so the helpers and the story card live here.)

export const SITE = "https://www.vectis.co.uk/"

export type Article = {
  id: number; alias: string; title: string; category: string | null; tags: string[]
  featured: boolean; publishedAt: Date | null; introText: string | null; fullText: string | null
  imagePath: string | null; imageKey: string | null
  /** The article page's own HTML (cleaned by the collector) — null for loads made before it was collected. */
  bodyHtml?: string | null
  /** The pictures inside the article: the site path as it appears in bodyHtml, and the collector's file name.
   *  `missing` = the collector could not fetch it (gone from the site, or a dead host) — never shown. */
  bodyImages?: { path: string; file: string; missing?: boolean }[] | null
  /** Our R2 copies of those (news-photos/<file>), registered by the picture upload. */
  bodyImageKeys?: string[] | null
}

/** Our R2 copy when the Hub has one (signed for an hour), else the website's own file — a
 *  visitor's browser can fetch that; only the Hub's server is refused. */
export async function articlePicture(a: { imageKey: string | null; imagePath: string | null }): Promise<string | null> {
  if (a.imageKey) return getSignedImageUrl(a.imageKey, 3600).catch(() => null)
  return a.imagePath ? SITE + a.imagePath : null
}

/** The first line or two of the article as plain text, without repeating the headline. */
export function teaser(a: { introText: string | null; fullText: string | null; title: string; bodyHtml?: string | null }, max = 150): string {
  const t = htmlToText(a.bodyHtml || a.introText || a.fullText || "").replace(/\s+/g, " ").trim()
  const head = a.title.replace(/\s+/g, " ").trim()
  const body = head && t.toLowerCase().startsWith(head.toLowerCase()) ? t.slice(head.length).replace(/^[\s:–—-]+/, "") : t
  if (body.length <= max) return body
  const cut = body.slice(0, max)
  const space = cut.lastIndexOf(" ")
  return (space > 60 ? cut.slice(0, space) : cut) + "…"
}

/** "15 October 2026" — in Europe/London, like every other date on the site (the server runs in UTC). */
export const gbDate = (d: Date | null) => dateShort(d)

// The site's HTML as served, made safe enough for the test site: scripts, styles and inline event
// handlers out; pictures and links that still point at the site's own root made absolute so they
// load from here; outside links open in a new tab. Used by the article and department pages.
export function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\shref\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/(src|href)="(?:\/)?(images\/)/gi, `$1="${SITE}$2`)
    .replace(/(src|href)="\/(?!\/)/gi, `$1="${SITE}`)
    .replace(/<a href="(https?:\/\/[^"]+)">/gi, `<a href="$1" target="_blank" rel="noreferrer">`)
}

/**
 * A story as vectis.co.uk's news cards show it: the picture 16:9 with a NEWS / FEATURED label in
 * its top-right corner, the date in red, the title, a line or two of the story, READ MORE. `big`
 * is the featured row's card — the same card with more room for the title. The picture, title and
 * READ MORE each open the story (one card can't be one link: links don't nest); the picture is
 * kept out of the tab order so a keyboard reaches each story once, by its title.
 */
export function StoryCard({ a, big }: { a: Article & { photo: string | null }; big?: boolean }) {
  const href = `/news-stories/news/${encodeURIComponent(a.alias)}`
  const line = teaser(a)
  return (
    <article className="vs-card flex flex-col h-full">
      <Link href={href} className="relative block bg-[var(--vs-bg)] aspect-[16/9] overflow-hidden" tabIndex={-1} aria-hidden="true">
        {a.photo
          ? <img src={a.photo} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <span className="w-full h-full flex items-center justify-center"><img src="/vectis-logo.svg" alt="" loading="lazy" width={120} height={48} className="opacity-30" /></span>}
        <span className="vs-badge absolute top-0 right-0">{a.featured ? "Featured" : "News"}</span>
      </Link>
      <div className={`flex flex-col flex-1 ${big ? "p-6 sm:p-7" : "p-5 sm:p-6"}`}>
        {a.publishedAt && <p className="vs-kicker mb-2">{gbDate(a.publishedAt)}</p>}
        <h3 className={`vs-h4 mb-3 ${big ? "line-clamp-3" : "line-clamp-2"}`}>
          <Link href={href} className="hover:underline">{a.title}</Link>
        </h3>
        {line && <p className="text-sm text-[var(--vs-muted)] line-clamp-3 mb-5">{line}</p>}
        <Link href={href} className="vs-link vs-link-sm mt-auto self-start" aria-label={`Read more: ${a.title}`}>Read more</Link>
      </div>
    </article>
  )
}

/** One page number in a `vs-pages` strip; the current page carries aria-current. */
export function PageLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link href={href} className="vs-page-link" aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  )
}
