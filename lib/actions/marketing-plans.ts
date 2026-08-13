"use server"

// Server actions behind Marketing Reports → Business Plan.
//
// ⚠ Every action RETURNS its error rather than throwing (RULES: a thrown server
// action is redacted to "An error occurred…" in a production build, so the user
// sees gibberish instead of the reason).

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { isGaConfigured, type GaRange } from "@/lib/ga"
import { PLAN_CHANNELS, PLAN_STATUSES } from "@/lib/marketing-plan"
import { buildPlanSnapshot } from "@/lib/marketing-plan-snapshot"

const PLAN_PATH = "/tools/marketing-reports/plan"

export type ActionResult = { ok: boolean; error?: string; id?: string }

async function requireUser() {
  const session = await auth()
  if (!session) throw new Error("Unauthorised")
  return session
}

function clean(v: string | null | undefined, max = 2000): string | null {
  const s = (v ?? "").trim()
  return s ? s.slice(0, max) : null
}

const VALID_RANGES: GaRange[] = ["7d", "28d", "90d", "365d"]
function asRange(v: string | null | undefined): GaRange {
  return (VALID_RANGES as string[]).includes(v ?? "") ? (v as GaRange) : "28d"
}
function asChannel(v: string | null | undefined): string {
  return PLAN_CHANNELS.some((c) => c.key === v) ? (v as string) : "other"
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export async function createMarketingPlan(input: {
  name: string
  periodLabel?: string
  range?: string
  excludeBots?: boolean
  ukOnly?: boolean
}): Promise<ActionResult> {
  try {
    const session = await requireUser()
    const name = clean(input.name, 120)
    if (!name) return { ok: false, error: "Give the plan a name." }

    const range = asRange(input.range)
    // A plan with no figures is still a usable document, so a GA failure must
    // not block creation — it just leaves "Where we are now" empty until the
    // user hits Refresh figures.
    let snapshot: any = null
    let snapshotAt: Date | null = null
    if (isGaConfigured()) {
      try {
        snapshot = await buildPlanSnapshot(range, !!input.excludeBots, !!input.ukOnly)
        snapshotAt = new Date()
      } catch { /* leave the snapshot empty — the page shows a Refresh button */ }
    }

    const plan = await prisma.marketingPlan.create({
      data: {
        name,
        periodLabel: clean(input.periodLabel, 80),
        rangeKey:    range,
        excludeBots: !!input.excludeBots,
        ukOnly:      !!input.ukOnly,
        snapshot,
        snapshotAt,
        createdBy:   session.user.name ?? session.user.email ?? null,
      },
    })
    revalidatePath(PLAN_PATH)
    return { ok: true, id: plan.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not create the plan" }
  }
}

export async function updateMarketingPlan(id: string, fields: {
  name?: string
  periodLabel?: string
  status?: string
  summary?: string
  audience?: string
  competitors?: string
}): Promise<ActionResult> {
  try {
    await requireUser()
    const data: Record<string, any> = {}
    if (fields.name !== undefined) {
      const n = clean(fields.name, 120)
      if (!n) return { ok: false, error: "The plan needs a name." }
      data.name = n
    }
    if (fields.periodLabel !== undefined) data.periodLabel = clean(fields.periodLabel, 80)
    if (fields.summary     !== undefined) data.summary     = clean(fields.summary, 8000)
    if (fields.audience    !== undefined) data.audience    = clean(fields.audience, 8000)
    if (fields.competitors !== undefined) data.competitors = clean(fields.competitors, 8000)
    if (fields.status      !== undefined) {
      if (!(PLAN_STATUSES as readonly string[]).includes(fields.status)) return { ok: false, error: "Unknown status" }
      data.status = fields.status
    }
    if (Object.keys(data).length === 0) return { ok: true }

    await prisma.marketingPlan.update({ where: { id }, data })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save the plan" }
  }
}

/** Re-read GA and freeze a fresh set of figures onto the plan. */
export async function refreshPlanSnapshot(id: string, opts?: {
  range?: string
  excludeBots?: boolean
  ukOnly?: boolean
}): Promise<ActionResult> {
  try {
    await requireUser()
    if (!isGaConfigured()) return { ok: false, error: "Google Analytics isn't connected on this environment." }

    const plan = await prisma.marketingPlan.findUnique({ where: { id } })
    if (!plan) return { ok: false, error: "Plan not found" }

    const range       = asRange(opts?.range ?? plan.rangeKey)
    const excludeBots = opts?.excludeBots ?? plan.excludeBots
    const ukOnly      = opts?.ukOnly ?? plan.ukOnly

    const snapshot = await buildPlanSnapshot(range, excludeBots, ukOnly)
    await prisma.marketingPlan.update({
      where: { id },
      data: { snapshot: snapshot as any, snapshotAt: new Date(), rangeKey: range, excludeBots, ukOnly },
    })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not read Google Analytics" }
  }
}

export async function deleteMarketingPlan(id: string): Promise<ActionResult> {
  try {
    const session = await requireUser()
    const plan = await prisma.marketingPlan.findUnique({ where: { id }, select: { createdBy: true } })
    if (!plan) return { ok: false, error: "Plan not found" }
    const me = session.user.name ?? session.user.email ?? ""
    if (session.user.role !== "ADMIN" && plan.createdBy && plan.createdBy !== me) {
      return { ok: false, error: `Only ${plan.createdBy} or an admin can delete this plan.` }
    }
    await prisma.marketingPlan.delete({ where: { id } })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete the plan" }
  }
}

// ─── Objectives ─────────────────────────────────────────────────────────────

export async function addPlanObjective(planId: string, fields: {
  title: string; metric?: string; baseline?: string; target?: string; dueBy?: string; notes?: string
}): Promise<ActionResult> {
  try {
    await requireUser()
    const title = clean(fields.title, 200)
    if (!title) return { ok: false, error: "Give the objective a title." }
    const last = await prisma.marketingPlanObjective.findFirst({ where: { planId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
    const row = await prisma.marketingPlanObjective.create({
      data: {
        planId, title,
        metric:   clean(fields.metric, 80),
        baseline: clean(fields.baseline, 80),
        target:   clean(fields.target, 80),
        dueBy:    clean(fields.dueBy, 80),
        notes:    clean(fields.notes, 2000),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    })
    revalidatePath(PLAN_PATH)
    return { ok: true, id: row.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not add the objective" }
  }
}

export async function updatePlanObjective(id: string, fields: {
  title?: string; metric?: string; baseline?: string; target?: string; dueBy?: string; notes?: string
}): Promise<ActionResult> {
  try {
    await requireUser()
    const data: Record<string, any> = {}
    if (fields.title !== undefined) {
      const t = clean(fields.title, 200)
      if (!t) return { ok: false, error: "The objective needs a title." }
      data.title = t
    }
    if (fields.metric   !== undefined) data.metric   = clean(fields.metric, 80)
    if (fields.baseline !== undefined) data.baseline = clean(fields.baseline, 80)
    if (fields.target   !== undefined) data.target   = clean(fields.target, 80)
    if (fields.dueBy    !== undefined) data.dueBy    = clean(fields.dueBy, 80)
    if (fields.notes    !== undefined) data.notes    = clean(fields.notes, 2000)
    if (Object.keys(data).length === 0) return { ok: true }
    await prisma.marketingPlanObjective.update({ where: { id }, data })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save the objective" }
  }
}

export async function deletePlanObjective(id: string): Promise<ActionResult> {
  try {
    await requireUser()
    await prisma.marketingPlanObjective.delete({ where: { id } })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete the objective" }
  }
}

// ─── Actions (the things we're going to do) ─────────────────────────────────

export async function addPlanAction(planId: string, fields: {
  channel?: string; title: string; detail?: string; owner?: string; dueBy?: string; effort?: string; impact?: string
}): Promise<ActionResult> {
  try {
    await requireUser()
    const title = clean(fields.title, 200)
    if (!title) return { ok: false, error: "Give the action a title." }
    const last = await prisma.marketingPlanAction.findFirst({ where: { planId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
    const row = await prisma.marketingPlanAction.create({
      data: {
        planId, title,
        channel: asChannel(fields.channel),
        detail:  clean(fields.detail, 2000),
        owner:   clean(fields.owner, 80),
        dueBy:   clean(fields.dueBy, 80),
        effort:  clean(fields.effort, 20),
        impact:  clean(fields.impact, 20),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    })
    revalidatePath(PLAN_PATH)
    return { ok: true, id: row.id }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not add the action" }
  }
}

export async function updatePlanAction(id: string, fields: {
  channel?: string; title?: string; detail?: string; owner?: string; dueBy?: string
  effort?: string; impact?: string; status?: string
}): Promise<ActionResult> {
  try {
    await requireUser()
    const data: Record<string, any> = {}
    if (fields.title !== undefined) {
      const t = clean(fields.title, 200)
      if (!t) return { ok: false, error: "The action needs a title." }
      data.title = t
    }
    if (fields.channel !== undefined) data.channel = asChannel(fields.channel)
    if (fields.detail  !== undefined) data.detail  = clean(fields.detail, 2000)
    if (fields.owner   !== undefined) data.owner   = clean(fields.owner, 80)
    if (fields.dueBy   !== undefined) data.dueBy   = clean(fields.dueBy, 80)
    if (fields.effort  !== undefined) data.effort  = clean(fields.effort, 20)
    if (fields.impact  !== undefined) data.impact  = clean(fields.impact, 20)
    if (fields.status  !== undefined) {
      if (!["TODO", "DOING", "DONE"].includes(fields.status)) return { ok: false, error: "Unknown status" }
      data.status = fields.status
    }
    if (Object.keys(data).length === 0) return { ok: true }
    await prisma.marketingPlanAction.update({ where: { id }, data })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save the action" }
  }
}

export async function deletePlanAction(id: string): Promise<ActionResult> {
  try {
    await requireUser()
    await prisma.marketingPlanAction.delete({ where: { id } })
    revalidatePath(PLAN_PATH)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete the action" }
  }
}

// ─── Adding AI suggestions ──────────────────────────────────────────────────
// The user ticks which suggestions to keep; only the ticked ones land here, and
// they are stamped source:"ai" so the plan always shows where a line came from.

export async function addPlanSuggestions(planId: string, picks: {
  objectives?: { title: string; metric?: string; baseline?: string; target?: string; notes?: string }[]
  actions?: { channel?: string; title: string; detail?: string; effort?: string; impact?: string }[]
  audience?: string
  summary?: string
}): Promise<ActionResult & { added?: number }> {
  try {
    await requireUser()
    const objectives = (picks.objectives ?? []).filter((o) => clean(o.title, 200))
    const actions    = (picks.actions ?? []).filter((a) => clean(a.title, 200))
    const wantsText  = !!clean(picks.audience ?? "", 8000) || !!clean(picks.summary ?? "", 8000)
    if (objectives.length === 0 && actions.length === 0 && !wantsText) {
      return { ok: false, error: "Nothing was ticked — pick at least one suggestion first." }
    }

    const [lastObj, lastAct] = await Promise.all([
      prisma.marketingPlanObjective.findFirst({ where: { planId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }),
      prisma.marketingPlanAction.findFirst({ where: { planId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }),
    ])
    let objAt = (lastObj?.sortOrder ?? -1) + 1
    let actAt = (lastAct?.sortOrder ?? -1) + 1

    const writes: any[] = []
    for (const o of objectives) {
      writes.push(prisma.marketingPlanObjective.create({
        data: {
          planId, source: "ai", sortOrder: objAt++,
          title:    clean(o.title, 200)!,
          metric:   clean(o.metric, 80),
          baseline: clean(o.baseline, 80),
          target:   clean(o.target, 80),
          notes:    clean(o.notes, 2000),
        },
      }))
    }
    for (const a of actions) {
      writes.push(prisma.marketingPlanAction.create({
        data: {
          planId, source: "ai", sortOrder: actAt++,
          channel: asChannel(a.channel),
          title:   clean(a.title, 200)!,
          detail:  clean(a.detail, 2000),
          effort:  clean(a.effort, 20),
          impact:  clean(a.impact, 20),
        },
      }))
    }
    // Free text is APPENDED, never overwritten — a suggestion must not wipe
    // something the user typed themselves.
    if (wantsText) {
      const plan = await prisma.marketingPlan.findUnique({ where: { id: planId }, select: { audience: true, summary: true } })
      const join = (existing: string | null, addition: string | null) =>
        !addition ? existing : existing ? `${existing}\n\n${addition}` : addition
      const data: Record<string, any> = {}
      const aud = clean(picks.audience ?? "", 8000)
      const sum = clean(picks.summary ?? "", 8000)
      if (aud) data.audience = join(plan?.audience ?? null, aud)
      if (sum) data.summary  = join(plan?.summary ?? null, sum)
      if (Object.keys(data).length) writes.push(prisma.marketingPlan.update({ where: { id: planId }, data }))
    }

    await prisma.$transaction(writes)
    revalidatePath(PLAN_PATH)
    return { ok: true, added: objectives.length + actions.length }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not add the suggestions" }
  }
}
