import NewsIndex, { type NewsParams } from "./index-view"
import { PageBlocks, pageMetadata, publishedPage } from "../../page-editor/render"

// News & Stories on the test website. Built in the page editor (Website → Pages) once published
// there; until then the built-in listing (./index-view.tsx — the editor's "News & Stories" live
// block shows the same one).

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return pageMetadata("news-stories/news", {
    title: "News & Stories",
    description: "Sold prices, stories and news from the world's leading toy and collectables auction house.",
  })
}

export default async function NewsPage({ searchParams }: { searchParams: Promise<NewsParams> }) {
  const sp = await searchParams
  const page = await publishedPage("news-stories/news")
  if (page) return <PageBlocks data={page.data} searchParams={sp} />
  return <NewsIndex sp={sp} />
}
