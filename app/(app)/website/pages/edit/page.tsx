import Link from "next/link"
import type { Data } from "@puckeditor/core"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { BUILT_IN_PAGES, deptSlugOf, pathFor } from "@/app/(site)/page-editor/pages"
import { seedFor } from "@/app/(site)/page-editor/seeds"
import EditorLoader from "./editor-loader"

// /website/pages/edit?slug=how-to-bid — the page editor for one page of the TEST website. Admins
// only. It opens on the page's saved draft, else its live version, else its built-in design as
// blocks (seeds.ts) — so the first edit of any page starts from what the page looks like now.

export const dynamic = "force-dynamic"

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6">
      <div className="max-w-2xl rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-6">
        <h1 className="text-lg font-black text-gray-900 dark:text-white mb-2">{title}</h1>
        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">{children}</div>
        <Link href="/website/pages" className="inline-block mt-4 text-sm font-bold text-sky-700 dark:text-sky-400 hover:underline">← All pages</Link>
      </div>
    </div>
  )
}

export default async function EditSitePage({ searchParams }: { searchParams: Promise<{ slug?: string }> }) {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return <Notice title="Admins only"><p>The website&apos;s pages can only be edited by an admin.</p></Notice>
  }
  const { slug: raw } = await searchParams
  const slug = String(raw ?? "").trim()

  const builtIn = BUILT_IN_PAGES.find(p => p.slug === slug)
  const dept = deptSlugOf(slug)
  let title = builtIn?.label ?? ""
  if (dept) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT "name" FROM "SiteDepartment" WHERE "slug" = ${dept} LIMIT 1`.catch(() => [])
    if (!rows[0]) return <Notice title="No such department"><p>There&apos;s no department at {pathFor(slug)} — load the departments at Databases → Departments first.</p></Notice>
    title = rows[0].name
  }

  let row: { title: string; draft: unknown; published: unknown; publishedAt: Date | null } | null = null
  try {
    row = await prisma.sitePage.findUnique({ where: { slug }, select: { title: true, draft: true, published: true, publishedAt: true } })
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? "")
    if (/does not exist|relation/i.test(msg)) {
      return <Notice title="The page editor isn't set up here yet"><p>Its tables aren&apos;t on this environment — press <strong>Run Migrations</strong> on the Admin page, then come back.</p></Notice>
    }
    throw e
  }
  if (!builtIn && !dept && !row) {
    return <Notice title="No such page"><p>There&apos;s no page at {pathFor(slug)} yet — make it from the Pages list.</p></Notice>
  }

  // A draft identical to the live version (as it is straight after a publish) is the live version.
  const sameAsLive = !!row?.draft && !!row?.published && JSON.stringify(row.draft) === JSON.stringify(row.published)
  const startedFrom = row?.draft && !sameAsLive ? "draft" : row?.published ? "published" : builtIn || dept ? "built-in" : "new"
  const initialData = (row?.draft ?? row?.published ?? (await seedFor(slug, row?.title ?? title))) as Data

  return (
    <EditorLoader
      slug={slug}
      path={pathFor(slug)}
      title={row?.title ?? title}
      initialData={initialData}
      live={!!row?.published}
      publishedAt={row?.publishedAt ? row.publishedAt.toISOString() : null}
      builtIn={!!builtIn || !!dept}
      startedFrom={startedFrom}
    />
  )
}
