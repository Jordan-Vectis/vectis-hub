import { AppCardTile, CARD_GRID, getEditorData, getHubCards, sectionSlug } from "./hub-cards"
import { SectionTile } from "./section-tile"
import HomeEditor from "./home-editor"

export default async function HubPage({ searchParams }: { searchParams: Promise<{ edit?: string; section?: string }> }) {
  const { edit, section } = await searchParams
  const { standaloneCards, grouped, isAdmin } = await getHubCards()

  // Edit mode — admins only; anyone else just gets the normal home page.
  if (edit && isAdmin) {
    const { cards, layout } = await getEditorData()
    return <HomeEditor initialCards={cards} initialLayout={layout} startSection={section ?? null} />
  }

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
