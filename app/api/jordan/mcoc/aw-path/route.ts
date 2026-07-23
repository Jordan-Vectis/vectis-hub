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
    // "pick" = the player has ticked which minis they're taking (default).
    // "recommend" = let the AI choose 1 mini per path (A/B/C) + one boss side.
    const miniMode = ((form.get("miniMode") as string) ?? "pick") === "recommend" ? "recommend" : "pick"
    // Attackers the player WANTS to bring — "tell me which fights these handle".
    let forcedIn: string[] = []
    try { const f = JSON.parse((form.get("forced") as string) ?? "[]"); if (Array.isArray(f)) forcedIn = f.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 8) } catch {}

    const [pathFights, allMinis, rosterRows] = await Promise.all([
      prisma.mcocWarFight.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } }),
      // Every mini node with its slot. Tolerated absent pre-migration.
      prisma.mcocMiniNode.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } })
        .catch(() => [] as { id: string; label: string; defender: string; taking: boolean; slot: string | null; nodesImageKey: string | null }[]),
      // Strongest first — primes the model and lets us flag the top-rank champs.
      prisma.mcocChampion.findMany({ where: { ownerId: session.user.id }, select: { name: true, stars: true, rank: true }, orderBy: [{ rank: "desc" }, { stars: "desc" }] }),
    ])

    // Which minis feed the MAIN plan: in pick mode, the ticked ones (as before);
    // in recommend mode, none — the AI chooses them separately (below).
    const takingMinis = miniMode === "pick" ? allMinis.filter((m) => m.taking && m.defender.trim()) : []

    // Path fights first, then (pick mode) this war's selected mini bosses — one
    // combined list so the plan (teams, per-fight options, must-use) covers both.
    const withDef = [
      ...pathFights.filter((f) => f.defender.trim()).map((f) => ({ defender: f.defender, nodesImageKey: f.nodesImageKey, miniLabel: null as string | null })),
      ...takingMinis.map((m) => ({ defender: m.defender, nodesImageKey: m.nodesImageKey, miniLabel: m.label || "Mini boss" })),
    ]

    // ── Recommend mode: build the candidate minis grouped by section ──
    // 1 must be taken from each of Path A / B / C, and one of the two Boss nodes.
    const SECTION_OF = (slot: string | null): { section: string; side: string } | null => {
      if (!slot) return null
      const side = slot.endsWith("_l") ? "L" : slot.endsWith("_c") ? "C" : slot.endsWith("_r") ? "R" : slot === "boss_ll" ? "L" : slot === "boss_lr" ? "R" : ""
      if (slot.startsWith("pa_")) return { section: "Path A", side }
      if (slot.startsWith("pb_")) return { section: "Path B", side }
      if (slot.startsWith("pc_")) return { section: "Path C", side }
      if (slot === "boss_ll" || slot === "boss_lr") return { section: "Boss", side }
      return null
    }
    type Candidate = { id: string; slot: string; section: string; side: string; label: string; defender: string; nodesImageKey: string | null }
    const candidates: Candidate[] = miniMode === "recommend"
      ? allMinis.flatMap((m) => {
          const sec = SECTION_OF(m.slot)
          if (!sec || !m.defender.trim() || !m.slot) return []
          return [{ id: m.id, slot: m.slot, section: sec.section, side: sec.side, label: m.label, defender: m.defender, nodesImageKey: m.nodesImageKey }]
        })
      : []

    if (!withDef.length && !candidates.length) return NextResponse.json({ error: "Add at least one fight with a defender." }, { status: 400 })
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
      const miniTag = f.miniLabel ? `MINI BOSS (${f.miniLabel}) — ` : ""
      fightLines.push(`${i + 1}. ${miniTag}${f.defender}${hasImage ? " — nodes in the image labelled FIGHT " + (i + 1) : ""}`)
    }

    // Recommend mode: attach each candidate mini's photo and build a grouped block
    // the AI reads to choose one node per section.
    const miniCandidateBlock: string[] = []
    if (candidates.length) {
      const order = ["Path A", "Path B", "Path C", "Boss"]
      for (const section of order) {
        const list = candidates.filter((c) => c.section === section)
        if (!list.length) continue
        miniCandidateBlock.push(`${section}:`)
        for (const c of list) {
          let hasImg = false
          if (c.nodesImageKey) {
            try {
              const buf = await getObjectBuffer(c.nodesImageKey)
              parts.push({ text: `MINI CANDIDATE — ${c.section} ${c.side} (${c.defender}):` })
              parts.push({ inlineData: { data: buf.toString("base64"), mimeType: "image/jpeg" } })
              hasImg = true
            } catch { /* image missing/unreadable — defender + tier only */ }
          }
          miniCandidateBlock.push(`  - ${c.side}: ${c.defender}${c.label ? ` [${c.label}]` : ""}${hasImg ? ` — node buffs in the image labelled MINI CANDIDATE — ${c.section} ${c.side}` : ""}`)
        }
      }
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

${forcedIn.length ? `\nMUST-USE ATTACKERS: the player specifically wants to bring these champions and needs to know which fights each one handles: ${forcedIn.join(", ")}.
For EACH must-use attacker, judge it against EVERY fight on the path and report which fights it is a viable attacker for, with a rating. Where a must-use attacker is a good pick for a fight, prefer it in that fight's normal options and in the teams too. Be honest — if a must-use attacker is a poor/dangerous choice for a fight, rate it "avoid" and say why; do not pretend it works everywhere. Also note in "notes" any fight that NONE of the must-use attackers can safely take.\n` : ""}
Give the player OPTIONS:
1. TWO or THREE different 3-champion attack teams from the roster that could each clear this whole path — each genuinely different, and each built around the player's max-rank champs where they fit${forcedIn.length ? ", and using the must-use attackers wherever they fit" : ""}. Short name + one-line game plan.
2. For EACH fight, the 2–3 BEST attackers from the roster for that specific defender + its nodes (best first), each with a short note on how. The BEST pick should be the strongest suitable champion the player actually has well-ranked.
${candidates.length ? `
MINI BOSS SELECTION — the player takes EXACTLY ONE mini from each of Path A, Path B, Path C, and ONE of the two Boss nodes (L or R): 4 minis total. Here are the candidates with the defender on each this war:
${miniCandidateBlock.join("\n")}
Choose the single BEST node to take in EACH of Path A, Path B, Path C, and the better of Boss L / Boss R — the set that is EASIEST for this roster. PREFER nodes that the attackers/teams you recommended for the PATH above can ALSO clear, so the player needs no extra champions beyond their path team. For each chosen mini return its section, side (L/C/R for the paths, L/R for the boss), the defender, the single best attacker from the roster, and a short why. Read each candidate's node buffs from its image where one is attached.
` : ""}
Return STRICT JSON only (no prose, no markdown):
{
  "teams": [
    { "name": string, "summary": string, "champions": [ { "champion": string, "why": string } ] }
  ],
  "fights": [
    { "defender": string, "nodeBuff": string, "options": [ { "attacker": string, "how": string } ] }
  ],${forcedIn.length ? `
  "forced": [
    { "attacker": string, "fights": [ { "fight": number, "rating": "best" | "good" | "risky" | "avoid", "how": string } ] }
  ],   // one entry per must-use attacker, EXACT name; "fight" = the fight number (1-based); include every fight you rate good enough to mention, best ratings first` : ""}${candidates.length ? `
  "miniRecs": [
    { "section": "Path A" | "Path B" | "Path C" | "Boss", "side": "L" | "C" | "R", "defender": string, "attacker": string, "why": string }
  ],   // EXACTLY one per section (Path A, Path B, Path C, Boss = 4). "side" must be one of that section's listed candidates. Boss uses L or R only.` : ""}
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
      // Which entries are this war's mini bosses — the client badges them.
      miniLabel: withDef[i]?.miniLabel ?? null,
      nodeBuff: typeof f?.nodeBuff === "string" ? f.nodeBuff.slice(0, 200) : "",
      options: (Array.isArray(f?.options) ? f.options : []).slice(0, 3).map((o: any) => ({
        attacker: typeof o?.attacker === "string" ? o.attacker.trim().slice(0, 60) : "?",
        how: typeof o?.how === "string" ? o.how.slice(0, 300) : "",
      })),
    }))

    const RATINGS = ["best", "good", "risky", "avoid"]
    const forcedOut = forcedIn.length
      ? (Array.isArray(parsed?.forced) ? parsed.forced : []).slice(0, 8).map((f: any) => ({
          attacker: typeof f?.attacker === "string" ? f.attacker.trim().slice(0, 60) : "?",
          fights: (Array.isArray(f?.fights) ? f.fights : []).slice(0, withDef.length + 2).map((x: any) => ({
            fight: Number(x?.fight) || 0,
            defender: withDef[(Number(x?.fight) || 0) - 1]?.defender ?? "",
            rating: RATINGS.includes(String(x?.rating).toLowerCase()) ? String(x?.rating).toLowerCase() : "good",
            how: typeof x?.how === "string" ? x.how.slice(0, 300) : "",
          })).filter((x: { fight: number }) => x.fight >= 1),
        }))
      : []

    // Recommend mode: resolve the AI's section+side picks back to the real
    // candidate nodes (for the slot/id to highlight on the map). One per section.
    const SECTIONS = ["Path A", "Path B", "Path C", "Boss"]
    const miniRecs = candidates.length
      ? SECTIONS.map((section) => {
          const raw = (Array.isArray(parsed?.miniRecs) ? parsed.miniRecs : []).find((r: any) => String(r?.section) === section)
          if (!raw) return null
          const side = String(raw?.side ?? "").toUpperCase()
          const cand = candidates.find((c) => c.section === section && c.side === side)
            ?? candidates.find((c) => c.section === section)   // fall back to any candidate in the section
          if (!cand) return null
          return {
            section, side: cand.side, slot: cand.slot, nodeId: cand.id, label: cand.label,
            defender: cand.defender,
            attacker: typeof raw?.attacker === "string" ? raw.attacker.trim().slice(0, 60) : "?",
            why: typeof raw?.why === "string" ? raw.why.slice(0, 300) : "",
          }
        }).filter(Boolean)
      : []

    return NextResponse.json({
      teams, fights: fightsOut, forced: forcedOut, miniRecs,
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
