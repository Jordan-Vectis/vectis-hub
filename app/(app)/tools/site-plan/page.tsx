import Link from "next/link"
import { prisma } from "@/lib/prisma"
import SitePlanClient from "./site-plan-client"

export const dynamic = "force-dynamic"

// Migration-safe: the table is newer than the deploy that reads it.
async function load() {
  try {
    const [plans, kits] = await Promise.all([
      prisma.sitePlan.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.firstAidKit.findMany({ where: { planId: { not: null } }, select: { id: true, kind: true, label: true, planId: true, pinX: true, pinY: true } }),
    ])
    return { plans, kits }
  } catch {
    return { plans: [], kits: [] }
  }
}

export default async function SitePlanPage() {
  const { plans, kits } = await load()
  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🗺️ Site Plan</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          The building drawing everything else is marked up on. Upload it once here; each app pins its
          own equipment onto it — First Aid does its kits and defibrillators on its own{" "}
          <Link href="/tools/first-aid" className="text-sky-600 hover:underline">Kits &amp; equipment</Link> tab.
          ⚠ The plan appears on the <strong>public</strong> first aid page, so don&apos;t upload a drawing
          with anything confidential on it.
        </p>
      </div>
      <SitePlanClient
        plans={plans.map(p => ({ id: p.id, name: p.name, imageKey: p.imageKey, active: p.active, sortOrder: p.sortOrder }))}
        kits={kits.map(k => ({ id: k.id, kind: k.kind, label: k.label, planId: k.planId!, pinX: k.pinX ?? 0, pinY: k.pinY ?? 0 }))}
      />
    </div>
  )
}
