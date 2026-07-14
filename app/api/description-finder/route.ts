import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { hasAppAccess } from "@/lib/apps"

export const dynamic = "force-dynamic"

// GET /api/description-finder?q=<code | name | barcode>
// Substring-searches our past descriptions across the BC history mirror
// (WarehouseItem, ~200k rows) and the app's own catalogued lots (CatalogueLot),
// so a cataloguer can pull up and reuse how an item was described before.

export type FinderResult = {
  source:      "app" | "bc"
  code:        string | null
  title:       string | null
  description: string
  category:    string | null
  brand:       string | null
  vendor:      string | null
  auctionCode: string | null
  auctionName: string | null
  date:        string | null   // ISO, for display
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "DESCRIPTION_FINDER")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const q = (req.nextUrl.searchParams.get("q") ?? "").trim()
    if (q.length < 2) {
      return NextResponse.json({ results: [], q, message: "Type at least 2 characters." })
    }

    const TAKE = 60
    const [lots, items] = await Promise.all([
      prisma.catalogueLot.findMany({
        where: {
          OR: [
            { description: { contains: q, mode: "insensitive" } },
            { title:       { contains: q, mode: "insensitive" } },
            { barcode:     { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          id: true, barcode: true, title: true, description: true, category: true,
          brand: true, vendor: true, createdAt: true,
          auction: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: TAKE,
      }),
      prisma.warehouseItem.findMany({
        where: {
          OR: [
            { description: { contains: q, mode: "insensitive" } },
            { barcode:     { contains: q, mode: "insensitive" } },
          ],
        },
        select: {
          uniqueId: true, barcode: true, description: true, category: true,
          vendorName: true, auctionCode: true, auctionName: true, auctionDate: true, bcModifiedAt: true,
        },
        orderBy: { bcModifiedAt: "desc" },
        take: TAKE,
      }),
    ])

    // Merge — app lots first (fuller descriptions), then BC history.
    type Row = FinderResult & { sortKey: number }
    const rows: Row[] = []

    for (const l of lots) {
      if (!l.description || !l.description.trim()) continue
      rows.push({
        source: "app",
        code: l.barcode, title: l.title, description: l.description,
        category: l.category, brand: l.brand, vendor: l.vendor,
        auctionCode: l.auction?.code ?? null, auctionName: l.auction?.name ?? null,
        date: l.createdAt.toISOString(), sortKey: l.createdAt.getTime(),
      })
    }
    for (const it of items) {
      if (!it.description || !it.description.trim()) continue
      rows.push({
        source: "bc",
        code: it.barcode, title: null, description: it.description,
        category: it.category, brand: null, vendor: it.vendorName,
        auctionCode: it.auctionCode, auctionName: it.auctionName,
        date: it.bcModifiedAt ? it.bcModifiedAt.toISOString() : (it.auctionDate ?? null),
        sortKey: it.bcModifiedAt ? it.bcModifiedAt.getTime() : 0,
      })
    }

    // Dedupe by barcode (app row wins since it was pushed first), then recency.
    const seen = new Set<string>()
    const deduped = rows.filter(r => {
      const key = (r.code ?? "").toLowerCase().trim()
      if (!key) return true
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    deduped.sort((a, b) => b.sortKey - a.sortKey)

    const results: FinderResult[] = deduped.slice(0, 50).map(({ sortKey, ...r }) => r)
    return NextResponse.json({ results, q, total: deduped.length })
  } catch (e: any) {
    console.error("description-finder error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
