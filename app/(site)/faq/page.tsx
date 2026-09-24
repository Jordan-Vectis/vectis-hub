import FaqBuiltIn from "./faq-built-in"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// The FAQ page. Built in the page editor (Website → Pages) once published there; until then the
// built-in design (./faq-built-in.tsx).

export async function generateMetadata() {
  return pageMetadata("faq", {
    title: "FAQ",
    description: "Answers to the questions we're asked most about bidding, buying, paying, selling, postage and grading at Vectis Auctions.",
  })
}

export default async function FaqPage() {
  const page = await publishedPage("faq")
  if (page) return <PageBlocks data={page.data} />
  return <FaqBuiltIn />
}
