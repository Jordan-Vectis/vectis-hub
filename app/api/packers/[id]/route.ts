import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const VALID_GROUPS = ["FULL_TIME", "AGENCY", "EX_STAFF"] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const body = await req.json()
    const { name, staffGroup, active, sortOrder, aliases, addAlias, removeAlias, renameAlias } = body

    if (staffGroup !== undefined && !VALID_GROUPS.includes(staffGroup)) {
      return NextResponse.json({ error: "Invalid staffGroup" }, { status: 400 })
    }

    // `aliases` replaces the whole list (used when the user removes one inline).
    // `addAlias`, `removeAlias`, `renameAlias` are atomic single-element ops —
    // server reads the current list, applies the change, and writes back.
    // Avoids client-side stale-state races when the user mutates several
    // aliases in quick succession.
    const cleanReplaceList = Array.isArray(aliases)
      ? [...new Set(aliases.map((a: string) => String(a).trim()).filter(Boolean))]
      : undefined

    let finalAliases: string[] | undefined = cleanReplaceList
    if (addAlias !== undefined || removeAlias !== undefined || renameAlias !== undefined) {
      const current = await prisma.packer.findUnique({
        where: { id },
        select: { aliases: true },
      })
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 })
      let next = current.aliases ?? []
      if (typeof addAlias === "string" && addAlias.trim()) {
        const trimmed = addAlias.trim()
        if (!next.includes(trimmed)) next = [...next, trimmed]
      }
      if (typeof removeAlias === "string") {
        next = next.filter(a => a !== removeAlias)
      }
      if (renameAlias && typeof renameAlias === "object") {
        const from = String(renameAlias.from ?? "").trim()
        const to   = String(renameAlias.to   ?? "").trim()
        if (from && to && from !== to) {
          next = next.map(a => a === from ? to : a)
          // Dedupe in case `to` already existed
          next = [...new Set(next)]
        }
      }
      finalAliases = next
    }

    const packer = await prisma.packer.update({
      where: { id },
      data: {
        ...(name        !== undefined && { name: String(name).trim() }),
        ...(staffGroup  !== undefined && { staffGroup }),
        ...(active      !== undefined && { active: Boolean(active) }),
        ...(sortOrder   !== undefined && { sortOrder: Number(sortOrder) }),
        ...(finalAliases !== undefined && { aliases: { set: finalAliases } }),
      },
    })
    return NextResponse.json({ packer })
  } catch (e: any) {
    console.error("packers PATCH error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    await prisma.packer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("packers DELETE error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
