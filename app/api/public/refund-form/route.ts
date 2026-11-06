import { NextRequest, NextResponse } from "next/server"
import { createHash, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"
import { REFUND_FEED_MAX_BYTES, readRefundFeed, refundFeedKey } from "@/lib/refunds-feed"
import { isMissingRefunds, matchCustomerId, nextRefundRef, tidyCustomerNo, writeRefundEvent } from "@/lib/refunds-server"
import { dayToStored } from "@/lib/uncollected"

// POST /api/public/refund-form: the Power Automate flow's way in. Customers fill in the Microsoft Form,
// the flow sends each response here, and it lands in Accounts → Refunds as New (Jack, 2026-11-06: "we
// will make a new form and a new flow to put it in to the hub"). See RULES.md "Refund form".
//
// ⚠ NOT a public form. Nothing happens without REFUND_FORM_SECRET, sent by the flow as
// "Authorization: Bearer <key>". An environment without it set turns everything away. The key lives only
// in Railway and in the flow: never in a URL, the repo or the memory page.
//
// ⚠ WRITE-ONLY. It answers {ok:true} and nothing about any record, and never logs what was sent.
//
// A failure answers 5xx so the flow retries and its run history shows it. Sending the same response
// again is safe: Refund.importKey is unique (refundFeedKey).

const BY_FORM = { id: null, name: "Refund form" }
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest()

/** The flow's key, compared as hashes so the comparison takes the same time whatever was sent. */
function keyMatches(req: NextRequest): boolean {
  const secret = process.env.REFUND_FORM_SECRET?.trim()
  if (!secret) return false
  const sent = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "")?.[1] ?? ""
  return timingSafeEqual(sha256(sent), sha256(secret))
}

/** What to log about a fault: its kind and code. ⚠ Never a Prisma error's message, which can carry the
 *  values being written. */
function describe(e: unknown): string {
  const err = e as { name?: string; code?: string } | null
  return `${err?.name ?? "Error"}${err?.code ? ` ${err.code}` : ""}`
}

export async function POST(req: NextRequest) {
  if (!keyMatches(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const tooBig = () => NextResponse.json({ error: "That's too much for one form response." }, { status: 413 })
  if (Number(req.headers.get("content-length") ?? 0) > REFUND_FEED_MAX_BYTES) return tooBig()

  let raw: unknown
  try {
    const text = await req.text()
    if (text.length > REFUND_FEED_MAX_BYTES) return tooBig()
    raw = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "That wasn't JSON." }, { status: 400 })
  }

  const check = readRefundFeed(raw)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
  const v = check.value
  const importKey = sha256(refundFeedKey(v.responseId)).toString("hex")
  const isIn = async () => !!(await prisma.refund.findUnique({ where: { importKey }, select: { id: true } }))

  try {
    if (await isIn()) return NextResponse.json({ ok: true })

    // A buyer number that isn't a C-number can't be matched, so it stays in the details as typed.
    const customerNo = tidyCustomerNo(v.customerNo)
    const typedNo = v.customerNo && !customerNo ? `Customer number as typed: ${v.customerNo}` : ""
    const details = [v.details, typedNo].filter(Boolean).join("\n\n") || null
    const customerId = await matchCustomerId(customerNo)

    await prisma.$transaction(async (tx) => {
      const ref = await nextRefundRef(tx)
      const created = await tx.refund.create({
        data: {
          ref,
          source: "form",
          importKey,
          status: "new",
          party: "buyer",
          receivedAt: new Date(),
          name: v.name,
          email: v.email,
          customerNo,
          customerId,
          auctionDate: v.auctionDate ? dayToStored(v.auctionDate) : null,
          lotsText: v.lotsText,
          reason: v.reason,
          details,
          photoKeys: [],
        },
        select: { id: true },
      })
      await writeRefundEvent(tx, created.id, "created", "Sent in on the Microsoft Form", BY_FORM)
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    // Two sends of one response at once: the second loses the unique key, and it's in.
    if ((e as { code?: string } | null)?.code === "P2002" && (await isIn().catch(() => false))) {
      return NextResponse.json({ ok: true })
    }
    if (isMissingRefunds(e)) return NextResponse.json({ error: "The Refunds tables aren't ready yet." }, { status: 503 })
    console.error("refund-form error:", describe(e))
    return NextResponse.json({ error: "That couldn't be saved. Try again." }, { status: 500 })
  }
}
