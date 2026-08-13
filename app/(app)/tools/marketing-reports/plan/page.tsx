import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { isGaConfigured } from "@/lib/ga"
import { asSnapshot } from "@/lib/marketing-plan"
import MarketingTabs from "../tabs"
import PlanWorkspace from "./plan-workspace"

export const dynamic = "force-dynamic"
export const metadata = { title: "Marketing Business Plan" }

// Marketing Reports → Business Plan.
// A saved plan per period: the analytics figures frozen at the top, objectives
// with targets, a channel-by-channel action list, audience and competitor
// notes — then 🖨 the whole thing as a PDF.

export default async function MarketingPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const sp = await searchParams
  const plans = await prisma.marketingPlan.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, periodLabel: true, status: true, updatedAt: true },
  })

  const activeId = plans.find((p) => p.id === sp.id)?.id ?? plans[0]?.id ?? null
  const active = activeId
    ? await prisma.marketingPlan.findUnique({
        where: { id: activeId },
        include: {
          objectives: { orderBy: { sortOrder: "asc" } },
          actions:    { orderBy: { sortOrder: "asc" } },
        },
      })
    : null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <MarketingTabs active="plan" />

      <div className="mb-5">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Marketing Business Plan</h1>
        <p className="text-base text-gray-500 mt-1">
          Build a plan from the website&apos;s analytics — suggested objectives and actions you can edit, add to, and print as a PDF.
        </p>
      </div>

      <PlanWorkspace
        gaConfigured={isGaConfigured()}
        plans={plans.map((p) => ({
          id: p.id, name: p.name, periodLabel: p.periodLabel, status: p.status,
          updatedAt: p.updatedAt.toISOString(),
        }))}
        plan={
          active
            ? {
                id:          active.id,
                name:        active.name,
                periodLabel: active.periodLabel,
                status:      active.status,
                rangeKey:    active.rangeKey,
                ukOnly:      active.ukOnly,
                excludeBots: active.excludeBots,
                summary:     active.summary,
                audience:    active.audience,
                competitors: active.competitors,
                createdBy:   active.createdBy,
                snapshot:    asSnapshot(active.snapshot),
                snapshotAt:  active.snapshotAt ? active.snapshotAt.toISOString() : null,
                objectives:  active.objectives.map((o) => ({
                  id: o.id, title: o.title, metric: o.metric, baseline: o.baseline,
                  target: o.target, dueBy: o.dueBy, notes: o.notes, source: o.source,
                })),
                actions: active.actions.map((a) => ({
                  id: a.id, channel: a.channel, title: a.title, detail: a.detail, owner: a.owner,
                  dueBy: a.dueBy, effort: a.effort, impact: a.impact, status: a.status, source: a.source,
                })),
              }
            : null
        }
      />
    </div>
  )
}
