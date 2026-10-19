import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import { cardSection } from "@/lib/home-layout"
import { getHomeLayout } from "@/lib/home-layout-server"
import { getEffectiveSession } from "@/lib/impersonation"

export const sectionSlug = (key: string) => key.toLowerCase().replace(/_/g, "-")

export const CARD_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-5"

// The cards this person may see, with the admin's Home Page settings applied,
// grouped into their sections. Shared by /hub and /hub/[section].
export async function getHubCards() {
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

  const [dbCards, layout] = await Promise.all([prisma.appCard.findMany(), getHomeLayout()])
  const dbMap   = Object.fromEntries(dbCards.map(c => [c.key, c]))

  // Merge DB settings with static defaults
  const cards = APP_CARD_DEFS
    .map((def, i) => {
      const db    = dbMap[def.key]
      const style = layout.cards[def.key] ?? {}
      return {
        ...def,
        group:       cardSection(layout, def),
        icon:        style.icon || def.icon,
        colour:      style.colour ?? null,
        textColour:  style.textColour ?? null,
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
  const grouped = layout.sections
    .filter(s => !s.hidden)
    .map(s => ({ ...s, cards: cards.filter(c => c.group === s.key) }))
    .filter(s => s.cards.length > 0)

  return { name, standaloneCards, grouped }
}

export type HubCard = Awaited<ReturnType<typeof getHubCards>>["standaloneCards"][number]

export function AppCardTile({ app }: { app: HubCard }) {
  const cardClass = `relative bg-white dark:bg-[#1c1f27] border ${app.border} rounded-xl p-7 flex flex-col items-center text-center min-h-[320px]
    transition-all duration-200 hover:shadow-xl ${app.glow} hover:-translate-y-0.5`

  // An admin-picked colour (Admin → Home Page Cards) replaces the built-in classes.
  const colour = app.colour ? { borderColor: app.colour } : undefined
  const btn    = app.colour ? { backgroundColor: app.colour } : undefined
  const text   = app.textColour ? { color: app.textColour } : undefined

  const inner = (
    <>
      {app.pinned && (
        <span className="absolute top-3 right-3 text-xs font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-300 px-2 py-0.5 rounded-full">
          ★ Featured
        </span>
      )}

      <div className={`text-5xl mb-4 ${app.iconBg}`}>{app.icon}</div>

      <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white" style={text}>{app.label}</h2>

      <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-6 flex-1" style={text ? { ...text, opacity: 0.8 } : undefined}>{app.description}</p>

      {app.comingSoon ? (
        <span className="w-full text-center text-sm font-semibold text-gray-500 bg-gray-200 dark:bg-gray-800 py-2 px-4 rounded-lg cursor-not-allowed">
          Coming Soon
        </span>
      ) : (
        <span className={`w-full text-center text-sm font-semibold text-white py-2 px-4 rounded-lg transition-colors ${app.colour ? "hover:brightness-110" : app.btnBg}`} style={btn}>
          Open {app.label} →
        </span>
      )}
    </>
  )

  // The whole card is the click target (not just the button) so a click
  // anywhere on it navigates. Coming-soon cards aren't links.
  return app.comingSoon ? (
    <div className={`${cardClass} cursor-not-allowed`} style={colour}>{inner}</div>
  ) : (
    <Link href={app.href} className={`${cardClass} cursor-pointer`} style={colour}>{inner}</Link>
  )
}
