import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError } from "@/lib/ai-provider"

export const maxDuration = 120

// POST /api/it-tools/bc-source/chat
//
// Body: { question, history?: [{ role: "user"|"model", text }], modelId? }
//
// "How does X work?" answered from the ACTUAL BC source. Same retrieval idea
// as IT Help's ask route (keyword scoring — corpus is small, embeddings are
// overkill), but over the stored AL files: score every file against the
// question, feed the best ones to Gemini, and answer citing file paths so the
// user can open them in the browser tab.

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","do","does","did","how",
  "what","why","where","when","who","which","i","you","we","they","it","this",
  "that","and","or","but","if","then","to","of","in","on","for","with","about",
  "work","works","working","mean","means","happen","happens","press","pressed",
])

function tokenise(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s._-]+/gu, " ").split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function scoreText(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase()
  let s = 0
  for (const t of terms) {
    let count = 0, idx = 0
    while ((idx = h.indexOf(t, idx)) !== -1) { count++; idx += t.length }
    s += Math.min(count, 8)
  }
  return s
}

const CONTEXT_BUDGET = 300_000   // characters of source fed to the model
const MAX_FILES      = 25

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { question, history, modelId, pinnedIds } = await req.json() as {
      question?: string
      history?: { role: "user" | "model"; text: string }[]
      modelId?: string
      pinnedIds?: string[]   // files the previous answer cited — see below
    }
    const q = String(question ?? "").trim()
    if (!q) return NextResponse.json({ error: "Question required" }, { status: 400 })

    // Score against the question plus the last couple of turns, so follow-ups
    // ("and what does the toggle do?") still retrieve the right files.
    const recent = (history ?? []).slice(-4).map(h => h.text).join(" ")
    const terms  = tokenise(`${q} ${recent}`)
    if (terms.length === 0) return NextResponse.json({ error: "Ask with a few more words" }, { status: 400 })

    // ── Shortlist in SQL, RANKED ────────────────────────────────────────────
    // The stored source is ~23 MB across ~3,000 files, so pulling it all into
    // memory to score in JS would spike the container on every question.
    //
    // ⚠ But the shortlist must be RANKED. A plain `OR contains … take: 400`
    // hands back an arbitrary 400 rows, and on a question made of common words
    // ("filter", "group", "start", "category") the genuinely relevant files
    // don't make the cut — the model then answers "the source doesn't say",
    // while naming the very files it should have been given. Score in Postgres
    // and take the best, counting a path match for much more than a body hit.
    const probe = terms.slice(0, 10)
    const like  = probe.map(t => `%${t}%`)
    const scoreExpr = probe
      .map((_, i) => `(CASE WHEN "content" ILIKE $${i + 1} THEN 1 ELSE 0 END) + (CASE WHEN "path" ILIKE $${i + 1} THEN 5 ELSE 0 END)`)
      .join(" + ")
    const whereExpr = probe.map((_, i) => `("content" ILIKE $${i + 1} OR "path" ILIKE $${i + 1})`).join(" OR ")

    let shortlist: { id: string }[] = []
    try {
      shortlist = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT "id", (${scoreExpr}) AS score FROM "BcSourceFile" WHERE ${whereExpr} ORDER BY score DESC, length("content") ASC LIMIT 60`,
        ...like,
      )
    } catch {
      return NextResponse.json({ error: "No BC source has been uploaded yet." }, { status: 400 })
    }

    // Files the previous answer already cited. A follow-up ("and how do I…")
    // is nearly always about the same objects, but its wording alone rarely
    // retrieves them again — so carry them forward explicitly.
    const carried = (pinnedIds ?? []).filter(id => typeof id === "string").slice(0, 12)
    const ids = [...new Set([...carried, ...shortlist.map(s => s.id)])]

    if (ids.length === 0) {
      return NextResponse.json({
        answer: "Nothing in the BC source mentions those words. Try the exact name off the screen — a page title, a field name, or a report name.",
        sources: [],
      })
    }

    const files = await prisma.bcSourceFile.findMany({
      where:  { id: { in: ids } },
      select: { id: true, extension: true, path: true, kind: true, content: true },
    })

    // ⚠ Carried-forward files must NOT be dropped by the score filter — the
    // whole point is that a follow-up's wording doesn't match them.
    const carriedSet = new Set(carried)
    const scored = files
      .map(f => ({
        f,
        score: scoreText(f.content, terms) + scoreText(f.path, terms) * 4 + (carriedSet.has(f.id) ? 1000 : 0),
      }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      return NextResponse.json({
        answer: "Nothing in the BC source matches those words. Try the exact name off the screen — a page title, a field name, or a report name.",
        sources: [],
      })
    }

    let used = 0
    const picked: typeof files = []
    for (const s of scored) {
      if (picked.length >= MAX_FILES) break
      if (used + s.f.content.length > CONTEXT_BUDGET) continue
      picked.push(s.f)
      used += s.f.content.length
    }

    const context = picked.map(f => `===== FILE: ${f.path} =====\n${f.content}`).join("\n\n")

    // ⚠ Gemini rejects the WHOLE request if any history part is empty:
    //   "contents[3].parts[0].data: required oneof field 'data' must have one
    //    initialized field"
    // One blank reply therefore poisoned the conversation permanently — every
    // later question 400'd. Blank turns are dropped, and the history must also
    // START with a user turn (the slice can otherwise begin on a model reply).
    const cleanHistory = (history ?? [])
      .filter(h => h && typeof h.text === "string" && h.text.trim().length > 0)
      .slice(-8)
    while (cleanHistory.length > 0 && cleanHistory[0].role !== "user") cleanHistory.shift()

    const prompt = `You are explaining Vectis Auctions' Business Central system to the staff member who administers it. They are NOT a programmer. British English.

Answer the question using ONLY the source files below. Rules:
- Explain plainly, step by step — what the user sees and what the system does. Keep technical detail to what's needed.
- When you rely on a file, cite its path in square brackets, e.g. [Evo-auction - Base/src/Codeunit/…], so they can open it.
- If the files below don't contain the answer, say exactly that — never guess. Suggest what to search for instead.
- Plain text only, no markdown.

SOURCE FILES:
${context}

QUESTION: ${q}`

    // Gemini or Claude, per Admin → AI Models. ⚠ The empty-answer and
    // blank-history guards that stop one bad reply poisoning a conversation now
    // live in generateAiText — it raises AiBlockedError instead of ever
    // returning "" (a thinking-capable model can spend its whole output budget
    // reasoning and return no text). maxOutputTokens is roomy for that reason.
    let answer: string
    try {
      answer = await generateAiText({
        model:   await getToolModel("bc_source_chat", modelId),
        prompt,
        history: cleanHistory,
        maxOutputTokens: 16384,
      })
    } catch (err) {
      if (err instanceof AiBlockedError) return NextResponse.json({ error: err.message }, { status: 502 })
      throw err
    }

    return NextResponse.json({
      answer,
      sources: picked.map(f => ({ id: f.id, path: f.path, extension: f.extension })),
    })
  } catch (e: any) {
    console.error("bc-source chat error:", e)
    const msg = String(e?.message ?? "")
    if (msg.includes("503") || msg.toLowerCase().includes("overloaded")) {
      return NextResponse.json({ error: "Gemini is briefly overloaded — try again in a moment." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Chat failed" }, { status: 500 })
  }
}
