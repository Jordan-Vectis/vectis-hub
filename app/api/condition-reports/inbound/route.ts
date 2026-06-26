import { NextRequest, NextResponse } from "next/server"
import { ingestConditionEmail, loadAuctionCandidates } from "@/lib/condition-ingest"

export const maxDuration = 60

// POST /api/condition-reports/inbound?key=SECRET
// Public webhook hit by Power Automate (or Make) when a condition-report email
// arrives in admin@vectis.co.uk (or a chosen folder). No Microsoft admin consent
// needed — the flow runs on the user's own delegated access and just POSTs the
// email here. Secured by the CONDITION_INBOUND_SECRET shared key.

function pick(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = k.split(".").reduce((o: any, part) => (o == null ? o : o[part]), obj)
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

// Parse "Name <email>", a bare email, or a JSON {address,name} into name/email.
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

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CONDITION_INBOUND_SECRET
    const key = req.nextUrl.searchParams.get("key")
    if (!secret || key !== secret) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    // Accept JSON (recommended) or form-encoded bodies.
    const ct = req.headers.get("content-type") || ""
    let body: any
    if (ct.includes("application/json")) {
      body = await req.json()
    } else {
      const form = await req.formData()
      body = Object.fromEntries(
        Array.from(form.entries())
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => [k, v as string]),
      )
    }

    const subject    = pick(body, ["Subject", "subject", "headers.Subject"]) || "(no subject)"
    const html       = pick(body, ["BodyHtml", "Body", "html", "bodyHtml", "HtmlBody"])
    const text       = pick(body, ["BodyPreview", "Text", "TextBody", "text", "plain", "bodyText", "bodyPreview"])
    const fromRaw    = pick(body, ["From", "from", "Sender", "sender", "FromEmail"])
    const messageId  = (pick(body, ["MessageId", "InternetMessageId", "messageId", "Message-Id", "Message-ID"]) || "")
      .replace(/[<>]/g, "").trim() || null
    const webLink    = pick(body, ["WebLink", "webLink"])
    const receivedRaw = pick(body, ["ReceivedDateTime", "receivedAt", "DateTimeReceived", "received"])

    if (!html && !text) {
      return NextResponse.json({ error: "No email body provided (send Body/BodyHtml or Text)" }, { status: 400 })
    }

    const from = parseAddress(fromRaw)
    const receivedAt = receivedRaw && !isNaN(Date.parse(receivedRaw)) ? new Date(receivedRaw) : new Date()

    const result = await ingestConditionEmail({
      subject,
      text:              text ?? "",
      html:              html ?? null,
      envelopeFromName:  from.name,
      envelopeFromEmail: from.email,
      messageId,
      webLink:           webLink ?? null,
      receivedAt,
    }, loadAuctionCandidates)

    return NextResponse.json({ ok: true, created: result.created, duplicate: result.duplicate ?? false })
  } catch (e: any) {
    console.error("condition-reports inbound error:", e)
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
