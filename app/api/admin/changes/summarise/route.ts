import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getToolModel } from "@/lib/ai-models"
import { generateAiText, AiBlockedError, AiNotConfiguredError } from "@/lib/ai-provider"
import { listChanges, changesToText } from "@/lib/changelog"

export const maxDuration = 120

// POST /api/admin/changes/summarise
// Body: { from: ISO, to: ISO, audience?: string, modelId?: string }
// Turns a window of the development record into a report a manager can read.

const SYSTEM = `You are writing a progress report about the Vectis Hub — the internal web app used by staff at Vectis Auctions, a UK toy and collectables auction house. The reader is a MANAGER or a director. They are not technical, they did not ask for any of these changes personally, and they want to know what the business got.

You are given the list of changes that went into the app over a period, one per line, taken from the development record.

RULES
- British English throughout.
- Write for someone who has never seen the code. Never mention commits, branches, files, functions, databases, migrations, deploys or model names.
- GROUP the work by what it is FOR (e.g. cataloguing, photography, the warehouse, marketing, health & safety), not by date and not by who did it.
- Lead each group with what it means in practice — what someone can now do, or no longer has to do. The change itself is the supporting detail.
- Lines marked [internal] are housekeeping — notes, documentation, tidying. Do NOT give them their own section. Mention them only as a single closing line about upkeep, if at all.
- Be honest about the mix: fixes are as worth reporting as new features, and a period that was mostly fixing should read that way.
- Do NOT invent benefits, figures, time savings or costs. If the record does not say it, do not claim it. No "significantly improved efficiency" unless a line actually says so.
- Do not editorialise about how hard the work was or how much there is of it.

FORMAT — plain text, no markdown symbols, ready to paste into an email:
Open with two or three sentences summarising the period overall.
Then each area as:

AREA NAME
- what changed, in a sentence a manager would understand
- another, if there is one

Close with one short line on anything still outstanding or worth knowing, only if the record supports it.
Aim for something that reads in two minutes.`

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const from = new Date(body?.from)
    const to   = new Date(body?.to)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: "Pick a period first" }, { status: 400 })
    }

    const rows = await listChanges(from, to)
    if (rows.length === 0) {
      return NextResponse.json({ error: "There are no recorded changes in that period." }, { status: 400 })
    }

    const audience = String(body?.audience ?? "").trim().slice(0, 300)
    const model = await getToolModel("changes_summary", body?.modelId)

    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    const prompt = `PERIOD: ${fmt(from)} to ${fmt(to)} — ${rows.length} changes recorded.
${audience ? `\nThe reader: ${audience}\n` : ""}
THE RECORD
${changesToText(rows)}

Write the report now.`

    let text: string
    try {
      text = await generateAiText({ model, system: SYSTEM, prompt, maxOutputTokens: 8192 })
    } catch (e: any) {
      if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 500 })
      if (e instanceof AiBlockedError) return NextResponse.json({ error: e.message }, { status: 422 })
      throw e
    }

    if (!text.trim()) return NextResponse.json({ error: "The AI came back empty — try again." }, { status: 502 })

    return NextResponse.json({ body: text.trim(), model, changeCount: rows.length })
  } catch (e: any) {
    console.error("changes/summarise error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
