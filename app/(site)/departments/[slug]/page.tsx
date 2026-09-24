import { notFound } from "next/navigation"
import Link from "next/link"
import { htmlToText } from "@/lib/html-text"
import { cleanHtml } from "../../news-stories/news/shared"
import { getDepartment, sitePicture, withDeptPictures } from "../data"
import { DeptHighlights, DeptPastAuctions, NewsList } from "../sections"
import { PageBlocks, pageMetadata, publishedPage } from "../../page-editor/render"

// One department on the test website, from the page collected from vectis.co.uk: the banner, the
// "sell with us" copy, the hand-picked highlighted lots, plus — from our own databases — the
// department's latest news (by its news category, else its keywords) and its past auctions (the
// sales the site's page listed, plus any whose title matches the keywords). Its own design.
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
  const copyHasHeading = /<h1\b/i.test(copy)
  const title = d.pageTitle ?? d.name

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* ── Banner ── */}
      <div className="relative bg-[#32348A] overflow-hidden" style={{ height: "300px" }}>
        {hero ? (
          <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#32348A] to-[#4446a8]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 to-transparent" />
        <div className="relative h-full w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 flex flex-col justify-end pb-8">
          <div className="flex items-center gap-2 text-xs text-gray-300 mb-3">
            <Link href="/departments" className="hover:text-white transition-colors uppercase tracking-wider font-semibold">Departments</Link>
            <span>/</span>
            <span className="text-white uppercase tracking-wider font-semibold">{d.name}</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white">{title}</h1>
        </div>
      </div>

      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* ── The copy, as the site has it (its own heading, bold and italic runs, lists, pictures) ── */}
        <div className="lg:col-span-8 bg-white border border-gray-200 p-6 sm:p-8 xl:p-10">
          {!copyHasHeading && d.heading && <h1 className="text-3xl font-black text-[#32348A] leading-tight mb-4">{d.heading}</h1>}
          {copy
            ? <div className="news-body" dangerouslySetInnerHTML={{ __html: copy }} />
            : <p className="text-gray-400">No text is held for this department yet.</p>}
        </div>

        {/* ── The "Sell your collection" side box + latest news ── */}
        <div className="lg:col-span-4 flex flex-col gap-5">
          {side ? (
            <div className="dept-side bg-[#32348A] text-white p-6" dangerouslySetInnerHTML={{ __html: side }} />
          ) : (
            <div className="bg-[#32348A] text-white p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#2AB4A6] mb-1">Selling</p>
              <h3 className="text-2xl font-black mb-2">Sell your collection with us</h3>
              <p className="text-sm text-gray-200 leading-relaxed mb-5">Looking to sell? From a single piece to a room of thousands, our Collections Team will guide you through the process — a free valuation, no lotting fees, and worldwide marketing at no extra cost.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/sell-with-us" className="inline-flex items-center gap-2 bg-white text-[#32348A] text-xs font-black uppercase tracking-widest px-5 py-3 hover:bg-[#2AB4A6] hover:text-white transition-colors">Get started <span aria-hidden="true">→</span></Link>
                <span className="text-xs text-gray-300">or call <a href="tel:+441642750616" className="text-white font-semibold hover:underline">01642 750 616</a></span>
              </div>
            </div>
          )}

          <NewsList department={slug} heading="Latest news" count={3} layout="list" />
        </div>
      </div>

      {/* ── Highlighted lots ── */}
      <DeptHighlights slug={slug} />

      {/* ── Past auctions ── */}
      <DeptPastAuctions slug={slug} />
    </div>
  )
}
