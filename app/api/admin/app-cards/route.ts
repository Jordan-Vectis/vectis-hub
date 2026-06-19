import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { APP_CARD_DEFS } from "@/lib/app-cards"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") return null
  return session
}

export async function GET() {
  if (!await requireAdmin()) return Response.json({ error: "Unauthorised" }, { status: 401 })

  const dbCards = await prisma.appCard.findMany()
  const dbMap = Object.fromEntries(dbCards.map(c => [c.key, c]))

  // Merge DB overrides with defaults, preserving default order if no DB record
  const merged = APP_CARD_DEFS.map((def, i) => {
    const db = dbMap[def.key]
    return {
      key:         def.key,
      order:       db?.order       ?? i,
      visible:     db?.visible     ?? true,
      pinned:      db?.pinned      ?? false,
      label:       db?.label       ?? null,
      description: db?.description ?? null,
      // statics
      defaultLabel:       def.defaultLabel,
      defaultDescription: def.defaultDescription,
      icon:               def.icon,
      group:              def.group ?? null,
    }
  }).sort((a, b) => a.order - b.order)

  return Response.json(merged)
}

export async function PUT(req: NextRequest) {
  if (!await requireAdmin()) return Response.json({ error: "Unauthorised" }, { status: 401 })

  const cards: { key: string; order: number; visible: boolean; pinned: boolean; label: string | null; description: string | null }[] = await req.json()

  await Promise.all(
    cards.map(c =>
      prisma.appCard.upsert({
        where:  { key: c.key },
        create: { key: c.key, order: c.order, visible: c.visible, pinned: c.pinned, label: c.label, description: c.description },
        update: {               order: c.order, visible: c.visible, pinned: c.pinned, label: c.label, description: c.description },
      })
    )
  )

  return Response.json({ ok: true })
}
