import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 300

// GET  /api/it-tools/bc-source/guide?extension=X  → the stored guide (or null)
// POST /api/it-tools/bc-source/guide  { extension, modelId? } → (re)generate from the source
// PUT  /api/it-tools/bc-source/guide  { extension, content } → save a manual edit
//
// One plain-English guide per extension, written for non-technical readers —
// what it does, the screens, the data, how the workflows run. Regenerating
// overwrites (including a hand-edited guide — the UI warns first).

// Feed order: the manifest and readme set the scene, then data (Tables),
// screens (Pages), logic (Codeunits), and the rest. Budgeted so the biggest
// extensions still fit comfortably in the model's context.
const KIND_PRIORITY = ["Config", "Docs", "Table", "TableExt", "TableExtension", "Enum", "EnumExt", "EnumExtension",
  "Page", "PageExt", "PageExtension", "Codeunit", "Report", "Query", "XmlPort", "Interface", "ControlAddin"]
const CONTEXT_BUDGET = 400_000   // characters

function priorityOf(kind: string): number {
  const i = KIND_PRIORITY.findIndex(k => k.toLowerCase() === kind.toLowerCase())
  return i === -1 ? KIND_PRIORITY.length : i
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const extension = req.nextUrl.searchParams.get("extension")?.trim()
    if (!extension) return NextResponse.json({ error: "Missing extension" }, { status: 400 })
    try {
      const guide = await prisma.bcSourceGuide.findUnique({ where: { extension } })
      return NextResponse.json({ guide })
    } catch {
      return NextResponse.json({ guide: null, notReady: true })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { extension, content } = await req.json() as { extension?: string; content?: string }
    if (!extension?.trim() || !content?.trim()) {
      return NextResponse.json({ error: "Missing extension or content" }, { status: 400 })
    }
    const guide = await prisma.bcSourceGuide.update({
      where: { extension: extension.trim() },
      data:  { content: content.trim(), edited: true },
    })
    return NextResponse.json({ guide })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Couldn't save the guide" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { extension, modelId } = await req.json() as { extension?: string; modelId?: string }
    const ext = extension?.trim()
    if (!ext) return NextResponse.json({ error: "Missing extension" }, { status: 400 })

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 })

    const files = await prisma.bcSourceFile.findMany({
      where:  { extension: ext },
      select: { path: true, name: true, kind: true, content: true, size: true },
    })
    if (files.length === 0) return NextResponse.json({ error: "No source files stored for that extension" }, { status: 404 })

    // Pack files into the budget, most explanatory first.
    const ordered = [...files].sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind) || a.path.localeCompare(b.path))
    let used = 0
    const included: string[] = []
    let left = 0
    for (const f of ordered) {
      if (used + f.content.length > CONTEXT_BUDGET) { left++; continue }
      included.push(`===== FILE: ${f.path} =====\n${f.content}`)
      used += f.content.length
    }

    const prompt = `You are writing an internal guide for Vectis Auctions (a UK toy auction house) explaining one extension of their Business Central system. The reader is NOT a programmer — they are the staff member who administers the system. British English.

Explain, from the source code below, the extension "${ext}":

1. WHAT IT IS — two or three sentences on what this extension does for the business and who at an auction house would use it.
2. THE SCREENS — each Page the user can open: what it shows, what the buttons/actions on it do, when you'd use it. Use the caption/name a user would see.
3. THE DATA — the Tables and fields it adds, in plain terms (what each thing records, not the technical types).
4. HOW IT WORKS — walk through the main workflows step by step (what happens when the user presses X). Name the codeunit/report behind each so a developer can find it, but keep the explanation itself non-technical.
5. HOW IT CONNECTS — which other extensions or standard BC parts it depends on or feeds (use app.json and object references).
6. JARGON — a short glossary of any BC terms the reader will meet on these screens.

FORMAT RULES — important:
- Plain text only. NO markdown: no #, no **, no backticks, no tables. They will not be rendered.
- Headings in CAPITALS on their own line. Lists as simple "- " lines.
- Be concrete and specific to THIS code — never generic filler about Business Central.
- If something in the source is unclear, say so rather than guessing.
${left > 0 ? `\nNOTE: ${left} less-important file(s) did not fit and were omitted — mention at the end that the guide covers the main objects.` : ""}

SOURCE CODE:

${included.join("\n\n")}`

    const genai = new GoogleGenerativeAI(apiKey)
    const model = await getToolModel("bc_source_guide", modelId)
    const gm = genai.getGenerativeModel({ model, generationConfig: { maxOutputTokens: 16384 } })

    const result   = await gm.generateContent(prompt)
    const response = result.response
    const blocked  = response.promptFeedback?.blockReason
    if (blocked) return NextResponse.json({ error: `Gemini blocked the request: ${blocked}` }, { status: 422 })
    const finish = response.candidates?.[0]?.finishReason
    if (finish && finish !== "STOP" && finish !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped: ${finish}` }, { status: 422 })
    }

    const content = response.text().trim()
    if (!content) return NextResponse.json({ error: "Gemini returned an empty guide — try again" }, { status: 500 })

    const guide = await prisma.bcSourceGuide.upsert({
      where:  { extension: ext },
      create: { extension: ext, content, model, generatedBy: session.user.name ?? session.user.email ?? null },
      update: { content, model, generatedBy: session.user.name ?? session.user.email ?? null, edited: false, generatedAt: new Date() },
    })
    return NextResponse.json({ guide })
  } catch (e: any) {
    console.error("bc-source guide error:", e)
    // 503s from Gemini are transient — surface that plainly so the user retries.
    const msg = String(e?.message ?? "")
    if (msg.includes("503") || msg.toLowerCase().includes("overloaded")) {
      return NextResponse.json({ error: "Gemini is briefly overloaded — try again in a moment." }, { status: 503 })
    }
    return NextResponse.json({ error: e?.message ?? "Couldn't generate the guide" }, { status: 500 })
  }
}
