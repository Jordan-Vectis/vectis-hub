import { notFound } from "next/navigation"
import Link from "next/link"
import { htmlToText } from "@/lib/html-text"
import { cleanHtml } from "../../news-stories/news/shared"
import { getDepartment, sitePicture, withDeptPictures } from "../data"
import { DeptHighlights, DeptPastAuctions, NewsList } from "../sections"
import { PageBlocks, pageMetadata, publishedPage } from "../../page-editor/render"

// One department on the test website, from the page collected from vectis.co.uk and laid out as
// the site lays it out (2026-10-14): the banner picture with the title over it, the copy beside the
// navy "sell your collection" box, then — from our own databases — the hand-picked highlighted
// lots, the department's latest news (by its news category, else its keywords) and its past
// auctions (the sales the site's page listed, plus any whose title matches the keywords).
//
// Built in the page editor (Website → Pages → Departments) once published there; until then the
// built-in design below. The lots, news and past auctions are ../sections.tsx — the editor's live
// blocks show the same ones.

export const dynamic = "force-dynamic"

// These pages exist to be found — the title is the site's own page title and the description the
// first line or two of the copy, so a search result reads like the page.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const d = await getDepartment(slug).catch(() => null)
  if (!d) return { title: "Departments" }
  const text = htmlToText(d.copyHtml ?? "").replace(/\s+/g, " ").trim()
  const cut = text.length > 160 ? text.slice(0, 160).replace(/\s+\S*$/, "") + "…" : text
  return pageMetadata(`departments/${slug}`, {
    title: d.pageTitle ?? d.name,
    description: cut || `Sell ${d.name} at auction with Vectis, the world's leading collectable toy specialist.`,
    openGraph: { title: d.pageTitle ?? d.name, description: cut || undefined, type: "website" },
  })
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()

export default async function DepartmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const d = await getDepartment(slug)
  if (!d) notFound()

  const edited = await publishedPage(`departments/${slug}`)
  if (edited) return <PageBlocks data={edited.data} />

  const hero = await sitePicture(d.heroKey, d.heroPath)
  const copy = d.copyHtml ? cleanHtml(await withDeptPictures(d.copyHtml, d)) : ""
  // The "Sell your collection" side box as the site has it — video, text, the prices-achieved
  // picture — with its GET STARTED pointing at our own sell-with-us page.
  const side = d.sideHtml
    ? cleanHtml(await withDeptPictures(d.sideHtml, d)).replace(/href="(?:https:\/\/www\.vectis\.co\.uk)?\/valuations[^"]*"(?: target="_blank" rel="noreferrer")?/gi, 'href="/sell-with-us"')
    : ""
  const title = d.pageTitle ?? d.name

  // One h1 a page: the banner carries the title, so the copy's own <h1> is shown as an h2 — or
  // dropped when it only repeats the banner (the site's pages often head the copy with the name again).
  const copyH1 = copy.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const copyHeading = (copyH1 ? htmlToText(copyH1[1]) : d.heading ?? "").trim()
  const repeatsTitle = !copyHeading || norm(copyHeading) === norm(title)
  const body = copyH1
    ? copy.replace(copyH1[0], () => (repeatsTitle ? "" : copyH1[0].replace(/<(\/?)h1\b/gi, "<$1h2")))
    : copy

  return (
    <div className="bg-white">
      {/* ── Banner: the collected hero picture under a dark fade, the title in white; a navy band without one ── */}
      <div className="relative bg-[var(--vs-navy)] overflow-hidden flex items-end min-h-[220px] sm:min-h-[260px]">
        {hero && <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" aria-hidden="true" />
        <div className="vs-container relative pt-16 pb-8">
          <p className="vs-kicker mb-2">Collections wanted</p>
          <h1 className="vs-h1 !text-white">{title}</h1>
        </div>
      </div>

      <div className="vs-container pt-6 pb-12 lg:pb-16">
        {/* py-3 -my-3 on the text links: a 44px touch target (the iPads) without moving the text. */}
        <Link href="/departments" className="vs-link vs-link-back vs-link-sm py-3 -my-3">Back to departments</Link>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12 items-start">
          {/* ── The copy, as the site has it (its bold and italic runs, lists, pictures) ── */}
          <div className="lg:col-span-2 min-w-0">
            {!copyH1 && !repeatsTitle && <h2 className="vs-h3 mb-4">{copyHeading}</h2>}
            {body
              ? <div className="vs-prose" dangerouslySetInnerHTML={{ __html: body }} />
              : <p className="vs-muted">No text is held for this department yet.</p>}
          </div>

          {/* ── The navy side box: the site's own "Sell your collection" column (video, GET STARTED, the
                prices-achieved picture), or ours when none was collected ── */}
          <aside className="bg-[var(--vs-navy)] text-white p-6 sm:p-8 min-w-0">
            {side ? (
              <div className="dept-side" dangerouslySetInnerHTML={{ __html: side }} />
            ) : (
              <>
                <h2 className="vs-h3 !text-white mb-3">Sell your collection with us</h2>
                <p className="text-white/85 mb-5">
                  From a single piece to a room of thousands, our Collections Team will guide you through the
                  process — a free valuation, no lotting fees, and worldwide marketing at no extra cost.
                </p>
                <Link href="/sell-with-us" className="vs-link !text-white py-3 -my-3">Get started</Link>
                <p className="mt-6 pt-5 border-t border-white/20 text-sm text-white/85">
                  Or talk to us on <a href="tel:+441642750616" className="text-white underline underline-offset-2">(+44) 01642 750 616</a>
                  <br />
                  <a href="mailto:collections@vectis.co.uk" className="text-white underline underline-offset-2">collections@vectis.co.uk</a>
                </p>
                <p className="mt-3"><Link href="/contact" className="vs-link vs-link-sm !text-white py-3 -my-3">Contact us</Link></p>
              </>
            )}
          </aside>
        </div>
      </div>

      <DeptHighlights slug={slug} />
      <NewsList department={slug} heading="Latest news" count={3} layout="cards" />
      <DeptPastAuctions slug={slug} />
    </div>
  )
}
