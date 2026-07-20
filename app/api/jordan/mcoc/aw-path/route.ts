import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { getObjectBuffer } from "@/lib/r2"
import { friendlyGeminiError } from "@/lib/gemini-retry"

export const maxDuration = 180

// POST /api/jordan/mcoc/aw-path — Alliance War path planner. Reads the player's
// SAVED war path (app/(app)/jordan/mcoc/aw-client.tsx): an ordered list of
// fights, each with a defender and (usually) a photo of that fight's nodes.
// Recommends a few 3-champion attack teams from the roster plus 2–3 ranked
// attacker options per fight, reading each fight's node buffs from its photo.
// FormData: tier?, model?. Fights + roster are loaded from the DB. Locked to jordan.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const tier = ((form.get("tier") as string) ?? "").trim().slice(0, 40)

    const [fights, rosterRows] = await Promise.all([
      prisma.mcocWarFight.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } }),
      // Strongest first — primes the model and lets us flag the top-rank champs.
      prisma.mcocChampion.findMany({ where: { ownerId: session.user.id }, select: { name: true, stars: true, rank: true }, orderBy: [{ rank: "desc" }, { stars: "desc" }] }),
    ])

    const withDef = fights.filter((f) => f.defender.trim())
    if (!withDef.length) return NextResponse.json({ error: "Add at least one fight with a defender." }, { status: 400 })
    if (rosterRows.length < 3) return NextResponse.json({ error: "Your roster needs at least 3 champions." }, { status: 400 })

    // Each fight's nodes photo becomes a labelled image part the AI reads for the
    // node buffs. A fight with no photo just relies on the defender + tier.
    const parts: any[] = []
    const fightLines: string[] = []
    for (let i = 0; i < withDef.length; i++) {
      const f = withDef[i]
      let hasImage = false
      if (f.nodesImageKey) {
        try {
          const buf = await getObjectBuffer(f.nodesImageKey)
          parts.push({ text: `NODES IMAGE for FIGHT ${i + 1} (${f.defender}):` })
          parts.push({ inlineData: { data: buf.toString("base64"), mimeType: "image/jpeg" } })
          hasImage = true
        } catch { /* image missing/unreadable — fall back to defender + tier */ }
      }
      fightLines.push(`${i + 1}. ${f.defender}${hasImage ? " — nodes in the image labelled FIGHT " + (i + 1) : ""}`)
    }

    // Mark the player's best champs (rank 5, then rank 4) so the model weights
    // them — a heavily-invested champ hits far harder than a rank-1 of a
    // "theoretically better" champ, and is what the player actually wants to use.
    const rosterList = rosterRows
      .map((c) => {
        const badge = c.rank >= 5 ? "  ⭐ TOP (max rank)" : c.rank === 4 ? "  ◆ high rank" : ""
        return `- ${c.name}${c.stars ? ` (${c.stars}★ R${c.rank})` : ""}${badge}`
      })
      .join("\n")
    const topChamps = rosterRows.filter((c) => c.rank >= 5).map((c) => c.name)

    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. The player must clear an AW path with these DEFENDERS, in this order:
${fightLines.join("\n")}
${tier ? `\nWar bracket: ${tier} tier — assume the node buffs and defensive tactics of ${tier}-tier Alliance War.` : ""}
${parts.length ? `\nNODES (important): each fight above with an image has a screenshot of that fight's node list attached, labelled "NODES IMAGE for FIGHT n". READ the node names/buffs directly from the matching image and treat them as AUTHORITATIVE — use them exactly, override any assumption, and factor them into the attacker pick and the "how". Return each fight's node buffs in "nodeBuff" (a short summary of the node effects that matter). For a fight with no image, look the node up${tier ? ` in ${tier} tier` : ""} if you know it, else set "nodeBuff" to "" — never invent one.` : `\nFor each fight, if you know its likely AW nodes${tier ? ` in ${tier} tier` : ""} include them in "nodeBuff"; otherwise "" — do not guess.`}

