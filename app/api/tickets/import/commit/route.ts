import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const maxDuration = 120

// POST /api/tickets/import/commit
//
// Body: { tickets: ImportTicket[], defaultStatus?: string }
// Bulk-creates tickets with original dates preserved. Admin only.

type ImportTicket = {
  title:          string
  description:    string
  resolutionNote: string
  category:       string
  originalDate:   string   // yyyy-mm-dd
  raisedBy:       string
  status?:        string
  priority?:      string
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin only" }, { status: 401 })
    }

    const { tickets, defaultStatus } = await req.json() as {
      tickets?:        ImportTicket[]
      defaultStatus?:  string
    }
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return NextResponse.json({ error: "tickets array required" }, { status: 400 })
    }

    const status = defaultStatus ?? "RESOLVED"

    // Build records — back-date createdAt + resolvedAt using the supplied
    // originalDate. Fall back to NOW for anything Gemini couldn't extract.
    const records = tickets.map(t => {
      const dt = t.originalDate && /^\d{4}-\d{2}-\d{2}$/.test(t.originalDate)
        ? new Date(t.originalDate + "T12:00:00Z")
        : new Date()
      const isResolved = status === "RESOLVED" || status === "CLOSED"
      return {
        title:          (t.title || "Untitled").slice(0, 200),
        description:    t.description    || "",
        status,
        priority:       t.priority       || "MEDIUM",
        category:       t.category       || "OTHER",
        resolutionNote: t.resolutionNote || null,
        createdById:    null,
        createdByName:  t.raisedBy       || "Imported",
        resolvedAt:     isResolved ? dt : null,
        createdAt:      dt,
        updatedAt:      dt,
      }
    })

    const result = await prisma.ticket.createMany({ data: records })
    return NextResponse.json({ ok: true, count: result.count })
  } catch (e: any) {
    console.error("tickets/import/commit error:", e)
    return NextResponse.json({ error: e?.message ?? "Commit failed" }, { status: 500 })
  }
}
