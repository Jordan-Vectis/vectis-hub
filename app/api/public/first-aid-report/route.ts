import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"

// PUBLIC, UNAUTHENTICATED WRITE — the only one on the First Aid page. It sits under /api/public,
// which was already on the login allowlist, so adding it opened nothing new.
//
// It is deliberately write-only: it never returns a report, a count, or anything about the
// database, so it cannot be used to read the Hub or probe for records. Protections below.

const MAX_PER_IP_PER_HOUR = 5
const MAX_PER_HOUR_TOTAL  = 60

// The IP is hashed, never stored raw: it is only ever compared against other hashes for rate
// limiting, so keeping the address itself would collect personal data for no extra benefit.
// AUTH_SECRET is the salt, so the hashes are useless outside this deployment.
function hashIp(req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
        || req.headers.get("x-real-ip")
        || "unknown"
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? "vectis"}:${ip}`).digest("hex").slice(0, 32)
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Nothing was sent." }, { status: 400 })

    // Honeypot — a hidden field only a bot fills in. Answer 200 so it learns nothing.
    if (str(body.website, 10)) return NextResponse.json({ ok: true })

    const reporterName = str(body.reporterName, 100)
    const description  = str(body.description, 4000)
    if (!reporterName)      return NextResponse.json({ error: "Please add your name." }, { status: 400 })
    if (description.length < 10) return NextResponse.json({ error: "Please say a bit more about what happened." }, { status: 400 })

    const ipHash = hashIp(req)
    const since  = new Date(Date.now() - 60 * 60 * 1000)

    // Two limits: one per sender so nobody can flood it, and one overall so a botnet spreading
    // across many addresses still cannot fill the table. Both fail CLOSED with a plain message.
    const [fromThisIp, totalRecent] = await Promise.all([
      prisma.accidentReport.count({ where: { ipHash, createdAt: { gte: since } } }),
      prisma.accidentReport.count({ where: { createdAt: { gte: since } } }),
    ])
    if (fromThisIp >= MAX_PER_IP_PER_HOUR || totalRecent >= MAX_PER_HOUR_TOTAL) {
      return NextResponse.json(
        { error: "Too many reports have been sent from here recently. Please tell the office directly." },
        { status: 429 },
      )
    }

    await prisma.accidentReport.create({
      data: {
        reporterName,
        reporterPhone: str(body.reporterPhone, 40)  || null,
        injuredName:   str(body.injuredName, 100)   || null,
        happenedAt:    str(body.happenedAt, 100)    || null,
        location:      str(body.location, 150)      || null,
        description,
        ipHash,
      },
    })

    // Nothing about the record comes back — not even its id.
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("first-aid-report error:", e)
    return NextResponse.json({ error: "Could not send that just now." }, { status: 500 })
  }
}
