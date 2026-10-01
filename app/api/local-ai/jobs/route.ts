import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveInstruction } from "@/lib/ai-instructions"
import { buildBatchSystemInstruction, buildBatchUserPrompt } from "@/lib/batch-prompt"

// Jobs for the office PC's model (lib/local-ai.ts). Session routes used by Instructions Testing.
//   POST — queue the ticked lots as one batch. The FULL prompt is frozen on each row, built with
//          the same code the Batch route uses, so the PC's model gets exactly what Gemini got.
//   GET ?batchId= — the batch's jobs and results, for the tab to poll.
// ⚠ PREVIEW ONLY. Nothing here, and nothing downstream of it, writes to a CatalogueLot.

const MAX_LOTS   = 100
const MAX_IMAGES = 24

type LotIn = { id: string; label: string; keyPoints?: string; imageUrls?: string[] }

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json() as { auctionCode?: string; presetKey?: string; lots?: LotIn[] }
    const auctionCode = (body.auctionCode ?? "").trim().toUpperCase()
    const presetKey   = (body.presetKey ?? "").trim()
    const lots = Array.isArray(body.lots) ? body.lots.filter(l => l && l.id && l.label) : []
    if (!auctionCode || !presetKey) return NextResponse.json({ error: "Missing auctionCode or presetKey" }, { status: 400 })
    if (!lots.length) return NextResponse.json({ error: "No lots given" }, { status: 400 })
    if (lots.length > MAX_LOTS) return NextResponse.json({ error: `At most ${MAX_LOTS} lots in one go — this is a trial, not a sale` }, { status: 400 })

    let presetInstruction = ""
    try {
      presetInstruction = await resolveInstruction(presetKey)
    } catch {
      return NextResponse.json({ error: `Instruction "${presetKey}" not found` }, { status: 400 })
    }
    const systemInstruction = buildBatchSystemInstruction(presetInstruction)

    const batchId = randomUUID()
    const createdBy = session.user?.email ?? "unknown"
    const rows = lots.map(l => {
      const keyPoints = (l.keyPoints ?? "").trim()
      return {
        batchId,
        createdBy,
        auctionCode,
        lotId:     l.id,
        lotLabel:  l.label,
        presetKey,
        systemInstruction,
        // No Google Search on the office PC, so never the "verify by search" line.
        userPrompt: buildBatchUserPrompt({ existingContext: keyPoints || null, contextType: keyPoints ? "keyPoints" : null, grounded: false }),
        imageUrls: (Array.isArray(l.imageUrls) ? l.imageUrls : []).filter(u => typeof u === "string" && u).slice(0, MAX_IMAGES),
      }
    })

    await prisma.localAiJob.createMany({ data: rows })
    return NextResponse.json({ batchId, count: rows.length })
  } catch (e: any) {
    console.error("local-ai/jobs POST error:", e)
    const waiting = e?.code === "P2021" || /does not exist/i.test(String(e?.message))
    return NextResponse.json({ error: waiting ? "The database update for the office PC trial is still waiting (the amber banner on /admin)" : (e?.message ?? "Unknown error") }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const batchId = (req.nextUrl.searchParams.get("batchId") ?? "").trim()
    if (!batchId) return NextResponse.json({ error: "Missing batchId" }, { status: 400 })

    const jobs = await prisma.localAiJob.findMany({
      where: { batchId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, lotId: true, lotLabel: true, status: true, model: true,
        description: true, estimate: true, flag: true, error: true,
        promptTokens: true, outputTokens: true, ms: true, imageCount: true,
        leasedAt: true, finishedAt: true,
      },
    })
    return NextResponse.json({ jobs })
  } catch (e: any) {
    console.error("local-ai/jobs GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
