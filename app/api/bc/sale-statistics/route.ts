import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"

export const maxDuration = 60

// Buyer's premium the house earns — 22.5% of hammer (ex-VAT). This lands within
// a rounding whisker of BC's own "Buyer's Premium" figure. Adjust here if the
// house rate changes. (Seller's/vendor commission is NOT derivable from the
// lines — it varies per vendor — so it comes from EVA_AuctionHeader later.)
const BUYERS_PREMIUM_RATE = 0.225

// Location code that means a lot has been physically scanned to collected.
// Tunable — confirm against BC's "Total Items Collected" if it ever looks off.
const COLLECTED_LOCATION = "COLLECTED"

// Auction_Lines_Excel is item-level (one row per lot) and carries hammer,
// estimates, category and subcategory — see the BC reference. We aggregate it
// into (auction × category × subcategory) buckets so the client can roll up by
// any combination without re-fetching.
const ENDPOINT = "Auction_Lines_Excel"
const SELECT = [
  "EVA_AuctionNo", "EVA_AuctionName", "EVA_AuctionDate",
  "EVA_HammerPrice", "EVA_LowEstimate", "EVA_HighEstimate",
  "EVA_ArticleCategoryCode", "EVA_ArticleSubcategoryCode",
  "EVA_ArticleLocationCode",
].join(",")

type Bucket = {
  auctionNo: string; auctionName: string; auctionDate: string
  category: string; subcategory: string
  lots: number; sold: number; hammer: number; low: number; high: number; collected: number
}

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

// GET /api/bc/sale-statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Streams NDJSON: {type:"progress"} … then {type:"result", data:{ buckets, ... }}.
// Always pass a date range — an unbounded fetch would walk the whole history.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const from = req.nextUrl.searchParams.get("from")?.trim() || ""
  const to   = req.nextUrl.searchParams.get("to")?.trim()   || ""

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const clauses: string[] = []
        if (from) clauses.push(`EVA_AuctionDate ge ${from}`)
        if (to)   clauses.push(`EVA_AuctionDate le ${to}`)
        const params: Record<string, string | number> = { $select: SELECT }
        if (clauses.length) params.$filter = clauses.join(" and ")

        const buckets = new Map<string, Bucket>()
        let processed = 0
        let partial = false
        const startMs = Date.now()

        // Walk via @odata.nextLink (no $skip ceiling — see BC reference).
        let link: string | null = null
        let first = true
        while (true) {
          if (Date.now() - startMs > 50_000) { partial = true; break }

          const { rows, nextLink } = await bcPageWithNext(
            token,
            first ? ENDPOINT : (link as string),
            first ? params : undefined,
          )
          first = false

          for (const r of rows as Record<string, unknown>[]) {
            const auctionNo = String(r.EVA_AuctionNo ?? "").trim()
            if (!auctionNo) continue
            const category    = String(r.EVA_ArticleCategoryCode ?? "").trim() || "(uncategorised)"
            const subcategory = String(r.EVA_ArticleSubcategoryCode ?? "").trim() || "(none)"
            const key = `${auctionNo}|${category}|${subcategory}`

            let b = buckets.get(key)
            if (!b) {
              b = {
                auctionNo,
                auctionName: String(r.EVA_AuctionName ?? "").trim(),
                auctionDate: String(r.EVA_AuctionDate ?? "").slice(0, 10),
                category, subcategory,
                lots: 0, sold: 0, hammer: 0, low: 0, high: 0, collected: 0,
              }
              buckets.set(key, b)
            }

            const hammer = num(r.EVA_HammerPrice)
            b.lots += 1
            if (hammer > 0) b.sold += 1
            b.hammer += hammer
            b.low  += num(r.EVA_LowEstimate)
            b.high += num(r.EVA_HighEstimate)
            if (String(r.EVA_ArticleLocationCode ?? "").trim().toUpperCase() === COLLECTED_LOCATION) b.collected += 1
          }

          processed += rows.length
          send(controller, { type: "progress", done: processed, total: processed })

          link = nextLink
          if (!nextLink) break
        }

        send(controller, {
          type: "result",
          data: {
            buckets:            [...buckets.values()],
            total:              processed,
            partial,
            buyersPremiumRate:  BUYERS_PREMIUM_RATE,
            range:              { from, to },
          },
        })
      } catch (e: any) {
        send(controller, { type: "error", error: e?.message ?? "Unknown error" })
      }
      controller.close()
    },
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
