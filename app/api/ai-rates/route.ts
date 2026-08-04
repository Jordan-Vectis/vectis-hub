import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { DEFAULT_RATES, type ModelRate } from "@/lib/ai-pricing"

export const dynamic = "force-dynamic"

// AI prices, USD per 1,000,000 tokens.
//
// GET  — any signed-in user. The run-cost estimate on the Auction AI tabs needs
//        it, and a price list is not sensitive.
// PUT  — admins only. Saves a correction; deleting a row (blank values) drops
//        back to the built-in default in lib/ai-pricing.ts.
//
// ⚠ Reads are wrapped so a missing table (code deploys before Run Migrations is
// clicked) degrades to "no overrides" rather than breaking the run tabs.

async function loadOverrides(): Promise<Record<string, ModelRate>> {
  try {
    const rows = await prisma.aiModelRate.findMany({
      select: { modelId: true, inputPerM: true, outputPerM: true },
    })
    return Object.fromEntries(rows.map(r => [r.modelId, { inputPerM: r.inputPerM, outputPerM: r.outputPerM }]))
  } catch {
    return {}
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    return NextResponse.json({ overrides: await loadOverrides(), defaults: DEFAULT_RATES })
  } catch (e: any) {
    console.error("ai-rates GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    const body = await req.json().catch(() => null)
    const updates = Array.isArray(body?.updates) ? body.updates : null
    if (!updates) return NextResponse.json({ error: "No updates supplied" }, { status: 400 })

    for (const raw of updates) {
      const u = (raw ?? {}) as { modelId?: unknown; inputPerM?: unknown; outputPerM?: unknown }
      const modelId = String(u.modelId ?? "").trim()
      if (!modelId) continue

      const input  = Number(u.inputPerM)
      const output = Number(u.outputPerM)
      // Blank / non-numeric = "stop overriding this one".
      if (!isFinite(input) || !isFinite(output) || input < 0 || output < 0) {
        await prisma.aiModelRate.deleteMany({ where: { modelId } })
        continue
      }
      await prisma.aiModelRate.upsert({
        where:  { modelId },
        create: { modelId, inputPerM: input, outputPerM: output },
        update: { inputPerM: input, outputPerM: output },
      })
    }

    return NextResponse.json({ ok: true, overrides: await loadOverrides() })
  } catch (e: any) {
    console.error("ai-rates PUT error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
