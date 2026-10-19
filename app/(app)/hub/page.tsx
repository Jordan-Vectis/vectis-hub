import Link from "next/link"
import { AppCardTile, CARD_GRID, getHubCards, sectionSlug } from "./hub-cards"

export default async function HubPage() {
  const { standaloneCards, grouped } = await getHubCards()

  // Someone with only one section skips the extra click and sees its apps straight away.
  const onlySection = grouped.length === 1 ? grouped[0] : null

  return (
    <div className="relative min-h-screen bg-gray-100 dark:bg-[#111318]">
      <div className="w-full px-6 pt-10 pb-16 space-y-5">
        <div className={CARD_GRID}>
          {onlySection
            ? onlySection.cards.map(app => <AppCardTile key={app.key} app={app} />)
            : grouped.map(section => (
                <Link
                  key={section.key}
                  href={`/hub/${sectionSlug(section.key)}`}
                  className="relative bg-white dark:bg-[#1c1f27] border border-indigo-500 rounded-xl p-7 flex flex-col items-center text-center min-h-[320px]
                    transition-all duration-200 hover:shadow-xl hover:shadow-indigo-900/40 hover:-translate-y-0.5 cursor-pointer"
                >
                  <div className="text-5xl mb-4">{section.icon}</div>
                  <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">{section.label}</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6 flex-1">
                    {section.cards.map(c => c.label).join(" · ")}
                  </p>
                  <span className="w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 transition-colors">
                    Open {section.cards.length} {section.cards.length === 1 ? "app" : "apps"} →
                  </span>
                </Link>
              ))}
          {standaloneCards.map(app => <AppCardTile key={app.key} app={app} />)}
        </div>
      </div>
    </div>
  )
}
