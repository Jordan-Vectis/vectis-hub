import { notFound } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import RosterClient from "./roster-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "ROSTER.SYS" }

export default async function JordanRosterPage() {
  const session = await auth()
  if (!session || !(await isJordan())) notFound()

  const rows = await prisma.mcocChampion.findMany({
    where: { ownerId: session.user.id },
    orderBy: [{ rank: "desc" }, { name: "asc" }],
  })
  const champions = rows.map((c) => ({
    id: c.id, name: c.name, class: c.class, stars: c.stars, rank: c.rank, bgsDeck: c.bgsDeck,
  }))

  return (
    <div className="h-full bg-black p-6 font-mono flex flex-col" style={{ color: "#33ff66" }}>
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h1 className="text-lg font-bold tracking-widest">05 · MY ROSTER</h1>
          <div className="flex items-center gap-3 text-xs">
            <Link href="/jordan/mcoc" prefetch={false} className="opacity-60 hover:opacity-100">⚔ COUNTERS</Link>
            <Link href="/jordan" prefetch={false} className="opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
          </div>
        </div>
        <RosterClient initial={champions} />
      </div>
    </div>
  )
}
