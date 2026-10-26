import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { uploadBufferToR2 } from "@/lib/r2"
import { REFUND_FORM_PATH, REFUND_LIMITS, REFUND_PHOTO_PREFIX } from "@/lib/refunds"
import { isMissingRefunds, matchCustomerId, nextRefundRef, tidyCustomerNo, writeRefundEvent } from "@/lib/refunds-server"
import { REFUND_REQUEST_MAX_BYTES, TOO_MANY_PHOTOS, checkRefundForm, checkRefundPhoto, type RefundPhotoType } from "@/lib/refunds-public"
import { londonDay } from "@/lib/uncollected"

// PUBLIC, UNAUTHENTICATED WRITE — the refund form at /refund (Accounts → Refunds), the Hub's own
// replacement for the Microsoft Form on vectis.co.uk. Built like the First Aid report
// (app/api/public/first-aid-report): /api/public was already public, so it opens nothing new.
//
// ⚠ WRITE-ONLY. It answers {ok:true} and NOTHING about any record — not the id, not even the request's
// RF number (that's sequential: one request would tell anyone how many Vectis has ever had, and two
// how fast they come), not whether it was flagged or matched a customer. Staff quote the RF number when
// they reply by email. Errors are {error} in plain words for the customer.
//
// ⚠ A real customer must never be turned away by a heuristic. So, as on First Aid, a suspicious
// request is SAVED AND FLAGGED (suspect), never refused: the honeypot can be filled by a password
// manager for a real person, and a whole office can share one address. A human sees the flag in the
// Hub and deletes the rubbish. The only refusals are floods, to protect the database and this process
// (which is the whole staff Hub too) — every limit far above any believable real use:
//   • per address, every attempt in this process, BEFORE the body is read (ATTEMPTS_PER_IP_PER_HOUR) —
//     the database only counts what was SAVED, so requests that fail the checks would never count;
//   • a few requests read at once, across everyone (MAX_IN_FLIGHT) — each can be 20MB, held twice
//     while it's parsed;
//   • per address, requests saved in the last hour (PER_IP_CEILING_PER_HOUR), so one sender can't use
//     up the overall ceiling for every real customer;
//   • the overall hourly ceiling (HARD_CEILING_PER_HOUR), for a spread-out botnet.
//
// The browser's own submit (no JavaScript — an old iPad, a page that never finished loading) posts
// here too, with everything in the BODY (the form has method="post" — never a GET, which would put
// the customer's details in the address). That gets a redirect back to /refund?sent=1 or
// ?problem=<what>, never raw JSON.
//
// ⚠ Never log what was sent (names, emails, what happened) — only the refund's id and the error.

// Far above any believable real use — this exists to stop a runaway, not to police people.
const HARD_CEILING_PER_HOUR = 300
// One address can't save more than this in an hour (a whole office sharing one would never get near).
const PER_IP_CEILING_PER_HOUR = 30
// Above this from one address in an hour, a request is still SAVED, just marked for a human to glance at.
const SUSPECT_PER_IP_PER_HOUR = 10
// Attempts (saved or not) from one address in an hour, counted in this process before anything is read.
const ATTEMPTS_PER_IP_PER_HOUR = 60
// Requests being read and saved at once, across everyone.
const MAX_IN_FLIGHT = 3
const HOUR_MS = 60 * 60 * 1000

const NOT_READY = "The refund form isn't ready yet — please try again later."
const TOO_BIG = "That's too much to send in one go — please send fewer photos."
const FAILED = "Something went wrong sending that — please try again in a minute."
const BUSY_HOUR = "A lot of requests are coming in just now — please try again in an hour."
const BUSY_MINUTE = "A lot of requests are coming in just now — please try again in a minute."
const BY_FORM = { id: null, name: "Refund form" }

// ── This process's own counts (the database only knows what was saved) ─────────────────────
const attempts = new Map<string, number[]>()
let inFlight = 0

/** Notes one attempt from an address and answers how many it has made in the last hour. Kept small:
 *  each address keeps only as many times as the limit needs, and addresses quiet for an hour go. */
function noteAttempt(ipHash: string, now: number): number {
  const recent = (attempts.get(ipHash) ?? []).filter(t => now - t < HOUR_MS)
  recent.push(now)
  if (recent.length > ATTEMPTS_PER_IP_PER_HOUR + 1) recent.splice(0, recent.length - ATTEMPTS_PER_IP_PER_HOUR - 1)
  attempts.set(ipHash, recent)
  if (attempts.size > 5_000) {
    for (const [k, ts] of attempts) if (!ts.some(t => now - t < HOUR_MS)) attempts.delete(k)
    if (attempts.size > 20_000) attempts.clear()
  }
  return recent.length
}

