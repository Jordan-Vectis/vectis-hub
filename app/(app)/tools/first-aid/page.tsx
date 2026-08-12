import Link from "next/link"
import { prisma } from "@/lib/prisma"
import FirstAidClient from "./first-aid-client"

export const dynamic = "force-dynamic"

// Migration-safe: the tables are newer than the deploy that reads them, so an empty page beats
// a 500 while the migration catches up.
async function load() {
  try {
    const [aiders, kits, info, reports] = await Promise.all([
      prisma.firstAider.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      prisma.firstAidKit.findMany({ orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
      prisma.firstAidInfo.findUnique({ where: { id: "global" } }),
      prisma.accidentReport.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    ])
    return { aiders, kits, info, reports }
  } catch {
    return { aiders: [], kits: [], info: null, reports: [] }
  }
}

export default async function FirstAidAdminPage() {
  const { aiders, kits, info, reports } = await load()
  const newCount = reports.filter(r => r.status === "NEW").length

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🩹 First Aid</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          Everything here except the accident reports appears on the public page at{" "}
          <Link href="/first-aid" className="text-green-600 hover:underline font-mono">/first-aid</Link>, which
          anyone can open without logging in — so keep it to information you are happy for anyone on site to read.
        </p>
        {newCount > 0 && (
          <p className="mt-3 inline-block rounded-lg bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-sm font-semibold px-3 py-1.5">
            {newCount} accident report{newCount === 1 ? "" : "s"} not yet looked at
          </p>
        )}
      </div>

      <FirstAidClient
        aiders={aiders.map(a => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() }))}
        kits={kits.map(k => ({ ...k, createdAt: k.createdAt.toISOString(), updatedAt: k.updatedAt.toISOString() }))}
        info={info ? { emergencySteps: info.emergencySteps, siteAddress: info.siteAddress, assemblyPoint: info.assemblyPoint, extraNotes: info.extraNotes } : null}
        reports={reports.map(r => ({
          id: r.id, reporterName: r.reporterName, reporterPhone: r.reporterPhone, injuredName: r.injuredName,
          happenedAt: r.happenedAt, location: r.location, description: r.description, status: r.status,
          handledBy: r.handledBy, createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
