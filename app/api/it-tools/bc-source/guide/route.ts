import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError } from "@/lib/ai-provider"

export const maxDuration = 300

// GET  /api/it-tools/bc-source/guide?extension=X  → the stored guide (or null)
// POST /api/it-tools/bc-source/guide  { extension, modelId? } → (re)generate from the source
// PUT  /api/it-tools/bc-source/guide  { extension, content } → save a manual edit
//
// One plain-English guide per extension, written for non-technical readers —
// what it does, the screens, the data, how the workflows run. Regenerating
// overwrites (including a hand-edited guide — the UI warns first).

// Feed order: the manifest and readme set the scene, then data (Tables),
// screens (Pages), logic (Codeunits), and the rest.
const KIND_PRIORITY = ["Config", "Docs", "Table", "TableExt", "TableExtension", "Enum", "EnumExt", "EnumExtension",
  "Page", "PageExt", "PageExtension", "Codeunit", "Report", "Query", "XmlPort", "Interface", "ControlAddin"]

// ⚠ The big extensions are genuinely big — Evo-auction - Base alone is 7.5 MB
// across 1,113 files. A flat "include files until the budget runs out" left a
// guide for the MOST important extension written from ~5% of it.
//
// So: full text while it fits, then fall back to a CONDENSED form of the
// remaining code files (object header + procedure/trigger signatures) rather
// than dropping them. The reader wants what the screens and workflows are —
// which needs breadth of object names far more than every line of a codeunit.
const FULL_BUDGET      = 700_000   // characters of verbatim source
const CONDENSED_BUDGET = 250_000   // characters of signature-only summaries

function priorityOf(kind: string): number {
  const i = KIND_PRIORITY.findIndex(k => k.toLowerCase() === kind.toLowerCase())
  return i === -1 ? KIND_PRIORITY.length : i
}

// Object declaration + the procedures/triggers it exposes. Enough for the model
// to say "pressing X runs Y" and name it, without the whole implementation.
function condense(content: string): string {
  const keep: string[] = []
  for (const raw of content.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (/^(table|tableextension|page|pageextension|codeunit|report|query|xmlport|enum|enumextension|interface|controladdin|profile|permissionset\w*)\s/i.test(line)
      || /^(local\s+|internal\s+|protected\s+)?procedure\s/i.test(line)
      || /^trigger\s/i.test(line)
      || /^(Caption|ToolTip|SourceTable|ApplicationArea|Description)\s*=/i.test(line)
      || /^field\(/i.test(line)
      || /^action\(/i.test(line)) {
      keep.push(line)
    }
    if (keep.length > 400) break   // a single monster object shouldn't eat the budget
  }
  return keep.join("\n")
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

    const files = await prisma.bcSourceFile.findMany({
      where:  { extension: ext },
      select: { path: true, name: true, kind: true, content: true, size: true },
    })
    if (files.length === 0) return NextResponse.json({ error: "No source files stored for that extension" }, { status: 404 })

    // Pack files into the budget, most explanatory first: verbatim while there's
    // room, then signature-only, then genuinely omitted.
    const ordered = [...files].sort((a, b) => priorityOf(a.kind) - priorityOf(b.kind) || a.path.localeCompare(b.path))
    let used = 0, condensedUsed = 0
    const included: string[] = []
    const condensed: string[] = []
    let left = 0
    for (const f of ordered) {
      if (used + f.content.length <= FULL_BUDGET) {
        included.push(`===== FILE: ${f.path} =====\n${f.content}`)
        used += f.content.length
        continue
      }
      const summary = condense(f.content)
      if (summary && condensedUsed + summary.length <= CONDENSED_BUDGET) {
        condensed.push(`===== OUTLINE ONLY: ${f.path} =====\n${summary}`)
        condensedUsed += summary.length
      } else {
        left++
      }
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
${condensed.length > 0 ? `\nSOME FILES ARE OUTLINE ONLY: this extension is large, so ${condensed.length} file(s) appear below as "OUTLINE ONLY" — just their object declaration and procedure names. Use them to say WHAT exists and what it is for; do not describe their inner workings in detail, because you cannot see them.` : ""}${left > 0 ? `\nNOTE: ${left} further file(s) did not fit at all. Say at the end that the guide covers the main objects rather than every one.` : ""}

SOURCE CODE:

${included.join("\n\n")}${condensed.length > 0 ? `\n\n${condensed.join("\n\n")}` : ""}`

    // Runs on Gemini or Claude depending on Admin → AI Models. Claude Opus 5's
    // 1M-token window swallows even Evo-auction - Base comfortably.
    const model = await getToolModel("bc_source_guide", modelId)
    let content: string
    try {
      content = await generateAiText({ model, prompt, maxOutputTokens: 16384 })
    } catch (err) {
      if (err instanceof AiBlockedError) return NextResponse.json({ error: err.message }, { status: 422 })
      throw err
    }
    if (!content) return NextResponse.json({ error: "The model returned an empty guide — try again" }, { status: 500 })

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
