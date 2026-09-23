import Link from "next/link"
import { format } from "date-fns"
import { getSignedImageUrl } from "@/lib/r2"
import { htmlToText } from "@/lib/html-text"

// Shared by the News & Stories list and article pages on the test website. (A page file may only
// export its page, so the helpers and the story card live here.)

export const SITE = "https://www.vectis.co.uk/"

export type Article = {
  id: number; alias: string; title: string; category: string | null; tags: string[]
  featured: boolean; publishedAt: Date | null; introText: string | null; fullText: string | null
  imagePath: string | null; imageKey: string | null
  /** The article page's own HTML (cleaned by the collector) — null for loads made before it was collected. */
  bodyHtml?: string | null
  /** The pictures inside the article: the site path as it appears in bodyHtml, and the collector's file name. */
  bodyImages?: { path: string; file: string }[] | null
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

export const gbDate = (d: Date | null) => (d ? format(d, "d MMMM yyyy") : "")

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

export function StoryCard({ a, big }: { a: Article & { photo: string | null }; big?: boolean }) {
  const href = `/news-stories/news/${encodeURIComponent(a.alias)}`
  return (
    <Link href={href} className="group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col">
      <div className={`relative bg-gray-100 overflow-hidden ${big ? "aspect-[16/10]" : "aspect-[16/9]"}`}>
        {a.photo ? (
          <img src={a.photo} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="absolute inset-0 bg-[#32348A]/5 flex items-center justify-center">
            <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        {a.featured && <span className="absolute top-2 left-2 bg-[#DB0606] text-white text-[10px] font-black uppercase tracking-widest px-2 py-0.5">Featured</span>}
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#2AB4A6] truncate">{a.category ?? "News"}</span>
          {a.publishedAt && <span className="text-[11px] text-gray-400 uppercase tracking-wide shrink-0">{gbDate(a.publishedAt)}</span>}
        </div>
        <h3 className={`font-black text-[#32348A] leading-snug group-hover:underline mb-2 ${big ? "text-xl line-clamp-3" : "text-base line-clamp-2"}`}>{a.title}</h3>
        <p className="text-sm text-gray-600 leading-snug line-clamp-3 mb-4">{teaser(a)}</p>
        <span className="mt-auto text-xs font-black uppercase tracking-widest text-[#32348A]">Read story <span aria-hidden="true">→</span></span>
      </div>
    </Link>
  )
}

export function PageLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`min-w-[2.5rem] text-center px-3 py-2 text-sm font-semibold border transition-colors ${
        active ? "bg-[#32348A] text-white border-[#32348A]" : "bg-white text-[#32348A] border-gray-300 hover:border-[#32348A]"
      }`}
    >
      {label}
    </Link>
  )
}
