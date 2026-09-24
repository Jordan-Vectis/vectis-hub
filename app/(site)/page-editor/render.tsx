import { cache } from "react"
import type { Metadata } from "next"
import { Render, type Data } from "@puckeditor/core"
import { prisma } from "@/lib/prisma"
import { siteConfig } from "./site-config"

// How a test-website page built in the page editor (Website → Pages) reaches the site. SERVER ONLY.
//
// Every built-in page asks publishedPage(slug) first: when the editor has PUBLISHED that page, the
// site draws the page's blocks; when it hasn't (or before Run Migrations has made the table), the
// page shows its built-in design as it always has. Nothing about a page changes until someone
// presses Publish.

export type PublishedPage = { data: Data; seoTitle: string | null; seoDescription: string | null; title: string }

// One read per page view, shared by generateMetadata and the page itself (React's request cache).
export const publishedPage = cache(async (slug: string): Promise<PublishedPage | null> => {
  try {
    const row = await prisma.sitePage.findUnique({
      where: { slug },
      select: { published: true, seoTitle: true, seoDescription: true, title: true },
    })
    if (!row?.published || typeof row.published !== "object") return null
    return { data: row.published as unknown as Data, seoTitle: row.seoTitle, seoDescription: row.seoDescription, title: row.title }
  } catch (e) {
    // No table yet (Run Migrations adds it) is expected and quiet: the built-in page stands. Any
    // other failure is logged — a page silently falling back to its old design is otherwise a mystery.
    const msg = String((e as { message?: string })?.message ?? "")
    if (!/does not exist|relation|column/i.test(msg)) console.error(`site page "${slug}": couldn't read the published version —`, msg)
    return null
  }
})

/** The page's title and description for search engines: the editor's when it set them, else the built-in page's. */
export async function pageMetadata(slug: string, fallback: Metadata): Promise<Metadata> {
  const p = await publishedPage(slug)
  if (!p) return fallback
  const title = p.seoTitle?.trim() || fallback.title || p.title
  const description = p.seoDescription?.trim() || fallback.description
  return {
    ...fallback,
    title,
    description,
    openGraph: { ...(fallback.openGraph ?? {}), title: typeof title === "string" ? title : undefined, description: description ?? undefined },
  }
}

/** A page's blocks, drawn the way the site draws them. `searchParams` reaches the live blocks that read the address bar. */
export function PageBlocks({ data, searchParams }: { data: Data; searchParams?: Record<string, string | undefined> }) {
  return <Render config={siteConfig} data={data} metadata={{ searchParams: searchParams ?? {} }} />
}
