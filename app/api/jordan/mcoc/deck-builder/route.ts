import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 300

// POST /api/jordan/mcoc/deck-builder — build a full Battlegrounds deck from the
// season's nodes/meta (screenshot and/or notes) + the player's roster.
// FormData: image? (nodes/meta screenshot), notes?, roster (JSON [{name,stars,rank}]),
// size (default 30), model. Locked to jordan.orange.

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const notes = ((form.get("notes") as string) ?? "").trim().slice(0, 1500)
    const size = Math.min(35, Math.max(10, Number(form.get("size")) || 30))
    let roster: { name: string; stars?: number; rank?: number }[] = []
    try { const r = JSON.parse((form.get("roster") as string) ?? "[]"); if (Array.isArray(r)) roster = r } catch {}
    roster = roster.filter((c) => typeof c?.name === "string" && c.name.trim()).slice(0, 400)
    if (roster.length < size) {
      return NextResponse.json({ error: `Your roster has ${roster.length} champs — add more before building a ${size}-champ deck.` }, { status: 400 })
    }

    const file = form.get("image")
    const parts: any[] = []
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      parts.push({ inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" } })
    }
    if (!parts.length && !notes) {
      return NextResponse.json({ error: "Upload a screenshot of the season's nodes/meta, or describe it in the notes box." }, { status: 400 })
    }

    const rosterList = roster.map((c) => `- ${c.name}${c.stars ? ` (${c.stars}★${c.rank ? ` R${c.rank}` : ""})` : ""}`).join("\n")
    const prompt = `You are an expert Marvel Contest of Champions Battlegrounds strategist. Build the best possible ${size}-champion Battlegrounds deck for THIS SEASON from the player's roster.

${parts.length ? "The image shows the current Battlegrounds season's nodes / meta. Read it carefully — the node buffs decide which champions excel this season." : ""}${notes ? `\nSeason notes from the player: ${notes}` : ""}

THE PLAYER'S ROSTER (you may ONLY pick from this list, names copied exactly):
${rosterList}

Consider: which champions attack well into this meta, which are nightmare defenders on these nodes, class spread for drafting, and the ban phase. Use up-to-date knowledge of the current Battlegrounds meta.

Return STRICT JSON only (no prose, no markdown):
{
  "deck": [ { "champion": string, "role": "Attacker" | "Defender" | "Flex", "why": string } ],  // EXACTLY ${size} entries, champion names copied exactly from the roster list
  "strategy": string,   // 2–3 sentences: how to draft/play this deck this season
  "watchouts": string   // what this deck lacks / what to be careful of, or ""
}`

    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null)
    const deck = (Array.isArray(parsed?.deck) ? parsed.deck : [])
      .filter((d: any) => typeof d?.champion === "string" && d.champion.trim())
      .slice(0, size + 5)
      .map((d: any) => ({
        champion: d.champion.replace(/\s+/g, " ").trim().slice(0, 60),
        role: d?.role === "Defender" ? "Defender" : d?.role === "Flex" ? "Flex" : "Attacker",
        why: typeof d?.why === "string" ? d.why.slice(0, 300) : "",
      }))

    return NextResponse.json({
      deck,
      strategy: typeof parsed?.strategy === "string" ? parsed.strategy.slice(0, 800) : "",
      watchouts: typeof parsed?.watchouts === "string" ? parsed.watchouts.slice(0, 800) : "",
    })
  } catch (e: any) {
    console.error("jordan/mcoc/deck-builder error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
