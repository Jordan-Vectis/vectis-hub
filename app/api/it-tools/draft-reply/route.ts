import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"

export const maxDuration = 60

// POST /api/it-tools/draft-reply
//
// Body: { email: string, notes?: string, modelId?: string }
// Returns: { reply: string, sources: Source[] }
//
// Drafts a customer-facing reply by:
// 1. keyword-scoring the customer's email + optional notes against every
//    KnowledgeArticle and every Resolved/Closed Ticket with a resolutionNote
// 2. handing the top 6 matches to Gemini with strict instructions to write a
//    polite, factual reply in British English
// 3. returning the draft + the list of sources it pulled from so staff can
//    verify before sending.

type Source = {
  kind:    "article" | "ticket"
  id:      string
  title:   string
  snippet: string
}

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","be","been","being","do","does","did",
  "i","you","he","she","it","we","they","my","your","our","their","this","that",
  "and","or","but","if","then","else","when","at","by","for","with","about",
  "to","of","in","on","off","up","out","as","not","no","yes","can","cant","can't",
  "how","what","why","where","who","which","there","here","its","it's","im","i'm",
  "hi","hello","dear","regards","thanks","thank","please","kind",
])

function tokenise(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function score(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase()
  let s = 0
  for (const t of terms) {
    let count = 0, idx = 0
    while ((idx = h.indexOf(t, idx)) !== -1) { count++; idx += t.length }
    s += Math.min(count, 5)
  }
  return s
}

function snippet(text: string, terms: string[], len = 240): string {
  const lower = text.toLowerCase()
  let bestIdx = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i
  }
  if (bestIdx === -1) return text.slice(0, len)
  const start = Math.max(0, bestIdx - 40)
  return (start > 0 ? "…" : "") + text.slice(start, start + len) + (text.length > start + len ? "…" : "")
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const { email, notes, modelId } = await req.json() as {
      email?:   string
      notes?:   string
      modelId?: string
    }
    const emailText = String(email ?? "").trim()
    const note      = String(notes ?? "").trim()
    if (!emailText) return NextResponse.json({ error: "Email body required" }, { status: 400 })

    const terms = tokenise(emailText + " " + note)

    const [articles, tickets] = await Promise.all([
      prisma.knowledgeArticle.findMany(),
      prisma.ticket.findMany({ where: { status: { in: ["RESOLVED", "CLOSED"] } } }),
    ])

    type Scored = { source: Source; score: number; body: string }
    const scored: Scored[] = []

    for (const a of articles) {
      const blob = `${a.title}\n${a.tags.join(" ")}\n${a.body}`
      const sc   = score(blob, terms) + score(a.title, terms) * 2
      if (sc > 0) scored.push({
        source: { kind: "article", id: a.id, title: a.title, snippet: snippet(a.body, terms) },
        score:  sc,
        body:   a.body,
      })
    }
    for (const t of tickets) {
      const resolution = t.resolutionNote ?? ""
      if (!resolution.trim()) continue
      const blob = `${t.title}\n${t.description}\n${resolution}`
      const sc   = score(blob, terms) + score(t.title, terms) * 2
      if (sc > 0) scored.push({
        source: { kind: "ticket", id: t.id, title: t.title, snippet: snippet(resolution, terms) },
        score:  sc,
        body:   `Problem: ${t.description}\n\nResolution: ${resolution}`,
      })
    }

    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, 6)

    const context = top.length > 0
      ? top.map((s, i) => `[Source ${i + 1} — ${s.source.kind === "article" ? "Knowledge Article" : "Resolved Ticket"}: ${s.source.title}]\n${s.body}`).join("\n\n---\n\n")
      : "(no relevant sources found — answer based on general best practice and acknowledge uncertainty)"

    const prompt = `You are a Vectis Auctions support agent drafting a reply to a customer email. Vectis is a UK auction house. Use British English throughout.

Below is the customer's email${note ? " plus extra context from staff" : ""}, followed by SOURCES from our internal knowledge base and previously-resolved support tickets. Draft a polite, professional, factual reply that:

- Addresses the customer's specific question or problem
- Pulls relevant facts/solutions ONLY from the sources where applicable
- Is honest if the sources don't fully answer the question (offer to investigate further rather than guessing)
- Avoids internal jargon (no ticket numbers, no "Auction Marketer", no "BC")
- Has a warm but professional tone
- Includes a "Kind regards," sign-off (do NOT include a name — staff will add their own)
- Plain text only, no markdown headers

CUSTOMER EMAIL:
${emailText}
${note ? `\nSTAFF NOTES / CONTEXT:\n${note}\n` : ""}
SOURCES:
${context}

DRAFTED REPLY:`

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId || "gemini-3-flash-preview",
      generationConfig: { maxOutputTokens: 2048 },
    })

    const result   = await model.generateContent(prompt)
    const response = result.response
    if (response.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `Gemini blocked: ${response.promptFeedback.blockReason}` }, { status: 422 })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped: ${finishReason}` }, { status: 422 })
    }

    const reply = response.text().trim()
    return NextResponse.json({ reply, sources: top.map(s => s.source) })
  } catch (e: any) {
    console.error("it-tools/draft-reply error:", e)
    return NextResponse.json({ error: e?.message ?? "Draft failed" }, { status: 500 })
  }
}
