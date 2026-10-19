import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { APP_CARD_DEFS } from "@/lib/app-cards"
import { cardSection } from "@/lib/home-layout"
import { getHomeLayout } from "@/lib/home-layout-server"
import { getEffectiveSession } from "@/lib/impersonation"

export const sectionSlug = (key: string) => key.toLowerCase().replace(/_/g, "-")

export const CARD_GRID = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 auto-rows-fr gap-5"

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

  return { name, standaloneCards, grouped, isAdmin: dbUser?.role === "ADMIN" }
}

export type HubCard = Awaited<ReturnType<typeof getHubCards>>["standaloneCards"][number]
export { AppCardTile } from "./app-card-tile"

// Everything the home page editor needs: every card (hidden ones too) with its saved
// settings and built-in defaults, plus the saved layout. Admins only — the page checks.
export async function getEditorData() {
  const [dbCards, layout] = await Promise.all([prisma.appCard.findMany(), getHomeLayout()])
  const dbMap = Object.fromEntries(dbCards.map(c => [c.key, c]))
  const cards = APP_CARD_DEFS
    .map((def, i) => {
      const db = dbMap[def.key]
      return {
        key:                def.key,
        order:              db?.order       ?? i,
        visible:            db?.visible     ?? true,
        pinned:             db?.pinned      ?? false,
        label:              db?.label       ?? null,
        description:        db?.description ?? null,
      }
    })
    .sort((a, b) => a.order - b.order)
  return { cards, layout }
}
