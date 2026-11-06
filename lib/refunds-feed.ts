// Accounts → Refunds: one Microsoft Form response, as the Power Automate flow sends it to
// app/api/public/refund-form (Jack, 2026-11-06: "we will make a new form and a new flow to put it in to
// the hub"). PURE: no Prisma, no Node APIs.
//
// ⚠ A real customer must never be turned away by how they typed something. The form has already taken
// their request, so a refusal here would lose it silently. Only a response with no id is refused:
// anything that can't go in its own box goes in the details instead, as it was typed. Never bank or
// card details, though: they come out of every field first (withoutBankDetails).

import { FORM_REASONS, REFUND_LIMITS, REFUND_MICROSOFT_FORM, REFUND_REASON_LABELS, type RefundReason } from "@/lib/refunds"
import { firstDayIn, plainText, prose, withoutBankDetails } from "@/lib/refunds-import"
import { isEmailShape } from "@/lib/refunds-public"

/** The most one response may be. A form response is a few KB of text: no photos come this way. */
export const REFUND_FEED_MAX_BYTES = 64_000

export type RefundFeedRequest = {
  responseId: string
  name: string
  email: string | null
  /** As typed. The server tidies it (tidyCustomerNo) and keeps it in the details when it isn't one. */
  customerNo: string
  /** YYYY-MM-DD. */
  auctionDate: string | null
  lotsText: string | null
  reason: RefundReason
  details: string | null
}

export type RefundFeedCheck = { ok: true; value: RefundFeedRequest } | { ok: false; error: string }

/** A field as text with any bank or card details out; anything but text or a number is nothing. */
const field = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? withoutBankDetails(String(v)).text.trim() : ""

const oneLine = (s: string): string => plainText(s).replace(/\s+/g, " ").trim()

/** The form's choice as a reason, by its words: null when it isn't one of them. */
function reasonFrom(said: string): RefundReason | null {
  const s = said.toLowerCase()
  if (s === "other") return "other"
  return FORM_REASONS.find((r) => REFUND_REASON_LABELS[r].toLowerCase() === s) ?? null
}

/** Reads one response. Never throws. */
export function readRefundFeed(raw: unknown): RefundFeedCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "That isn't a form response." }
  const r = raw as Record<string, unknown>

  const responseId = oneLine(String(r.responseId ?? ""))
  if (!/^[\w.:-]{1,100}$/.test(responseId)) return { ok: false, error: "The form response has no id." }

  const extras: string[] = []

  const emailTyped = oneLine(field(r.email))
  const email = emailTyped && isEmailShape(emailTyped) ? emailTyped : null
  if (emailTyped && !email) extras.push(`Email as typed: ${emailTyped}`)

  const name = oneLine(field(r.name)).slice(0, REFUND_LIMITS.name) || email || "No name given"

  const dayTyped = oneLine(field(r.auctionDate))
  // Microsoft can send a date with a time on it (2026-10-28T00:00:00Z), which firstDayIn doesn't read.
  const auctionDate = firstDayIn(dayTyped.replace(/^(\d{4}-\d{2}-\d{2})T.*$/, "$1"))
  if (dayTyped && !auctionDate) extras.push(`Auction date as typed: ${dayTyped}`)

  const lotsTyped = oneLine(field(r.lots))
  if (lotsTyped.length > REFUND_LIMITS.lotsText) extras.push(`Lots as typed: ${lotsTyped}`)

  const said = oneLine(field(r.reason))
  const known = reasonFrom(said)
  if (said && !known) extras.push(`Reason as chosen: ${said}`)

  const details = [prose(field(r.details)), ...extras].filter(Boolean).join("\n\n").slice(0, REFUND_LIMITS.details)

  return {
    ok: true,
    value: {
      responseId,
      name,
      email,
      customerNo: oneLine(field(r.customerNo)).slice(0, 40),
      auctionDate,
      lotsText: lotsTyped.slice(0, REFUND_LIMITS.lotsText) || null,
      reason: known ?? "other",
      details: details || null,
    },
  }
}

/** What makes a response itself: the form and its response number. The server stores its sha256 in
 *  Refund.importKey, which is unique, so the flow sending the same response twice adds it once. */
export function refundFeedKey(responseId: string): string {
  const form = new URL(REFUND_MICROSOFT_FORM).searchParams.get("id") ?? ""
  return `ms-form|${form}|${responseId}`
}
