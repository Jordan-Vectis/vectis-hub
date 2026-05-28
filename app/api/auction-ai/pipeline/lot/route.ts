import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/auction-ai/pipeline/lot
// Upsert a single lot's result for a pipeline stage.
// Body: { code, lotId, label, ...stage fields }
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json()
    const { code, lotId, label, ...fields } = body
    if (!code || !lotId) return NextResponse.json({ error: "Missing code or lotId" }, { status: 400 })

    const upper = code.trim().toUpperCase()

    // Ensure pipeline run exists
    const run = await prisma.pipelineRun.upsert({
      where:  { code: upper },
      update: { updatedAt: new Date() },
      create: { code: upper, preset: "", model: "" },
    })

    // Upsert the lot result
    await prisma.pipelineLot.upsert({
      where:  { runId_lotId: { runId: run.id, lotId } },
      update: { ...fields, updatedAt: new Date() },
      create: { runId: run.id, lotId, label, ...fields },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
