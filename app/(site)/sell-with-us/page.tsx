import Link from "next/link"
import PublicSubmitPage from "../../submit/page"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// Sell with us — the customer valuation form (the same page as /submit) under the site's inner-page
// header: "‹ BACK TO HOME", the title with its short navy rule and a line of invitation; the form
// brings its own "Why use Vectis?" band and hides its standalone title inside the site. Built in
// the page editor (Website → Pages) once published there — its "Sell with us" live block is this
// same form; until then the form on its own.

export async function generateMetadata() {
  return pageMetadata("sell-with-us", {
    title: "Sell With Us — Free Valuation",
    description: "Submit your toys and collectables to Vectis for a free specialist valuation. The world's leading toy auction house.",
  })
}

export default async function SellWithUsPage() {
  const page = await publishedPage("sell-with-us")
  if (page) return <PageBlocks data={page.data} />
  return (
    <div className="pt-8">
      <div className="vs-container mb-10">
        <p className="mb-6"><Link href="/" className="vs-link vs-link-back vs-link-sm">Back to home</Link></p>
        <h1 className="vs-h2 vs-rule">Sell with us</h1>
        <p className="vs-lead mt-8 max-w-[760px]">
          It&apos;s easy to sell your collectable items with us. Tell us about them below, or call us on{" "}
          <a href="tel:+441642750616" className="vs-text-link">(+44) 01642 750 616</a>, and our experts will review your
          items and support you to achieve the best possible price for your collectables.
        </p>
      </div>
      <PublicSubmitPage />
    </div>
  )
}
