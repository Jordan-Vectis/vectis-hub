import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError } from "@/lib/ai-provider"
import { allowedHelpContext, helpContextText } from "@/lib/help-map"

export const maxDuration = 60

// POST /api/help/ask
// Body: { question: string, history?: { role: "user" | "model", text: string }[] }
// Returns: { answer: string, links: { name: string, href: string }[] }
//
// The top-bar Help box: "where do I go to do an overnight run?"
//
// ⚠⚠ PERMISSIONS ARE ENFORCED BY WHAT GOES IN, NOT BY WHAT THE MODEL IS TOLD.
// The context is built from `allowedHelpContext(role, apps, sections)` — someone without
// Accounts is never sent a word about Accounts, so no amount of prompt-ignoring or clever
// asking can produce it. Never relax that into "the prompt says not to mention it".
//
// ⚠ The answer's links are checked back against the allowed set before they are returned, so
// a hallucinated path can never become a clickable link to somewhere they cannot go.

const SYSTEM = `You are the Vectis Hub's help assistant. Staff at a toy and collectables auction
house ask you how to find things and what a screen is for.

The list you are given is EVERYTHING you may talk about. It is already filtered to what this
person is allowed to open.

Rules:
- Answer only from that list. If it is not there, say you cannot see a tool for that in their
  Hub and suggest they ask IT — never guess a page, a path or a button that is not listed.
- Be short. Name the screen the way it is named on the list, say what they will do when they get
  there, and stop. Two or three sentences is usually the whole answer.
- Give the route as the exact path from the list, so it can be linked.
- If two places could be meant, say which one does what and let them choose.
- British English. Never mention permissions, roles, or that anything has been filtered out —
  from where they are sitting, the list simply is the Hub.
- No preamble, no "great question", no bullet lists unless you are genuinely listing places.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { question, history } = await req.json() as {
      question?: string
      history?: { role: "user" | "model"; text: string }[]
    }
    if (!question?.trim()) return NextResponse.json({ error: "Ask a question first" }, { status: 400 })

    // ⚠ Read the permissions FRESH from the database, not from the session token — a JWT can be
    // hours old, and access someone has had removed must not still open the door here.
    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true, appPermissions: true },
    })
    if (!dbUser) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const ctx = allowedHelpContext(
      dbUser.role ?? "",
      (dbUser.allowedApps as string[] | null) ?? [],
      dbUser.appPermissions as Record<string, any> | null,
    )
    if (ctx.destinations.length === 0 && ctx.cards.length === 0) {
      return NextResponse.json({ answer: "You don't have any tools in your Hub yet — ask IT to give you access.", links: [] })
    }

    const model = await getToolModel("help_assistant")
    const answer = await generateAiText({
      model,
      system: SYSTEM,
      // The list is the same on every question this person asks, so it goes in the cached
      // block and only the question varies (see cachePrefix in lib/ai-provider.ts).
      cachePrefix: helpContextText(ctx),
      history: (history ?? []).slice(-6).map(h => ({ role: h.role, text: h.text })),
      prompt: question.trim(),
      maxOutputTokens: 600,
    })

    // ⚠ Only hand back links that are genuinely in this person's allowed set. The model is
    // asked for exact paths, but a made-up one must never become a clickable link, and a path
    // it copied from its own training must never point somewhere they cannot open.
    const allowed = [
      ...ctx.destinations.map(d => ({ name: d.name, href: d.href })),
      ...ctx.cards.map(c => ({ name: c.name, href: c.href })),
    ]
    const links = allowed.filter(l => answer.includes(l.href))
      // Longest path first, then de-duplicate by href, so "/tools/auction-ai?tab=pipeline"
      // wins over the bare "/tools/auction-ai" it contains.
      .sort((a, b) => b.href.length - a.href.length)
      .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i)
      .slice(0, 4)

    return NextResponse.json({ answer, links })
  } catch (e: any) {
    if (e instanceof AiBlockedError) {
      return NextResponse.json({ error: "The AI wouldn't answer that one. Try rewording it." }, { status: 422 })
    }
    console.error("help/ask error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
