import { NextRequest, NextResponse } from "next/server"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { isTransientGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 120

// POST /api/jordan/mcoc/aw-path — Alliance War path planner: given the defenders
// on the player's path (+ optional per-defender nodes + optional war-map photo),
// recommend a few different 3-champion attack teams from the roster, plus 2–3
// ranked attacker options per fight with each node's buff.
// FormData: defenders (JSON [{name,node?}]), nodes?, tier?, roster (JSON), model?,
// image? (war-map screenshot — authoritative for node buffs).

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    // Defenders may be plain strings (legacy) or { name, node } objects (JSON string).
    let rawDefs: unknown[] = []
    try { const d = JSON.parse((form.get("defenders") as string) ?? "[]"); if (Array.isArray(d)) rawDefs = d } catch {}
    const defenders: { name: string; node: string }[] = rawDefs
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
    try { const r = JSON.parse((form.get("roster") as string) ?? "[]"); if (Array.isArray(r)) roster = r } catch {}
    roster = roster.filter((c) => typeof c?.name === "string" && c.name.trim()).slice(0, 400)
    if (roster.length < 3) return NextResponse.json({ error: "Your roster needs at least 3 champions." }, { status: 400 })

    const nodes = ((form.get("nodes") as string) ?? "").trim().slice(0, 1000)
    const tier = ((form.get("tier") as string) ?? "").trim().slice(0, 40)

    // Optional war-map screenshot — the AI reads the real node buffs from it and
    // treats them as authoritative (correcting its own lookup).
    const file = form.get("image")
    const parts: any[] = []
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer())
      parts.push({ inlineData: { data: buffer.toString("base64"), mimeType: file.type || "image/jpeg" } })
    }

    const rosterList = roster.map((c) => `- ${c.name}${c.stars ? ` (${c.stars}★${c.rank ? ` R${c.rank}` : ""})` : ""}`).join("\n")

    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. The player must clear an AW path with these DEFENDERS, in this order:
${defenders.map((d, i) => `${i + 1}. ${d.name}${d.node ? ` (on node ${d.node})` : ""}`).join("\n")}
${tier ? `\nWar bracket: ${tier} tier — assume the node buffs and defensive tactics of ${tier}-tier Alliance War.` : ""}
${nodes ? `\nExtra node / buff info from the player (treat as authoritative): ${nodes}` : ""}
${parts.length ? `\nNODE LOOKUP (important): A screenshot of the war map / node screen is attached — READ the node numbers and their buffs directly from the image. Those are AUTHORITATIVE: use them exactly and override any prior assumption. For a node that has a number but isn't legible in the image, look it up${tier ? ` in ${tier} tier` : ""}. Return each fight's node buff in "nodeBuff", factor it into the attacker pick and the "how", and set "nodeBuff" to "" only if it's neither in the image nor something you actually know (never invent one).` : defenders.some((d) => d.node) ? `\nNODE LOOKUP (important): for each defender that has a node number, LOOK UP what that Alliance War node actually does${tier ? ` in ${tier} tier` : ""} — the node's buff(s) and any global effects — and return it in that fight's "nodeBuff". Factor the node buff into which attacker you pick and into the "how". Use real, current Alliance War node data. If you genuinely don't know a specific node's buff, set "nodeBuff" to "" rather than inventing one — do not guess.` : ""}

THE PLAYER'S ROSTER (pick ONLY from this list, names copied exactly):
${rosterList}

Give the player OPTIONS, using up-to-date knowledge of matchups:
1. TWO or THREE different 3-champion attack teams from the roster that could each clear this whole path. Make them genuinely different (different classes / playstyles — e.g. a mystic-heavy team vs a skill/tech team), each with a short name and a one-line game plan.
2. For EACH defender, the 2–3 BEST attackers from the roster to take that specific fight (best first), each with a short note on how.

Return STRICT JSON only (no prose, no markdown):
{
  "teams": [
    { "name": string, "summary": string, "champions": [ { "champion": string, "why": string } ] }
  ],   // 2 or 3 teams; exactly 3 champions each; names copied from the roster list
  "fights": [
    { "defender": string, "node": string, "nodeBuff": string, "options": [ { "attacker": string, "how": string } ] }
  ],   // one per defender, same order. node = its node number (echo it, "" if none). nodeBuff = what that node does at this tier (looked up; "" if truly unknown). 2–3 options each, best first, attackers from the roster
  "risks": string,   // the hardest fight(s) on this path and why, or ""
  "notes": string    // extra tips for the path (boosts to bring, ramp-up champs, order to fight in…), or ""
}`

    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null)
    const teams = (Array.isArray(parsed?.teams) ? parsed.teams : []).slice(0, 3).map((t: any) => ({
      name: typeof t?.name === "string" ? t.name.trim().slice(0, 60) : "",
      summary: typeof t?.summary === "string" ? t.summary.slice(0, 300) : "",
      champions: (Array.isArray(t?.champions) ? t.champions : []).slice(0, 3).map((c: any) => ({
        champion: typeof c?.champion === "string" ? c.champion.trim().slice(0, 60) : "?",
        why: typeof c?.why === "string" ? c.why.slice(0, 300) : "",
      })),
    })).filter((t: { champions: unknown[] }) => t.champions.length)
    const fights = (Array.isArray(parsed?.fights) ? parsed.fights : []).slice(0, defenders.length + 2).map((f: any) => ({
      defender: typeof f?.defender === "string" ? f.defender.trim().slice(0, 60) : "?",
      node: typeof f?.node === "string" ? f.node.trim().slice(0, 12) : (typeof f?.node === "number" ? String(f.node) : ""),
      nodeBuff: typeof f?.nodeBuff === "string" ? f.nodeBuff.slice(0, 200) : "",
      options: (Array.isArray(f?.options) ? f.options : []).slice(0, 3).map((o: any) => ({
        attacker: typeof o?.attacker === "string" ? o.attacker.trim().slice(0, 60) : "?",
        how: typeof o?.how === "string" ? o.how.slice(0, 300) : "",
      })),
    }))

    return NextResponse.json({
      teams, fights,
      risks: typeof parsed?.risks === "string" ? parsed.risks.slice(0, 600) : "",
      notes: typeof parsed?.notes === "string" ? parsed.notes.slice(0, 600) : "",
    })
  } catch (e: any) {
    console.error("jordan/mcoc/aw-path error:", e)
    if (isTransientGeminiError(e)) return NextResponse.json({ error: "Model overloaded — try again shortly." }, { status: 503 })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
