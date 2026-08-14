// Server-side loader for the induction deck. Shared by the tool page and the presenter so
// both show exactly the same slides and the same live First Aid data.
//
// Every read is wrapped: the tables arrive after the deploy that reads them, and an empty
// deck beats a 500 in front of a room of new starters.

import { prisma } from "@/lib/prisma"

export type DeckSlide = {
  id: string
  title: string
  subtitle: string | null
  body: string | null
  imageKey: string | null
  videoUrl: string | null
  liveBlock: string
  layout: string
  notes: string | null
  sortOrder: number
  active: boolean
}

export type LiveData = {
  aiders: { id: string; name: string; roleTitle: string | null; location: string | null; phone: string | null; photoKey: string | null }[]
  kits:   { id: string; kind: string; label: string; whereText: string | null; planId: string | null; pinX: number | null; pinY: number | null }[]
  plan:   { id: string; name: string; imageKey: string } | null
}

// Everything except `layout`, which arrived after the table did.
const BASE_SELECT = {
  id: true, title: true, subtitle: true, body: true, imageKey: true,
  videoUrl: true, liveBlock: true, notes: true, sortOrder: true, active: true,
} as const

export async function loadInductionSlides(opts: { activeOnly?: boolean } = {}): Promise<DeckSlide[]> {
  const where   = opts.activeOnly ? { active: true } : undefined
  const orderBy = [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }]
  try {
    const rows = await prisma.inductionSlide.findMany({ where, orderBy, select: { ...BASE_SELECT, layout: true } })
    return rows.map(r => ({ ...r, layout: r.layout }))
  } catch {
    // ⚠ Code reaches Railway the moment it is pushed; the SQL is applied separately. Without
    // this, the deploy that added `layout` would make the whole deck disappear until the
    // migration ran — and "there are no slides to show" in front of a room is not a fallback.
    try {
      const rows = await prisma.inductionSlide.findMany({ where, orderBy, select: BASE_SELECT })
      return rows.map(r => ({ ...r, layout: "CONTENT" }))
    } catch { return [] }
  }
}

/**
 * The First Aid records the slides render instead of retyping. Only ACTIVE rows — a first
 * aider marked inactive has left or let their certificate lapse, and showing them on an
 * induction slide is exactly the failure the PowerPoint had.
 */
export async function loadInductionLiveData(): Promise<LiveData> {
  try {
    const [aiders, kits, plan] = await Promise.all([
      prisma.firstAider.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.firstAidKit.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
      prisma.sitePlan.findFirst({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    ])
    return {
      aiders: aiders.map(a => ({ id: a.id, name: a.name, roleTitle: a.roleTitle, location: a.location, phone: a.phone, photoKey: a.photoKey })),
      kits:   kits.map(k => ({ id: k.id, kind: k.kind, label: k.label, whereText: k.whereText, planId: k.planId, pinX: k.pinX, pinY: k.pinY })),
      plan:   plan ? { id: plan.id, name: plan.name, imageKey: plan.imageKey } : null,
    }
  } catch { return { aiders: [], kits: [], plan: null } }
}
