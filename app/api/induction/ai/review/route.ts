import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { REVIEW_SYSTEM, describeDeck, parseAiJson, STRICTER_JSON } from "@/lib/induction-ai"

export const maxDuration = 300
export const runtime = "nodejs"

// POST /api/induction/ai/review
// Reads the WHOLE deck and reports what is wrong and what is missing. Advisory only — it
// writes nothing, and the UI carries a standing "not legal advice" line. Same stance as the
// accident book, which is deliberately not claimed to be certified (RULES.md).
export async function POST(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { model: clientModel } = await req.json().catch(() => ({}))

    const slides = await prisma.inductionSlide.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { title: true, subtitle: true, body: true, liveBlock: true, videoUrl: true },
    })
    if (slides.length === 0) return NextResponse.json({ error: "There are no slides to review." }, { status: 400 })

    // The forms go in too — what someone signs is part of the induction, and a tick list that
    // claims something was covered when no slide covers it is exactly the kind of gap worth
    // catching.
    const forms = await prisma.inductionForm.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }],
      include: { items: { orderBy: { sortOrder: "asc" } } },
    })

    const model = await getToolModel("induction_review", clientModel)

    const deck = describeDeck(slides)
    const formText = forms.map(f =>
      [`FORM: ${f.title}`, f.intro, f.body, f.declaration ? `Declaration: ${f.declaration}` : "",
       "They must confirm:", ...f.items.map(i => `- ${i.label}`)].filter(Boolean).join("\n")
    ).join("\n\n---\n\n")

    const promptText = [
        "THE INDUCTION SLIDES, in the order they are presented:",
        deck,
        "",
        "THE FORMS THE NEW STARTER READS AND SIGNS AFTERWARDS:",
        formText || "(none)",
        "",
      "Review the whole thing and reply with the JSON described.",
    ].join("\n")

    const raw = await generateAiText({ model, system: REVIEW_SYSTEM, prompt: promptText, json: true, maxOutputTokens: 8000 })
    let parsed = parseAiJson(raw)
    if (!parsed) {
      const retry = await generateAiText({
        model, system: REVIEW_SYSTEM, prompt: `${promptText}\n\n${STRICTER_JSON}`, json: true, maxOutputTokens: 8000,
      })
      parsed = parseAiJson(retry)
    }
    if (!parsed) {
      return NextResponse.json({ error: "The AI's answer could not be read, twice. Try again." }, { status: 502 })
    }

    return NextResponse.json({
      model,
      slideCount: slides.length,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      issues:  Array.isArray(parsed.issues)  ? parsed.issues.slice(0, 40)  : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 40) : [],
    })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    console.error("induction/ai/review error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
