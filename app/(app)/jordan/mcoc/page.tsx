import { notFound } from "next/navigation"
import Link from "next/link"
import { isJordan } from "@/lib/jordan-auth"
import McocClient from "./mcoc-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "MCOC.SYS" }

export default async function JordanMcocPage() {
  if (!(await isJordan())) notFound()

  return (
    <div className="h-full bg-black p-6 font-mono flex flex-col" style={{ color: "#33ff66" }}>
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <h1 className="text-lg font-bold tracking-widest">04 · MCOC COUNTERS</h1>
          <Link href="/jordan" prefetch={false} className="text-xs opacity-60 hover:opacity-100">&lt; JORDAN.SYS</Link>
        </div>
        <McocClient />
      </div>
    </div>
  )
}
