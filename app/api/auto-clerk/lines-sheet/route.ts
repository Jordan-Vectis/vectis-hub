import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { lotPhotoUrl } from "@/lib/photo-url"
import { parseLinesSheet, MAX_SHEET_LOTS } from "@/lib/lines-sheet"

export const runtime = "nodejs"

// POST /api/auto-clerk/lines-sheet — multipart, field "file": a Business Central Lines export.
// Returns that sale's lots in the Saleroom Trainer's Test Mode shape ({id, est, desc, img}), in
// lot order, with the lot NUMBER as the id.
//
// ⚠ This is the fourth sanctioned trainer exception (2026-09-29, RULES.md §8): the trainer's Test
// Mode picker gained a "From a BC Lines export" option so the fake Saleroom can run THE SAME lots
// as the real Vectis clerking screen for an Auto Clerk Scenario 2 test. The parsing lives here,
// outside the frozen app/api/trainer tree, on purpose.
//
// Read-only: nothing is written anywhere. Photos are a courtesy — each lot's barcode is looked up
// in the Hub so the fake screen can show the real picture; a lot the Hub doesn't have simply has
// no photo, exactly as the built-in lots.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    // The same gate as the trainer page itself.
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "SALEROOM_TRAINER")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "No file received" }, { status: 400 })
    if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "That file is over 20 MB — a Lines export is a few hundred KB." }, { status: 413 })

    let parsed
    try {
      parsed = parseLinesSheet(Buffer.from(await file.arrayBuffer()))
    } catch (e: any) {
      return NextResponse.json({ error: e?.message ?? "Couldn't read the sheet" }, { status: 400 })
    }
    if (!parsed.lots.length) {
      return NextResponse.json({
        error: parsed.unnumbered
          ? `None of the ${parsed.unnumbered} lots in the sheet has a lot number yet — number the sale in Business Central first.`
          : "The sheet has no lots to run.",
      }, { status: 400 })
    }

    // Best-effort photos from the Hub, matched on barcode (every casing — the two systems disagree).
    const photo = new Map<string, string>()
    try {
      const codes = parsed.lots.map(l => l.barcode).filter(Boolean)
      if (codes.length) {
        const variants = [...new Set(codes.flatMap(c => [c, c.toUpperCase(), c.toLowerCase()]))]
        const hub = await prisma.catalogueLot.findMany({
          where:  { barcode: { in: variants } },
          select: { barcode: true, imageUrls: true },
        })
        for (const h of hub) {
          const url = lotPhotoUrl(h.imageUrls?.[0])
          if (h.barcode && url) photo.set(h.barcode.toUpperCase(), url)
        }
      }
    } catch (e) {
      console.error("[auto-clerk/lines-sheet] photo lookup failed (lots still returned):", e)
    }

    return NextResponse.json({
      code:       parsed.code,
      name:       file.name,
      total:      parsed.total,
      returned:   parsed.lots.length,
      unnumbered: parsed.unnumbered,
      withdrawn:  parsed.withdrawn,
      cap:        MAX_SHEET_LOTS,
      lots: parsed.lots.map(l => ({
        id:   l.id,
        est:  l.est,
        desc: l.desc,
        img:  photo.get(l.barcode.toUpperCase()) ?? null,
        barcode: l.barcode,
        uniqueId: l.uniqueId,
      })),
    })
  } catch (e: any) {
    console.error("auto-clerk/lines-sheet error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
