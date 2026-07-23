import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { getObjectBuffer } from "@/lib/r2"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { normChampName } from "@/lib/mcoc"

// The MCOC class wheel: attacker class → the class it has ADVANTAGE over.
// Used so the planner can be told which of the player's champs are class-favoured
// against each defender (and which are at a disadvantage — never recommend those).
const BEATS: Record<string, string> = { Cosmic: "Tech", Tech: "Mutant", Mutant: "Skill", Skill: "Science", Science: "Mystic", Mystic: "Cosmic" }
function classMatchup(attacker: string, defender: string): "advantage" | "disadvantage" | "neutral" {
  if (!attacker || !defender) return "neutral"
  if (BEATS[attacker] === defender) return "advantage"
  if (BEATS[defender] === attacker) return "disadvantage"
  return "neutral"
}

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
    // When set, the recommend-mode minis are planned SEPARATELY (per team) by the
    // /aw-minis call, so this call only plans the path + teams. The client sets it.
    const splitMinis = ((form.get("splitMinis") as string) ?? "") === "1"
    // Attackers the player WANTS to bring — "tell me which fights these handle".
    let forcedIn: string[] = []
    try { const f = JSON.parse((form.get("forced") as string) ?? "[]"); if (Array.isArray(f)) forcedIn = f.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 8) } catch {}

    const [pathFights, allMinis, rosterRows] = await Promise.all([
      prisma.mcocWarFight.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } }),
      // Every mini node with its slot. Tolerated absent pre-migration.
      prisma.mcocMiniNode.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } })
        .catch(() => [] as { id: string; label: string; defender: string; taking: boolean; slot: string | null; nodesImageKey: string | null }[]),
      // Strongest first — primes the model and lets us flag the top-rank champs.
      prisma.mcocChampion.findMany({ where: { ownerId: session.user.id }, select: { name: true, class: true, stars: true, rank: true }, orderBy: [{ rank: "desc" }, { stars: "desc" }] }),
    ])
    const rosterClass = new Map(rosterRows.map((c) => [normChampName(c.name), c.class]))
    const rosterNorms = new Set(rosterRows.map((c) => normChampName(c.name)))

    // Which minis feed the MAIN plan: pick mode = the ticked ones; recommend mode
    // = the AI chooses them separately (below).
    const takingMinis = miniMode === "pick" ? allMinis.filter((m) => m.taking && m.defender.trim()) : []
    // The numbered fight list = path fights, then (pick mode) the ticked minis.
    // Teams are assigned a champ per numbered fight ("path" in the output).
    const withDef = [
      ...pathFights.filter((f) => f.defender.trim()).map((f) => ({ defender: f.defender, nodesImageKey: f.nodesImageKey, miniLabel: null as string | null })),
      ...takingMinis.map((m) => ({ defender: m.defender, nodesImageKey: m.nodesImageKey, miniLabel: m.label || "Mini boss" })),
    ]

    // ── Recommend mode: build the candidate minis grouped by section ──
    // One mini from each of Path A / B / C, plus a SIDE of the boss island (you go
    // up left OR right: each side is an upper node + a lower node; node 50 is the
    // boss, fought either way). bossRole tags which boss node is which.
    const SECTION_OF = (slot: string | null): { section: string; side: string; bossRole: string } | null => {
      if (!slot) return null
      const side = slot.endsWith("_l") ? "L" : slot.endsWith("_c") ? "C" : slot.endsWith("_r") ? "R" : ""
      if (slot.startsWith("pa_")) return { section: "Path A", side, bossRole: "" }
      if (slot.startsWith("pb_")) return { section: "Path B", side, bossRole: "" }
      if (slot.startsWith("pc_")) return { section: "Path C", side, bossRole: "" }
      if (slot === "boss_ul") return { section: "Boss", side: "L", bossRole: "upper" }
      if (slot === "boss_ll") return { section: "Boss", side: "L", bossRole: "lower" }
      if (slot === "boss_ur") return { section: "Boss", side: "R", bossRole: "upper" }
      if (slot === "boss_lr") return { section: "Boss", side: "R", bossRole: "lower" }
      if (slot === "boss_top") return { section: "Boss", side: "", bossRole: "boss" }
      return null
    }
    type Candidate = { id: string; slot: string; section: string; side: string; bossRole: string; label: string; defender: string; nodesImageKey: string | null }
    const candidates: Candidate[] = (miniMode === "recommend" && !splitMinis)
      ? allMinis.flatMap((m) => {
          const sec = SECTION_OF(m.slot)
          if (!sec || !m.defender.trim() || !m.slot) return []
          return [{ id: m.id, slot: m.slot, section: sec.section, side: sec.side, bossRole: sec.bossRole, label: m.label, defender: m.defender, nodesImageKey: m.nodesImageKey }]
        })
      : []
    const pathCandidates = candidates.filter((c) => c.section !== "Boss")
    const bossCandidates = candidates.filter((c) => c.section === "Boss")
    const bossNode = (side: string, role: string) => bossCandidates.find((c) => c.bossRole === role && (role === "boss" || c.side === side))

    if (!withDef.length && !candidates.length) return NextResponse.json({ error: "Add at least one fight or mini with a defender." }, { status: 400 })
    if (rosterRows.length < 3) return NextResponse.json({ error: "Your roster needs at least 3 champions." }, { status: 400 })

    // ── Ground truth for accuracy: each defender's class + immunities + the
    // player's OWN verified counters (myCounters). We feed these so the AI picks
    // from confirmed answers and respects class, instead of guessing (which gave
    // impossible picks like a class-disadvantaged Silk into Yelena).
    const defenderNames = [...new Set([...withDef.map((f) => f.defender), ...candidates.map((c) => c.defender)].map((d) => d.trim()).filter(Boolean))]
    const profiles = await prisma.mcocChampionProfile.findMany({
      where: { nameNorm: { in: defenderNames.map(normChampName) } },
      select: { nameNorm: true, class: true, immunities: true, myCounters: true, counters: true },
    }).catch(() => [] as { nameNorm: string; class: string; immunities: string[]; myCounters: string[]; counters: string[] }[])
    const profByNorm = new Map(profiles.map((p) => [p.nameNorm, p]))
    // A compact fact line for a defender: class, immunities, and — the big one —
    // the player's verified counters that are actually in their roster.
    const defenderFacts = (defender: string): string => {
      const p = profByNorm.get(normChampName(defender))
      if (!p) return ""
      const bits: string[] = []
      if (p.class) bits.push(`${p.class} class`)
      if (p.immunities?.length) bits.push(`immune to ${p.immunities.slice(0, 6).join("/")}`)
      const mine = (p.myCounters ?? []).filter((c) => rosterNorms.has(normChampName(c)))
      if (mine.length) bits.push(`VERIFIED counters you own: ${mine.join(", ")}`)
      // Which roster champs hold a class ADVANTAGE here (helps steer + flag disadvantage).
      if (p.class) {
        const fav = rosterRows.filter((c) => classMatchup(c.class, p.class) === "advantage").map((c) => c.name)
        if (fav.length) bits.push(`class-favoured in your roster: ${fav.slice(0, 10).join(", ")}`)
      }
      return bits.length ? `  [${bits.join(" · ")}]` : ""
    }
    const anyVerified = profiles.some((p) => (p.myCounters ?? []).some((c) => rosterNorms.has(normChampName(c))))

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
      fightLines.push(`${i + 1}. ${miniTag}${f.defender}${hasImage ? " — nodes in the image labelled FIGHT " + (i + 1) : ""}${defenderFacts(f.defender)}`)
    }

    // Recommend mode: attach each candidate's photo (labelled by slot so the model
    // can't confuse them) and build a grouped text block. Paths = take one; the
    // boss island = go up one side.
    const miniCandidateBlock: string[] = []
    if (candidates.length) {
      const attach = async (c: Candidate): Promise<boolean> => {
        if (!c.nodesImageKey) return false
        try {
          const buf = await getObjectBuffer(c.nodesImageKey)
          parts.push({ text: `MINI CANDIDATE — ${c.slot} (${c.defender}):` })
          parts.push({ inlineData: { data: buf.toString("base64"), mimeType: "image/jpeg" } })
          return true
        } catch { return false }
      }
      for (const section of ["Path A", "Path B", "Path C"]) {
        const list = pathCandidates.filter((c) => c.section === section)
        if (!list.length) continue
        miniCandidateBlock.push(`${section} (take ONE):`)
        for (const c of list) {
          const img = await attach(c)
          miniCandidateBlock.push(`  - ${c.side}: ${c.defender}${c.label ? ` [${c.label}]` : ""}${img ? ` — buffs in image MINI CANDIDATE — ${c.slot}` : ""}${defenderFacts(c.defender)}`)
        }
      }
      if (bossCandidates.length) {
        miniCandidateBlock.push(`Boss island (go up ONE side — left OR right, not both):`)
        const describe = async (role: string, side: string, tag: string) => {
          const c = bossNode(side, role)
          if (!c) return
          const img = await attach(c)
          miniCandidateBlock.push(`  - ${tag}: ${c.defender}${c.label ? ` [${c.label}]` : ""}${img ? ` — buffs in image MINI CANDIDATE — ${c.slot}` : ""}${defenderFacts(c.defender)}`)
        }
        await describe("upper", "L", "LEFT side, upper node")
        await describe("lower", "L", "LEFT side, lower node")
        await describe("upper", "R", "RIGHT side, upper node")
        await describe("lower", "R", "RIGHT side, lower node")
        await describe("boss", "", "BOSS (fought whichever side you pick)")
      }
    }

    // Mark the player's best champs (rank 5, then rank 4) so the model weights
    // them — a heavily-invested champ hits far harder than a rank-1 of a
    // "theoretically better" champ, and is what the player actually wants to use.
    const rosterList = rosterRows
      .map((c) => {
        const badge = c.rank >= 5 ? "  ⭐ TOP (max rank)" : c.rank === 4 ? "  ◆ high rank" : ""
        return `- ${c.name} [${c.class || "?"}]${c.stars ? ` (${c.stars}★ R${c.rank})` : ""}${badge}`
      })
      .join("\n")
    const topChamps = rosterRows.filter((c) => c.rank >= 5).map((c) => c.name)

    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. The player must clear an AW path with these DEFENDERS, in this order:
