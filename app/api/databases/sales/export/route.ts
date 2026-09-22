import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { SITE_IMAGES } from "@/lib/archive-site"

export const dynamic = "force-dynamic"

// GET /api/databases/sales/export — every sale as CSV: for a backup, or a future website.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

    type R = { siteId: number; auctionId: number | null; code: string | null; title: string; saleDate: Date | null; lots: number; finished: boolean; heroUrl: string | null; heroKey: string | null }
    let rows: R[]
    try {
      rows = await prisma.$queryRaw<R[]>`SELECT "siteId", "auctionId", "code", "title", "saleDate", "lots", "finished", "heroUrl", "heroKey" FROM "ArchiveSale" ORDER BY "siteId"`
    } catch (e: any) {
      if (!/heroUrl|heroKey|"code"/i.test(String(e?.message ?? ""))) throw e
      rows = (await prisma.$queryRaw<Omit<R, "code" | "heroUrl" | "heroKey">[]>`SELECT "siteId", "auctionId", "title", "saleDate", "lots", "finished" FROM "ArchiveSale" ORDER BY "siteId"`)
        .map(r => ({ ...r, code: null, heroUrl: null, heroKey: null }))
    }
    const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const lines = ["SiteSaleId,AuctionID,Code,Title,Date,Lots,Finished,PictureFile,PictureOnWebsite"]
    for (const r of rows) {
      lines.push([
        r.siteId, r.auctionId ?? "", r.code ?? "", r.title, r.saleDate ? r.saleDate.toISOString().slice(0, 10) : "", r.lots, r.finished ? "yes" : "no",
        r.heroKey ?? "", r.heroUrl ? SITE_IMAGES + r.heroUrl : "",
      ].map(cell).join(","))
    }
    return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vectis-sales-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    })
  } catch (e: any) {
    console.error("databases/sales/export error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