THE PLAYER'S ROSTER (sorted STRONGEST FIRST; pick ONLY from this list, names copied exactly):
${rosterList}

HOW TO PICK — read carefully, this is where most tools get it wrong:
- **Rank is a huge signal.** A champion marked ⭐ TOP is at MAX rank — the player's biggest investment, highest damage and best sustain. STRONGLY prefer these as attackers wherever they are a sensible pick, and build your team options AROUND them. Do NOT bury a maxed champion under lower-rank picks, and do NOT recommend a rank-1/2 champion as "best" over a maxed champion that can do the same job.${topChamps.length ? ` The player's max-rank champs are: ${topChamps.join(", ")} — a good plan uses several of these.` : ""}
- **Use CURRENT meta.** Judge each champion by how it performs in the game NOW — recently-released or recently-buffed champions are frequently among the very best attackers. Do not under-rate a champion because older data rated it low.
- A champion that is BOTH max-rank AND a strong current-meta pick for a fight should almost always be the BEST option for that fight.

Give the player OPTIONS:
1. TWO or THREE different 3-champion attack teams from the roster that could each clear this whole path — each genuinely different, and each built around the player's max-rank champs where they fit. Short name + one-line game plan.
2. For EACH fight, the 2–3 BEST attackers from the roster for that specific defender + its nodes (best first), each with a short note on how. The BEST pick should be the strongest suitable champion the player actually has well-ranked.

Return STRICT JSON only (no prose, no markdown):
{
  "teams": [
    { "name": string, "summary": string, "champions": [ { "champion": string, "why": string } ] }
  ],
  "fights": [
    { "defender": string, "nodeBuff": string, "options": [ { "attacker": string, "how": string } ] }
  ],
  "risks": string,
  "notes": string
}
Rules: 2 or 3 teams, exactly 3 champions each, names copied from the roster. One fights entry per defender, in the same order. 2–3 options each, best first, attackers from the roster. nodeBuff = what the node(s) do (read from the image or looked up; "" if truly unknown).`

    // The node images + big prompt make a grounded reply likely to fail to parse,
    // and the fallback answers from training data (a stale meta) — which is how a
    // current top attacker like a recent champ gets left out. Surface it.
    let groundedFallback = false
    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null, () => { groundedFallback = true })

    const teams = (Array.isArray(parsed?.teams) ? parsed.teams : []).slice(0, 3).map((t: any) => ({
      name: typeof t?.name === "string" ? t.name.trim().slice(0, 60) : "",
      summary: typeof t?.summary === "string" ? t.summary.slice(0, 300) : "",
      champions: (Array.isArray(t?.champions) ? t.champions : []).slice(0, 3).map((c: any) => ({
        champion: typeof c?.champion === "string" ? c.champion.trim().slice(0, 60) : "?",
        why: typeof c?.why === "string" ? c.why.slice(0, 300) : "",
      })),
    })).filter((t: { champions: unknown[] }) => t.champions.length)

    const fightsOut = (Array.isArray(parsed?.fights) ? parsed.fights : []).slice(0, withDef.length + 2).map((f: any, i: number) => ({
      defender: typeof f?.defender === "string" ? f.defender.trim().slice(0, 60) : (withDef[i]?.defender ?? "?"),
      nodeBuff: typeof f?.nodeBuff === "string" ? f.nodeBuff.slice(0, 200) : "",
      options: (Array.isArray(f?.options) ? f.options : []).slice(0, 3).map((o: any) => ({
        attacker: typeof o?.attacker === "string" ? o.attacker.trim().slice(0, 60) : "?",
        how: typeof o?.how === "string" ? o.how.slice(0, 300) : "",
      })),
    }))

    return NextResponse.json({
      teams, fights: fightsOut,
      risks: typeof parsed?.risks === "string" ? parsed.risks.slice(0, 600) : "",
      notes: typeof parsed?.notes === "string" ? parsed.notes.slice(0, 600) : "",
      groundedFallback,
    })
  } catch (e: any) {
    console.error("jordan/mcoc/aw-path error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
