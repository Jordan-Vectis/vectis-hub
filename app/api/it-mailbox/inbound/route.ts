import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const maxDuration = 30

// POST /api/it-mailbox/inbound?key=SECRET
// Public webhook hit by an inbound-email service (e.g. Postmark Inbound) when a
// new email is forwarded from IT@vectis.co.uk. Creates an ITJob, deduped by the
// email Message-ID. Secured by the IT_INBOUND_SECRET shared key (the email
// service isn't a logged-in user, so it can't use a session).

function pick(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = k.split(".").reduce((o: any, part) => (o == null ? o : o[part]), obj)
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.IT_INBOUND_SECRET
    const key = req.nextUrl.searchParams.get("key")
    if (!secret || key !== secret) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Accept JSON (Postmark/CloudMailin) or form-encoded (Mailgun/SendGrid)
    const ct = req.headers.get("content-type") || ""
    let body: any
    if (ct.includes("application/json")) {
      body = await req.json()
    } else {
      const form = await req.formData()
      body = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""]))
    }

    const subject   = pick(body, ["Subject", "subject", "headers.Subject"]) || "(no subject)"
    const fromEmail = pick(body, ["FromFull.Email", "From", "from", "sender", "envelope.from"])
    const fromName  = pick(body, ["FromFull.Name", "FromName", "from_name"])
    const text      = pick(body, ["StrippedTextReply", "TextBody", "plain", "text", "body-plain"])
    const html      = pick(body, ["HtmlBody", "html", "body-html"])
    const messageId = pick(body, ["MessageID", "MessageId", "message_id", "Message-Id", "headers.Message-ID"])

    const fromEmailClean = fromEmail?.replace(/^.*<([^>]+)>.*$/, "$1") ?? null

    let job = text || (html ? stripHtml(html) : "")
    if (job.length > 8000) job = job.slice(0, 8000) + "…"

    // Dedupe by Message-ID when present
    if (messageId) {
      const existing = await prisma.iTJob.findUnique({ where: { graphMessageId: messageId }, select: { id: true } })
      if (existing) return NextResponse.json({ ok: true, duplicate: true })
    }

    await prisma.iTJob.create({
      data: {
        title:          subject.slice(0, 300),
        body:           job,
        fromName:       fromName ?? null,
        fromEmail:      fromEmailClean,
        status:         "NEW",
        source:         "EMAIL",
        graphMessageId: messageId ?? null,
        receivedAt:     new Date(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("it-mailbox inbound error:", e)
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
