import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { isCronRequest } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/pipeline?code=X
// Returns the pipeline run for this code with all lot results
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
    if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

    const run = await prisma.pipelineRun.findUnique({
      where: { code },
      include: { lots: { orderBy: { createdAt: "asc" } } },
    })

    if (!run) return NextResponse.json({ run: null })

    // ⚠⚠ Say whether each lot is ACTUALLY empty in the catalogue right now.
    //
    // The run's own rows are its record of what it produced, and `appliedDesc` stays the only
    // proof a lot's text reached the catalogue — that is not re-derived here and must not be
    // (see the appliedDesc note). But a saved row can outlive the thing it describes: on F113
    // a 🧹 Clear Descriptions wiped 499 lots between two runs, and the report went on stating
    // "600 applied to the catalogue" while 210 of them held nothing at all (Jordan, 2026-09-02).
    // So the live description is reported ALONGSIDE, purely so the page can show the
    // disagreement instead of asserting the stale half of it.
    const auction = await prisma.catalogueAuction.findFirst({
      where:   { code },
      orderBy: { createdAt: "desc" },   // codes get reused across years — newest wins
      select:  { lots: { select: { id: true, description: true } } },
    })
    const blank = new Set(
      (auction?.lots ?? []).filter(l => !(l.description ?? "").trim()).map(l => l.id)
    )
    return NextResponse.json({
      run: { ...run, lots: run.lots.map(l => ({ ...l, catalogueBlank: blank.has(l.lotId) })) },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST /api/auction-ai/pipeline
// Upsert a pipeline run — updates stage/model/preset
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

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
