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

export async function loadInductionSlides(opts: { activeOnly?: boolean } = {}): Promise<DeckSlide[]> {
  try {
    const rows = await prisma.inductionSlide.findMany({
      where: opts.activeOnly ? { active: true } : undefined,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    return rows.map(r => ({
      id: r.id, title: r.title, subtitle: r.subtitle, body: r.body, imageKey: r.imageKey,
      videoUrl: r.videoUrl, liveBlock: r.liveBlock, layout: r.layout, notes: r.notes, sortOrder: r.sortOrder, active: r.active,
    }))
  } catch { return [] }
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
