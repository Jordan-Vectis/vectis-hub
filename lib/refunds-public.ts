// Accounts → Refunds: the rules for the PUBLIC refund form (app/refund, the Hub's replacement for the
// Microsoft Form) and the write-only route behind it (app/api/public/refund-request).
//
// A PLAIN module — no Prisma, no Node, no auth — so the browser checks a request with exactly the rules
// the server does (the server always checks again: nothing from the browser is trusted), and so the
// rules can be tested on their own. The C-number is tidied on the server (tidyCustomerNo in
// lib/refunds-server.ts) — a buyer number that isn't one is simply left off, never an error.
//
// ⚠ Customer personal data, from anyone on the internet: never bank or card details
// (looksLikeBankDetails refuses the obvious, in every field), and the route never logs what was sent.

import { FORM_REASONS, REFUND_LIMITS, REFUND_PHOTO_TYPES, looksLikeBankDetails, type RefundReason } from "@/lib/refunds"
import { isDay } from "@/lib/uncollected"

/** The most one request may be, photos and all — refused (413) before the body is read. */
export const REFUND_REQUEST_MAX_BYTES = 20_000_000

/** The browser shrinks every photo to this on its long edge and re-encodes it as a JPEG at this quality
 *  before sending — a phone's 10MB photo comes down to well under REFUND_LIMITS.photoBytes. */
export const REFUND_PHOTO_MAX_EDGE = 2000
export const REFUND_PHOTO_QUALITY = 0.85

export const REFUND_BANK_REFUSED =
  "That looks like bank or card details — please take them out. We'll ask how to pay you if a refund is agreed."

/** The form's fields, as typed (every one a string from the form). */
export type RefundFormFields = {
  name: string
  email: string
  customerNo: string
  auctionDate: string
  lots: string
  reason: string
  details: string
}
export type RefundFormField = keyof RefundFormFields

/** A request that passed: trimmed, and the reason one of the form's. */
export type RefundRequestInput = {
  name: string
  email: string
  /** As typed (trimmed, capped) — the server tidies it into a C-number or drops it. */
  customerNo: string
  /** YYYY-MM-DD, a real day, not after today. */
  auctionDate: string
  lotsText: string
  reason: RefundReason
  details: string | null
}

export type RefundFormCheck =
  | { ok: true; value: RefundRequestInput }
  | { ok: false; error: string; field: RefundFormField }

