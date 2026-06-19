import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"
import { getEffectiveSession } from "@/lib/impersonation"

export default async function HubPage() {
  const effective = await getEffectiveSession()
  const name     = effective?.user?.name?.split(" ")[0] ?? "there"

  const dbUser = effective?.user?.id
    ? await prisma.user.findUnique({ where: { id: effective.user.id }, select: { allowedApps: true, role: true, appPermissions: true } })
    : null

  // Per-user hub card visibility override (stored in appPermissions.HUB_CARDS.visible)
  const hubCardsVisible: string[] | null =
    dbUser?.role === "ADMIN"
      ? null  // admins always see everything
      : (dbUser?.appPermissions as any)?.HUB_CARDS?.visible ?? null

  const dbCards = await prisma.appCard.findMany()
  const dbMap   = Object.fromEntries(dbCards.map(c => [c.key, c]))

  // Merge DB settings with static defaults
  const cards = APP_CARD_DEFS
    .map((def, i) => {
      const db = dbMap[def.key]
      return {
        ...def,
        order:       db?.order   ?? i,
        visible:     db?.visible ?? true,
        pinned:      db?.pinned  ?? false,
        label:       db?.label   || def.defaultLabel,
        description: db?.description || def.defaultDescription,
      }
    })
    // Sort: pinned first, then by order
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.order - b.order
    })
    // Filter hidden
    .filter(c => c.visible)
    // Filter by access
    .filter(c => {
      if (c.allUsers) {
        // Respect per-user hub card overrides if configured
        if (hubCardsVisible !== null) return hubCardsVisible.includes(c.key)
        return true
      }
      if (!c.appKey) return dbUser?.role === "ADMIN"
      return hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], c.appKey)
    })

  const standaloneCards = cards.filter(c => !c.group)
  const grouped = SECTION_DEFS
    .map(s => ({ ...s, cards: cards.filter(c => c.group === s.key) }))
    .filter(s => s.cards.length > 0)

  function renderCard(app: typeof cards[0]) {
    const cardClass = `relative bg-white dark:bg-[#1c1f27] border ${app.border} rounded-xl p-7 flex flex-col items-center text-center h-[320px]
      transition-all duration-200 hover:shadow-xl ${app.glow} hover:-translate-y-0.5`

    const inner = (
      <>
        {app.pinned && (
          <span className="absolute top-3 right-3 text-xs font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 px-2 py-0.5 rounded-full">
            ★ Featured
          </span>
        )}

        <div className={`text-5xl mb-4 ${app.iconBg}`}>{app.icon}</div>

        <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">{app.label}</h2>

        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6 flex-1">{app.description}</p>

        {app.comingSoon ? (
          <span className="w-full text-center text-sm font-semibold text-gray-500 bg-gray-200 dark:bg-gray-800 py-2 px-4 rounded-lg cursor-not-allowed">
            Coming Soon
          </span>
        ) : (
          <span className={`w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition-colors ${app.btnBg}`}>
            Open {app.label} →
          </span>
        )}
      </>
    )

    // The whole card is the click target (not just the button) so a click
    // anywhere on it navigates. Coming-soon cards aren't links.
    return app.comingSoon ? (
      <div key={app.key} className={`${cardClass} cursor-not-allowed`}>{inner}</div>
    ) : (
      <Link key={app.key} href={app.href} className={`${cardClass} cursor-pointer`}>{inner}</Link>
    )
  }

  return (
    <div className="relative min-h-screen bg-gray-100 dark:bg-[#111318] flex flex-col items-center">

      {grouped.length > 1 && (
        <div className="sticky top-0 z-10 w-full bg-gray-900/95 backdrop-blur border-b border-white/5 flex items-center gap-1 px-6 py-2">
          {grouped.map(section => (
            <a
              key={section.key}
              href={`#${section.key}`}
              className="text-xs font-medium text-gray-400 hover:text-white px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              {section.label}
            </a>
          ))}
        </div>
      )}

      <div className="w-full max-w-6xl space-y-10 px-6 pt-10 pb-16">
        {grouped.map(section => (
          <div key={section.key} id={section.key} className="scroll-mt-12">
            <div className="flex items-center gap-4 mb-5">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-widest">{section.label}</span>
              <div className="flex-1 h-px bg-gray-300 dark:bg-white/5" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {section.cards.map(renderCard)}
            </div>
          </div>
        ))}

        {standaloneCards.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {standaloneCards.map(renderCard)}
          </div>
        )}
      </div>
    </div>
  )
}
