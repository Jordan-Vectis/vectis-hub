// Server-side loaders for IT & Admin → Training. Shared by the course list, the module page
// and the presenter so all three show exactly the same content.
//
// ⚠ Every read is wrapped. The tables arrive when someone presses Run Migrations, which is
// after the deploy that reads them — an empty course list beats a 500 on the Hub.

import { prisma } from "@/lib/prisma"

export type TrainingModuleRow = {
  id: string
  key: string
  title: string
  icon: string
  blurb: string | null
  href: string | null
  appKey: string | null
  accent: string
  sortOrder: number
  active: boolean
  slideCount: number
  exerciseCount: number
}

export type TrainingSlideRow = {
  id: string
  title: string
  subtitle: string | null
  body: string | null
  imageKey: string | null
  videoUrl: string | null
  layout: string
  graphic: string
  tryHref: string | null
  tryLabel: string | null
  notes: string | null
  sortOrder: number
  active: boolean
}

export type TrainingExerciseRow = {
  id: string
  title: string
  brief: string
  panel: string | null
  kind: string
  params: unknown
  expected: string | null
  hint: string | null
  explain: string | null
  sortOrder: number
  active: boolean
}

export type TrainingProgressRow = {
  moduleId: string
  slidesSeen: number
  deckDoneAt: string | null
  passedIds: string[]
  completedAt: string | null
}

const MODULE_SELECT = {
  id: true, key: true, title: true, icon: true, blurb: true, href: true,
  appKey: true, accent: true, sortOrder: true, active: true,
} as const

export async function loadTrainingModules(opts: { activeOnly?: boolean } = {}): Promise<TrainingModuleRow[]> {
  try {
    const rows = await prisma.trainingModule.findMany({
      where:   opts.activeOnly ? { active: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      select:  {
        ...MODULE_SELECT,
        // Counted rather than loaded — the list needs "12 slides", not the slides.
        _count: { select: { slides: true, exercises: true } },
      },
    })
    return rows.map(r => ({
      id: r.id, key: r.key, title: r.title, icon: r.icon, blurb: r.blurb, href: r.href,
      appKey: r.appKey, accent: r.accent, sortOrder: r.sortOrder, active: r.active,
      slideCount: r._count.slides, exerciseCount: r._count.exercises,
    }))
  } catch { return [] }
}

export async function loadTrainingModule(key: string): Promise<TrainingModuleRow | null> {
  try {
    const r = await prisma.trainingModule.findUnique({
      where:  { key },
      select: { ...MODULE_SELECT, _count: { select: { slides: true, exercises: true } } },
    })
    if (!r) return null
    return {
      id: r.id, key: r.key, title: r.title, icon: r.icon, blurb: r.blurb, href: r.href,
      appKey: r.appKey, accent: r.accent, sortOrder: r.sortOrder, active: r.active,
      slideCount: r._count.slides, exerciseCount: r._count.exercises,
    }
  } catch { return null }
}

export async function loadTrainingSlides(
  moduleId: string, opts: { activeOnly?: boolean } = {},
): Promise<TrainingSlideRow[]> {
  try {
    return await prisma.trainingSlide.findMany({
      where:   { moduleId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, title: true, subtitle: true, body: true, imageKey: true, videoUrl: true,
        layout: true, graphic: true, tryHref: true, tryLabel: true, notes: true,
        sortOrder: true, active: true,
      },
    })
  } catch { return [] }
}

export async function loadTrainingExercises(
  moduleId: string, opts: { activeOnly?: boolean } = {},
): Promise<TrainingExerciseRow[]> {
  try {
    return await prisma.trainingExercise.findMany({
      where:   { moduleId, ...(opts.activeOnly ? { active: true } : {}) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true, title: true, brief: true, panel: true, kind: true, params: true,
        expected: true, hint: true, explain: true, sortOrder: true, active: true,
      },
    })
  } catch { return [] }
}

/** Everything this person has done, for the ticks on the course list. */
export async function loadMyTrainingProgress(userId: string): Promise<TrainingProgressRow[]> {
  try {
    const rows = await prisma.trainingProgress.findMany({
      where:  { userId },
      select: { moduleId: true, slidesSeen: true, deckDoneAt: true, passedIds: true, completedAt: true },
    })
    return rows.map(r => ({
      moduleId: r.moduleId, slidesSeen: r.slidesSeen, passedIds: r.passedIds,
      deckDoneAt:  r.deckDoneAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    }))
  } catch { return [] }
}

/**
 * Who has finished what, for the admin view. ⚠ Not a performance metric — it answers
 * "has this person been shown this yet", which is a management question, not a league table.
 */
export async function loadTrainingProgressForModule(moduleId: string) {
  try {
    return await prisma.trainingProgress.findMany({
      where:   { moduleId },
      orderBy: [{ completedAt: "desc" }, { lastAt: "desc" }],
      take:    500,
      select:  { userId: true, userName: true, slidesSeen: true, passedIds: true, completedAt: true, lastAt: true },
    })
  } catch { return [] }
}
