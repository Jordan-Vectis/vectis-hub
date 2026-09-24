import { notFound } from "next/navigation"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"
import { RESERVED_SLUGS, SLUG_RE } from "../page-editor/pages"

// A page of the test website made in the page editor (Website → Pages → New page), at /<its name>.
// Only a PUBLISHED page shows; anything else is the ordinary "not found". Every name the app
// already answers is refused when the page is made (RESERVED_SLUGS), and checked again here.

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const p = SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug) ? await publishedPage(slug) : null
  return p ? pageMetadata(slug, { title: p.title }) : {}
}

export default async function EditorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) notFound()
  const page = await publishedPage(slug)
  if (!page) notFound()
  return <PageBlocks data={page.data} />
}