${fightLines.join("\n")}
${tier ? `\nWar bracket: ${tier} tier — assume the node buffs and defensive tactics of ${tier}-tier Alliance War.` : ""}
${parts.length ? `\nNODES (important): each fight above with an image has a screenshot of that fight's node list attached, labelled "NODES IMAGE for FIGHT n". READ the node names/buffs directly from the matching image and treat them as AUTHORITATIVE — use them exactly, override any assumption, and factor them into the attacker pick and the "how". Return each fight's node buffs in "nodeBuff" (a short summary of the node effects that matter). For a fight with no image, look the node up${tier ? ` in ${tier} tier` : ""} if you know it, else set "nodeBuff" to "" — never invent one.` : `\nFor each fight, if you know its likely AW nodes${tier ? ` in ${tier} tier` : ""} include them in "nodeBuff"; otherwise "" — do not guess.`}

THE PLAYER'S ROSTER (sorted STRONGEST FIRST; pick ONLY from this list, names copied exactly):
${rosterList}

ACCURACY RULES — these OVERRIDE everything else. Wrong picks dressed up as safe are worse than useless:
- **CLASS.** The class wheel is: Cosmic > Tech > Mutant > Skill > Science > Mystic > Cosmic (each beats the next). Each champion's class is in [square brackets]; each defender's class is in its fact note. A class-DISADVANTAGED attacker (e.g. Science into a Skill defender) must NEVER be presented as a confident pick — do not mark it "good". If it is the only thing the roster has, you may still offer it but marked "risky" or "unlikely" with the class problem named in the "how". Prefer class ADVANTAGE, then class-neutral.
- **VERIFIED COUNTERS.** Where a defender's fact note lists "VERIFIED counters you own: …", those are champions the player has PERSONALLY CONFIRMED beat that defender. Treat them as the correct answer — the pick for that fight should come from that list whenever one is in the roster/team, and it earns "good" confidence. Do not override a verified counter with a guess.
- **RATE CONFIDENCE — be honest, but don't refuse too readily.** Every pick carries a "confidence": "good" (a solid, reliable answer — class-favoured or a verified counter), "risky" (doable but needs careful play or a marginal/awkward matchup), or "unlikely" (probably won't clear it, but it's the best the roster has — "possible but unlikely"). It is FINE and USEFUL to return a champion marked "risky" or "unlikely" — that is far more helpful than refusing. Only set "attacker": "" (no pick) when the roster genuinely has NOTHING that could even attempt it. A whole set of minis often can't be matched cleanly — say "unlikely" for the awkward ones rather than pretending they're easy.

