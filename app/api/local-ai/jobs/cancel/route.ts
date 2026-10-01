import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Stop pressed on the tab: anything still QUEUED in the batch is cancelled. A job the PC is
// in the middle of finishes on its own and is simply shown when it lands.
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { batchId } = await req.json() as { batchId?: string }
    if (!batchId) return NextResponse.json({ error: "Missing batchId" }, { status: 400 })

    const r = await prisma.localAiJob.updateMany({
      where: { batchId, status: "QUEUED" },
      data:  { status: "CANCELLED", finishedAt: new Date() },
    })
    return NextResponse.json({ cancelled: r.count })
  } catch (e: any) {
    console.error("local-ai/jobs/cancel POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
