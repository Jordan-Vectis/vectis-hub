import { AppCardTile, CARD_GRID, getHubCards, sectionSlug } from "./hub-cards"
import { SectionTile } from "./section-tile"

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
                <SectionTile
                  key={section.key}
                  href={`/hub/${sectionSlug(section.key)}`}
                  label={section.label}
                  icon={section.icon}
                  colour={section.colour}
                  textColour={section.textColour}
                  appNames={section.cards.map(c => c.label)}
                />
              ))}
          {standaloneCards.map(app => <AppCardTile key={app.key} app={app} />)}
        </div>
      </div>
    </div>
  )
}
