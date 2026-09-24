import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { BUILT_IN_PAGES, DEPT_PREFIX, pathFor, type PageGroup } from "@/app/(site)/page-editor/pages"
import NewPageForm from "./new-page-form"

// Website → Pages: every page of the TEST website, and its state in the page editor. The site keeps
// each page's built-in design until the page is published from the editor. Admins only — the
// Website card is open to everyone, so the page checks the role itself.

export const dynamic = "force-dynamic"

type Row = { slug: string; title: string; hasDraft: boolean; live: boolean; changed: boolean; publishedAt: Date | null; publishedBy: string | null; updatedAt: Date; updatedBy: string | null }
type Entry = { slug: string; label: string; group: PageGroup; row: Row | null }

// ⚠ UK time, always — the server runs in UTC, so without the zone it read an hour early all summer.
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })

function State({ e }: { e: Entry }) {
  const r = e.row
  if (r?.live && r.changed) return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 text-[11px] font-bold">● Live, with unpublished changes</span>
  if (r?.live) return <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 px-2.5 py-0.5 text-[11px] font-bold">● Live — edited version</span>
  if (r?.hasDraft) return <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 px-2.5 py-0.5 text-[11px] font-bold">● Draft, not published</span>
  if (e.group === "New pages") return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2.5 py-0.5 text-[11px] font-bold">● Not on the site</span>
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2.5 py-0.5 text-[11px] font-bold">● Built-in design</span>
}

export default async function SitePagesList() {
  const session = await auth()
  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">The website&apos;s pages can only be edited by an admin.</p>
      </div>
    )
  }

  let rows: Row[] = []
  let tableMissing = false
  try {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT "slug", "title", ("draft" IS NOT NULL) AS "hasDraft", ("published" IS NOT NULL) AS "live",
             ("published" IS NOT NULL AND "draft" IS NOT NULL AND "draft" IS DISTINCT FROM "published") AS "changed",
             "publishedAt", "publishedBy", "updatedAt", "updatedBy"
      FROM "SitePage"`
  } catch (e) {
    if (/does not exist|relation/i.test(String((e as { message?: string })?.message ?? ""))) tableMissing = true
    else throw e
  }
  const bySlug = new Map(rows.map(r => [r.slug, r]))

  let departments: { slug: string; name: string }[] = []
  try {
    departments = await prisma.$queryRaw<{ slug: string; name: string }[]>`SELECT "slug", "name" FROM "SiteDepartment" ORDER BY "order", "name"`
  } catch { departments = [] }

  const builtInSlugs = new Set(BUILT_IN_PAGES.map(p => p.slug))
  const entries: Entry[] = [
    ...BUILT_IN_PAGES.map(p => ({ slug: p.slug, label: p.label, group: p.group, row: bySlug.get(p.slug) ?? null })),
    ...departments.map(d => ({ slug: DEPT_PREFIX + d.slug, label: d.name, group: "Departments" as PageGroup, row: bySlug.get(DEPT_PREFIX + d.slug) ?? null })),
    ...rows.filter(r => !builtInSlugs.has(r.slug) && !r.slug.startsWith(DEPT_PREFIX)).sort((a, b) => a.title.localeCompare(b.title))
      .map(r => ({ slug: r.slug, label: r.title, group: "New pages" as PageGroup, row: r })),
  ]
  const groups: PageGroup[] = ["Main pages", "Help & information", "Departments", "New pages"]
  const liveCount = rows.filter(r => r.live).length

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/website" className="text-xs font-bold text-sky-700 dark:text-sky-400 hover:underline">← Website</Link>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white mt-1">📄 Pages</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1 max-w-4xl">
            Every page of the <strong>test website</strong>, built from blocks you drag in and edit. Changes save as a draft on their own; the site changes only when you press <strong>Publish</strong> in the editor, and every publish is kept so a page can be put back.
            Until a page is published from here, the site shows its built-in design.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500 dark:text-gray-400">
          {entries.length} pages · {liveCount} showing an edited version
        </div>
      </div>

      {tableMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          The page editor&apos;s tables aren&apos;t on this environment yet — press <strong>Run Migrations</strong> on the Admin page before editing.
        </div>
      )}

      <NewPageForm />

      {/* What the coloured dots mean (design rule 3 — a colour that means something needs a key). */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span><span className="text-green-600">●</span> Live — the site shows the edited version</span>
        <span><span className="text-amber-500">●</span> A draft that isn&apos;t on the site yet</span>
        <span><span className="text-gray-400">●</span> The site shows the page&apos;s built-in design (a new page: not on the site)</span>
      </div>

      {groups.map(g => {
        const list = entries.filter(e => e.group === g)
        if (list.length === 0 && g !== "Departments") return null
        return (
          <section key={g}>
            <h2 className="text-xs font-black uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-2">{g} <span className="font-semibold">({list.length})</span></h2>
            {list.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No departments are held yet — load them at Databases → Departments.</p>
            ) : (
              <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] divide-y divide-gray-100 dark:divide-gray-800">
                {list.map(e => (
                  <div key={e.slug} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-[220px] flex-1">
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{e.label}</p>
                      <a href={pathFor(e.slug)} target="_blank" rel="noreferrer" className="text-xs font-mono text-sky-700 dark:text-sky-400 hover:underline">{pathFor(e.slug)} ↗</a>
                    </div>
                    <div className="min-w-[200px]"><State e={e} /></div>
                    <div className="min-w-[220px] text-[11px] text-gray-500 dark:text-gray-400">
                      {e.row?.publishedAt
                        ? <>Published {when(e.row.publishedAt)}{e.row.publishedBy ? ` by ${e.row.publishedBy}` : ""}</>
                        : e.row?.hasDraft
                          ? <>Draft saved {when(e.row.updatedAt)}{e.row.updatedBy ? ` by ${e.row.updatedBy}` : ""}</>
                          : "Not edited yet"}
                    </div>
                    <Link
                      href={`/website/pages/edit?slug=${encodeURIComponent(e.slug)}`}
                      className="inline-flex min-h-[40px] items-center rounded-lg bg-sky-600 hover:bg-sky-500 px-4 text-xs font-bold text-white"
                    >
                      Edit
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
