import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { buildReceiptPdf } from "@/lib/goods-in/pdf"
import { cleanEmail, escapeHtml, mailStatus, receiptsMailbox, sendReceiptEmail } from "@/lib/goods-in/mail"
import { errorJson, failure, gate, loadReceiptForPdf, londonLongDate } from "../../../_lib/shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

// POST /api/goods-in/receipt/R010244/email   { to: "customer@example.com" }  →  { ok: true, emailedTo, emailedAt } | { ok: false, error }
//
// Emails the receipt PDF to the customer from the receipts mailbox, then records who it went to
// and when (shown on the receipt page). Anyone with Warehouse access. When the mailbox isn't
// connected yet the answer says so plainly — the clerk can still print it or download it.

const NOT_SET_UP = "Email isn't set up yet — an admin connects the receipts mailbox in Goods In → Settings. Until then, print the receipt, or download it and email it by hand."

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await gate("warehouse")
    if (g.res) return g.res

    const { id } = await params
    const body = (await req.json().catch(() => null)) as { to?: unknown } | null
    const to = cleanEmail(body?.to)
    if (!to) return errorJson("That email address doesn't look right — check it and try again.", 400)

    const mail = await mailStatus()
    if (!mail.connected) return errorJson(NOT_SET_UP, 409)

    const r = await loadReceiptForPdf(id)
    if (!r) return errorJson(`Receipt ${id.toUpperCase()} couldn't be found.`, 404)
    if (r.status === "void") return errorJson(`Receipt ${r.pdf.id} has been voided, so it can't be emailed.`, 409)
    if (r.pdf.containers.length === 0) return errorJson(`Receipt ${r.pdf.id} has no totes or pallets on it yet, so there's nothing to send.`, 409)

    const pdf = await buildReceiptPdf(r.pdf)
    const c = r.pdf.customer
    const dear = [c.salutation, c.name].filter(Boolean).join(" ").trim() || "Sir or Madam"
    const n = r.pdf.containers.length
    const html = [
      `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">`,
      `<p>Dear ${escapeHtml(dear)},</p>`,
      `<p>Thank you for consigning your items to Vectis Auctions.</p>`,
      `<p>Your receipt, <b>${escapeHtml(r.pdf.id)}</b>, is attached. It lists the ${n} ${n === 1 ? "tote or pallet" : "totes and pallets"} booked in on ${escapeHtml(londonLongDate(r.pdf.createdAt))} and the terms they were booked in on. Please keep it for your records.</p>`,
      `<p>If anything on it isn't right, or you have any questions, please reply to this email or call us on 01642 750 616.</p>`,
      `<p>Kind regards,<br>Vectis Auctions</p>`,
      `<p style="font-size:12px;color:#666;border-top:1px solid #ddd;padding-top:8px;margin-top:16px">`,
      `Vectis Auctions, Fleck Way, Stockton-on-Tees, TS17 9JZ<br>`,
      `(+44) 01642 750 616 &middot; <a href="mailto:${escapeHtml(receiptsMailbox())}" style="color:#2e328e">${escapeHtml(receiptsMailbox())}</a> &middot; <a href="https://www.vectis.co.uk" style="color:#2e328e">www.vectis.co.uk</a><br>`,
      `Registered in England and Wales No. 03298762, VAT No. 647566303`,
      `</p></div>`,
    ].join("")

    await sendReceiptEmail({ to, subject: `Your Vectis Auctions receipt ${r.pdf.id}`, html, pdf, filename: `Receipt-${r.pdf.id}.pdf` })

    // Sent — record it. If only the record fails, the customer still has the email, so say it went.
    const emailedAt = new Date()
    await prisma.goodsInReceipt.update({ where: { id: r.pdf.id }, data: { emailedAt, emailedTo: to } })
      .catch(e => console.error("goods-in receipt email: sent, but couldn't record it:", e))

    return NextResponse.json({ ok: true, emailedTo: to, emailedAt: emailedAt.toISOString() })
  } catch (e) {
    return failure("receipt email", e)
  }
}
