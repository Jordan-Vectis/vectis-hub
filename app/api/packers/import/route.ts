import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// POST /api/packers/import
// Body: { packers: { name, staffGroup, active, sortOrder, aliases }[] }
// Upserts by name (case-insensitive): merges aliases for existing, creates new
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { packers } = await req.json()
    if (!Array.isArray(packers) || packers.length === 0) {
      return NextResponse.json({ error: "No packers provided" }, { status: 400 })
    }

    const existing = await prisma.packer.findMany()
    const existingByName = new Map(existing.map(p => [p.name.toLowerCase().trim(), p]))

    let created = 0
    let updated = 0

    for (const row of packers) {
      const name = String(row.name ?? "").trim()
      if (!name) continue

      const aliases: string[] = Array.isArray(row.aliases)
        ? row.aliases.map(String).filter(Boolean)
        : []

      const match = existingByName.get(name.toLowerCase())

      if (match) {
        // Merge aliases — add any that don't already exist
        const merged = Array.from(new Set([...match.aliases, ...aliases]))
        if (merged.length !== match.aliases.length) {
          await prisma.packer.update({
            where: { id: match.id },
            data:  { aliases: merged },
          })
          updated++
        }
      } else {
        await prisma.packer.create({
          data: {
            name,
            staffGroup: ["FULL_TIME", "AGENCY", "EX_STAFF"].includes(row.staffGroup)
              ? row.staffGroup
              : "FULL_TIME",
            active:    typeof row.active === "boolean" ? row.active : true,
            sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 0,
            aliases,
          },
        })
        created++
      }
    }

    return NextResponse.json({ ok: true, created, updated })
  } catch (e: any) {
    console.error("[packers/import POST]", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
