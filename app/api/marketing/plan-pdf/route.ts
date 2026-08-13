import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { asSnapshot } from "@/lib/marketing-plan"
import { buildMarketingPlanPdf, type PdfPlan } from "@/lib/marketing-plan-pdf"

export const maxDuration = 120

// GET /api/marketing/plan-pdf?id=<planId>
// Renders the saved plan as an A4 portrait PDF. Everything comes from the DB —
// the figures are the snapshot frozen on the plan, never a fresh GA read.

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const id = req.nextUrl.searchParams.get("id") ?? ""
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

    const plan = await prisma.marketingPlan.findUnique({
      where: { id },
      include: {
        objectives: { orderBy: { sortOrder: "asc" } },
        actions:    { orderBy: { sortOrder: "asc" } },
      },
    })
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

    const data: PdfPlan = {
      name:        plan.name,
      periodLabel: plan.periodLabel,
      status:      plan.status,
      createdBy:   plan.createdBy,
      summary:     plan.summary,
      audience:    plan.audience,
      competitors: plan.competitors,
      snapshot:    asSnapshot(plan.snapshot),
      objectives:  plan.objectives.map((o) => ({
        title: o.title, metric: o.metric, baseline: o.baseline,
        target: o.target, dueBy: o.dueBy, notes: o.notes, source: o.source,
      })),
      actions: plan.actions.map((a) => ({
        channel: a.channel, title: a.title, detail: a.detail, owner: a.owner,
        dueBy: a.dueBy, effort: a.effort, impact: a.impact, status: a.status, source: a.source,
      })),
    }

    const pdfBytes = await buildMarketingPlanPdf(data)
    const niceName = `Marketing plan - ${plan.name}${plan.periodLabel ? ` - ${plan.periodLabel}` : ""}.pdf`

    // Content-Disposition must be Latin-1 — plain ASCII `filename`, plus a
    // UTF-8 `filename*` for modern browsers.
    const asciiName = niceName
      .replace(/[^\x20-\x7E]/g, "-")
      .replace(/[\/\\?%*:|"<>]/g, "-")
      .replace(/-+/g, "-")
      .replace(/\s+/g, " ")
      .trim()

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(niceName)}`,
        "Content-Length":      String(pdfBytes.length),
        "Cache-Control":       "no-store",
      },
    })
  } catch (e: any) {
    console.error("marketing plan pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
