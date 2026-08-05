import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { computeSaleStats } from "@/lib/sale-stats"

export const maxDuration = 60

// GET /api/bc/sale-statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
// Streams NDJSON: {type:"progress"} … then {type:"result", data:{ buckets, ... }}.
// Always pass a date range — an unbounded fetch would walk the whole history.
//
// The aggregation itself lives in lib/sale-stats.ts because the Dashboard's
// sale-results widgets need the same figures. This route keeps the streaming
// progress (the walk can take the better part of a minute and the page shows a
// counter) by handing in an onProgress callback.

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const from = req.nextUrl.searchParams.get("from")?.trim() || ""
  const to   = req.nextUrl.searchParams.get("to")?.trim()   || ""

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const data = await computeSaleStats(from, to, processed => {
          send(controller, { type: "progress", done: processed, total: processed })
        })

        if (!data.connected) {
          send(controller, { type: "error", error: "BC_NOT_CONNECTED" })
          controller.close()
          return
        }

        send(controller, { type: "result", data })
      } catch (e: any) {
        send(controller, { type: "error", error: e?.message ?? "Unknown error" })
      }
      controller.close()
    },
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
