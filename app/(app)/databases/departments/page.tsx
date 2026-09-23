import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import DepartmentsTools from "./departments-tools"

// Databases → Departments: the website's 28 department pages — menu name, banner and tile pictures,
// the "sell with us" copy, the hand-picked highlighted lots, and the words used to find each
// department's news and past sales. Jordan, 2026-09-23: "what about the department pages?" → scrape
// what's there now, an editor to follow; and "why would I do it through the news, they are totally
// separate" → its own page, own load, own picture upload.
//
// Where the rows come from: scripts/collect-departments.mjs on an office machine (the website
// refuses the Hub's server), loaded with 📥 Update the departments; the test website's Departments
// menu and pages read from here.
const SITE = "https://www.vectis.co.uk/"
type Row = {
  slug: string; name: string; order: number; pageTitle: string | null; heading: string | null
  heroPath: string | null; heroKey: string | null; tilePath: string | null; tileKey: string | null
  copyHtml: string | null; highlights: { file?: string }[] | null; highlightKeys: string[]
  newsCategory: string | null; saleKeywords: string[]; siteSaleIds: number[]; pulledAt: Date
  picture?: string | null
}
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "")
const ext = (p: string) => (p.split("?")[0].match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase()

export default async function DepartmentsDatabasePage() {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"

  let rows: Row[] = [], tableError: string | null = null
  const missing: { file: string }[] = []
  let picturesHeld = 0, picturesWanted = 0
  try {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT d."slug", d."name", d."order", d."pageTitle", d."heading", d."heroPath", d."heroKey", d."tilePath", d."tileKey", d."copyHtml",
             d."highlights", d."highlightKeys", d."newsCategory", d."saleKeywords", d."siteSaleIds", d."pulledAt"
      FROM "SiteDepartment" d ORDER BY d."order", d."name"`
    for (const d of rows) {
      const keys = new Set(d.highlightKeys ?? [])
      if (d.heroPath) { picturesWanted++; if (d.heroKey) picturesHeld++; else missing.push({ file: `dept-${d.slug}-hero${ext(d.heroPath)}` }) }
      if (d.tilePath) { picturesWanted++; if (d.tileKey) picturesHeld++; else missing.push({ file: `dept-${d.slug}-tile${ext(d.tilePath)}` }) }
      for (const h of d.highlights ?? []) {
        if (!h?.file) continue
        picturesWanted++
        if (keys.has(`news-photos/${h.file}`)) picturesHeld++; else missing.push({ file: h.file })
      }
    }
    await Promise.all(rows.map(async d => {
      const key = d.tileKey ?? d.heroKey, path = d.tilePath ?? d.heroPath
      d.picture = key ? await getSignedImageUrl(key, 3600).catch(() => null) : path ? SITE + path : null
    }))
  } catch (e: any) {
    const msg = String(e?.message ?? "")
    tableError = /does not exist|relation/i.test(msg) ? "The departments table isn't there yet — press Run Migrations on this environment first." : (msg || "Couldn't read the departments")
  }

  const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
  const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums", lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400", sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
  const withCopy = rows.filter(r => r.copyHtml).length
  const highlightsTotal = rows.reduce((n, r) => n + (r.highlights?.length ?? 0), 0)
  const lastPull = rows.reduce<Date | null>((m, r) => (!m || r.pulledAt > m ? r.pulledAt : m), null)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div>
          <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
          <h1 className="text-xl font-bold mt-1">Departments</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">The website&apos;s department pages — the Departments menu, each page&apos;s banner, &quot;sell with us&quot; copy and highlighted lots — collected on an office machine. The test website&apos;s Departments menu and pages read from here; an editor for the copy can follow.</p>
        </div>

        {rows.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}><div className={lbl}>Departments</div><div className={big}>{rows.length}</div><div className={sub}>{withCopy} with their page copy · collected {fmtDate(lastPull)}</div></div>
            <div className={tile}><div className={lbl}>Highlighted lots</div><div className={big}>{highlightsTotal.toLocaleString()}</div><div className={sub}>hand-picked past lots on the department pages</div></div>
            <div className={tile}><div className={lbl}>Pictures in the Hub</div><div className={big}>{picturesHeld.toLocaleString()} <span className="text-base font-semibold text-gray-500">of {picturesWanted.toLocaleString()}</span></div>
              <div className={sub}>{missing.length ? `${missing.length.toLocaleString()} still only on the website` : "every picture is in the Hub"}</div>
              <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${picturesWanted ? Math.round((picturesHeld / picturesWanted) * 100) : 0}%` }} /></div></div>
            <div className={tile}><div className={lbl}>On the test site</div><div className={big}><Link href="/departments" className="text-violet-600 dark:text-violet-400 hover:underline text-lg">Departments →</Link></div><div className={sub}>the menu, the index and a page per department</div></div>
          </div>
        )}

        {isAdmin && !tableError && <DepartmentsTools missing={missing} held={rows.length} />}

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">No departments here yet — run the collector on an office machine and load its file with 📥 Update the departments.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {rows.map(d => {
              const keys = new Set(d.highlightKeys ?? [])
              const hl = d.highlights ?? []
              const hlHeld = hl.filter(h => h?.file && keys.has(`news-photos/${h.file}`)).length
              return (
                <div key={d.slug} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] overflow-hidden flex flex-col">
                  <Link href={`/departments/${d.slug}`} className="block aspect-[16/10] bg-gray-100 dark:bg-gray-800/60" title="Open on the test site">
                    {d.picture
                      ? <img src={d.picture} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">no picture</div>}
                  </Link>
                  <div className="p-3 space-y-1 flex-1 flex flex-col">
                    <div className="font-semibold text-gray-900 dark:text-white leading-snug">{d.name}</div>
                    {d.heading && <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1" title={d.heading}>{d.heading}</div>}
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      {hl.length} highlighted lots{hl.length ? ` (${hlHeld} pictures in the Hub)` : ""} · {d.siteSaleIds.length} past sales listed
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      <span className="text-gray-400">News:</span> {d.newsCategory ?? "—"} · <span className="text-gray-400">Sale words:</span> {d.saleKeywords.length ? d.saleKeywords.join(", ") : "—"}
                    </div>
                    <div className="mt-auto pt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <Link href={`/departments/${d.slug}`} className="text-violet-600 dark:text-violet-400 hover:underline">On the test site →</Link>
                      <a href={`${SITE}departments/${d.slug}`} target="_blank" rel="noreferrer" className="text-violet-600 dark:text-violet-400 hover:underline">vectis.co.uk ↗</a>
                      {d.heroKey ? <span className="text-gray-400">banner in the Hub</span> : d.heroPath ? <span className="text-gray-400">banner on the website only</span> : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
