import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { parseCsv, rowsToObjects } from "@/lib/csv-parse"

export const maxDuration = 120

// POST /api/tickets/import/commit
//
// Body: { csv: string, defaultStatus?: string }
// Expects a CSV with columns: Date, Title, Description, Resolution,
// Category, RaisedBy. (TicketNo is ignored.) Bulk-creates tickets with
// the original dates preserved. Admin only.

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const { csv, defaultStatus } = await req.json() as { csv?: string; defaultStatus?: string }
    if (!csv?.trim()) return NextResponse.json({ error: "CSV body required" }, { status: 400 })

    const rows    = parseCsv(csv)
    const records = rowsToObjects(rows)
    if (records.length === 0) return NextResponse.json({ error: "CSV is empty" }, { status: 400 })

    const status     = defaultStatus ?? "RESOLVED"
    const isResolved = status === "RESOLVED" || status === "CLOSED"

    // Map known active category keys so unknown ones fall back to OTHER.
    const cats = await prisma.ticketCategory.findMany({ where: { active: true } })
    const validKeys = new Set(cats.map(c => c.key))

    const data = records.map(r => {
      const dateStr = (r["Date"] ?? "").trim()
      const dt = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
        ? new Date(dateStr + "T12:00:00Z")
        : new Date()
      const catRaw = (r["Category"] ?? "OTHER").trim().toUpperCase()
      const category = validKeys.has(catRaw) ? catRaw : "OTHER"
      return {
        title:          (r["Title"] ?? "Untitled").slice(0, 200),
        description:    r["Description"] ?? "",
        status,
        priority:       "MEDIUM",
        category,
        resolutionNote: r["Resolution"] || null,
        createdById:    null,
        createdByName:  r["RaisedBy"] || "Imported",
        resolvedAt:     isResolved ? dt : null,
        createdAt:      dt,
        updatedAt:      dt,
      }
    }).filter(t => t.title && t.description)

    if (data.length === 0) {
      return NextResponse.json({ error: "No rows with both Title and Description" }, { status: 400 })
    }

    // Strip stray invisible / problematic Unicode and clip overlong fields —
    // protects against weird email content (zero-width joiners, BOMs, etc.)
    // that can break Prisma's binary protocol on big batches.
    const INVISIBLE_RE = /[­​-‏‪-‮⁠﻿]/g
    const clean = data.map(t => ({
      ...t,
      title:          t.title.replace(INVISIBLE_RE, "").slice(0, 200),
      description:    t.description.replace(INVISIBLE_RE, "").slice(0, 8000),
      resolutionNote: t.resolutionNote == null ? null : t.resolutionNote.replace(INVISIBLE_RE, "").slice(0, 8000),
      createdByName:  t.createdByName.replace(INVISIBLE_RE, "").slice(0, 100),
    }))

    // Insert in chunks so one bad row can't kill the whole import.
    const CHUNK = 50
    let success     = 0
    const failures: string[] = []
    for (let i = 0; i < clean.length; i += CHUNK) {
      const slice = clean.slice(i, i + CHUNK)
      try {
        const res = await prisma.ticket.createMany({ data: slice })
        success += res.count
      } catch (e: any) {
        // Retry one-by-one to isolate the bad row(s) and keep the rest.
        for (const row of slice) {
          try {
            await prisma.ticket.create({ data: row })
            success++
          } catch (rowErr: any) {
            failures.push(`"${row.title.slice(0, 60)}": ${(rowErr?.message ?? rowErr).toString().slice(0, 120)}`)
          }
        }
      }
    }

    return NextResponse.json({
      ok:       true,
      count:    success,
      skipped:  records.length - data.length,
      failed:   failures.length,
      failures: failures.slice(0, 20),
    })
  } catch (e: any) {
    console.error("tickets/import/commit error:", e)
    return NextResponse.json({ error: e?.message ?? "Commit failed" }, { status: 500 })
  }
}
