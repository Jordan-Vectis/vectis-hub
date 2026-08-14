import { NextRequest, NextResponse } from "next/server"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess } from "@/lib/apps"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { REWRITE_SYSTEM } from "@/lib/induction-ai"

export const maxDuration = 120
export const runtime = "nodejs"

// POST /api/induction/ai/rewrite  { slideId }
// Rewrites ONE induction slide and, in the same pass, says what was wrong with the original —
// factually, legally or in plain readability. ⚠ It never writes to the slide: the answer comes
// back for a human to accept or throw away, the same manual gate the Auto Pipeline's Double
// Check stage uses. An AI silently editing the company's legal H&S record would be indefensible.
export async function POST(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, allowedApps: true } })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { slideId, model: clientModel } = await req.json().catch(() => ({}))
    if (!slideId) return NextResponse.json({ error: "No slide given" }, { status: 400 })

    // ⚠ Explicit select, never a bare findUnique. A bare one selects EVERY column, including
    // any added by a deploy whose SQL has not been applied yet — which is how this route died
    // with "the column InductionSlide.layout does not exist". Same trap RULES.md documents for
    // the login query on the User table. It needs five fields; ask for five fields.
    const slide = await prisma.inductionSlide.findUnique({
      where: { id: String(slideId) },
      select: { title: true, subtitle: true, body: true, liveBlock: true, videoUrl: true },
    })
    if (!slide) return NextResponse.json({ error: "That slide no longer exists" }, { status: 404 })

    const model = await getToolModel("induction_rewrite", clientModel)

    const prompt = [
      "Here is the slide as it stands.",
      `TITLE: ${slide.title}`,
      slide.subtitle ? `SUBTITLE: ${slide.subtitle}` : "SUBTITLE: (none)",
      "BODY:",
      slide.body || "(no body text)",
      slide.liveBlock && slide.liveBlock !== "NONE"
        ? `\nNote: this slide also displays live company data (${slide.liveBlock.toLowerCase().replace(/_/g, " ")}) underneath the text, pulled from the records automatically. Do not write that list into the body.`
        : "",
      slide.videoUrl ? `\nNote: this slide plays a video, so the text only needs to introduce it.` : "",
    ].filter(Boolean).join("\n")

    const raw = await generateAiText({
      model,
      // The standard is identical on every call, so it is the thing worth caching.
      system: REWRITE_SYSTEM,
      prompt,
      json: true,
      maxOutputTokens: 4000,
    })

    let parsed: any
    try { parsed = JSON.parse(raw) } catch {
      return NextResponse.json({ error: "The AI did not return usable JSON — try again." }, { status: 502 })
    }

    return NextResponse.json({
      model,
      title:    typeof parsed.title === "string" ? parsed.title : slide.title,
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "",
      body:     typeof parsed.body === "string" ? parsed.body : "",
      changed:  parsed.changed !== false,
      issues:   Array.isArray(parsed.issues) ? parsed.issues.slice(0, 20) : [],
    })
  } catch (e: any) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
    if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
    console.error("induction/ai/rewrite error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
