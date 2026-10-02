import Link from "next/link"
import { getEffectiveSession } from "@/lib/impersonation"
import VansClient from "./vans-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Vans" }

export default async function VansPage() {
  const session = await getEffectiveSession()
  const me = session?.user?.name || session?.user?.email || ""
  return (
    <div className="p-8">
      <div className="mb-6">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🚐 Vans</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          The collection vans: who has each one out, what&apos;s due, and everything done to them.
          Sign a van out when you take it and back in when it&apos;s returned, with the mileage.
        </p>
      </div>
      <VansClient me={me} />
    </div>
  )
}
