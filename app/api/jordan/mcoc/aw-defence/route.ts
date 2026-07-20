import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// POST /api/jordan/mcoc/aw-defence — recommend which roster champions to place
// on Alliance War defence, and on which nodes. FormData: image? (defence map /
// node screenshot), notes? (tier/map info), count (default 5), roster (JSON),
// model. Locked to jordan.orange.

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const notes = ((form.get("notes") as string) ?? "").trim().slice(0, 1000)
    const tier = ((form.get("tier") as string) ?? "").trim().slice(0, 40)
    const count = Math.min(10, Math.max(1, Number(form.get("count")) || 5))
    let roster: { name: string; stars?: number; rank?: number }[] = []
    try { const r = JSON.parse((form.get("roster") as string) ?? "[]"); if (Array.isArray(r)) roster = r } catch {}
    roster = roster.filter((c) => typeof c?.name === "string" && c.name.trim()).slice(0, 400)
    if (roster.length < count) return NextResponse.json({ error: "Not enough champions in your roster." }, { status: 400 })

    const file = form.get("image")
    const parts: any[] = []
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      parts.push({ inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" } })
    }

    const rosterList = roster.map((c) => `- ${c.name}${c.stars ? ` (${c.stars}★${c.rank ? ` R${c.rank}` : ""})` : ""}`).join("\n")
    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. Recommend the player's best AW DEFENCE placements.

${parts.length ? "The image shows the defence map / nodes available to the player — read the node numbers and buffs from it." : "No map image was provided — use standard current Alliance War defence nodes and call nodes by their usual numbers."}${tier ? `\nWar bracket: ${tier} tier — assume the node buffs and defensive tactics typical of ${tier}-tier Alliance War.` : ""}${notes ? `\nExtra info from the player (tier/map/etc.): ${notes}` : ""}

THE PLAYER'S ROSTER (pick ONLY from this list, names copied exactly):
${rosterList}

Pick the ${count} best DEFENDERS from the roster and assign each to the node where it is most dangerous (node synergy matters more than raw rating). Use up-to-date knowledge of the AW meta.

Return STRICT JSON only (no prose, no markdown):
{
  "placements": [ { "node": string, "champion": string, "why": string } ],  // exactly ${count}, champion names from the roster list, node = number/name
  "notes": string   // 1–2 sentences of overall defence advice for this roster, or ""
}`

    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null)
    const placements = (Array.isArray(parsed?.placements) ? parsed.placements : []).slice(0, count + 2).map((p: any) => ({
      node: typeof p?.node === "string" ? p.node.trim().slice(0, 40) : String(p?.node ?? "?"),
      champion: typeof p?.champion === "string" ? p.champion.trim().slice(0, 60) : "?",
      why: typeof p?.why === "string" ? p.why.slice(0, 300) : "",
    }))

    return NextResponse.json({
      placements,
      notes: typeof parsed?.notes === "string" ? parsed.notes.slice(0, 600) : "",
    })
  } catch (e: any) {
    console.error("jordan/mcoc/aw-defence error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
