import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import JSZip from "jszip"

export const maxDuration = 120

// POST /api/it-tools/bc-source/upload
//
// Body: multipart form with `zip` = a zip of the BC "Source" folder (the one
// with each Evo-soft extension as a top-level folder). The server unzips it,
// keeps the text/source files, and REPLACES everything previously stored.
//
// The source lives in the DB, deliberately NOT in the git repo — it is
// Evo-soft's proprietary code and must stay out of GitHub.
//
// Admin only: replacing the entire source set is destructive, and the viewer
// pages don't need this power.

// Text files worth keeping. Everything else in the tree (logo.jpg, nested
// EvoMobile.zip, .app binaries…) is skipped.
const KEEP_EXT = new Set([
  "al", "json", "md", "xml", "txt", "js", "css", "ruleset", "yml", "yaml", "csv",
])

// A per-file cap so a stray huge file can't blow the row size. The whole
// source is ~2.7 MB, so this should never trigger on real AL code.
const MAX_FILE_BYTES = 2 * 1024 * 1024

// "82410.BlobProvider.Codeunit.al" → "Codeunit"; app.json → "Config"; readme.md → "Docs".
function kindOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower === "app.json" || lower.endsWith(".ruleset.json")) return "Config"
  if (lower.endsWith(".md")) return "Docs"
  if (lower.endsWith(".al")) {
    const parts = name.split(".")
    if (parts.length >= 3) return parts[parts.length - 2]   // …-2 is the AL object type
    return "AL"
  }
  const ext = lower.split(".").pop() ?? ""
  return ext ? ext.toUpperCase() : "File"
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only admins can replace the BC source." }, { status: 403 })
    }

    const form = await req.formData()
    const zip = form.get("zip") as File | null
    if (!zip || zip.size === 0) return NextResponse.json({ error: "No zip file provided" }, { status: 400 })

    const loaded = await JSZip.loadAsync(await zip.arrayBuffer())

    // Zips made by right-click → "Compress to zip" wrap everything in one root
    // folder ("Source/…"); zips made from inside the folder don't. Detect a
    // single shared root and strip it so paths always start at the extension.
    const entryPaths = Object.keys(loaded.files).filter(p => !loaded.files[p].dir)
    if (entryPaths.length === 0) return NextResponse.json({ error: "That zip is empty" }, { status: 400 })
    const firstSeg = (p: string) => p.split("/")[0]
    const roots = new Set(entryPaths.map(firstSeg))
    // Only strip when the single root is a WRAPPER (no files directly inside it
    // would remain path-less) — i.e. every file sits at least two levels deep.
    const stripRoot = roots.size === 1 && entryPaths.every(p => p.split("/").length >= 3)

    const rows: { extension: string; path: string; name: string; kind: string; content: string; size: number }[] = []
    let skipped = 0

    for (const rawPath of entryPaths) {
      const path = stripRoot ? rawPath.slice(rawPath.indexOf("/") + 1) : rawPath
      const segs = path.split("/").filter(Boolean)
      if (segs.length < 2) { skipped++; continue }   // loose files at the top level aren't part of an extension
      const name = segs[segs.length - 1]
      const extDot = name.toLowerCase().split(".").pop() ?? ""
      const isRuleset = name.toLowerCase().endsWith(".ruleset.json")
      if (!KEEP_EXT.has(extDot) && !isRuleset) { skipped++; continue }

      const buf = await loaded.files[rawPath].async("uint8array")
      if (buf.byteLength > MAX_FILE_BYTES) { skipped++; continue }
      const content = new TextDecoder("utf-8").decode(buf)

      rows.push({
        extension: segs[0],
        path,
        name,
        kind: kindOf(name),
        content,
        size: buf.byteLength,
      })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "No source files found in that zip — is it the BC Source folder?" }, { status: 400 })
    }

    // Replace everything atomically — a half-replaced source is worse than the
    // old one staying up a few seconds longer.
    await prisma.$transaction(async tx => {
      await tx.bcSourceFile.deleteMany({})
      // createMany in chunks — one call with ~2,600 rows of text is fine for
      // Postgres but keeps each statement a sensible size.
      for (let i = 0; i < rows.length; i += 250) {
        await tx.bcSourceFile.createMany({ data: rows.slice(i, i + 250) })
      }
    }, { timeout: 60000 })

    const extensions = new Set(rows.map(r => r.extension)).size
    return NextResponse.json({ ok: true, files: rows.length, extensions, skipped })
  } catch (e: any) {
    console.error("bc-source upload error:", e)
    return NextResponse.json({ error: e?.message ?? "Upload failed" }, { status: 500 })
  }
}
