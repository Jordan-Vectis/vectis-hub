import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// POST /api/jordan/mcoc/aw-path — Alliance War path planner: given the defenders
// on the player's path (+ optional node notes), recommend the best 3-champion
// attack team from the roster that can clear them all.
// JSON body: { defenders: (string | {name, node?})[], nodes?: string, roster: [{name,stars,rank}], model? }

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    // Defenders may be plain strings (legacy) or { name, node } objects.
    const defenders: { name: string; node: string }[] = (Array.isArray(body?.defenders) ? body.defenders : [])
      .map((d: unknown) => {
        const obj = d && typeof d === "object" ? (d as { name?: unknown; node?: unknown }) : null
        const name = (typeof d === "string" ? d : String(obj?.name ?? "")).replace(/\s+/g, " ").trim().slice(0, 60)
        const node = obj?.node != null ? String(obj.node).replace(/[^0-9]/g, "").slice(0, 3) : ""
        return { name, node }
      })
      .filter((d: { name: string }) => d.name)
      .slice(0, 12)
    if (!defenders.length) return NextResponse.json({ error: "Add at least one defender." }, { status: 400 })

    let roster: { name: string; stars?: number; rank?: number }[] = []
    if (Array.isArray(body?.roster)) roster = body.roster.filter((c: any) => typeof c?.name === "string" && c.name.trim()).slice(0, 400)
    if (roster.length < 3) return NextResponse.json({ error: "Your roster needs at least 3 champions." }, { status: 400 })

    const nodes = typeof body?.nodes === "string" ? body.nodes.trim().slice(0, 1000) : ""
    const rosterList = roster.map((c) => `- ${c.name}${c.stars ? ` (${c.stars}★${c.rank ? ` R${c.rank}` : ""})` : ""}`).join("\n")

    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. The player must clear an AW path with these DEFENDERS, in this order:
${defenders.map((d, i) => `${i + 1}. ${d.name}${d.node ? ` (on node ${d.node})` : ""}`).join("\n")}
${nodes ? `\nNode / buff info from the player: ${nodes}` : ""}
${defenders.some((d) => d.node) ? `\nWhere a node number is given, factor in that AW node's known buff(s) when choosing the attacker and explaining how.` : ""}

THE PLAYER'S ROSTER (pick ONLY from this list, names copied exactly):
${rosterList}

Recommend the best 3-CHAMPION attack team from the roster that can clear ALL of these defenders between them. Use up-to-date knowledge of matchups.

Return STRICT JSON only (no prose, no markdown):
{
  "team": [ { "champion": string, "why": string } ],                       // exactly 3, names from the roster list
  "assignments": [ { "defender": string, "attacker": string, "how": string } ],  // one per defender, attacker from the team
  "risks": string,       // the hardest fight(s) on this path and why, or ""
  "alternates": string   // 1–2 roster champs worth swapping in if a team member is unavailable, or ""
}`

    const parsed = await groundedJson(prompt, body?.model)
    const team = (Array.isArray(parsed?.team) ? parsed.team : []).slice(0, 3).map((t: any) => ({
      champion: typeof t?.champion === "string" ? t.champion.trim().slice(0, 60) : "?",
      why: typeof t?.why === "string" ? t.why.slice(0, 300) : "",
    }))
    const assignments = (Array.isArray(parsed?.assignments) ? parsed.assignments : []).slice(0, defenders.length + 2).map((a: any) => ({
      defender: typeof a?.defender === "string" ? a.defender.trim().slice(0, 60) : "?",
      attacker: typeof a?.attacker === "string" ? a.attacker.trim().slice(0, 60) : "?",
      how: typeof a?.how === "string" ? a.how.slice(0, 300) : "",
    }))

    return NextResponse.json({
      team, assignments,
      risks: typeof parsed?.risks === "string" ? parsed.risks.slice(0, 600) : "",
      alternates: typeof parsed?.alternates === "string" ? parsed.alternates.slice(0, 600) : "",
    })
  } catch (e: any) {
    console.error("jordan/mcoc/aw-path error:", e)
    if (isTransientGeminiError(e)) return NextResponse.json({ error: "Model overloaded — try again shortly." }, { status: 503 })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
