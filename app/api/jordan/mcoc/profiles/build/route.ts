import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { groundedJson } from "@/lib/mcoc-ai"
import { MCOC_IMMUNITIES, MCOC_TAGS, normaliseClass } from "@/lib/mcoc"

export const maxDuration = 300

// POST /api/jordan/mcoc/profiles/build  { limit?, refresh?, model? }
// Computes the capability profile for the next batch of champions that don't
// have one yet (or, in refresh mode, the oldest profiles). Grounded so it
// reflects the current game. The client loops until remaining hits 0.
// Locked to jordan.orange.

const IMM = MCOC_IMMUNITIES.join(", ")
const TAGS = MCOC_TAGS.join(", ")

function buildPrompt(name: string, cls: string): string {
  return `You are compiling a DETAILED profile of the Marvel Contest of Champions (MCOC) champion "${name}"${cls ? ` (${cls} class)` : ""}. Use up-to-date, accurate sources (e.g. mcoc.gg, official spotlights, community guides).

Return STRICT JSON only (no prose, no markdown):
{
  "class": string,          // Cosmic | Tech | Mutant | Skill | Science | Mystic
  "immunities": string[],   // ONLY from: ${IMM}
  "tags": string[],         // the champion's counter-relevant capabilities, ONLY from: ${TAGS}
  "summary": string,        // 1–2 sentences on what makes this champion strong as an ATTACKER
  "abilities": [            // the champion's kit broken into its main sections (max 8), like a spotlight page
    { "name": string,       // section heading, e.g. "Omni-Morph Forms", "Special 2", "Signature Ability"
      "details": string[] } // 2–5 short bullet points, key numbers included where notable
  ],
  "counters": string[],     // 4–8 champion NAMES that are the BEST attackers to bring AGAINST this champion when it DEFENDS, best first
  "defenderNotes": string   // 1–2 sentences: what makes this champion dangerous on defence and what an attacker needs to handle it
}

Only include immunities/tags the champion genuinely has (base kit or reliably-accessible). Pick tags/immunities from the given lists only. Use each counter champion's common in-game name. If unsure about something, leave it empty rather than guessing.`
}

const inVocab = (arr: unknown, vocab: readonly string[]): string[] => {
  if (!Array.isArray(arr)) return []
  const low = new Map(vocab.map((v) => [v.toLowerCase(), v]))
  const out: string[] = []
  for (const x of arr) {
    const hit = typeof x === "string" ? low.get(x.trim().toLowerCase()) : undefined
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

export async function POST(req: NextRequest) {
  try {
    if (!(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const body = await req.json().catch(() => ({}))
    const limit = Math.min(8, Math.max(1, Number(body?.limit) || 4))
    // A "build" (default) profiles only champs that have never been built
    // (profileAt null). A "refresh" passes staleBefore = the time it started, so
    // it re-profiles everything built before then, exactly once, then terminates
    // (each done champ's profileAt becomes "now", so it stops matching).
    const staleBefore = body?.staleBefore ? new Date(body.staleBefore) : null
    const where = staleBefore
      ? { OR: [{ profileAt: null }, { profileAt: { lt: staleBefore } }] }
      : { profileAt: null }

    const batch = await prisma.mcocChampionProfile.findMany({
      where, orderBy: { name: "asc" }, take: limit,
      select: { id: true, name: true, class: true },
    })

    // Compute concurrently (small batch) — a failure leaves that champ unbuilt
    // so the next loop retries it.
    const results = await Promise.allSettled(batch.map(async (c) => {
      const parsed = await groundedJson(buildPrompt(c.name, c.class), body?.model)
      // Abilities: array of { name, details[] }, capped so a rambling answer
      // can't bloat the row.
      const abilities = (Array.isArray(parsed?.abilities) ? parsed.abilities : [])
        .filter((a: any) => typeof a?.name === "string" && a.name.trim())
        .slice(0, 8)
        .map((a: any) => ({
          name: a.name.trim().slice(0, 80),
          details: (Array.isArray(a?.details) ? a.details : [])
            .filter((d: any) => typeof d === "string" && d.trim())
            .slice(0, 5)
            .map((d: string) => d.trim().slice(0, 400)),
        }))
      const counters = (Array.isArray(parsed?.counters) ? parsed.counters : [])
        .filter((n: any) => typeof n === "string" && n.trim())
        .slice(0, 8)
        .map((n: string) => n.replace(/\s+/g, " ").trim().slice(0, 60))
      await prisma.mcocChampionProfile.update({
        where: { id: c.id },
        data: {
          class: normaliseClass(parsed?.class ?? "") || c.class,
          immunities: inVocab(parsed?.immunities, MCOC_IMMUNITIES),
          tags: inVocab(parsed?.tags, MCOC_TAGS),
          summary: typeof parsed?.summary === "string" ? parsed.summary.slice(0, 600) : "",
          abilities,
          counters,
          defenderNotes: typeof parsed?.defenderNotes === "string" ? parsed.defenderNotes.slice(0, 600) : "",
          profileAt: new Date(),
        },
      })
    }))
    const done = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - done

    const [total, profiled, remaining] = await Promise.all([
      prisma.mcocChampionProfile.count(),
      prisma.mcocChampionProfile.count({ where: { profileAt: { not: null } } }),
      prisma.mcocChampionProfile.count({ where }),   // still to do this run
    ])

    return NextResponse.json({ done, failed, total, profiled, remaining })
  } catch (e: any) {
    console.error("jordan/mcoc/profiles/build error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
