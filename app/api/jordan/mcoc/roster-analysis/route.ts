import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { isTransientGeminiError } from "@/lib/gemini-retry"
import { groundedJson } from "@/lib/mcoc-ai"
import { MCOC_TAGS, normChampName } from "@/lib/mcoc"

export const maxDuration = 120

// POST /api/jordan/mcoc/roster-analysis — "what should I rank up, and what
// utility am I missing?". Body: { model? }. Locked to jordan.orange.
//
// Deliberately needs NO new data entry (Jordan's ask: "I dont want to have to
// upload every champion I have"):
//   - What you HAVE  = the champions already in the roster at rank 4+. A champ
//     owned at rank 1 doesn't give you its utility in practice, so it doesn't
//     count as coverage — Jordan's call.
//   - What you COULD rank = every champion in the Champion DB, all assumed
//     available. So recommendations are never limited by what's been scanned in.
//
// The gap maths is done HERE in plain code, not by the AI: coverage is just set
// arithmetic over the stored tags, so it should be exact and repeatable rather
// than something the model re-guesses each run. The AI is left to do the part
// that actually needs judgement + live meta — which champs are worth the
// materials, and why.

const HIGH_RANK = 4

const PROMPT = `You are an expert Marvel Contest of Champions (MCOC) roster advisor. Advise which champions this player should spend their limited rank-up materials on next.

You are given: the champions they have ALREADY ranked up (rank 4+, i.e. the utility they can actually field), the utility tags NOT covered by those champions, and the pool of champions available to rank (assume every one of them is owned and available).

HARD RULES for "rankUps" — a bad recommendation wastes materials that take months to earn, so a SHORT list of genuinely great champions is far better than a long list:
1. RAW VALUE IS THE GATE. Every pick must be a champion worth scarce endgame materials TODAY, on its own merits (current meta, Battlegrounds, war, endgame content). If it doesn't clear that bar, leave it out — no matter what it fills.
2. GAP FILLING IS ONLY A TIE-BREAKER, applied AFTER rule 1. Among champions that are ALL genuinely worth materials, prefer the one that covers utility the player lacks. NEVER let gap-filling promote a champion that wouldn't otherwise deserve the materials.
3. NEVER recommend a champion just because it is the only one with a missing tag. Niche, dated champions often hold rare utility — they are still a bad investment. If a gap can only be filled by a champion that isn't meta-relevant, say exactly that in the gap's "whyItMatters" and leave it OUT of rankUps.
4. ONLY recommend champions available at 7-STAR. Champions that exist only at 6-star are older and are NOT endgame/meta relevant — never recommend one, whatever utility it has.
5. If you are not confident a champion is currently meta-relevant and 7-star available, leave it out.

Do not recommend a champion that is already in their rank 4+ list. The meta shifts monthly — use up-to-date information, and judge by how the champion is regarded NOW, not by how it was regarded on release.

Return STRICT JSON only (no prose, no markdown fences):
{
  "summary": string,        // 2-3 sentences: the shape of this roster and the single biggest priority
  "gaps": [ {
    "tag": string,          // the missing utility, copied EXACTLY from the missing list given below
    "whyItMatters": string, // what content/fights this costs them
    "fixes": [string]       // 1-3 champions from the pool that best cover it
  } ],
  "rankUps": [ {
    "champion": string,     // exact champion name from the pool
    "class": string,        // Cosmic | Tech | Mutant | Skill | Science | Mystic
    "priority": string,     // "high" | "medium" | "low"
    "why": string,          // why THIS champion is worth the materials for THIS roster
    "fills": [string]       // utility tags it adds that they lack, or [] if it's a pure-value pick
  } ]
}

Give UP TO 8 rankUps, best first — fewer is correct if only a few clear rule 1, and returning 3 great picks is a better answer than 8 padded ones. Cover the most damaging gaps (up to 6). If the missing list is empty, say so in summary and recommend on raw value alone.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const model = typeof body?.model === "string" ? body.model : null

    const [roster, profiles] = await Promise.all([
      prisma.mcocChampion.findMany({
        where: { ownerId: session.user.id },
        select: { name: true, class: true, stars: true, rank: true },
      }),
      prisma.mcocChampionProfile.findMany({
        select: { name: true, nameNorm: true, class: true, tags: true },
        orderBy: { name: "asc" },
      }),
    ])

    if (profiles.length === 0) {
      return NextResponse.json(
        { error: "The Champion DB is empty — build it in the 🧬 CHAMPION DB tab first." },
        { status: 400 }
      )
    }

    const high = roster.filter((c) => c.rank >= HIGH_RANK)
    if (high.length === 0) {
      return NextResponse.json(
        { error: `No rank ${HIGH_RANK}+ champions in your roster yet — add some in the roster below and analyse again.` },
        { status: 400 }
      )
    }

    // Coverage = tags on the rank 4+ champs. A champ with no profile built yet
    // contributes nothing and is reported, so a gap can't be an artefact of an
    // unbuilt Champion DB without Jordan being told which champs were skipped.
    const byNorm = new Map(profiles.map((p) => [p.nameNorm, p]))
    const covered = new Set<string>()
    const unprofiled: string[] = []
    for (const c of high) {
      const p = byNorm.get(normChampName(c.name))
      if (!p) { unprofiled.push(c.name); continue }
      for (const t of p.tags) covered.add(t)
    }
    const missing = MCOC_TAGS.filter((t) => !covered.has(t))

    const highNorms = new Set(high.map((c) => normChampName(c.name)))
    const candidates = profiles.filter((p) => !highNorms.has(p.nameNorm))

    const haveList = high
      .map((c) => `${c.name} (${c.class || "?"}, ${c.stars}* r${c.rank})`)
      .join("\n")
    const poolList = candidates
      .map((p) => `${p.name} (${p.class || "?"})${p.tags.length ? ` [${p.tags.join(", ")}]` : ""}`)
      .join("\n")

    const prompt = [
      PROMPT,
      `\nALREADY RANKED (rank ${HIGH_RANK}+ — the utility they can field):\n${haveList}`,
      `\nUTILITY TAGS NOT COVERED by those champions:\n${missing.length ? missing.join(", ") : "(none — every tracked utility is covered)"}`,
      `\nPOOL AVAILABLE TO RANK UP (all assumed owned; tags in brackets):\n${poolList}`,
    ].join("\n")

    // This prompt is large (the whole champion pool), which makes a grounded
    // reply more likely to leak prose and fail to parse — and the fallback
    // answers from training data, i.e. a stale meta, which is exactly how dated
    // champions get recommended. Surface it rather than let it pass silently.
    let groundedFallback = false
    const parsed = await groundedJson(prompt, model, () => { groundedFallback = true })

    const str = (v: unknown) => (typeof v === "string" ? v : "")
    const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [])

    return NextResponse.json({
      // Local, exact facts — the client shows these regardless of what the AI said.
      missingTags: missing,
      coveredTags: [...covered].sort(),
      highRankCount: high.length,
      unprofiled,
      groundedFallback,
      // AI judgement.
      summary: str(parsed?.summary),
      gaps: Array.isArray(parsed?.gaps)
        ? parsed.gaps.slice(0, 8).map((g: any) => ({
            tag: str(g?.tag),
            whyItMatters: str(g?.whyItMatters),
            fixes: strArr(g?.fixes).slice(0, 3),
          }))
        : [],
      rankUps: Array.isArray(parsed?.rankUps)
        ? parsed.rankUps.slice(0, 10).map((r: any) => ({
            champion: str(r?.champion) || "?",
            class: str(r?.class),
            priority: ["high", "medium", "low"].includes(str(r?.priority).toLowerCase())
              ? str(r?.priority).toLowerCase()
              : "medium",
            why: str(r?.why),
            fills: strArr(r?.fills).slice(0, 6),
          }))
        : [],
    })
  } catch (e: any) {
    console.error("jordan/mcoc/roster-analysis error:", e)
    if (isTransientGeminiError(e)) {
      return NextResponse.json(
        { error: "That model is overloaded right now — try again in a minute, or switch model." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
