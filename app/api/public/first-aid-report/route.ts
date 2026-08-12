import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"

// PUBLIC, UNAUTHENTICATED WRITE — the only one on the First Aid page.
//
// ⚠⚠ GOVERNING RULE: an accident report must NEVER be silently lost, and a genuine reporter
// must NEVER be turned away. This is the accident book. Everything below follows from that.
//
// The first cut got both wrong (found in review, 2026-08-11):
//   - the honeypot returned {ok:true} and the page said "Report sent" — so a password manager
//     filling the hidden field meant a real injury was binned with nobody able to tell;
//   - a per-IP hourly cap refused everyone on site after 5 reports, because the whole building
//     shares one office NAT address, and the global cap could be tripped deliberately to take
//     the accident book offline for an hour.
//
// So suspicious submissions are FLAGGED AND STORED, not refused. A human sees them in the Hub
// and deletes the rubbish; nothing is ever thrown away by a heuristic. The only hard refusal
// left is an absurd flood, purely to protect the database.

// Far above any believable real use — this exists to stop a runaway, not to police people.
const HARD_CEILING_PER_HOUR = 500
// Above these, a report is still SAVED, just marked for a human to glance at.
const SUSPECT_PER_IP_PER_HOUR = 20

// The IP is hashed, never stored raw: it is only ever compared against other hashes, so keeping
// the address would collect personal data for no benefit. AUTH_SECRET salts it, so the hashes
// are useless outside this deployment.
// ⚠ x-forwarded-for is client-supplied at the left-hand end, so this is a weak signal and is
// deliberately only ever used to FLAG, never to reject.
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

    const reporterName = str(body.reporterName, 100)
    const description  = str(body.description, 4000)
    if (!reporterName)           return NextResponse.json({ error: "Please add your name." }, { status: 400 })
    if (description.length < 10) return NextResponse.json({ error: "Please say a bit more about what happened." }, { status: 400 })

    const ipHash = hashIp(req)
    const since  = new Date(Date.now() - 60 * 60 * 1000)

    let recentFromIp = 0
    let recentTotal  = 0
    try {
      ;[recentFromIp, recentTotal] = await Promise.all([
        prisma.accidentReport.count({ where: { ipHash, createdAt: { gte: since } } }),
        prisma.accidentReport.count({ where: { createdAt: { gte: since } } }),
      ])
    } catch {
      // Counting is only used to decide the FLAG. If it fails, save the report anyway —
      // losing a real one to a failed count would be the worst possible trade.
    }

    if (recentTotal >= HARD_CEILING_PER_HOUR) {
      return NextResponse.json(
        { error: "Something has gone wrong with this form. Please tell the office directly." },
        { status: 429 },
      )
    }

    // Honeypot: a hidden field only an automated filler touches. It no longer discards the
    // report — a browser or password manager can fill it in for a real person.
    const honeypot = !!str(body.hp_ref, 20)
    const suspect  = honeypot || recentFromIp >= SUSPECT_PER_IP_PER_HOUR

    // datetime-local arrives as "2026-08-12T14:30" — keep it only if it really parses, and
    // never let a bad string throw: losing an accident report to a date typo is unacceptable.
    const rawWhen = str(body.happenedOn, 40)
    const when    = rawWhen ? new Date(rawWhen) : null
    const happenedOn = when && !Number.isNaN(when.getTime()) ? when : null

    await prisma.accidentReport.create({
      data: {
        reporterName,
        reporterPhone:      str(body.reporterPhone, 40)       || null,
        reporterAddress:    str(body.reporterAddress, 300)    || null,
        reporterOccupation: str(body.reporterOccupation, 100) || null,
        injuredName:        str(body.injuredName, 100)        || null,
        injuredAddress:     str(body.injuredAddress, 300)     || null,
        injuredOccupation:  str(body.injuredOccupation, 100)  || null,
        happenedOn,
        // Kept as free text too, so a date that would not parse is still on the record rather
        // than silently dropped.
        happenedAt:    rawWhen || str(body.happenedAt, 100)   || null,
        location:      str(body.location, 150)                || null,
        description,
        injuryDetails: str(body.injuryDetails, 1000)          || null,
        ipHash,
        status: suspect ? "SUSPECT" : "NEW",
      },
    })

    // Nothing about the record comes back — not even its id, and not whether it was flagged.
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("first-aid-report error:", e)
    return NextResponse.json({ error: "Could not send that just now." }, { status: 500 })
  }
}