/** The sender's address: the LAST X-Forwarded-For hop, the one Railway's proxy adds — the first can be
 *  typed in by anyone, so hashing that would give a flood a new address on every request (as auth.ts
 *  and the scanner's sign-in route do). */
function clientAddress(req: NextRequest): string {
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map(s => s.trim()).filter(Boolean)
  return (hops[hops.length - 1] || req.headers.get("x-real-ip") || "unknown").slice(0, 64)
}

// The IP is hashed, never stored raw: it is only ever compared against other hashes, so keeping
// the address would collect personal data for no benefit. AUTH_SECRET salts it, so the hashes
// are useless outside this deployment.
function hashIp(req: NextRequest): string {
  return createHash("sha256").update(`${process.env.AUTH_SECRET ?? "vectis"}:${clientAddress(req)}`).digest("hex").slice(0, 32)
}

/** The browser's own form submit (a page navigation), not the form's script. */
function isPageSubmit(req: NextRequest): boolean {
  const mode = req.headers.get("sec-fetch-mode")
  if (mode) return mode === "navigate"
  return /^\s*text\/html/i.test(req.headers.get("accept") ?? "") // older browsers send no Sec-Fetch-Mode
}

/** What /refund?problem= says for each refusal (app/refund/page.tsx) — a word, never the details. */
function problemFor(status: number): string {
  if (status === 413) return "big"
  if (status === 429) return "busy"
  if (status === 503) return "ready"
  if (status >= 500) return "failed"
  return "check"
}

/** A redirect back to the form, for the browser's own submit. A relative Location — the browser
 *  resolves it against this Hub's own address, whatever the proxy in front calls it. */
const backToForm = (query: string) =>
  new NextResponse(null, { status: 303, headers: { Location: `${REFUND_FORM_PATH}?${query}`, "Cache-Control": "no-store" } })

/** The body, read up to `max` bytes — "too-big" past that. Content-Length can be missing (a chunked
 *  upload) or wrong, so the cap is kept while reading too, never taken from the header alone. */
