import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { workerFromRequest, parseDescriptionReply } from "@/lib/local-ai"

// The office PC posts what its model wrote (lib/local-ai.ts). Bearer token.
// The reply is split the way the Batch route splits Gemini's — Estimate line, FLAG line, leaked
// tool call, Dolls & Bears clean-up — so the two columns are judged by the same rules.
// ⚠ An empty or leaked answer is a FAILED job, never an empty description shown as success.

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null)

export async function POST(req: NextRequest) {
  try {
    const worker = await workerFromRequest(req)
    if (!worker) return NextResponse.json({ error: "Unauthorised — no valid bridge token" }, { status: 401 })

    const body = await req.json() as {
      jobId?: string; text?: string; error?: string; model?: string
      promptTokens?: number; outputTokens?: number; ms?: number; imageCount?: number
    }
    if (!body.jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

    const job = await prisma.localAiJob.findUnique({ where: { id: body.jobId }, select: { id: true, status: true, workerId: true, presetKey: true } })
    if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 })
    if (job.status !== "RUNNING") return NextResponse.json({ error: `Job is ${job.status}, not RUNNING — the lease probably expired and it was handed out again` }, { status: 409 })
    if (job.workerId && job.workerId !== worker.id) return NextResponse.json({ error: "This job is leased to a different worker" }, { status: 409 })

    const common = {
      finishedAt:   new Date(),
      model:        body.model ? String(body.model).slice(0, 200) : null,
      promptTokens: num(body.promptTokens),
      outputTokens: num(body.outputTokens),
      ms:           num(body.ms),
      imageCount:   num(body.imageCount),
      rawResponse:  typeof body.text === "string" ? body.text.slice(0, 20000) : null,
    }

    if (body.error) {
      await prisma.localAiJob.update({ where: { id: job.id }, data: { ...common, status: "FAILED", error: String(body.error).slice(0, 2000) }, select: { id: true } })
      await prisma.localAiWorker.update({ where: { id: worker.id }, data: { lastSeenAt: new Date() }, select: { id: true } })
      return NextResponse.json({ ok: true, status: "FAILED" })
    }

    const { description, estimate, flag, leaked } = parseDescriptionReply(body.text ?? "", job.presetKey)
    let status = "DONE"
    let error: string | null = null
    if (leaked) {
      status = "FAILED"
      error  = "The model wrote out a search instead of a description (leaked tool call)"
    } else if (!description.trim()) {
      status = "FAILED"
      error  = (body.text ?? "").trim() ? `The model returned no description — only this came back: ${(body.text ?? "").trim().slice(0, 120)}` : "The model returned nothing at all"
    }

    await prisma.localAiJob.update({
      where: { id: job.id },
      data:  { ...common, status, error, description: description || null, estimate: estimate || null, flag: flag || null },
      select: { id: true },
    })
    await prisma.localAiWorker.update({ where: { id: worker.id }, data: { lastSeenAt: new Date() }, select: { id: true } })
    return NextResponse.json({ ok: true, status })
  } catch (e: any) {
    console.error("local-ai/worker/result POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
