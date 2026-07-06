import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { MCOC_CLASSES, cleanChampName, normChampName, normaliseClass } from "@/lib/mcoc"
import { isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// POST /api/jordan/mcoc/catalog  { class: "Cosmic", model? }
// Grounded enumeration of every champion of one class → upsert names into the
// Champion DB (profile left to be built later). The client loops the 6 classes.
// Locked to jordan.orange.
export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const cls = normaliseClass(body?.class ?? "")
    if (!cls) return NextResponse.json({ error: `class must be one of ${MCOC_CLASSES.join(", ")}` }, { status: 400 })

    const prompt = `List EVERY ${cls}-class champion currently playable in Marvel Contest of Champions (MCOC), including the most recent additions. Use up-to-date sources.
Return STRICT JSON only: { "champions": [ { "name": string } ] }
Use each champion's common in-game name. Do not include champions of other classes. Do not invent champions.`

    const parsed = await groundedJson(prompt, body?.model)
    const rows: any[] = Array.isArray(parsed?.champions) ? parsed.champions : []

    let added = 0, updated = 0
    const seen = new Set<string>()
    for (const r of rows) {
      const name = cleanChampName(r?.name ?? "")
      const norm = normChampName(name)
      if (!name || !norm || seen.has(norm)) continue
      seen.add(norm)
      const existing = await prisma.mcocChampionProfile.findUnique({ where: { nameNorm: norm } })
      if (existing) {
        if (!existing.class) { await prisma.mcocChampionProfile.update({ where: { id: existing.id }, data: { class: cls } }); updated++ }
      } else {
        await prisma.mcocChampionProfile.create({ data: { name, nameNorm: norm, class: cls } })
        added++
      }
    }

    const total = await prisma.mcocChampionProfile.count()
    return NextResponse.json({ class: cls, found: rows.length, added, updated, total })
  } catch (e: any) {
    console.error("jordan/mcoc/catalog error:", e)
    if (isTransientGeminiError(e)) return NextResponse.json({ error: "Model overloaded — try again shortly." }, { status: 503 })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
