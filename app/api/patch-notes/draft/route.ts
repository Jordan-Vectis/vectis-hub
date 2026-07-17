import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { getToolModel } from "@/lib/ai-models"

export const maxDuration = 60
export const dynamic = "force-dynamic"

// POST /api/patch-notes/draft
//
// Returns: { available: boolean, title?, body?, commitMessage?, sha?, reason? }
//
// Drafts a staff-facing patch note from the CURRENT DEPLOY'S commit message, which
// Railway injects as RAILWAY_GIT_COMMIT_MESSAGE. Gemini rewrites the developer wording
// into plain English for cataloguers. The admin edits it before pressing Push.
//
// ⚠ SCOPE — this sees exactly ONE commit, not the release.
// Railway injects only the current commit, and the app has no access to git history
// (no GitHub token, and the running image has no git). Pushing five commits at once
// means this describes the fifth and knows nothing of the other four. It is a starting
// point for the admin to edit, NOT an authoritative changelog. Widening it to a real
// range needs a GitHub token (deliberately not done — see the conversation on
// 2026-07-17), so don't "fix" the wording below to imply more coverage than it has.

// The commit message is developer-facing and often internal-only. Saying so plainly
// beats inventing a staff-facing benefit that doesn't exist.
const NOTHING_MARKER = "NOTHING_USER_FACING"

const PROMPT = (commitMessage: string) => `You are writing a short patch note for staff at Vectis, a UK auction house. They are cataloguers, warehouse and office staff — NOT developers. Use British English.

Below is the commit message for the version of the internal app (the "Hub") that has just been deployed. Rewrite it as a brief note telling staff what changed for them.

Rules:
- Only describe what a member of staff would NOTICE or DO differently.
- If the change is internal only — developer notes/memory, documentation, refactoring, tests, dependency bumps, build config — with nothing a staff member would ever see, reply with exactly ${NOTHING_MARKER} and nothing else.
- Do NOT invent changes. Only use what the commit message actually says. If it is vague, be vague rather than guessing specifics.
- Never mention commits, branches, migrations, code, file names, or model names.
- Keep it to at most 4 short bullets. Most commits need one.

Reply in EXACTLY this format and nothing else:
TITLE: <a short title, max 60 characters>
- <bullet>
- <bullet if needed>

COMMIT MESSAGE:
${commitMessage}`

export async function POST(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Railway sets these on a repo-connected service. Absent when running locally,
    // which is normal — say so rather than failing, so the editor just opens empty.
    const commitMessage = (process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? "").trim()
    const sha = (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim()
    if (!commitMessage) {
      return NextResponse.json({
        available: false,
        reason: "No deploy information available — RAILWAY_GIT_COMMIT_MESSAGE isn't set. That's expected when running locally; on Railway it means the service isn't linked to the GitHub repo.",
      })
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ available: false, reason: "GEMINI_API_KEY isn't configured, so the draft can't be written.", commitMessage, sha })
    }

    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: await getToolModel("patch_notes_draft"),
      generationConfig: { maxOutputTokens: 512 },
    })

    const result = await model.generateContent(PROMPT(commitMessage))
    const response = result.response

    // Check both before calling .text() — it throws on a blocked response and loses
    // the reason (RULES: Gemini Response Handling).
    if (response.promptFeedback?.blockReason) {
      return NextResponse.json({ error: `Gemini blocked: ${response.promptFeedback.blockReason}` }, { status: 422 })
    }
    const finishReason = response.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
      return NextResponse.json({ error: `Gemini stopped: ${finishReason}` }, { status: 422 })
    }

    const text = response.text().trim()

    if (text.includes(NOTHING_MARKER)) {
      return NextResponse.json({
        available: false,
        reason: "The latest deploy doesn't look like anything staff would notice — it reads as an internal change. Write the note yourself, or push a staff-facing change first.",
        commitMessage,
        sha,
      })
    }

    // Expected shape is "TITLE: x" then bullets. Parse leniently: a malformed reply
    // should still give the admin something to edit rather than an error.
    const lines = text.split("\n")
    const titleLine = lines.find((l) => /^TITLE:/i.test(l.trim()))
    const title = titleLine ? titleLine.replace(/^TITLE:/i, "").trim().slice(0, 120) : ""
    const body = lines
      .filter((l) => l !== titleLine)
      .join("\n")
      .trim()

    return NextResponse.json({
      available: true,
      title,
      // Fall back to the raw text ONLY when the format wasn't recognised at all — better
      // an odd draft than an empty box. When a TITLE line WAS found but there are no
      // bullets, leave the body empty: falling back here would echo "TITLE: …" into the
      // body box for the admin to delete by hand.
      body: body || (titleLine ? "" : text),
      commitMessage,
      sha,
    })
  } catch (e: any) {
    console.error("patch-notes/draft error:", e)
    return NextResponse.json({ error: e?.message ?? "Could not draft the patch note." }, { status: 500 })
  }
}
