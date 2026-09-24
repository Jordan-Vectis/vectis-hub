import { DepartmentsIndex } from "./sections"
import { PageBlocks, pageMetadata, publishedPage } from "../page-editor/render"

// The departments index on the test website: one tile per department, from the department pages
// collected from vectis.co.uk (Databases → Departments). Built in the page editor (Website → Pages)
// once published there; until then the built-in index (./sections.tsx — the editor's
// "Departments" live block shows the same one).

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return pageMetadata("departments", {
    title: "Departments",
    description: "Vectis's specialist departments — what we sell, highlights and results for each.",
  })
}

export default async function DepartmentsPage() {
  const page = await publishedPage("departments")
  if (page) return <PageBlocks data={page.data} />
  return (
    <DepartmentsIndex
      kicker="Specialist teams"
      heading="Departments"
      intro="Vectis has a number of specialist departments, each holding a series of auctions through the year. Pick a department for what we sell, highlighted lots, the latest news and past results."
    />
  )
}
