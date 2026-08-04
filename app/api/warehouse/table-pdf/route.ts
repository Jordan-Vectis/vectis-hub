import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { buildWarehouseTablePdf, type TablePdfColumn } from "@/lib/warehouse-table-pdf"

export const maxDuration = 60
export const runtime = "nodejs"

// POST /api/warehouse/table-pdf
//
// Prints whatever the user is looking at. The <FilterTable> component posts its
// visible rows (already filtered and sorted on screen) as plain strings, so the
// PDF and the table can never disagree. No BC call, no DB read — the payload IS
// the report.
//
// Body: { title, subtitle?, filename?, orientation?, columns: [{label,width?,align?}], rows: string[][] }

const MAX_ROWS = 20_000

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
    }

    const columns = Array.isArray(body.columns) ? body.columns : []
    const rows    = Array.isArray(body.rows)    ? body.rows    : []

    if (columns.length === 0) {
      return NextResponse.json({ error: "No columns to print" }, { status: 400 })
    }
    if (rows.length > MAX_ROWS) {
      return NextResponse.json(
        { error: `Too many rows to print (${rows.length.toLocaleString()}). Filter the table down to ${MAX_ROWS.toLocaleString()} rows or fewer.` },
        { status: 400 },
      )
    }

    const safeColumns: TablePdfColumn[] = columns.map((raw: unknown) => {
      const c = (raw ?? {}) as { label?: unknown; width?: unknown; align?: unknown }
      return {
        label: String(c.label ?? ""),
        width: typeof c.width === "number" && isFinite(c.width) ? c.width : undefined,
        align: c.align === "right" ? "right" : "left",
      }
    })

    const safeRows: string[][] = rows.map((r: unknown) =>
      Array.isArray(r)
        ? safeColumns.map((_, i) => (r[i] == null ? "" : String(r[i])))
        : safeColumns.map(() => ""),
    )

    const title    = String(body.title ?? "Warehouse")
    const subtitle = body.subtitle ? String(body.subtitle) : undefined

    const pdfBytes = await buildWarehouseTablePdf({
      title,
      subtitle,
      columns:     safeColumns,
      rows:        safeRows,
      orientation: body.orientation === "portrait" || body.orientation === "landscape" ? body.orientation : undefined,
    })

    const base = String(body.filename ?? title)
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "warehouse"
    const filename = `${base}-${new Date().toISOString().slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length":      String(pdfBytes.length),
      },
    })
  } catch (e: any) {
    console.error("warehouse/table-pdf error:", e)
    return NextResponse.json({ error: e?.message ?? "PDF generation failed" }, { status: 500 })
  }
}
