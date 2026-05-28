import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/pipeline?code=X
// Returns the pipeline run for this code with all lot results
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    const run = await prisma.pipelineRun.findUnique({
      where: { code },
      include: { lots: { orderBy: { createdAt: "asc" } } },
    })

    if (!run) return NextResponse.json({ run: null })
    return NextResponse.json({ run })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/auction-ai/pipeline
// Upsert a pipeline run — updates stage/model/preset
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { code, preset, model, stage } = await req.json()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    const run = await prisma.pipelineRun.upsert({
      where:  { code: code.trim().toUpperCase() },
      update: { preset, model, stage, updatedAt: new Date() },
      create: { code: code.trim().toUpperCase(), preset: preset ?? "", model: model ?? "", stage: stage ?? "batch" },
    })

    return NextResponse.json({ ok: true, runId: run.id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}

// DELETE /api/auction-ai/pipeline
// Deletes the pipeline run for a code (reset)
export async function DELETE(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { code } = await req.json()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    await prisma.pipelineRun.deleteMany({ where: { code: code.trim().toUpperCase() } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
