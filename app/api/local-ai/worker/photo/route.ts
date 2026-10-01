import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { workerFromRequest, mimeFromKey } from "@/lib/local-ai"
import { getObjectBuffer } from "@/lib/r2"
import { needsJpegCopy } from "@/lib/media"
import { ensureJpegCopy } from "@/lib/media-convert"
import { parsePhotoMaxPx, shrinkPhoto } from "@/lib/ai-photo-options"

// One of a job's photos, SHRUNK for the office PC's model (lib/local-ai.ts). Bearer token.
//   GET /api/local-ai/worker/photo?job=<id>&i=<n>&maxPx=<px>
// ⚠ Why: measured 2026-10-01, an open model (Qwen3-VL in Ollama) reads a 3 MB camera photo at
// its full size — roughly 4,000 tokens a photo, so two photos were a 9,258-token prompt and four
// CPU cores took longer than five minutes just to read them. Gemini charges a flat 1,120 whatever
// the size. Shrinking happens HERE, with sharp on the server, so the PC needs nothing installed
// for it; without maxPx the original is served.

export async function GET(req: NextRequest) {
  try {
    const worker = await workerFromRequest(req)
    if (!worker) return NextResponse.json({ error: "Unauthorised — no valid bridge token" }, { status: 401 })

    const jobId = req.nextUrl.searchParams.get("job") ?? ""
    const i     = Number(req.nextUrl.searchParams.get("i"))
    const maxPx = parsePhotoMaxPx(req.nextUrl.searchParams.get("maxPx"))
    if (!jobId || !Number.isInteger(i) || i < 0) return NextResponse.json({ error: "Missing job or i" }, { status: 400 })

    const job = await prisma.localAiJob.findUnique({ where: { id: jobId }, select: { imageUrls: true, workerId: true } })
    if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 })
    if (job.workerId && job.workerId !== worker.id) return NextResponse.json({ error: "This job is leased to a different worker" }, { status: 409 })
    const key = job.imageUrls[i]
    if (!key) return NextResponse.json({ error: "No such photo on this job" }, { status: 404 })

    let servedKey = key
    if (needsJpegCopy(key)) {
      try { servedKey = await ensureJpegCopy(key) } catch { /* no copy — serve the original */ }
    }
    const original = await getObjectBuffer(servedKey)
    const mime     = mimeFromKey(servedKey)
    const out      = maxPx ? await shrinkPhoto(original, mime, maxPx) : { buffer: original, mimeType: mime }

    return new NextResponse(new Uint8Array(out.buffer), {
      headers: {
        "Content-Type":   out.mimeType,
        "Content-Length": String(out.buffer.length),
        "Cache-Control":  "private, max-age=3600",
      },
    })
  } catch (e: any) {
    const missing = e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404
    if (!missing) console.error("local-ai/worker/photo GET error:", e)
    return NextResponse.json({ error: missing ? "Photo not found" : (e?.message ?? "Could not load the photo") }, { status: missing ? 404 : 500 })
  }
}