HOW TO PICK:
- **Rank is a huge signal.** A champion marked ⭐ TOP is at MAX rank — the player's biggest investment, highest damage and best sustain. STRONGLY prefer these where they are a sensible pick. Do NOT recommend a rank-1/2 champion as "best" over a maxed champion that can do the same job.${topChamps.length ? ` The player's max-rank champs are: ${topChamps.join(", ")} — a good plan uses several of these.` : ""}
- **Use CURRENT meta.** Judge each champion by how it performs NOW — recently-released or recently-buffed champions are frequently among the very best attackers.
- A champion that is class-favoured (or a verified counter), max-rank AND a strong current-meta pick should be the BEST option for that fight.

${forcedIn.length ? `\nMUST-USE ATTACKERS: the player specifically wants to bring these champions and needs to know which fights each one handles: ${forcedIn.join(", ")}.
For EACH must-use attacker, judge it against EVERY fight on the path and report which fights it is a viable attacker for, with a rating. Where a must-use attacker is a good pick for a fight, prefer it in that fight's normal options and in the teams too. Be honest — if a must-use attacker is a poor/dangerous choice for a fight, rate it "avoid" and say why; do not pretend it works everywhere. Also note in "notes" any fight that NONE of the must-use attackers can safely take.\n` : ""}
Give the player 2 or 3 TEAMS, each a complete plan:
1. Each team = 3 champions from the roster, genuinely different from the other teams, built around the max-rank champs${forcedIn.length ? " and the must-use attackers" : ""}. Give it a short name + one-line game plan.
2. For EACH team, ASSIGN which of its 3 champions takes EACH numbered fight above (its "path") — the attacker MUST be one of that team's 3 champions, with a short "how" and a "confidence" ("good" / "risky" / "unlikely" — see ACCURACY RULES). Every fight must be covered; only put "attacker": "" if that team genuinely has nothing that could attempt it.
3. ALSO give, for EACH fight, the 2–3 overall BEST attackers from the whole roster (the "fights" detail, best first) — same accuracy rules.
${candidates.length ? `
MINI BOSS SELECTION — the player takes ONE mini from each of Path A, Path B, Path C, and goes up ONE SIDE of the boss island (left or right). Here are the candidates with the defender on each this war:
${miniCandidateBlock.join("\n")}
Choose the single BEST node in EACH of Path A, Path B, Path C — the set that is EASIEST for this roster. Then choose the better BOSS SIDE (left or right): compare the two nodes on the LEFT (upper + lower) against the two on the RIGHT, and pick the side that is easier for this roster overall. PREFER nodes/side that the attackers/teams you recommended for the PATH above can ALSO clear, so the player needs no extra champions. Read each candidate's node buffs from its image where one is attached.
For the PATHS: return "miniRecs" (one per path) — section, side (L/C/R), the single best attacker, a short why.
For the BOSS: return "bossRec" — which side, why, and the best attacker for that side's UPPER node, its LOWER node, and the BOSS itself.
` : ""}
Return STRICT JSON only (no prose, no markdown):
{
  "teams": [
    { "name": string, "summary": string,
      "champions": [ { "champion": string, "why": string } ],
      "path": [ { "fight": number, "attacker": string, "confidence": "good" | "risky" | "unlikely", "how": string } ]
    }
  ],   // 2-3 teams. "path" = one entry per numbered fight (1-based, EVERY fight); "attacker" is one of this team's 3 champions or "" only if nothing could attempt it.
  "fights": [
    { "defender": string, "nodeBuff": string, "options": [ { "attacker": string, "how": string } ] }
  ],${forcedIn.length ? `
  "forced": [
    { "attacker": string, "fights": [ { "fight": number, "rating": "best" | "good" | "risky" | "avoid", "how": string } ] }
  ],   // one entry per must-use attacker, EXACT name; "fight" = the fight number (1-based); include every fight you rate good enough to mention, best ratings first` : ""}${candidates.length ? `
  "miniRecs": [
    { "section": "Path A" | "Path B" | "Path C", "side": "L" | "C" | "R", "attacker": string, "confidence": "good" | "risky" | "unlikely", "why": string }
  ],   // EXACTLY one per path (3 total). "side" = the EASIEST node in that path for the roster. confidence per ACCURACY RULES.
  "bossRec": { "side": "Left" | "Right", "confidence": "good" | "risky" | "unlikely", "why": string, "upper": string, "lower": string, "boss": string },   // the side to go up + best attacker for that side's upper node, lower node, and the boss. "" for a node with no defender listed.` : ""}
  "risks": string,
  "notes": string
}
Rules: 2 or 3 teams, exactly 3 champions each, names copied from the roster. One fights entry per defender, in the same order. 2–3 options each, best first, attackers from the roster. nodeBuff = what the node(s) do (read from the image or looked up; "" if truly unknown).`

    // The node images + big prompt make a grounded reply likely to fail to parse,
    // and the fallback answers from training data (a stale meta) — which is how a
    // current top attacker like a recent champ gets left out. Surface it.
    let groundedFallback = false
    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null, () => { groundedFallback = true })

    const CONF = ["good", "risky", "unlikely"]
    const teams = (Array.isArray(parsed?.teams) ? parsed.teams : []).slice(0, 3).map((t: any) => ({
      name: typeof t?.name === "string" ? t.name.trim().slice(0, 60) : "",
      summary: typeof t?.summary === "string" ? t.summary.slice(0, 300) : "",
      champions: (Array.isArray(t?.champions) ? t.champions : []).slice(0, 3).map((c: any) => ({
        champion: typeof c?.champion === "string" ? c.champion.trim().slice(0, 60) : "?",
        why: typeof c?.why === "string" ? c.why.slice(0, 300) : "",
      })),
      // Which of this team's champs takes each numbered fight (the assignment).
      path: (Array.isArray(t?.path) ? t.path : []).slice(0, withDef.length).map((p: any) => ({
        fight: Number(p?.fight) || 0,
        defender: withDef[(Number(p?.fight) || 0) - 1]?.defender ?? "",
        miniLabel: withDef[(Number(p?.fight) || 0) - 1]?.miniLabel ?? null,
        attacker: typeof p?.attacker === "string" ? p.attacker.trim().slice(0, 60) : "",
        confidence: CONF.includes(String(p?.confidence).toLowerCase()) ? String(p?.confidence).toLowerCase() : "good",
        how: typeof p?.how === "string" ? p.how.slice(0, 300) : "",
      })).filter((p: { fight: number }) => p.fight >= 1).sort((a: any, b: any) => a.fight - b.fight),
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

    // Recommend mode: resolve the AI's picks back to the real candidate nodes (for
    // the slot/id to highlight on the map). One per path + the chosen boss side.
    const conf = (c: any) => CONF.includes(String(c).toLowerCase()) ? String(c).toLowerCase() : "good"
    const mk = (section: string, cand: Candidate | undefined, attacker: any, why: any, confidence: any) =>
      cand ? { section, side: cand.side, slot: cand.slot, nodeId: cand.id, label: cand.label, defender: cand.defender,
               attacker: typeof attacker === "string" && attacker.trim() ? attacker.trim().slice(0, 60) : "?",
               confidence: conf(confidence),
               why: typeof why === "string" ? why.slice(0, 300) : "" } : null
    let miniRecs: any[] = []
    if (candidates.length) {
      for (const section of ["Path A", "Path B", "Path C"]) {
        const raw = (Array.isArray(parsed?.miniRecs) ? parsed.miniRecs : []).find((r: any) => String(r?.section) === section)
        if (!raw) continue
        const side = String(raw?.side ?? "").toUpperCase()
        const cand = pathCandidates.find((c) => c.section === section && c.side === side) ?? pathCandidates.find((c) => c.section === section)
        const entry = mk(section, cand, raw?.attacker, raw?.why, raw?.confidence)
        if (entry) miniRecs.push(entry)
      }
      // Boss side — take the chosen side's upper + lower nodes + the boss.
      const br = parsed?.bossRec
      if (br && bossCandidates.length) {
        const side = String(br?.side ?? "").toLowerCase().startsWith("r") ? "R" : "L"
        const label = side === "R" ? "Right" : "Left"
        // The side rationale (why) + confidence sit on the first boss node only.
        const upper = mk("Boss", bossNode(side, "upper"), br?.upper, br?.why, br?.confidence)
        const lower = mk("Boss", bossNode(side, "lower"), br?.lower, "", br?.confidence)
        const boss  = mk("Boss", bossNode("", "boss"), br?.boss, "", br?.confidence)
        for (const e of [upper, lower, boss]) if (e) miniRecs.push({ ...e, side: label })
      }
    }

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
