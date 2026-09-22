import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import ArchiveImport from "./archive-import"
import ArchiveSite from "./archive-site"
import ArchiveTools from "./archive-tools"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import ZoomPhoto from "@/components/zoom-photo"

// Databases → Lot Archive: the pre-BC lot history (1999 → the BC switch), searchable.
// Photos: our R2 copy when the photo job has run, else the site's own picture.
// Server-rendered from query params so a twenty-year table is never sent to the
// browser — 100 rows a page. Admins get the import panel on top.
const PAGE = 100
const fmtDate = (d: Date | null) => d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—"
const fmtGBP = (n: number | null) => n == null ? "—" : "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 })

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""

// How the results are ordered.
//
// ⚠ Hammer and estimate sorts put the unsold / unpriced (null) at the END either way — a lot with
// no result is not "cheapest", and floating them to the top of a low-to-high sort buries the
// genuinely cheap ones.
//
// ⚠ Built from a FIXED MAP, never from the query string. An unknown value simply falls back to the
// default, so nothing a visitor types reaches the ordering.
//
// The keys match the BC Database page (`<field>_<dir>`) so the two pages sort identically. The old
// values — oldest / price_desc / price_asc / lot — are kept as aliases so a bookmark or a link
// somebody saved still works.
const ARCHIVE_ORDER: Record<string, any> = {
  "":            [{ auctionDate: "desc" }, { auctionId: "desc" }, { lot: "asc" }],
  date_desc:     [{ auctionDate: "desc" }, { auctionId: "desc" }, { lot: "asc" }],
  date_asc:      [{ auctionDate: "asc" }, { auctionId: "asc" }, { lot: "asc" }],
  sale_desc:     [{ saleTitle: "desc" }, { lot: "asc" }],
  sale_asc:      [{ saleTitle: "asc" }, { lot: "asc" }],
  lot_asc:       [{ auctionId: "desc" }, { lot: "asc" }],
  lot_desc:      [{ auctionId: "desc" }, { lot: "desc" }],
  est_desc:      [{ estimateLow: { sort: "desc", nulls: "last" } }, { auctionDate: "desc" }],
  est_asc:       [{ estimateLow: { sort: "asc",  nulls: "last" } }, { auctionDate: "desc" }],
  hammer_desc:   [{ hammerPrice: { sort: "desc", nulls: "last" } }, { auctionDate: "desc" }],
  hammer_asc:    [{ hammerPrice: { sort: "asc",  nulls: "last" } }, { auctionDate: "desc" }],
  // Aliases for the values this page used before the columns became sortable.
  oldest:        [{ auctionDate: "asc" }, { auctionId: "asc" }, { lot: "asc" }],
  price_desc:    [{ hammerPrice: { sort: "desc", nulls: "last" } }, { auctionDate: "desc" }],
  price_asc:     [{ hammerPrice: { sort: "asc",  nulls: "last" } }, { auctionDate: "desc" }],
  lot:           [{ auctionId: "desc" }, { lot: "asc" }],
}

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), year = one(sp.year).trim(), sale = one(sp.sale).trim()
  const status = one(sp.status).trim(), photo = one(sp.photo).trim()
  const order = one(sp.order).trim()
  const min = parseFloat(one(sp.min)), max = parseFloat(one(sp.max))
  const page = Math.max(1, parseInt(one(sp.page)) || 1)
  const FILTERS = ["q", "sale", "year", "min", "max", "status", "photo"] as const
  const anyFilter = FILTERS.some(k => one(sp[k]).trim())

  const where: any = {}
  const and: any[] = []
  // ⚠ The search covers the LotID too — looking a known lot up by the old system's id is one of
  // the commonest reasons anyone opens this page, and it used to find nothing. Same reasoning as
  // the unique ID on the BC Database page.
  if (q) and.push({ OR: [{ description: { contains: q, mode: "insensitive" } }, { saleTitle: { contains: q, mode: "insensitive" } }, { lotId: { contains: q, mode: "insensitive" } }] })
  if (sale) and.push({ saleTitle: { contains: sale, mode: "insensitive" } })
  if (/^\d{4}$/.test(year)) and.push({ auctionDate: { gte: new Date(Date.UTC(+year, 0, 1)), lt: new Date(Date.UTC(+year + 1, 0, 1)) } })
  if (Number.isFinite(min)) and.push({ hammerPrice: { gte: min } })
  // ⚠ `> 0` as well, or an upper bound sweeps in every unsold lot — they have no hammer at all,
  // which is not the same thing as a cheap one.
  if (Number.isFinite(max)) and.push({ hammerPrice: { lte: max, gt: 0 } })
  if (status === "sold")   and.push({ hammerPrice: { gt: 0 } })
  if (status === "unsold") and.push({ OR: [{ hammerPrice: null }, { hammerPrice: { lte: 0 } }] })
  if (photo === "yes") and.push({ OR: [{ photoKey: { not: null } }, { sitePhoto: { not: null } }] })
  if (photo === "no")  and.push({ photoKey: null, sitePhoto: null })
  if (and.length) where.AND = and

  // Migration-safe: before Run Migrations the table isn't there — say so, don't 500.
  type Stats = { n: number; sales: number; from: Date | null; to: Date | null; hammer: number; sold: number; withLotId: number; inHub: number; fullSize: number; siteOnly: number; noPhoto: number; fromSheet: number; fromSite: number }
  let rows: any[] = [], total = 0, stats: Stats | null = null, tableError: string | null = null
  try {
    const [r, t, agg] = await Promise.all([
      prisma.archiveLot.findMany({ where, orderBy: ARCHIVE_ORDER[order] ?? ARCHIVE_ORDER[""], skip: (page - 1) * PAGE, take: PAGE }),
      prisma.archiveLot.count({ where }),
      // One pass over the table for the summary box (a million rows — one scan, not eight counts).
      prisma.$queryRaw<{ n: bigint; sales: bigint; from: Date | null; to: Date | null; hammer: number | null; sold: bigint; withlotid: bigint; inhub: bigint; fullsize: bigint; siteonly: bigint; fromsheet: bigint }[]>`
        SELECT count(*)::bigint AS n, count(DISTINCT "auctionId")::bigint AS sales, min("auctionDate") AS "from", max("auctionDate") AS "to",
               sum("hammerPrice")::float8 AS hammer, count("hammerPrice")::bigint AS sold, count("lotId")::bigint AS withlotid,
               count("photoKey")::bigint AS inhub,
               count(*) FILTER (WHERE "photoXlKey" LIKE 'archive-photos/xl/%')::bigint AS fullsize,
               count(*) FILTER (WHERE "photoKey" IS NULL AND "sitePhoto" IS NOT NULL)::bigint AS siteonly,
               count(*) FILTER (WHERE "source" = 'sheet')::bigint AS fromsheet
        FROM "ArchiveLot"`,
    ])
    rows = r; total = t
    const a = agg[0]
    const n = Number(a?.n ?? 0), inHub = Number(a?.inhub ?? 0), siteOnly = Number(a?.siteonly ?? 0)
    stats = {
      n, sales: Number(a?.sales ?? 0), from: a?.from ?? null, to: a?.to ?? null, hammer: a?.hammer ?? 0, sold: Number(a?.sold ?? 0),
      withLotId: Number(a?.withlotid ?? 0), inHub, fullSize: Number(a?.fullsize ?? 0), siteOnly, noPhoto: n - inHub - siteOnly, fromSheet: Number(a?.fromsheet ?? 0), fromSite: n - Number(a?.fromsheet ?? 0),
    }
    // A picture per row: our copy (signed) first, else the site's medium-size image.
    await Promise.all(rows.map(async row => {
      row.photo = row.photoKey ? await getSignedImageUrl(row.photoKey, 3600).catch(() => null)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/medium/") : null
      // Clicking the thumbnail opens the best copy we hold, else the site's full-size one.
      row.photoFull = row.photoXlKey ? await getSignedImageUrl(row.photoXlKey, 3600).catch(() => row.photo)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/xlarge/") : row.photo
    }))
  } catch (e: any) {
    tableError = /does not exist|relation/i.test(String(e?.message)) ? "The archive table isn't there yet — Run Migrations on this environment first." : (e?.message ?? "Couldn't read the archive")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))
  // ⚠ EVERY filter travels with a page change AND with a sort. Page 2 quietly reverting to
  // unfiltered and newest-first is what made the filters feel broken on the BC page.
  const carry = () => {
    const u = new URLSearchParams()
    for (const k of FILTERS) { const v = one(sp[k]).trim(); if (v) u.set(k, v) }
    return u
  }
  const link = (p: number) => { const u = carry(); if (order) u.set("order", order); u.set("page", String(p)); return `/databases/archive?${u}` }
  // Clicking a column sorts it the way that column is normally wanted first — newest sale, biggest
  // hammer, lot 1 upwards — and clicking it again turns it round. Same as the BC Database page.
  const NATURAL: Record<string, "asc" | "desc"> = { date: "desc", sale: "asc", lot: "asc", est: "desc", hammer: "desc" }
  // The old alias values have no arrow of their own; normalise them so a saved link still shows
  // the column it is actually sorted by.
  const ALIAS: Record<string, string> = { oldest: "date_asc", price_desc: "hammer_desc", price_asc: "hammer_asc", lot: "lot_asc" }
  const current = ALIAS[order] ?? order ?? ""
  const currentOr = current || "date_desc"
  const sortHref = (f: string) => {
    const nat = NATURAL[f]
    const dir = currentOr === `${f}_${nat}` ? (nat === "desc" ? "asc" : "desc") : nat
    const u = carry(); u.set("order", `${f}_${dir}`)
    return `/databases/archive?${u}`
  }
  const arrow = (f: string) => currentOr === `${f}_desc` ? " ▼" : currentOr === `${f}_asc` ? " ▲" : ""
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
  const sortCls = "hover:text-violet-600 dark:hover:text-violet-400"

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
            <h1 className="text-xl font-bold mt-1">ABC Database</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Every lot sold through ABC, the system before Business Central — descriptions, estimates and hammer prices from its export, with LotIDs, photos and links matched from the website.</p>
          </div>
        </div>

        {stats && stats.n > 0 && (() => {
          const pct = (x: number) => stats!.n ? Math.round((x / stats!.n) * 100) : 0
          const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
          const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums"
          const lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"
          const sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
          return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className={tile}><div className={lbl}>Lots in the ABC database</div><div className={big}>{stats.n.toLocaleString()}</div>
                <div className={sub}>{stats.sales.toLocaleString()} sales · {fmtDate(stats.from)} → {fmtDate(stats.to)}</div></div>
              <div className={tile}><div className={lbl}>Sold</div><div className={big}>{stats.sold.toLocaleString()}</div>
                <div className={sub}>hammer total {fmtGBP(stats.hammer)} · {(stats.n - stats.sold).toLocaleString()} unsold or no result</div></div>
              <div className={tile}><div className={lbl}>Photos in the Hub</div><div className={big}>{stats.inHub.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.inHub)}%)</span></div>
                <div className={sub}>{stats.fullSize.toLocaleString()} full-size backups · {stats.siteOnly.toLocaleString()} still on the website only · {stats.noPhoto.toLocaleString()} no photo</div>
                <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct(stats.inHub)}%` }} /></div></div>
              <div className={tile}><div className={lbl}>Where the lots came from</div><div className={big}>{stats.fromSheet.toLocaleString()}</div>
                <div className={sub}>from the old system's export · {stats.fromSite.toLocaleString()} from the website · {stats.withLotId.toLocaleString()} with a LotID</div></div>
            </div>
          )
        })()}

        {/* ⚠ TOOLS AS CHIPS, nothing on screen until asked for — the same as the BC Database page
            (Jordan, 2026-09-09: "you have only fixed the UI in the BC database not in the ABC as
            well"). Three admin panels stacked open pushed the lots, which is what the page is for,
            below the fold. A running website job opens its own panel and keeps a live dot on the
            chip, so hiding the tools can never hide a job that is going. */}
        {isAdmin && (
          <ArchiveTools
            importPanel={<ArchiveImport />}
            jobs={<ArchiveSite scope="abc" />}
            exportPanel={
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Export &amp; handover — for a backup, or a future website</h2>
            <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex flex-wrap items-center gap-3">
                <a href="/api/databases/archive/export" className="min-h-[44px] inline-flex items-center px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">⬇ Export data (CSV)</a>
                <span className="text-gray-600 dark:text-gray-400">Every lot, one row each, with its LotID, both photo file names and the site link. Around 400 MB — opens in Excel. Streams as it goes, so give it a minute.</span>
              </div>
              <p><span className="font-semibold text-gray-900 dark:text-white">Where the photos live.</span> Cloudflare R2, bucket <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">{process.env.CLOUDFLARE_R2_BUCKET ?? "(not set)"}</code>, two files per lot named by its LotID:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">archive-photos/xl/&#123;LotID&#125;.webp</code> — full size, the best the old website held (about 250 KB)</li>
                <li><code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">archive-photos/&#123;LotID&#125;.webp</code> — small display copy (about 23 KB)</li>
              </ul>
              <p><span className="font-semibold text-gray-900 dark:text-white">Handing it to a new website.</span> Give the developer the CSV above and a read-only R2 API token (Cloudflare dashboard → R2 → Manage API tokens, "Object Read only", scoped to this bucket). They copy the pictures bucket-to-bucket with any S3 tool — nothing passes through a PC — for example with rclone:</p>
              <pre className="overflow-x-auto rounded-lg bg-gray-100 dark:bg-gray-900 p-3 text-xs font-mono">rclone copy r2:{process.env.CLOUDFLARE_R2_BUCKET ?? "BUCKET"}/archive-photos  their-storage:their-bucket/archive-photos  --transfers 32</pre>
              <p className="text-gray-600 dark:text-gray-400">Each row's PhotoFullSizeFile column names its file in that folder, so the new site needs nothing else to pair pictures with lots. This database <span className="font-semibold">is</span> in the Hub&apos;s nightly backup (since 22 September 2026 every table is copied, one file each — this one is about a gigabyte of it). Neon, the database host, keeps its own restore history as well, the original ABC export can be imported again, and the ⬇ Export above is a copy you can keep yourself.</p>
            </div>
          </div>
            }
          />
        )}

        {/* ⚠ THE FILTERS ARE ON SCREEN, not hidden behind "More filters" — matching the BC
            Database page (Jordan, 2026-09-09: "the filtering options are still awful", then "you
            have only fixed the UI in the BC database not in the ABC as well"). This page had the
            collapsed version from earlier the same day; the BC page is the one he kept.
            ⚠ Every filter is carried through paging AND through a sort, and every column that can
            be ordered says which way it is going. */}
        <form method="get" className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input name="q" defaultValue={q} placeholder="Search descriptions or a LotID — e.g. Dinky 105, Steiff, Palitoy Leia" className={input} />
            <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
            <Link href="/databases/archive" className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500 text-sm text-gray-700 dark:text-gray-300">Clear</Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input name="sale" defaultValue={sale} placeholder="Sale title" className={input} />
            <input name="year" defaultValue={year} placeholder="Year — e.g. 2014" inputMode="numeric" className={input} />
            <select name="status" defaultValue={status} className={input} aria-label="Sold or unsold">
              <option value="">Sold and unsold</option>
              <option value="sold">Sold only</option>
              <option value="unsold">Unsold only</option>
            </select>
            <select name="photo" defaultValue={photo} className={input} aria-label="Whether the lot has a photo">
              <option value="">Any photo</option>
              <option value="yes">Has a photo</option>
              <option value="no">No photo yet</option>
            </select>
            <input name="min" defaultValue={one(sp.min)} placeholder="Hammer from £" inputMode="numeric" className={input} />
            <input name="max" defaultValue={one(sp.max)} placeholder="Hammer to £" inputMode="numeric" className={input} />
          </div>
          {/* ⚠ Keeps the chosen sort when the form is submitted — without it every search threw
              the ordering away and dropped back to newest-first. */}
          {order && <input type="hidden" name="order" value={order} />}
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : stats && stats.n === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">The archive is empty. {isAdmin ? "Import the spreadsheet or pull from the website above to fill it." : "An admin needs to fill it first."}</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString()} {total === 1 ? "lot" : "lots"}{anyFilter ? " match" : ""} · page {page} of {pages}</p>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#141416]">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2"><Link href={sortHref("date")} className={sortCls}>Date{arrow("date")}</Link></th>
                    <th className="px-3 py-2"><Link href={sortHref("sale")} className={sortCls}>Sale{arrow("sale")}</Link></th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("lot")} className={sortCls}>Lot{arrow("lot")}</Link></th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("est")} className={sortCls}>Estimate{arrow("est")}</Link></th>
                    <th className="px-3 py-2 text-right"><Link href={sortHref("hammer")} className={sortCls}>Hammer{arrow("hammer")}</Link></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={`border-t border-gray-100 dark:border-gray-800/70 align-top ${i % 2 ? "bg-white dark:bg-[#141416]/40" : ""}`}>
                      <td className="px-2 py-2 w-16">
                        {r.photo ? <ZoomPhoto thumb={r.photo} full={r.photoFull} /> : <div className="h-14 w-14 rounded-md bg-gray-100 dark:bg-gray-800/60" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(r.auctionDate)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[220px]">{r.saleTitle || `Sale ${r.auctionId}`}<div className="text-xs text-gray-400">sale {r.auctionId}</div></td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {r.lot}
                        {r.lotId && <div className="text-xs text-gray-400 font-mono" title="The old system's LotID">{r.lotId}</div>}
                        {r.siteLink && <a href={`https://www.vectis.co.uk/${r.siteLink}`} target="_blank" rel="noreferrer" className="block text-xs font-sans text-violet-600 dark:text-violet-400 hover:underline" title="Open this lot on vectis.co.uk">vectis.co.uk ↗</a>}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.description}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600 dark:text-gray-400">{r.estimateLow == null && r.estimateHigh == null ? "—" : `${fmtGBP(r.estimateLow)} – ${fmtGBP(r.estimateHigh)}`}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {fmtGBP(r.hammerPrice)}
                        {r.siteHammerPrice != null && r.siteHammerPrice !== r.hammerPrice && <div className="text-xs font-normal text-amber-600 dark:text-amber-400" title="The website shows a different hammer price for this lot">site {fmtGBP(r.siteHammerPrice)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                {page > 1 && <Link href={link(page - 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">← Previous</Link>}
                <span className="text-gray-500">page {page} of {pages}</span>
                {page < pages && <Link href={link(page + 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">Next →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
