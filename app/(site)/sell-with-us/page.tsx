import PublicSubmitPage from "../../submit/page"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// Sell with us — the customer valuation form (the same page as /submit). Built in the page editor
// (Website → Pages) once published there — its "Sell with us" live block is this same form; until
// then the form on its own.

export async function generateMetadata() {
  return pageMetadata("sell-with-us", {
    title: "Sell With Us — Free Valuation",
    description: "Submit your toys and collectables to Vectis for a free specialist valuation. The world's leading toy auction house.",
  })
}

export default async function SellWithUsPage() {
  const page = await publishedPage("sell-with-us")
  if (page) return <PageBlocks data={page.data} />
  return <PublicSubmitPage />
}
