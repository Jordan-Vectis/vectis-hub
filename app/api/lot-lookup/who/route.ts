import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { lookupCataloguerByCode } from "@/lib/cataloguer-directory"

export const dynamic = "force-dynamic"

// Admin Centre → "Who catalogued this lot?"
//
// One lot in, one straight answer out. Given a barcode (F066001) or a receipt
// unique ID (R000016-413) it returns who entered the lot in the Hub and when,
// what Business Central says the cataloguer was, and everyone who has changed
// the lot since (from the CatalogueLotEvent audit trail).
//
// A barcode can legitimately appear in more than one sale, so this returns a
// LIST of matches rather than assuming one.

const MAX_LOTS   = 20
const MAX_EVENTS = 400
const VALUE_CAP  = 160   // old/new values are shown for context, not in full

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const dbUser = await prisma.user.findUnique({
      where:  { id: session.user.id },
      select: { role: true, allowedApps: true },
    })
    if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "ADMIN_CENTRE")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    // Scanners can emit stray non-ASCII around the code — strip it before matching.
    const q = (searchParams.get("q") ?? "").replace(/[^\x20-\x7E]/g, "").trim()
    if (!q) return NextResponse.json({ error: "Enter a barcode or unique ID" }, { status: 400 })

    const ci = (value: string) => ({ equals: value, mode: "insensitive" as const })
    const cleanName = (n: string | null | undefined) => (n && n !== "null" ? n : "")
    const cap = (v: string | null) => {
      if (!v) return ""
      const s = v.replace(/\s+/g, " ").trim()
      return s.length > VALUE_CAP ? `${s.slice(0, VALUE_CAP)}…` : s
    }

    // Both identifier fields are checked — a lot is fully identified by either.
    const lots = await prisma.catalogueLot.findMany({
      where: { OR: [{ barcode: ci(q) }, { receiptUniqueId: ci(q) }] },
      select: {
        id: true, title: true, barcode: true, receiptUniqueId: true, receipt: true, tote: true,
        vendor: true, status: true, addedToBC: true, category: true, imageUrls: true,
        createdByName: true, createdAt: true, updatedAt: true,
        auction: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_LOTS,
    })

    const events = lots.length
      ? await prisma.catalogueLotEvent.findMany({
          where:   { lotId: { in: lots.map(l => l.id) } },
          orderBy: { changedAt: "desc" },
          take:    MAX_EVENTS,
          select: {
            lotId: true, action: true, source: true, field: true,
            oldValue: true, newValue: true, changedBy: true, changedAt: true,
          },
        })
      : []

    const bcItems = await prisma.warehouseItem.findMany({
      where: { OR: [{ uniqueId: ci(q) }, { barcode: ci(q) }] },
      select: {
        uniqueId: true, barcode: true, description: true, receiptNo: true, vendorNo: true, vendorName: true,
        catalogued: true, cataloguedBy: true, cataloguedAt: true, noOfPhotos: true,
        auctionCode: true, auctionName: true, lotNo: true, currentLotNo: true,
        location: true, binCode: true, toteNo: true,
      },
      take: MAX_LOTS,
    })

    return NextResponse.json({
      q,
      lots: lots.map(l => {
        const mine = events.filter(e => e.lotId === l.id)

        // One line per person: how many changes, and the window they worked in.
        const byPerson = new Map<string, { name: string; changes: number; firstAt: string; lastAt: string; created: boolean }>()
        for (const e of mine) {
          const name = e.changedBy || "Unknown"
          const at   = e.changedAt.toISOString()
          const p = byPerson.get(name)
          if (!p) byPerson.set(name, { name, changes: 1, firstAt: at, lastAt: at, created: e.action === "created" })
          else {
            p.changes++
            if (at < p.firstAt) p.firstAt = at
            if (at > p.lastAt)  p.lastAt  = at
            if (e.action === "created") p.created = true
          }
        }

        return {
          id: l.id,
          title: l.title,
          barcode: l.barcode ?? "",
          receiptUniqueId: l.receiptUniqueId ?? "",
          receipt: l.receipt ?? "",
          tote: l.tote ?? "",
          vendor: l.vendor ?? "",
          status: l.status,
          addedToBC: l.addedToBC,
          category: l.category ?? "",
          photos: l.imageUrls.length,
          saleId: l.auction?.id ?? "",
          saleCode: l.auction?.code ?? "",
          saleName: cleanName(l.auction?.name),
          // The authoritative "who catalogued it" — stamped when the lot was created.
          cataloguedBy: l.createdByName ?? "",
          cataloguedAt: l.createdAt.toISOString(),
          updatedAt: l.updatedAt.toISOString(),
          people: [...byPerson.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt)),
          history: mine.map(e => ({
            action: e.action, source: e.source ?? "", field: e.field,
            oldValue: cap(e.oldValue), newValue: cap(e.newValue),
            changedBy: e.changedBy, changedAt: e.changedAt.toISOString(),
          })),
        }
      }),
      bc: bcItems.map(w => {
        const cat = lookupCataloguerByCode(w.cataloguedBy)
        return {
          uniqueId: w.uniqueId,
          barcode: w.barcode ?? "",
          description: w.description ?? "",
          receiptNo: w.receiptNo ?? "",
          vendorNo: w.vendorNo ?? "",
          vendorName: w.vendorName ?? "",
          catalogued: w.catalogued === true,
          // BC stores a staff CODE (e.g. "KS") — resolve it, nobody should read initials.
          cataloguedByCode: w.cataloguedBy?.trim() ?? "",
          cataloguedByName: cat?.name ?? "",
          cataloguedAt: w.cataloguedAt?.toISOString() ?? "",
          photos: w.noOfPhotos ?? 0,
          saleCode: w.auctionCode ?? "",
          saleName: cleanName(w.auctionName),
          lotNo: w.currentLotNo || w.lotNo || "",
          location: [w.location, w.binCode].filter(Boolean).join(" · "),
          toteNo: w.toteNo ?? "",
        }
      }),
      historyCapped: events.length >= MAX_EVENTS,
    })
  } catch (e: any) {
    console.error("lot-lookup/who error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
