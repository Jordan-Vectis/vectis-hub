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

// When an internal mailbox (admin@, accounts@, returns@ …) forwards a customer
// email in, the real customer sits in the quoted "From: Name <email>" in the
// body. Return the first EXTERNAL (non-@vectis.co.uk) one found.
function extractOriginalSender(body: string | null): { name: string | null; email: string | null } | null {
  if (!body) return null
  const isInternal = (e: string) => e.toLowerCase().endsWith("@vectis.co.uk")
  let m: RegExpExecArray | null
  const re = /From:\s*"?([^"<\n]*?)"?\s*<([^>\s@]+@[^>\s]+)>/gi
  while ((m = re.exec(body))) {
    if (!isInternal(m[2])) return { name: m[1].trim() || null, email: m[2].trim() }
  }
  const re2 = /From:\s*([^\s<>@]+@[^\s<>]+)/gi
  while ((m = re2.exec(body))) {
    if (!isInternal(m[1])) return { name: null, email: m[1].trim() }
  }
  return null
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
      const t = headersRaw.trim()
      // Make may send headers as a JSON array [{name,value}] / map, or as raw text.
      if (t.startsWith("[") || t.startsWith("{")) {
        try {
          const parsed = JSON.parse(t)
          const arr = Array.isArray(parsed)
            ? parsed
            : Object.entries(parsed).map(([k, v]) => ({ name: k, value: v }))
          const found = arr.find((h: any) => (h.name || h.key || h.Name || "").toString().toLowerCase() === name.toLowerCase())
          if (found) return (found.value ?? found.Value ?? "").toString().replace(/\s+/g, " ").trim() || null
          return null
        } catch { /* fall through to text parse */ }
      }
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

    let senderEmail = replyToParsed.email || fromParsed.email
    let senderName  = replyToParsed.name  || explicitName || fromParsed.name
    let content = text || (html ? stripHtml(html) : "")

    // Office 365 Conversation Id — same across an original email and all its
    // replies. Power Automate stamps it into the body as "VH-CID: <id>" (it
    // survives the relay, unlike the hidden thread headers). Strip it from view.
    let conversationId = pick(body, ["ConversationId", "conversationId", "Conversation-Id"])
    const cidMatch = content.match(/VH-CID:\s*(\S+)/i)
    if (cidMatch) { conversationId = conversationId || cidMatch[1] }
    content = content.replace(/^\s*VH-CID:\s*\S+\s*/i, "").trim()

    if (content.length > 20000) content = content.slice(0, 20000) + "…"

    // If forwarded in by an internal mailbox, resolve the real customer from the
    // quoted "From:" inside the body.
    if (senderEmail && senderEmail.toLowerCase().endsWith("@vectis.co.uk")) {
      const orig = extractOriginalSender(content)
      if (orig?.email) { senderEmail = orig.email; senderName = orig.name ?? senderName }
    }

    const threadKey = normaliseSubject(subject)

    // Duplicate of an email we've already turned into a job?
    if (messageId) {
      const dupe = await prisma.iTJob.findUnique({ where: { graphMessageId: messageId }, select: { id: true } })
      if (dupe) return NextResponse.json({ ok: true, duplicate: true })
    }

    // Is this a reply on an existing thread?
    // 1) Conversation Id — exact, reliable (preferred).
    // 2) In-Reply-To/References headers — exact, when present.
    // 3) Normalised subject — last-resort fallback only.
    let parent: { id: string } | null = null
    if (conversationId) {
      parent = await prisma.iTJob.findFirst({
        where:  { conversationId, status: { not: "DONE" } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    }
    const refIds = [...extractIds(inReplyTo), ...extractIds(references)]
    if (!parent && refIds.length) {
      parent = await prisma.iTJob.findFirst({
        where:  { graphMessageId: { in: refIds } },
        select: { id: true },
      })
    }
    if (!parent && !conversationId && threadKey) {
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
        conversationId: conversationId ?? null,
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
