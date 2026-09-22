import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { upsertSaleMeta, writeBcSale, type FeedLot } from "@/lib/archive-site"

export const maxDuration = 300

// POST /api/databases/bc/collect
// Takes the file(s) the browser collector saved on vectis.co.uk and writes them into BcLotWeb.
//
// ⚠⚠ WHY THE FILE ROUTE EXISTS AT ALL. The website answers our Railway server with 202 and an
// empty body for every request, while the same request from the office returns the lots — so the
// server cannot read the lot feed and nothing on our side changes that. Business Central holds both
// the description and the photo path but publishes neither, and there is no development time to
// change that. So the feed is collected in the browser ON the site and uploaded here.
//
// ⚠ It writes through `writeBcSale`, the SAME function the live walk uses, so the two can never
// drift. Everything that makes that write safe applies unchanged: matched on the BC unique id,
// duplicates within a sale dropped, and COALESCE on every column so a blank in the file never wipes
// something we already hold.
//
// ⚠ Nothing here touches WarehouseItem. BcLotWeb is purely the website's view of a lot; Business
// Central's own figures stay the authority and are never overwritten from the site.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const form = await req.formData()
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0)
    if (!files.length) return NextResponse.json({ error: "No file was chosen." }, { status: 400 })

    let sales = 0, lots = 0, saleRows = 0, heroes = 0
    const problems: string[] = []

    for (const file of files) {
      let parsed: any
      try {
        parsed = JSON.parse(await file.text())
      } catch {
        problems.push(`${file.name}: not a file this page can read — it should be one the collector script saved.`)
        continue
      }
      const list = Array.isArray(parsed?.sales) ? parsed.sales : null
      if (!list) {
        problems.push(`${file.name}: no sales in it.`)
        continue
      }
      for (const sale of list) {
        const code = typeof sale?.auctionCode === "string" ? sale.auctionCode.toUpperCase() : null
        const rows: FeedLot[] = Array.isArray(sale?.lots) ? sale.lots : []
        // ⚠ The website's own sale number rides along so the page can say how far the collection
        // has got and pre-fill the next run — otherwise nobody knows where to carry on from.
        const siteSaleId = Number.isFinite(Number(sale?.siteId)) ? Math.round(Number(sale.siteId)) : null
        // The SALE itself — title, date, code, cover picture — for every sale in the file, lots or
        // not (2026-09-22, Databases → Sales). Older files carry only lots and simply skip this.
        if (siteSaleId && (sale?.title || sale?.hero || sale?.date)) {
          try {
            const r = await upsertSaleMeta({
              siteId: siteSaleId, auctionId: sale?.auctionId ?? null, code,
              title: typeof sale?.title === "string" ? sale.title : null,
              date: typeof sale?.date === "string" ? sale.date : null,
              hero: typeof sale?.hero === "string" ? sale.hero : null,
              lotCount: Number.isFinite(Number(sale?.lotCount)) ? Number(sale.lotCount) : rows.length,
              finished: typeof sale?.finished === "boolean" ? sale.finished : rows.length > 0,
            })
            saleRows++
            if (r.hero) heroes++
          } catch (e: any) {
            problems.push(`${file.name}: sale ${siteSaleId} — ${e?.message ?? "couldn't be saved"}`)
          }
        }
        if (!rows.length) continue
        const written = await writeBcSale(code, rows, siteSaleId)
        if (written > 0) { sales++; lots += written }
      }
    }

    const pictures = heroes ? ` Cover pictures recorded for ${heroes.toLocaleString()} sale${heroes === 1 ? "" : "s"} — copy them into the Hub on Databases → Sales.` : ""
    return NextResponse.json({
      ok: true, files: files.length, sales, lots, saleRows, heroes,
      problems: problems.length ? problems : undefined,
      // ⚠ Said in numbers, not "Done" — a silent success on an import is how nobody notices it
      // read nothing.
      message: lots === 0
        ? (heroes
          ? `No Business Central lots in these files, but details for ${saleRows.toLocaleString()} sale${saleRows === 1 ? "" : "s"} were recorded.${pictures}`
          : "Nothing was loaded. The files held no Business Central lots — check the collector ran on vectis.co.uk and reached the recent sales.")
        : `Loaded ${lots.toLocaleString()} lot${lots === 1 ? "" : "s"} across ${sales.toLocaleString()} sale${sales === 1 ? "" : "s"}. Press Copy photos to bring their pictures in.${pictures}`,
    })
  } catch (e: any) {
    console.error("databases/bc/collect error:", e)
    return NextResponse.json({ error: e?.message ?? "Could not read the file" }, { status: 500 })
  }
}
