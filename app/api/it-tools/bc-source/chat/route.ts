import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

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

    const { question, history, modelId } = await req.json() as {
      question?: string
      history?: { role: "user" | "model"; text: string }[]
      modelId?: string
    }
    const q = String(question ?? "").trim()
    if (!q) return NextResponse.json({ error: "Question required" }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    // Score against the question plus the last couple of turns, so follow-ups
    // ("and what does the toggle do?") still retrieve the right files.
    const recent = (history ?? []).slice(-4).map(h => h.text).join(" ")
    const terms  = tokenise(`${q} ${recent}`)
    if (terms.length === 0) return NextResponse.json({ error: "Ask with a few more words" }, { status: 400 })

    // ⚠ Narrow in SQL FIRST. The stored source is ~23 MB across ~3,000 files —
    // pulling all of it into memory to score in JS would spike the container on
    // every question. Only files containing at least one search term (or the
    // term in their path) are loaded, capped, and scored properly below.
    const probe = terms.slice(0, 8)
    let files: { id: string; extension: string; path: string; kind: string; content: string }[] = []
    try {
      files = await prisma.bcSourceFile.findMany({
        where: {
          OR: probe.flatMap(t => [
            { content: { contains: t, mode: "insensitive" as const } },
            { path:    { contains: t, mode: "insensitive" as const } },
          ]),
        },
        select: { id: true, extension: true, path: true, kind: true, content: true },
        take: 400,
      })
    } catch {
      return NextResponse.json({ error: "No BC source has been uploaded yet." }, { status: 400 })
    }
    if (files.length === 0) {
      return NextResponse.json({
        answer: "Nothing in the BC source mentions those words. Try the exact name off the screen — a page title, a field name, or a report name.",
        sources: [],
      })
    }

    const scored = files
      .map(f => ({ f, score: scoreText(f.content, terms) + scoreText(f.path, terms) * 4 }))
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
    const convo = cleanHistory.map(h => ({ role: h.role, parts: [{ text: h.text }] }))

    const prompt = `You are explaining Vectis Auctions' Business Central system to the staff member who administers it. They are NOT a programmer. British English.

Answer the question using ONLY the source files below. Rules:
- Explain plainly, step by step — what the user sees and what the system does. Keep technical detail to what's needed.
- When you rely on a file, cite its path in square brackets, e.g. [Evo-auction - Base/src/Codeunit/…], so they can open it.
- If the files below don't contain the answer, say exactly that — never guess. Suggest what to search for instead.
- Plain text only, no markdown.

SOURCE FILES:
${context}

QUESTION: ${q}`

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("bc_source_chat", modelId),
      // Roomy on purpose: a thinking-capable model can spend most of its output
      // budget reasoning and return no text at all, which is what produced the
      // blank reply that then poisoned the history.
      generationConfig: { maxOutputTokens: 16384 },
    })

    const chat   = model.startChat({ history: convo })
    const result = await chat.sendMessage(prompt)
    const response = result.response
    const blocked  = response.promptFeedback?.blockReason
    if (blocked) return NextResponse.json({ error: `Gemini blocked the request: ${blocked}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped: ${finish}` }, { status: 422 })
    }

    // ⚠ Never hand back an empty answer. It renders as a blank bubble that
    // looks like a hang, and worse, it goes back into the history on the next
    // question and gets the whole conversation rejected.
    const answer = response.text().trim()
    if (!answer) {
      return NextResponse.json(
        { error: finish === "MAX_TOKENS"
            ? "The model ran out of room before writing an answer. Ask it in a narrower way — name the screen or field you mean."
            : "The model came back with nothing. Try asking again." },
        { status: 502 },
      )
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
