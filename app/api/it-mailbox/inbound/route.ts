import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const maxDuration = 30

// POST /api/it-mailbox/inbound?key=SECRET
// Public webhook hit by the inbound-email service (Make) when an email is
// forwarded from IT@vectis.co.uk. Creates an ITJob, OR — if it's a reply on an
// existing thread — appends it as a REPLY message and flags the job.
// Secured by the IT_INBOUND_SECRET shared key.

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

// Parse an address value that might be a plain email, "Name <email>", or a
// JSON object like {"address":"x@y.com","name":"X"} (Make sends Sender as JSON).
function parseAddress(raw: string | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null }
  const s = raw.trim()
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s)
      const email = (o.address || o.email || o.Address || o.Email || "").toString().trim() || null
      const name  = (o.name || o.Name || "").toString().trim() || null
      if (email) return { name, email }
    } catch { /* fall through */ }
  }
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, email: m[2].trim() }
  if (s.includes("@")) return { name: null, email: s.replace(/[<>]/g, "").trim() }
  return { name: null, email: null }
}

// Normalise a subject for thread matching: drop leading Re:/Fw:/Fwd: and case.
function normaliseSubject(s: string): string {
  let out = s.toLowerCase().trim()
  let prev
  do {
    prev = out
    out = out.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, "").trim()
  } while (out !== prev)
  return out
}

// Pull bare message-ids (without angle brackets) out of a References/In-Reply-To header.
function extractIds(raw: string | null): string[] {
  if (!raw) return []
  const ids = raw.match(/<[^>]+>/g)
  if (ids) return ids.map((m) => m.replace(/[<>]/g, "").trim())
  return raw.split(/\s+/).map((m) => m.replace(/[<>]/g, "").trim()).filter(Boolean)
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.IT_INBOUND_SECRET
    const key = req.nextUrl.searchParams.get("key")
    if (!secret || key !== secret) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const ct = req.headers.get("content-type") || ""
    let body: any
    if (ct.includes("application/json")) {
      body = await req.json()
    } else {
      const form = await req.formData()
      body = Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, typeof v === "string" ? v : ""]))
    }

    const subject   = pick(body, ["Subject", "subject", "headers.Subject"]) || "(no subject)"
    const fromRaw   = pick(body, ["FromFull.Email", "From", "from", "sender", "Sender", "envelope.from"])
    const explicitName = pick(body, ["FromName", "from_name", "FromFull.Name"])
    const text      = pick(body, ["StrippedTextReply", "TextBody", "plain", "text", "body-plain"])
    const html      = pick(body, ["HtmlBody", "html", "body-html"])
    // Thread IDs can come as explicit fields OR be dug out of a raw "Headers" blob
    // (Make's mailhook exposes the whole header block as a single "Headers" value).
    const headersRaw = pick(body, ["Headers", "headers_raw", "RawHeaders"])
    const headerLine = (name: string): string | null => {
      if (!headersRaw) return null
      const m = headersRaw.match(new RegExp(`^${name}:\\s*(.+(?:\\r?\\n[ \\t]+.+)*)`, "im"))
      return m ? m[1].replace(/\s+/g, " ").trim() : null
    }
    const messageId = (pick(body, ["MessageID", "MessageId", "message_id", "Message-Id", "Message-ID"]) || headerLine("Message-ID"))?.replace(/[<>]/g, "") ?? null
    const inReplyTo  = pick(body, ["InReplyTo", "In-Reply-To", "in_reply_to"]) || headerLine("In-Reply-To")
    const references = pick(body, ["References", "references"]) || headerLine("References")

    // When relayed by Power Automate the email is "from" the relay account, so the
    // real requester is carried in Reply-To. Prefer it for the requester details.
    const fromParsed    = parseAddress(fromRaw)
    const replyToParsed = parseAddress(pick(body, ["ReplyTo", "Reply-To", "reply_to"]) || headerLine("Reply-To"))

    const senderEmail = replyToParsed.email || fromParsed.email
    const senderName  = replyToParsed.name  || explicitName || fromParsed.name
    let content = text || (html ? stripHtml(html) : "")
    if (content.length > 8000) content = content.slice(0, 8000) + "…"
    const threadKey = normaliseSubject(subject)

    // Duplicate of an email we've already turned into a job?
    if (messageId) {
      const dupe = await prisma.iTJob.findUnique({ where: { graphMessageId: messageId }, select: { id: true } })
      if (dupe) return NextResponse.json({ ok: true, duplicate: true })
    }

    // Is this a reply on an existing thread?
    let parent: { id: string } | null = null
    const refIds = [...extractIds(inReplyTo), ...extractIds(references)]
    if (refIds.length) {
      parent = await prisma.iTJob.findFirst({
        where:  { graphMessageId: { in: refIds } },
        select: { id: true },
      })
    }
    if (!parent && threadKey) {
      parent = await prisma.iTJob.findFirst({
        where:  { threadKey, status: { not: "DONE" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    }

    if (parent) {
      await prisma.iTJobMessage.create({
        data: {
          jobId:       parent.id,
          kind:        "REPLY",
          authorName:  senderName ?? null,
          authorEmail: senderEmail,
          body:        content,
        },
      })
      await prisma.iTJob.update({
        where: { id: parent.id },
        data:  { hasNewReply: true, updatedAt: new Date() },
      })
      return NextResponse.json({ ok: true, reply: true })
    }

    await prisma.iTJob.create({
      data: {
        title:          subject.slice(0, 300),
        body:           content,
        fromName:       senderName ?? null,
        fromEmail:      senderEmail,
        status:         "NEW",
        source:         "EMAIL",
        graphMessageId: messageId,
        threadKey,
        receivedAt:     new Date(),
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("it-mailbox inbound error:", e)
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
