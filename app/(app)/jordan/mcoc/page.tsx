import { notFound } from "next/navigation"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { isJordan } from "@/lib/jordan-auth"
import McocHub from "./mcoc-hub"
import { JsysHeader } from "../jsys-style"

export const dynamic = "force-dynamic"
export const metadata = { title: "MCOC.SYS" }

export default async function JordanMcocPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth()
  if (!session || !(await isJordan())) notFound()

  const { tab } = await searchParams
  const rows = await prisma.mcocChampion.findMany({
    where: { ownerId: session.user.id },
    orderBy: [{ rank: "desc" }, { name: "asc" }],
  })
  const roster = await Promise.all(rows.map(async (c) => ({
    id: c.id, name: c.name, class: c.class, stars: c.stars, rank: c.rank, bgsDeck: c.bgsDeck,
    imageUrl: c.imageKey ? await getSignedImageUrl(c.imageKey) : null,
  })))

  return (
    <div className="h-full bg-(--j-bg) p-6 jsys-font flex flex-col" style={{ color: "var(--j-text)" }}>
      <div className="w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <JsysHeader n="04" title="MCOC" />
        </div>
        <McocHub roster={roster} initialTab={["roster", "champdb", "deck", "aw"].includes(tab ?? "") ? (tab as "roster" | "champdb" | "deck" | "aw") : "counters"} />
      </div>
    </div>
  )
}
