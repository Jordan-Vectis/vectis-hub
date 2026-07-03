import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { objectExistsInR2, uploadBufferToR2 } from "@/lib/r2"

export const maxDuration = 300

// POST /api/accounts/transfer/import-files — copy a CHUNK of scan/statement
// files into this environment's R2 bucket, downloading each from the signed
// URL carried in the export file. Admin only. The client loops over the full
// list in small chunks so no single request runs long.
//
// A file that already exists here is skipped — so if staging and production
// share a bucket, every file reports "exists" and nothing is copied.

const MAX_PER_CALL = 10

function mimeForKey(key: string): string {
  const k = key.toLowerCase()
  if (k.endsWith(".pdf")) return "application/pdf"
  if (k.endsWith(".png")) return "image/png"
  if (k.endsWith(".webp")) return "image/webp"
  if (k.endsWith(".heic") || k.endsWith(".heif")) return "image/heic"
  return "image/jpeg"
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = await req.json()
    const files: { key?: unknown; url?: unknown }[] = Array.isArray(body?.files) ? body.files.slice(0, MAX_PER_CALL) : []
    if (!files.length) return NextResponse.json({ error: "files required" }, { status: 400 })

    const results: { key: string; status: "copied" | "exists" | "failed"; error?: string }[] = []
    for (const f of files) {
      const key = typeof f?.key === "string" ? f.key : ""
      const url = typeof f?.url === "string" ? f.url : ""
      if (!key || !url) { results.push({ key: key || "(missing)", status: "failed", error: "Bad entry" }); continue }
      try {
        if (await objectExistsInR2(key)) { results.push({ key, status: "exists" }); continue }
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Download failed (${res.status}) — the export's links may have expired; re-export and try again`)
        const buf = Buffer.from(await res.arrayBuffer())
        await uploadBufferToR2(buf, key, res.headers.get("content-type") || mimeForKey(key))
        results.push({ key, status: "copied" })
      } catch (e: any) {
        results.push({ key, status: "failed", error: e?.message ?? "Copy failed" })
      }
    }

    return NextResponse.json({ ok: true, results })
  } catch (e: any) {
    console.error("accounts/transfer/import-files error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
