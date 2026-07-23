import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { getObjectBuffer } from "@/lib/r2"
import { friendlyGeminiError } from "@/lib/gemini-retry"
import { normChampName } from "@/lib/mcoc"

export const maxDuration = 180

// POST /api/jordan/mcoc/aw-minis — SECOND phase of the AW planner (recommend mode).
// Given the 2-3 teams the path planner produced, this picks each team's MINIS from
// THAT team's own 3 champions: one node per Path A/B/C + a boss side. Split out of
// aw-path so neither call is huge and the mini picks actually use the team's champs
// (the old single global pick recommended champs that weren't in any team).
// FormData: teams (JSON [{name, champions:[names]}]), tier?, model?. Locked to jordan.

const BEATS: Record<string, string> = { Cosmic: "Tech", Tech: "Mutant", Mutant: "Skill", Skill: "Science", Science: "Mystic", Mystic: "Cosmic" }
const CONF = ["good", "risky", "unlikely"]

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const form = await req.formData()
    const tier = ((form.get("tier") as string) ?? "").trim().slice(0, 40)
    let teamsIn: { name: string; champions: string[] }[] = []
    try {
      const t = JSON.parse((form.get("teams") as string) ?? "[]")
      if (Array.isArray(t)) teamsIn = t.slice(0, 3).map((x: any) => ({
        name: typeof x?.name === "string" ? x.name.slice(0, 60) : "",
        champions: (Array.isArray(x?.champions) ? x.champions : []).filter((c: any) => typeof c === "string" && c.trim()).map((c: string) => c.trim().slice(0, 60)).slice(0, 3),
      })).filter((x) => x.champions.length)
    } catch {}
    if (!teamsIn.length) return NextResponse.json({ error: "No teams provided." }, { status: 400 })

    const [allMinis, rosterRows] = await Promise.all([
      prisma.mcocMiniNode.findMany({ where: { ownerId: session.user.id }, orderBy: { order: "asc" } })
        .catch(() => [] as { id: string; label: string; defender: string; slot: string | null; nodesImageKey: string | null }[]),
      prisma.mcocChampion.findMany({ where: { ownerId: session.user.id }, select: { name: true, class: true, rank: true } }),
    ])
    const rosterClass = new Map(rosterRows.map((c) => [normChampName(c.name), c.class]))

    // Candidate minis grouped by section (same slot model as aw-path).
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
    type Cand = { id: string; slot: string; section: string; side: string; bossRole: string; label: string; defender: string; nodesImageKey: string | null }
    const candidates: Cand[] = allMinis.flatMap((m) => {
      const sec = SECTION_OF(m.slot)
      if (!sec || !m.defender.trim() || !m.slot) return []
      return [{ id: m.id, slot: m.slot, section: sec.section, side: sec.side, bossRole: sec.bossRole, label: m.label, defender: m.defender, nodesImageKey: m.nodesImageKey }]
    })
    if (!candidates.length) return NextResponse.json({ error: "No mini defenders to plan." }, { status: 400 })
    const bossNode = (side: string, role: string) => candidates.find((c) => c.section === "Boss" && c.bossRole === role && (role === "boss" || c.side === side))

    // Defender ground truth: class + immunities + the player's verified counters.
    const rosterNorms = new Set(rosterRows.map((c) => normChampName(c.name)))
    const profiles = await prisma.mcocChampionProfile.findMany({
      where: { nameNorm: { in: candidates.map((c) => normChampName(c.defender)) } },
      select: { nameNorm: true, class: true, immunities: true, myCounters: true },
    }).catch(() => [] as { nameNorm: string; class: string; immunities: string[]; myCounters: string[] }[])
    const profByNorm = new Map(profiles.map((p) => [p.nameNorm, p]))
    const defenderFacts = (defender: string, teamChamps: string[]): string => {
      const p = profByNorm.get(normChampName(defender))
      if (!p) return ""
      const bits: string[] = []
      if (p.class) bits.push(`${p.class} class`)
      if (p.immunities?.length) bits.push(`immune to ${p.immunities.slice(0, 6).join("/")}`)
      const mine = (p.myCounters ?? []).filter((c) => rosterNorms.has(normChampName(c)))
      if (mine.length) bits.push(`VERIFIED counters you own: ${mine.join(", ")}`)
      // Which of THIS team's champs hold a class advantage here.
      if (p.class) {
        const fav = teamChamps.filter((c) => BEATS[rosterClass.get(normChampName(c)) ?? ""] === p.class)
        if (fav.length) bits.push(`class-favoured on this team: ${fav.join(", ")}`)
      }
      return bits.length ? `  [${bits.join(" · ")}]` : ""
    }

    // Attach each candidate image once (labelled by slot), shared across teams.
    const parts: any[] = []
    for (const c of candidates) {
      if (!c.nodesImageKey) continue
      try {
        const buf = await getObjectBuffer(c.nodesImageKey)
        parts.push({ text: `MINI — ${c.slot} (${c.defender}):` })
        parts.push({ inlineData: { data: buf.toString("base64"), mimeType: "image/jpeg" } })
      } catch { /* skip unreadable */ }
    }

    // Per-team candidate blocks (facts tailored to that team's champs).
    const teamBlocks = teamsIn.map((team, ti) => {
      const lines: string[] = [`TEAM ${ti + 1} — "${team.name || `Team ${ti + 1}`}" — champs: ${team.champions.join(", ")}`]
      for (const section of ["Path A", "Path B", "Path C"]) {
        const list = candidates.filter((c) => c.section === section)
        if (!list.length) continue
        lines.push(`  ${section} (take ONE):`)
        for (const c of list) lines.push(`    - ${c.side}: ${c.defender}${c.label ? ` [${c.label}]` : ""}${defenderFacts(c.defender, team.champions)}`)
      }
      const boss = candidates.filter((c) => c.section === "Boss")
      if (boss.length) {
        lines.push(`  Boss island (go up ONE side):`)
        const d = (role: string, side: string, tag: string) => { const c = bossNode(side, role); if (c) lines.push(`    - ${tag}: ${c.defender}${defenderFacts(c.defender, team.champions)}`) }
        d("upper", "L", "LEFT upper"); d("lower", "L", "LEFT lower"); d("upper", "R", "RIGHT upper"); d("lower", "R", "RIGHT lower"); d("boss", "", "BOSS")
      }
      return lines.join("\n")
    })

    const prompt = `You are an expert Marvel Contest of Champions Alliance War strategist. For EACH of the player's chosen 3-champion teams below, pick that team's MINI BOSSES: exactly ONE node from Path A, ONE from Path B, ONE from Path C, and ONE SIDE of the boss island (left or right). ${tier ? `War bracket: ${tier} tier.` : ""}

⚠ CRITICAL: a team's mini picks MUST use ONLY that team's OWN 3 champions — never a champion from another team or elsewhere in the roster. Different teams will pick different nodes; that is expected.

ACCURACY RULES (override everything):
- CLASS WHEEL: Cosmic > Tech > Mutant > Skill > Science > Mystic > Cosmic. A class-DISADVANTAGED attacker must never be marked "good"; if it's the only option that team has, mark it "risky"/"unlikely" and name the class problem.
- VERIFIED COUNTERS: where a defender lists "VERIFIED counters you own", those are player-confirmed — if one is on the team it is the answer ("good").
- CONFIDENCE per pick: "good" (solid — class-favoured or verified), "risky" (marginal), "unlikely" ("possible but unlikely — best this team has"). It is FINE to return "risky"/"unlikely" — a full mini set often can't be matched cleanly. Only use "attacker": "" if the team has nothing that could attempt it.
${parts.length ? `Each node has its buffs in an attached image labelled "MINI — <slot>"; read them.` : ""}

TEAMS + CANDIDATES:
${teamBlocks.join("\n\n")}

Return STRICT JSON only (no prose):
{
  "teams": [
    { "team": number,   // 1-based, matching the team order above
      "minis": [ { "section": "Path A"|"Path B"|"Path C", "side": "L"|"C"|"R", "attacker": string, "confidence": "good"|"risky"|"unlikely", "how": string } ],
      "boss": { "side": "Left"|"Right", "confidence": "good"|"risky"|"unlikely", "upper": string, "lower": string, "boss": string, "why": string }
    }
  ]   // one entry per team, in order. attacker/upper/lower/boss are from THAT team's 3 champions (or "" if none can attempt it).
}`

    let groundedFallback = false
    const parsed = await groundedJson(parts.length ? [...parts, { text: prompt }] : prompt, form.get("model") as string | null, () => { groundedFallback = true })

    const conf = (c: any) => CONF.includes(String(c).toLowerCase()) ? String(c).toLowerCase() : "good"
    const resolve = (section: string, cand: Cand | undefined, attacker: any, how: any, confidence: any, sideLabel?: string) =>
      cand ? { section, side: sideLabel ?? cand.side, slot: cand.slot, label: cand.label, defender: cand.defender,
               attacker: typeof attacker === "string" && attacker.trim() ? attacker.trim().slice(0, 60) : "",
               confidence: conf(confidence), how: typeof how === "string" ? how.slice(0, 300) : "" } : null

    const out = teamsIn.map((_, ti) => {
      const raw = (Array.isArray(parsed?.teams) ? parsed.teams : []).find((r: any) => (Number(r?.team) || 0) - 1 === ti) ?? (parsed?.teams ?? [])[ti]
      const minis: any[] = []
      for (const section of ["Path A", "Path B", "Path C"]) {
        const r = (Array.isArray(raw?.minis) ? raw.minis : []).find((m: any) => String(m?.section) === section)
        if (!r) continue
        const side = String(r?.side ?? "").toUpperCase()
        const cand = candidates.find((c) => c.section === section && c.side === side) ?? candidates.find((c) => c.section === section)
        const e = resolve(section, cand, r?.attacker, r?.how, r?.confidence)
        if (e) minis.push(e)
      }
      const br = raw?.boss
      if (br) {
        const side = String(br?.side ?? "").toLowerCase().startsWith("r") ? "R" : "L"
        const label = side === "R" ? "Right" : "Left"
        const upper = resolve("Boss", bossNode(side, "upper"), br?.upper, br?.why, br?.confidence, label)
        const lower = resolve("Boss", bossNode(side, "lower"), br?.lower, "", br?.confidence, label)
        const boss  = resolve("Boss", bossNode("", "boss"), br?.boss, "", br?.confidence, label)
        for (const e of [upper, lower, boss]) if (e) minis.push(e)
      }
      return { team: ti, minis }
    })

    return NextResponse.json({ teams: out, groundedFallback })
  } catch (e: any) {
    console.error("jordan/mcoc/aw-minis error:", e)
    const friendly = friendlyGeminiError(e)
    if (friendly) return NextResponse.json({ error: friendly.error }, { status: friendly.status })
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
