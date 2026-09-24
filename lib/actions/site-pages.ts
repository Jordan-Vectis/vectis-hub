"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { BUILT_IN_PAGES, deptSlugOf, pathFor, slugProblem } from "@/app/(site)/page-editor/pages"
import { seedFor } from "@/app/(site)/page-editor/seeds"

// The page editor's saves (Website → Pages) — TEST website only; nothing here touches any other
// part of the Hub. Admins only. Every action RETURNS its error rather than throwing: a production
// build hides a thrown server action's message, and "couldn't save" with no reason is useless.

type Result<T = {}> = ({ ok: true } & T) | { ok: false; error: string }

const MAX_BYTES = 2_000_000

async function admin(): Promise<{ name: string } | null> {
  const session = await auth()
  if (!session || session.user?.role !== "ADMIN") return null
  return { name: session.user?.name ?? session.user?.email ?? "an admin" }
}

// What a page's JSON must look like before it is stored: Puck's shape, and not absurdly large.
function checkData(data: unknown): string | null {
  if (!data || typeof data !== "object") return "The page came through empty."
  const d = data as { content?: unknown; root?: unknown }
  if (!Array.isArray(d.content) || !d.root || typeof d.root !== "object") return "The page came through in a shape the site can't show."
  if (JSON.stringify(data).length > MAX_BYTES) return "The page is too big to save (over 2 MB) — split it, or use fewer pasted pictures."
  return null
}

const rootProps = (data: unknown) => ((data as { root?: { props?: Record<string, unknown> } })?.root?.props ?? {}) as Record<string, unknown>
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

// Is this a page the editor may write? A built-in page, a department that exists, or a new page already made.
async function knownPage(slug: string): Promise<{ title: string } | null> {
  const built = BUILT_IN_PAGES.find(p => p.slug === slug)
  if (built) return { title: built.label }
  const dept = deptSlugOf(slug)
  if (dept) {
    const rows = await prisma.$queryRaw<{ name: string }[]>`SELECT "name" FROM "SiteDepartment" WHERE "slug" = ${dept} LIMIT 1`
    return rows[0] ? { title: rows[0].name } : null
  }
  const row = await prisma.sitePage.findUnique({ where: { slug }, select: { title: true } })
  return row ? { title: row.title } : null
}

const tableHint = (e: unknown) => {
  const msg = String((e as { message?: string })?.message ?? "")
  return /does not exist|relation/i.test(msg) ? "The page editor's tables aren't on this environment yet — press Run Migrations first." : msg || "Unknown error"
}

