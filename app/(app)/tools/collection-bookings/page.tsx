import Link from "next/link"
import CollectionBookingsClient from "./collection-bookings-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Collection bookings" }

export default async function CollectionBookingsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams
  return (
    <div className="p-4 sm:p-8">
      <div className="mb-5">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🚚 Collection bookings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          Collections from vendors: where and when, what&apos;s being collected with photos, any special requirements, who&apos;s
          driving and in which van, and the hotel when it&apos;s an overnight. Pick a booking up to take it on — every change and
          note is kept on its history with who made it.
        </p>
      </div>
      <CollectionBookingsClient initialId={id ?? ""} />
    </div>
  )
}
