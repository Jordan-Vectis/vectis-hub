import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET — list all saved web descriptions
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const descriptions = await prisma.webDescription.findMany({
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ descriptions })
  } catch (e: any) {
    console.error("web-descriptions GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}

// POST — save a web description
export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { auctionId, description } = await req.json()
    if (!auctionId || !description) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const auction = await prisma.catalogueAuction.findUnique({
      where: { id: auctionId },
      select: { id: true, code: true, name: true },
    })
    if (!auction) return NextResponse.json({ error: "Auction not found" }, { status: 404 })

    // Upsert — one description per auction (overwrite if exists)
    const existing = await prisma.webDescription.findFirst({ where: { auctionId } })

    const saved = existing
      ? await prisma.webDescription.update({
          where: { id: existing.id },
          data: { description, auctionCode: auction.code, auctionName: auction.name },
        })
      : await prisma.webDescription.create({
          data: {
            auctionId,
            auctionCode: auction.code,
            auctionName: auction.name,
            description,
          },
        })

    return NextResponse.json({ description: saved })
  } catch (e: any) {
    console.error("web-descriptions POST error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
