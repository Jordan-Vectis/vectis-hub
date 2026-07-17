import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { isJordan } from "@/lib/jordan-auth"
import { getSignedImageUrl } from "@/lib/r2"

// GET /api/jordan/mcoc/war-path — the owner's saved Alliance War path: an ordered
// list of fights, each with its defender and a signed URL for its nodes photo.
// Locked to jordan.orange.
export async function GET() {
  try {
    const session = await auth()
    if (!session || !(await isJordan())) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const rows = await prisma.mcocWarFight.findMany({
      where: { ownerId: session.user.id },
      orderBy: { order: "asc" },
    })
    const fights = await Promise.all(rows.map(async (r) => ({
      id: r.id,
      defender: r.defender,
      nodesImageUrl: r.nodesImageKey ? await getSignedImageUrl(r.nodesImageKey) : null,
    })))
    return NextResponse.json({ fights })
  } catch (e: any) {
    console.error("jordan/mcoc/war-path error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
