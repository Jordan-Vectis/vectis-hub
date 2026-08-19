import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { fillBrief } from "@/lib/training"
import { pickSubject, markAnswer } from "@/lib/training-check"

export const dynamic = "force-dynamic"

// IT & Admin → Training → practice.
//
// GET  ?id=…  — hand out one task, with a REAL example chosen from the live data
// POST        — mark an answer against that same example and record the pass
//
// Open to any signed-in user: the courses are how somebody learns a panel, and putting a
// permission in front of the training for a tool is how people end up never being trained.
// Nothing here returns anything the Admin Centre would not show, and nothing here writes to
// any table but TrainingProgress.

// ─── GET — materialise a task ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const id = (new URL(req.url).searchParams.get("id") ?? "").trim()
    if (!id) return NextResponse.json({ error: "Which task?" }, { status: 400 })

    const ex = await prisma.trainingExercise.findUnique({
      where:  { id },
      select: { id: true, title: true, brief: true, panel: true, kind: true, params: true, hint: true, active: true },
    })
    if (!ex || !ex.active) return NextResponse.json({ error: "That task is no longer set" }, { status: 404 })

    const picked = await pickSubject(ex.kind, ex.params)

    // ⚠ Say so plainly. A live task on an environment with no matching data would otherwise
    // render as a question about nothing, and the trainee would assume they were wrong rather
    // than that there was nothing to find (RULES.md: never let "nothing happened" look like
    // success). Staging in particular has very little in it.
    if (!picked && ex.kind !== "CHOICE" && ex.kind !== "FREE_TEXT") {
      return NextResponse.json({
        id: ex.id, title: ex.title, kind: ex.kind, panel: ex.panel,
        brief: ex.brief, hint: ex.hint, subject: null,
        unavailable: "There is no lot in this environment that fits this task yet, so it cannot be set. Try it on the live system.",
      })
    }

    const subject = picked?.subject ?? ""
    return NextResponse.json({
      id:      ex.id,
      title:   ex.title,
      kind:    ex.kind,
      panel:   ex.panel,
      brief:   fillBrief(ex.brief, picked?.display ?? ""),
      hint:    ex.hint,
      subject,
      // CHOICE ships its options; everything else has no answer on the client, deliberately.
      options: ex.kind === "CHOICE" ? optionsOf(ex.params) : undefined,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not set that task" }, { status: 500 })
  }
}

function optionsOf(params: unknown): string[] {
  if (!params || typeof params !== "object") return []
  const o = (params as Record<string, unknown>).options
  return Array.isArray(o) ? o.filter((v): v is string => typeof v === "string") : []
}

// ─── POST — mark it ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await getEffectiveSession()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body    = await req.json().catch(() => ({}))
    const id      = String(body.id ?? "").trim()
    const subject = String(body.subject ?? "").trim()
    const answer  = String(body.answer ?? "").trim()
    if (!id)     return NextResponse.json({ error: "Which task?" }, { status: 400 })
    if (!answer) return NextResponse.json({ error: "Put an answer in first" }, { status: 400 })

    const ex = await prisma.trainingExercise.findUnique({
      where:  { id },
      select: { id: true, moduleId: true, kind: true, params: true, explain: true },
    })
    if (!ex) return NextResponse.json({ error: "That task is no longer set" }, { status: 404 })

    const marked = await markAnswer(ex.kind, subject, ex.params, answer)

    // Progress is best-effort. Getting the answer right and then seeing an error because the
    // progress row would not write is a worse experience than a tick that is not recorded.
    let progress: { passed: number; total: number; completed: boolean } | null = null
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: session.user.id }, select: { name: true, email: true },
      })
      const name = dbUser?.name || dbUser?.email || "Unknown"
      const total = await prisma.trainingExercise.count({ where: { moduleId: ex.moduleId, active: true } })

      const existing = await prisma.trainingProgress.findUnique({
        where:  { userId_moduleId: { userId: session.user.id, moduleId: ex.moduleId } },
        select: { passedIds: true, attempts: true, completedAt: true },
      })
      const passedIds = new Set(existing?.passedIds ?? [])
      if (marked.correct) passedIds.add(ex.id)
      const done = total > 0 && passedIds.size >= total
      const now  = new Date()

      await prisma.trainingProgress.upsert({
        where:  { userId_moduleId: { userId: session.user.id, moduleId: ex.moduleId } },
        create: {
          userId: session.user.id, moduleId: ex.moduleId, userName: name,
          passedIds: [...passedIds], attempts: 1, lastAt: now,
          completedAt: done ? now : null,
        },
        update: {
          userName: name, passedIds: [...passedIds], attempts: (existing?.attempts ?? 0) + 1, lastAt: now,
          // Never un-complete somebody. Deactivating a task later would otherwise strip a tick
          // off a person who genuinely did the course as it stood.
          completedAt: existing?.completedAt ?? (done ? now : null),
        },
      })
      progress = { passed: passedIds.size, total, completed: done || !!existing?.completedAt }
    } catch { /* leave progress null — the answer still gets marked */ }

    return NextResponse.json({
      correct:     marked.correct,
      answer:      marked.answer,
      detail:      marked.detail ?? null,
      unavailable: marked.unavailable ?? false,
      explain:     ex.explain,
      progress,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Could not mark that" }, { status: 500 })
  }
}
