import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/tickets/export?status=ALL
//
// Returns every ticket as a CSV in the same column order the import endpoint
// accepts, plus a few extra columns (Status, Priority, TicketId) so the file
// also works as a full snapshot/backup. Anyone signed in can export.

function esc(v: any): string {
  const s = String(v ?? "")
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const status = searchParams.get("status")?.trim()

    const where: any = {}
    if (status && status !== "ALL") where.status = status

    const tickets = await prisma.ticket.findMany({
      where,
      orderBy: { createdAt: "asc" },
    })

    const cols = ["Date", "Title", "Description", "Resolution", "Category", "RaisedBy", "Status", "Priority", "AssignedTo", "TicketId"]
    const lines = [cols.join(",")]
    for (const t of tickets) {
      const date = t.createdAt.toISOString().slice(0, 10)
      lines.push([
        esc(date),
        esc(t.title),
        esc(t.description),
        esc(t.resolutionNote ?? ""),
        esc(t.category),
        esc(t.createdByName),
        esc(t.status),
        esc(t.priority),
        esc(t.assignedToName ?? ""),
        esc(t.id),
      ].join(","))
    }
    const csv = lines.join("\r\n")
    const filename = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type":        "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (e: any) {
    console.error("tickets/export error:", e)
    return NextResponse.json({ error: e?.message ?? "Export failed" }, { status: 500 })
  }
}
