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

    const entryPaths = Object.keys(loaded.files).filter(p => !loaded.files[p].dir)
    if (entryPaths.length === 0) return NextResponse.json({ error: "That zip is empty" }, { status: 400 })

    // ── Find the extensions ──
    // An extension folder is one that directly contains app.json — that's the BC
    // manifest, and every extension has exactly one. Keying on that instead of
    // guessing at wrapper folders means ANY zip shape works: the Source folder,
    // its parent, or a single extension on its own.
    //
    // ⚠ Do NOT go back to "strip one shared root folder". The real archive has
    // TWO roots (Source/… plus a sibling "Webservices - PTE"), so that rule
    // didn't fire and all 62 extensions were filed under one called "Source".
    const appDirs = entryPaths
      .filter(p => p.toLowerCase().endsWith("app.json") && p.split("/").pop()?.toLowerCase() === "app.json")
      .map(p => p.slice(0, p.lastIndexOf("/") + 1))   // keeps the trailing slash; "" when at the zip root
      .sort((a, b) => b.length - a.length)            // longest first, so nested wins

    // Two extensions can't share a display name — `path` is unique in the DB, so
    // a collision would fail the whole upload. Fall back to the full folder path.
    const nameFor = new Map<string, string>()
    const taken = new Set<string>()
    for (const dir of [...appDirs].sort()) {
      const segs = dir.split("/").filter(Boolean)
      const short = segs.length > 0 ? segs[segs.length - 1] : (zip.name.replace(/\.zip$/i, "") || "Extension")
      const label = taken.has(short) ? (segs.join("/") || short) : short
      taken.add(label)
      nameFor.set(dir, label)
    }

    const rows: { extension: string; path: string; name: string; kind: string; content: string; size: number }[] = []
    let skipped = 0

    for (const rawPath of entryPaths) {
      // The extension this file belongs to = the deepest app.json folder above it.
      const dir = appDirs.find(d => rawPath.startsWith(d))
      if (dir === undefined) { skipped++; continue }   // stray file outside any extension
      const extName = nameFor.get(dir)!
      const rest = rawPath.slice(dir.length)
      if (!rest) { skipped++; continue }
      const path = `${extName}/${rest}`
      const segs = path.split("/").filter(Boolean)
      const name = segs[segs.length - 1]
      const extDot = name.toLowerCase().split(".").pop() ?? ""
      const isRuleset = name.toLowerCase().endsWith(".ruleset.json")
      if (!KEEP_EXT.has(extDot) && !isRuleset) { skipped++; continue }

      const buf = await loaded.files[rawPath].async("uint8array")
      if (buf.byteLength > MAX_FILE_BYTES) { skipped++; continue }
      const content = new TextDecoder("utf-8").decode(buf)

      rows.push({
        // extName, not segs[0] — the collision fallback can itself contain "/".
        extension: extName,
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
