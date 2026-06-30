import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 60

// POST /api/it-help/ask
//
// Body: { question: string }
//
// Strategy: keyword-score the question against (a) every KnowledgeArticle and
// (b) every resolved/closed Ticket. Take the top ~6 matches as context, send
// to Gemini with strict instructions to answer only from that context and
// cite which item it pulled from. If nothing scores above zero, tell the
// user nothing matched rather than hallucinating an answer.
//
// Why keyword scoring (not embeddings)? Corpus is small (tens to low
// hundreds of items), runs cheaply, no embedding refresh job needed. Can
// swap in pgvector later behind the same response shape.

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
])

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

function score(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase()
  let s = 0
  for (const t of terms) {
    // Count occurrences — frequent matches count more, but cap each term's
    // contribution so a single keyword spammed in one doc doesn't dominate.
    let count = 0
    let idx = 0
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

    const { question, modelId } = await req.json() as { question?: string; modelId?: string }
    const q = String(question ?? "").trim()
    if (!q) return NextResponse.json({ error: "Question required" }, { status: 400 })

    const terms = tokenise(q)
    if (terms.length === 0) {
      return NextResponse.json({
        answer:  "I need a bit more to go on — try asking with a few keywords (e.g. 'printer not working in packing room').",
        sources: [],
      })
    }

    // Pull everything — corpus is small. Filter+score in JS to keep the SQL
    // simple and the matching logic transparent.
    const [articles, tickets] = await Promise.all([
      prisma.knowledgeArticle.findMany(),
      prisma.ticket.findMany({
        where: { status: { in: ["RESOLVED", "CLOSED"] } },
      }),
    ])

    type Scored = { source: Source; score: number; body: string }
    const scored: Scored[] = []

    for (const a of articles) {
      const blob = `${a.title}\n${a.tags.join(" ")}\n${a.body}`
      const sc   = score(blob, terms) + score(a.title, terms) * 2  // title hits weighted higher
      if (sc > 0) {
        scored.push({
          source: { kind: "article", id: a.id, title: a.title, snippet: snippet(a.body, terms) },
          score:  sc,
          body:   a.body,
        })
      }
    }

    for (const t of tickets) {
      const resolution = t.resolutionNote ?? ""
      // Tickets without a resolution note aren't useful as solutions.
      if (!resolution.trim()) continue
      const blob = `${t.title}\n${t.description}\n${resolution}`
      const sc   = score(blob, terms) + score(t.title, terms) * 2
      if (sc > 0) {
        scored.push({
          source: { kind: "ticket", id: t.id, title: t.title, snippet: snippet(resolution, terms) },
          score:  sc,
          body:   `Problem: ${t.description}\n\nResolution: ${resolution}`,
        })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, 6)

    if (top.length === 0) {
      return NextResponse.json({
        answer:  "I couldn't find anything in the knowledge base or resolved tickets that matches that. Try raising a new ticket so the IT team can sort it.",
        sources: [],
      })
    }

    // Build Gemini prompt
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      // No Gemini configured — fall back to a plain "here's what I found" reply
      return NextResponse.json({
        answer:
          "Here's the most relevant information I found:\n\n" +
          top.map((s, i) => `${i + 1}. ${s.source.title}\n${s.source.snippet}`).join("\n\n"),
        sources: top.map(s => s.source),
      })
    }

    const context = top.map((s, i) =>
      `[Source ${i + 1} — ${s.source.kind === "article" ? "Knowledge Article" : "Resolved Ticket"}: ${s.source.title}]\n${s.body}`
    ).join("\n\n---\n\n")

    const prompt = `You are the Vectis Auctions IT helpdesk assistant. A staff member has asked a question. Answer ONLY using the information in the SOURCES below. If the sources do not contain an answer, say so plainly — do not invent or guess.

When you cite information, refer to the source like "(Source 1)" so the user knows where it came from. Keep the answer concise and practical — staff want steps to fix their problem, not essays. Use plain text, no markdown headers.

QUESTION:
${q}

SOURCES:
${context}

ANSWER:`

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: modelId || (await getToolModel("it_help")),
      generationConfig: { maxOutputTokens: 2048 },
    })

    const result   = await model.generateContent(prompt)
    const response = result.response

    const blocked = response.promptFeedback?.blockReason
    if (blocked) {
      return NextResponse.json({
        answer:  `(Gemini blocked the request: ${blocked}) Here are the most relevant sources I found:\n\n` +
                 top.map((s, i) => `${i + 1}. ${s.source.title} — ${s.source.snippet}`).join("\n\n"),
        sources: top.map(s => s.source),
      })
    }

    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({
        answer:  `Gemini stopped unexpectedly (${finishReason}). Sources:\n\n` +
                 top.map((s, i) => `${i + 1}. ${s.source.title}`).join("\n"),
        sources: top.map(s => s.source),
      })
    }

    const answer = response.text().trim()
    return NextResponse.json({ answer, sources: top.map(s => s.source) })
  } catch (e: any) {
    console.error("it-help/ask error:", e)
    return NextResponse.json({ error: e?.message ?? "Ask failed" }, { status: 500 })
  }
}
