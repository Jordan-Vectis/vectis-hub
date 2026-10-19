import Link from "next/link"
import { notFound } from "next/navigation"
import { AppCardTile, CARD_GRID, getHubCards, sectionSlug } from "../hub-cards"

export default async function HubSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section: slug } = await params
  const { grouped } = await getHubCards()
  // Only sections this person has at least one app in — anything else is a 404.
  const section = grouped.find(s => sectionSlug(s.key) === slug)
  if (!section) notFound()

  return (
    <div className="relative min-h-screen bg-gray-100 dark:bg-[#111318]">
      <div className="w-full px-6 pt-6 pb-16">
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/hub"
            className="inline-flex items-center min-h-[44px] px-4 rounded-lg text-sm font-semibold text-gray-700 dark:text-gray-200 bg-white dark:bg-[#1c1f27] border border-gray-300 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5"
          >
            ← Back to Hub
          </Link>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{section.icon} {section.label}</h1>
        </div>
        <div className={CARD_GRID}>
          {section.cards.map(app => <AppCardTile key={app.key} app={app} />)}
        </div>
      </div>
    </div>
  )
}
