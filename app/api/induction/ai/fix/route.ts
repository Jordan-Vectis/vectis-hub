import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { FIX_SYSTEM } from "@/lib/induction-ai"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/induction/ai/fix  { slideTitle, issues: [{ what, fix }] }
// Rewrites ONE slide to resolve findings the whole-deck review already reported. Returns the
// corrected text; the write goes through the applyInductionSlideText server action, so the
// permission check and the "AI can only touch title/subtitle/body" rule still apply.
//
// ⚠ Matched on the slide TITLE, because that is all the review returns. Duplicate titles are
// legitimate in this deck — "Legal responsibilities" appears twice — so an ambiguous match is
// refused rather than guessed at. Fixing the wrong slide silently would be worse than not
// fixing it.
export async function POST(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { slideTitle, issues, model: clientModel } = await req.json().catch(() => ({}))
    const title = String(slideTitle ?? "").trim()
    if (!title) return NextResponse.json({ error: "No slide given" }, { status: 400 })
    const list = Array.isArray(issues) ? issues.filter(Boolean).slice(0, 12) : []
    if (list.length === 0) return NextResponse.json({ error: "No issues given to fix" }, { status: 400 })

    const matches = await prisma.inductionSlide.findMany({
      where: { title },
      select: { id: true, title: true, subtitle: true, body: true, liveBlock: true, videoUrl: true },
    })
    if (matches.length === 0) {
      return NextResponse.json({ error: `No slide is called “${title}” — it may have been renamed since the review ran.` }, { status: 404 })
    }
    if (matches.length > 1) {
      return NextResponse.json({
        error: `More than one slide is called “${title}”, so this fix cannot be applied automatically — open that slide and use Rewrite & check on it.`,
      }, { status: 409 })
    }
    const slide = matches[0]

    const model = await getToolModel("induction_rewrite", clientModel)

    const prompt = [
      "THE SLIDE AS IT STANDS",
      `TITLE: ${slide.title}`,
      slide.subtitle ? `SUBTITLE: ${slide.subtitle}` : "SUBTITLE: (none)",
      "BODY:",
      slide.body || "(no body text)",
      slide.liveBlock && slide.liveBlock !== "NONE"
        ? `\nNote: this slide also displays live company data (${slide.liveBlock.toLowerCase().replace(/_/g, " ")}) underneath the text. Do not write that list into the body.`
        : "",
      "",
      "THE ISSUES TO RESOLVE",
      ...list.map((it: any, i: number) => `${i + 1}. ${String(it?.what ?? "").trim()}\n   Suggested fix: ${String(it?.fix ?? "").trim()}`),
    ].filter(Boolean).join("\n")

    const raw = await generateAiText({ model, system: FIX_SYSTEM, prompt, json: true, maxOutputTokens: 4000 })

    let parsed: any
    try { parsed = JSON.parse(raw) } catch {
      return NextResponse.json({ error: "The AI did not return usable JSON — try again." }, { status: 502 })
    }

    return NextResponse.json({
      slideId:  slide.id,
      model,
      title:    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : slide.title,
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : (slide.subtitle ?? ""),
      body:     typeof parsed.body === "string" ? parsed.body : (slide.body ?? ""),
      resolved: Array.isArray(parsed.resolved) ? parsed.resolved.map(String) : [],
      notes:    typeof parsed.notes === "string" ? parsed.notes : "",
      before:   { title: slide.title, subtitle: slide.subtitle ?? "", body: slide.body ?? "" },
    })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    console.error("induction/ai/fix error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
