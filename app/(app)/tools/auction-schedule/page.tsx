import Link from "next/link"
import ScheduleClient from "./schedule-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Auctioneering Schedule" }

export default async function AuctionSchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams
  return (
    <div className="p-4 sm:p-8">
      <div className="mb-5">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🗓️ Auctioneering Schedule</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          The week&apos;s sales come in by themselves. Drag a name from the list on the right onto a box — or tap a
          name, then tap the box. Tap a name already in a box to pin, lock or remove it. Changes save as you go.
        </p>
      </div>
      <ScheduleClient initialWeek={week ?? ""} />
    </div>
  )
}