async function readCapped(req: NextRequest, max: number): Promise<Uint8Array<ArrayBuffer> | "too-big" | null> {
  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return "too-big"
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/** What to log about a fault: its kind and code. ⚠ Never a Prisma error's message — that can carry the
 *  values being written (the customer's name, email, what happened). */
function describe(e: unknown): string {
  const err = e as { name?: string; code?: string; message?: string } | null
  const name = err?.name ?? "Error"
  const code = err?.code ? ` ${err.code}` : ""
  return name.startsWith("Prisma") ? `${name}${code}` : `${name}${code}: ${String(err?.message ?? "").slice(0, 300)}`
}

export async function POST(req: NextRequest) {
  const page = isPageSubmit(req)
  const refuse = (error: string, status: number) =>
    page ? backToForm(`problem=${problemFor(status)}`) : NextResponse.json({ error }, { status })

  // ── Floods, before reading a byte ─────────────────────────────────────────────────────
  const ipHash = hashIp(req)
  if (noteAttempt(ipHash, Date.now()) > ATTEMPTS_PER_IP_PER_HOUR) return refuse(BUSY_HOUR, 429)
  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > REFUND_REQUEST_MAX_BYTES) return refuse(TOO_BIG, 413)
  const contentType = req.headers.get("content-type") ?? ""
  if (!/^multipart\/form-data\b/i.test(contentType)) return refuse("That wasn't sent from the refund form — please use the form.", 415)
  if (inFlight >= MAX_IN_FLIGHT) return refuse(BUSY_MINUTE, 429)

  inFlight++
  try {
    // ── The hourly ceilings and the per-address count — before a 20MB body is read ────────
    const since = new Date(Date.now() - HOUR_MS)
    let recentFromIp = 0
    let recentTotal  = 0
    try {
      ;[recentFromIp, recentTotal] = await Promise.all([
        prisma.refund.count({ where: { ipHash, receivedAt: { gte: since } } }),
        prisma.refund.count({ where: { source: "form", receivedAt: { gte: since } } }),
      ])
    } catch (e) {
      if (isMissingRefunds(e)) return refuse(NOT_READY, 503)
      // Counting only decides the flag and the ceilings — a failed count must never lose a real request.
    }
    if (recentFromIp >= PER_IP_CEILING_PER_HOUR || recentTotal >= HARD_CEILING_PER_HOUR) return refuse(BUSY_HOUR, 429)

    // ── Read and check ────────────────────────────────────────────────────────────────────
    const body = await readCapped(req, REFUND_REQUEST_MAX_BYTES)
    if (body === "too-big") return refuse(TOO_BIG, 413)
    if (!body || body.byteLength === 0) return refuse("Nothing was sent.", 400)
    let fd: FormData
    try {
      fd = await new Response(body, { headers: { "content-type": contentType } }).formData()
    } catch {
      return refuse("That didn't arrive properly — please try again.", 400)
    }

    const field = (k: string) => {
      const v = fd.get(k)
      return typeof v === "string" ? v : ""
    }
    const check = checkRefundForm({
      name: field("name"), email: field("email"), customerNo: field("customerNo"), auctionDate: field("auctionDate"),
      lots: field("lots"), reason: field("reason"), details: field("details"),
    }, londonDay())
    if (!check.ok) return refuse(check.error, 400)
    const v = check.value

    // Every photo is read and checked BEFORE anything is saved — one bad file refuses the request
    // (the form keeps everything typed), rather than saving half of it.
    const files = fd.getAll("photos").filter((p): p is File => typeof p !== "string" && p.size > 0)
    if (files.length > REFUND_LIMITS.photos) return refuse(TOO_MANY_PHOTOS, 400)
    const photos: { buf: Buffer; type: RefundPhotoType; ext: string }[] = []
    for (const [i, f] of files.entries()) {
      const buf = Buffer.from(await f.arrayBuffer())
      const p = checkRefundPhoto({ type: f.type, size: buf.byteLength, head: buf.subarray(0, 16) }, i + 1)
      if (!p.ok) return refuse(p.error, p.status)
      photos.push({ buf, type: p.type, ext: p.ext })
    }

    // Honeypot: a hidden field only an automated filler touches. It never discards the request —
    // a browser or password manager can fill it in for a real person.
    const honeypot = !!field("hp_ref").trim()
    const suspect  = honeypot || recentFromIp >= SUSPECT_PER_IP_PER_HOUR

    // A buyer number that isn't a C-number is left off, not refused. Matched OUTSIDE the transaction.
    const customerNo = tidyCustomerNo(v.customerNo)
    const customerId = await matchCustomerId(customerNo)

    // ── Save: the number and the row and its first timeline line, together ───────────────
    let row: { id: string }
    try {
      row = await prisma.$transaction(async (tx) => {
        const ref = await nextRefundRef(tx)
        const created = await tx.refund.create({
          data: {
            ref,
            source: "form",
            status: "new",
            party: "buyer",
            receivedAt: new Date(),
            name: v.name,
            email: v.email,
            customerNo,
            customerId,
            // A London day, stored at 12:00 UTC (clear of either side of midnight, all year).
            auctionDate: new Date(`${v.auctionDate}T12:00:00Z`),
            lotsText: v.lotsText,
            reason: v.reason,
            details: v.details,
            photoKeys: [],
            ipHash,
            suspect,
          },
          select: { id: true },
        })
        await writeRefundEvent(tx, created.id, "created", "Sent in on the refund form", BY_FORM)
        return created
      })
    } catch (e) {
      if (isMissingRefunds(e)) return refuse(NOT_READY, 503)
      throw e
    }

    // ── The photos, after the request is safe ─────────────────────────────────────────────
    // ⚠ The request is kept whatever happens here: a photo that can't be saved is a line on its
    // timeline for staff (ask the customer to send it again), never a lost request.
    if (photos.length) {
      const saved = await Promise.allSettled(photos.map((p, i) =>
        uploadBufferToR2(p.buf, `${REFUND_PHOTO_PREFIX}${row.id}/${i + 1}.${p.ext}`, p.type)))
      let keys = saved.flatMap(s => (s.status === "fulfilled" ? [s.value] : []))
      for (const s of saved) if (s.status === "rejected") console.error("refund-request photo not saved:", row.id, describe(s.reason))
      if (keys.length) {
        try {
          await prisma.refund.update({ where: { id: row.id }, data: { photoKeys: keys } })
        } catch (e) {
          console.error("refund-request photo keys not saved:", row.id, describe(e))
          keys = []
        }
      }
      const lost = photos.length - keys.length
      if (lost > 0) {
        await writeRefundEvent(prisma, row.id, "photos",
          `${lost} photo${lost === 1 ? "" : "s"} couldn't be saved — ask the customer to send ${lost === 1 ? "it" : "them"} again`, BY_FORM)
          .catch(e => console.error("refund-request photo note not saved:", row.id, describe(e)))
      }
    }

    // Nothing about the record comes back.
    return page ? backToForm("sent=1") : NextResponse.json({ ok: true })
  } catch (e) {
    console.error("refund-request error:", describe(e))
    return refuse(FAILED, 500)
  } finally {
    inFlight--
  }
}