/** Saves what the editor holds as the page's draft — the site doesn't change. */
export async function saveSitePageDraft(slug: string, data: unknown): Promise<Result<{ at: string }>> {
  try {
    const who = await admin()
    if (!who) return { ok: false, error: "Only admins can edit the website's pages." }
    const bad = checkData(data)
    if (bad) return { ok: false, error: bad }
    const page = await knownPage(slug)
    if (!page) return { ok: false, error: "That page doesn't exist." }
    const json = data as Prisma.InputJsonValue
    const title = str(rootProps(data).title) ?? page.title
    const row = await prisma.sitePage.upsert({
      where: { slug },
      create: { slug, title, draft: json, updatedBy: who.name },
      update: { draft: json, title, updatedBy: who.name },
      select: { updatedAt: true },
    })
    return { ok: true, at: row.updatedAt.toISOString() }
  } catch (e) {
    console.error("saveSitePageDraft:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** Puts the page live on the site, and keeps a copy of this version in its history. */
export async function publishSitePage(slug: string, data: unknown): Promise<Result<{ at: string }>> {
  try {
    const who = await admin()
    if (!who) return { ok: false, error: "Only admins can publish the website's pages." }
    const bad = checkData(data)
    if (bad) return { ok: false, error: bad }
    const page = await knownPage(slug)
    if (!page) return { ok: false, error: "That page doesn't exist." }
    const json = data as Prisma.InputJsonValue
    const rp = rootProps(data)
    const title = str(rp.title) ?? page.title
    const seoTitle = str(rp.seoTitle), seoDescription = str(rp.seoDescription)
    const now = new Date()
    await prisma.$transaction([
      prisma.sitePage.upsert({
        where: { slug },
        create: { slug, title, draft: json, published: json, seoTitle, seoDescription, updatedBy: who.name, publishedAt: now, publishedBy: who.name },
        update: { title, draft: json, published: json, seoTitle, seoDescription, updatedBy: who.name, publishedAt: now, publishedBy: who.name },
        select: { slug: true },
      }),
      prisma.sitePageVersion.create({ data: { slug, data: json, seoTitle, seoDescription, publishedAt: now, publishedBy: who.name }, select: { id: true } }),
    ])
    revalidatePath(pathFor(slug))
    return { ok: true, at: now.toISOString() }
  } catch (e) {
    console.error("publishSitePage:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** Takes the editor's version off the site — the page shows its built-in design again. The draft and the history are kept. */
export async function unpublishSitePage(slug: string): Promise<Result> {
  try {
    const who = await admin()
    if (!who) return { ok: false, error: "Only admins can change the website's pages." }
    if (!BUILT_IN_PAGES.some(p => p.slug === slug) && !deptSlugOf(slug)) {
      return { ok: false, error: "A new page has no built-in design to go back to — delete it instead, or publish an earlier version." }
    }
    await prisma.sitePage.update({ where: { slug }, data: { published: Prisma.DbNull, publishedAt: null, publishedBy: null, seoTitle: null, seoDescription: null }, select: { slug: true } })
    revalidatePath(pathFor(slug))
    return { ok: true }
  } catch (e) {
    console.error("unpublishSitePage:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** The page's built-in design as blocks — to start again from it in the editor. Nothing is saved. */
export async function sitePageSeed(slug: string): Promise<Result<{ data: unknown }>> {
  try {
    if (!(await admin())) return { ok: false, error: "Only admins can edit the website's pages." }
    return { ok: true, data: await seedFor(slug) }
  } catch (e) {
    console.error("sitePageSeed:", e)
    return { ok: false, error: tableHint(e) }
  }
}

export type VersionRow = { id: string; publishedAt: string; publishedBy: string | null }

/** Every published version of the page, newest first. */
export async function listSitePageVersions(slug: string): Promise<Result<{ versions: VersionRow[] }>> {
  try {
    if (!(await admin())) return { ok: false, error: "Only admins can see a page's history." }
    const rows = await prisma.sitePageVersion.findMany({ where: { slug }, orderBy: { publishedAt: "desc" }, take: 100, select: { id: true, publishedAt: true, publishedBy: true } })
    return { ok: true, versions: rows.map(r => ({ id: r.id, publishedAt: r.publishedAt.toISOString(), publishedBy: r.publishedBy })) }
  } catch (e) {
    console.error("listSitePageVersions:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** One earlier version's blocks — loaded into the editor; nothing changes until it is saved or published. */
export async function getSitePageVersion(id: string): Promise<Result<{ data: unknown }>> {
  try {
    if (!(await admin())) return { ok: false, error: "Only admins can see a page's history." }
    const row = await prisma.sitePageVersion.findUnique({ where: { id }, select: { data: true } })
    if (!row) return { ok: false, error: "That version isn't there any more." }
    return { ok: true, data: row.data }
  } catch (e) {
    console.error("getSitePageVersion:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** A new page of the editor's own, at /<slug>. Starts as a draft; not on the site until published. */
export async function createSitePage(title: string, slug: string): Promise<Result<{ slug: string }>> {
  try {
    const who = await admin()
    if (!who) return { ok: false, error: "Only admins can add pages to the website." }
    const name = String(title ?? "").trim().slice(0, 120)
    if (!name) return { ok: false, error: "Give the page a name." }
    const s = String(slug ?? "").trim().toLowerCase()
    const problem = slugProblem(s)
    if (problem) return { ok: false, error: problem }
    const existing = await prisma.sitePage.findUnique({ where: { slug: s }, select: { slug: true } })
    if (existing) return { ok: false, error: `There's already a page at /${s}.` }
    const draft = (await seedFor(s, name)) as unknown as Prisma.InputJsonValue
    await prisma.sitePage.create({ data: { slug: s, title: name, draft, updatedBy: who.name }, select: { slug: true } })
    return { ok: true, slug: s }
  } catch (e) {
    console.error("createSitePage:", e)
    return { ok: false, error: tableHint(e) }
  }
}

/** Deletes a new page (never a built-in one) and its history. */
export async function deleteSitePage(slug: string): Promise<Result> {
  try {
    if (!(await admin())) return { ok: false, error: "Only admins can delete the website's pages." }
    if (BUILT_IN_PAGES.some(p => p.slug === slug) || deptSlugOf(slug)) {
      return { ok: false, error: "The site's own pages can't be deleted — take the edited version off instead, and the built-in design comes back." }
    }
    await prisma.sitePage.delete({ where: { slug }, select: { slug: true } })
    revalidatePath(pathFor(slug))
    return { ok: true }
  } catch (e) {
    console.error("deleteSitePage:", e)
    return { ok: false, error: tableHint(e) }
  }
}
