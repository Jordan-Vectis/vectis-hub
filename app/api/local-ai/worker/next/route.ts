import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { workerFromRequest, LOCAL_AI_LEASE_MS, mimeFromKey } from "@/lib/local-ai"
import { getSignedImageUrl } from "@/lib/r2"
import { needsJpegCopy } from "@/lib/media"
import { ensureJpegCopy } from "@/lib/media-convert"

// The office PC asks for work (lib/local-ai.ts). Bearer token, no Hub login — this path is in
// auth.config.ts publicPaths for that reason, and the token is the whole gate.
//
// Hands back ONE job at a time with everything the model needs: the frozen system instruction
// and user prompt, and per photo BOTH a signed R2 link to the original (an hour's life; iPhone
// HEIC and the like get their JPEG copy, as the browser does) AND a Hub path that serves it
// SHRUNK (../worker/photo?…&maxPx=N). ⚠ Measured 2026-10-01: an open model reads a 3 MB camera
// photo at full size — about 4,000 tokens each against Gemini's flat 1,120 — so on anything but
// a big card the bridge should take the shrunk copy. The job is leased: if the PC goes quiet the
// lease expires and the job is offered again.

const IDLE_WAIT_MS = 3000

export async function POST(req: NextRequest) {
  try {
    const worker = await workerFromRequest(req)
    if (!worker) return NextResponse.json({ error: "Unauthorised — no valid bridge token" }, { status: 401 })

    const body = await req.json().catch(() => ({})) as { worker?: string; model?: string; info?: string }
    await prisma.localAiWorker.update({
      where: { id: worker.id },
      data: {
        lastSeenAt: new Date(),
        ...(body.model ? { lastModel: String(body.model).slice(0, 200) } : {}),
        ...(body.info || body.worker ? { lastInfo: [body.worker, body.info].filter(Boolean).join(" · ").slice(0, 500) } : {}),
      },
      select: { id: true },
    })

    const now = new Date()
    // A lease the PC never finished goes back in the queue first.
    await prisma.localAiJob.updateMany({
      where: { status: "RUNNING", leaseExpiresAt: { lt: now } },
      data:  { status: "QUEUED", workerId: null, leasedAt: null, leaseExpiresAt: null },
    })

    // Claim the oldest queued job atomically: the update only counts if it was still QUEUED.
    let job: Awaited<ReturnType<typeof prisma.localAiJob.findFirst>> = null
    for (let attempt = 0; attempt < 5 && !job; attempt++) {
      const candidate = await prisma.localAiJob.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { id: true } })
      if (!candidate) break
      const claimed = await prisma.localAiJob.updateMany({
        where: { id: candidate.id, status: "QUEUED" },
        data:  { status: "RUNNING", workerId: worker.id, leasedAt: now, leaseExpiresAt: new Date(now.getTime() + LOCAL_AI_LEASE_MS) },
      })
      if (claimed.count === 1) job = await prisma.localAiJob.findFirst({ where: { id: candidate.id } })
    }

    if (!job) return NextResponse.json({ job: null, waitMs: IDLE_WAIT_MS })

    const images: { url: string; name: string; mimeType: string; photoPath: string }[] = []
    for (const [i, key] of job.imageUrls.entries()) {
      try {
        let servedKey = key
        if (needsJpegCopy(key)) {
          try { servedKey = await ensureJpegCopy(key) } catch { /* no copy — send the original and let the model try */ }
        }
        images.push({
          url:       await getSignedImageUrl(servedKey, 3600),
          name:      key.split("/").pop() || "photo.jpg",
          mimeType:  mimeFromKey(servedKey),
          photoPath: `/api/local-ai/worker/photo?job=${encodeURIComponent(job.id)}&i=${i}`,
        })
      } catch (e: any) {
        console.error(`[local-ai] could not sign ${key}:`, e?.message ?? e)
      }
    }

    return NextResponse.json({
      job: {
        id:                job.id,
        lotLabel:          job.lotLabel,
        auctionCode:       job.auctionCode,
        systemInstruction: job.systemInstruction,
        userPrompt:        job.userPrompt,
        images,
      },
      leaseMs: LOCAL_AI_LEASE_MS,
    })
  } catch (e: any) {
    console.error("local-ai/worker/next POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