// ⚠ Tight on purpose: the address becomes a mailto: link in the Hub, and a looser shape let
// "customer@gmail.com?bcc=someone@else.com" through — a Bcc (or a ready-written body) on every reply
// staff sent. So no ? & # % / \ < > , ; : " ( ) [ ] or spaces before the @, and a domain of letters,
// digits and hyphens in dot-separated parts.
const EMAIL_SHAPE = /^[^\s@?&#%/\\<>,;:"()[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/

/** A plain email shape (name@example.co.uk) — not a promise it exists. Shared with the staff panel's
 *  actions and the old-log import, so every address the Hub keeps passes the same check. */
export const isEmailShape = (s: string): boolean => s.length <= REFUND_LIMITS.email && EMAIL_SHAPE.test(s)

/** A mailto: link for an address — with ? & # % encoded as well, so even an address saved before the
 *  check above was tightened can never add a Bcc, a subject or a body to the reply. */
export const mailtoHref = (email: string): string => `mailto:${email.replace(/[?&#%]/g, (c) => encodeURIComponent(c))}`

/** "Other" needs a few words of what happened; the other reasons can leave it blank. */
export const REFUND_DETAILS_MIN = 10

const isFormReason = (v: string): v is RefundReason => (FORM_REASONS as string[]).includes(v)
const text = (v: unknown): string => String(v ?? "").trim()

/**
 * Checks one request the way the server will. `today` is the London day (londonDay()) — the auction
 * can't be after it. The first problem wins, with the field it's in so the form can take the person
 * straight to it.
 */
export function checkRefundForm(raw: Partial<Record<RefundFormField, unknown>>, today: string): RefundFormCheck {
  const no = (field: RefundFormField, error: string): RefundFormCheck => ({ ok: false, error, field })

  const name = text(raw.name)
  if (!name) return no("name", "Please add your name.")
  if (name.length > REFUND_LIMITS.name) return no("name", `Please keep your name to ${REFUND_LIMITS.name} characters.`)

  const email = text(raw.email)
  if (!email) return no("email", "Please add your email address — it's how we'll reply.")
  if (!isEmailShape(email)) return no("email", "That email address doesn't look right — please check it.")

  // A buyer number that isn't one is dropped by the server, not refused — but never an essay.
  const customerNo = text(raw.customerNo).slice(0, 40)

  const auctionDate = text(raw.auctionDate)
  if (!auctionDate) return no("auctionDate", "Please add the date of the auction.")
  if (!isDay(auctionDate)) return no("auctionDate", "That auction date doesn't look right — please pick it again.")
  if (auctionDate > today) return no("auctionDate", "The auction date can't be in the future — please check it.")

  const lotsText = text(raw.lots)
  if (!lotsText) return no("lots", "Please add the lot number (or numbers).")
  if (lotsText.length > REFUND_LIMITS.lotsText) return no("lots", `Please keep the lot numbers to ${REFUND_LIMITS.lotsText} characters.`)

  const reason = text(raw.reason)
  if (!isFormReason(reason)) return no("reason", "Please choose what's wrong.")

  const details = text(raw.details)
  if (details.length > REFUND_LIMITS.details) return no("details", "Please keep what happened to 4,000 characters.")
  if (reason === "other" && details.length < REFUND_DETAILS_MIN) {
    return no("details", "Please tell us what happened — a sentence or two is plenty.")
  }

  // Bank or card details anywhere — the field they're in, so it can be taken out.
  const typed: [RefundFormField, string][] = [
    ["name", name], ["email", email], ["customerNo", customerNo], ["lots", lotsText], ["details", details],
  ]
  for (const [field, v] of typed) if (looksLikeBankDetails(v)) return no(field, REFUND_BANK_REFUSED)

  return { ok: true, value: { name, email, customerNo, auctionDate, lotsText, reason, details: details || null } }
}

// ─── Photos ─────────────────────────────────────────────────────────────────────────────────

export type RefundPhotoType = (typeof REFUND_PHOTO_TYPES)[number]
export const REFUND_PHOTO_EXT: Record<RefundPhotoType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }

/** What a file really is, from its first bytes — never from its name or the type it claims. */
export function sniffPhotoType(b: Uint8Array): RefundPhotoType | null {
  // JPEG: FF D8 FF.
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg"
  // PNG: 89 50 4E 47 0D 0A 1A 0A (‰PNG and its line-ending check).
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png"
  // WEBP: "RIFF", four bytes of length, "WEBP".
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp"
  return null
}

const MAX_PHOTO_MB = Math.round(REFUND_LIMITS.photoBytes / (1024 * 1024))

export type RefundPhotoCheck =
  | { ok: true; type: RefundPhotoType; ext: string }
  | { ok: false; status: 413 | 415; error: string }

/**
 * One photo (`n` counts from 1): no bigger than REFUND_LIMITS.photoBytes, a type the form accepts, and
 * its first bytes really that type. ⚠ The type it claims is NOT enough — the photos are opened by staff
 * in the Hub, so an HTML or SVG file dressed up as image/jpeg must never get in.
 */
export function checkRefundPhoto(p: { type: string; size: number; head: Uint8Array }, n: number): RefundPhotoCheck {
  if (p.size > REFUND_LIMITS.photoBytes) {
    return { ok: false, status: 413, error: `Photo ${n} is too big — the most is ${MAX_PHOTO_MB} MB. Please remove it or pick another.` }
  }
  const type = (p.type || "").toLowerCase()
  const sniffed = sniffPhotoType(p.head)
  if (!(REFUND_PHOTO_TYPES as readonly string[]).includes(type) || sniffed !== type) {
    return { ok: false, status: 415, error: `Photo ${n} isn't a JPEG, PNG or WEBP picture — please remove it and try another.` }
  }
  return { ok: true, type: sniffed, ext: REFUND_PHOTO_EXT[sniffed] }
}

export const TOO_MANY_PHOTOS = `You can send up to ${REFUND_LIMITS.photos} photos.`
