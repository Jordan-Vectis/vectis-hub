"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"
import { GoodsInAccessError, requireGoodsIn } from "@/lib/goods-in/access"
import { isMissingTable } from "@/lib/prisma-errors"
import { SPECIAL_ARRANGEMENT_MAX } from "@/lib/goods-in/model"
import { AGREEMENT_NOT_READY, findAgreement } from "@/lib/goods-in/agreement"
import type { Result } from "@/lib/actions/goods-in"

// Goods In → a customer's page → Fees & agreement: the customer's standing commission and fees,
// their usual reserve, whether they've signed Vectis's vendor terms, and any special arrangement —
// set once there; Check in just uses it and never asks (Jack, 2026-10-16). SERVER ONLY.
//
//  • The fees stay on GoodsInCustomer (blank = standard, DEFAULT_TERMS); the reserve, signed terms
//    and special arrangement are on GoodsInAgreement, which needs Run Migrations. Until then the
//    fees still save, and anything else that would put something in the table is refused with
//    AGREEMENT_NOT_READY — before anything is written (clearing one back to standard is already
//    true without the table, so it isn't refused).
//  • Anyone in Goods In may change it, as they may change the rest of a customer; who changed it
//    last is recorded (GoodsInAgreement.updatedByName, once the table is there).
//  • Every read of GoodsInAgreement is tolerant (lib/goods-in/agreement.ts) — never an `include`.
//
// ⚠ Each action RETURNS { ok, error } rather than throwing (a thrown server-action error is redacted
// in production — RULES.md). ⚠ Never store or show bank details here. Nothing here touches Business
// Central.

export type CustomerAgreement = {
  contactId: string
  /** null = standard (DEFAULT_TERMS). */
  fees: { commission: number | null; lottingFee: number | null; photographyFee: number | null; unsoldFee: number | null }
  /** null = standard (DEFAULT_TERMS.reservePercent). */
  reservePercent: number | null
  /** ISO; the London day they signed Vectis's vendor terms (stored at 12:00 UTC that day). */
  termsSignedAt: string | null
  termsRecordedBy: string | null
  /** Plain words, ≤ SPECIAL_ARRANGEMENT_MAX characters. */
  specialArrangement: string | null
  updatedAt: string | null
  updatedByName: string | null
  /** false = GoodsInAgreement isn't migrated yet (the fees still work). */
  ready: boolean
}

export type AgreementPatch = {
  fees?: Partial<CustomerAgreement["fees"]>
  reservePercent?: number | null
  /** "YYYY-MM-DD", the London day they signed (not in the future) — or null for not signed. */
  termsSignedOn?: string | null
  specialArrangement?: string | null
}

type Fees = CustomerAgreement["fees"]
type FeeKey = keyof Fees

/** A message meant for the person, passed through as it is. */
class Refusal extends Error {}

const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof Refusal || e instanceof GoodsInAccessError) return { ok: false, error: e.message }
  const msg = String((e as { message?: string })?.message ?? e)
  if (isMissingTable(e)) {
    return { ok: false, error: /GoodsInAgreement/.test(msg) ? AGREEMENT_NOT_READY : "Goods In isn't set up on this environment yet — an admin needs to press Run Migrations." }
  }
  console.error("goods-in agreement action error:", e)
  return { ok: false, error: msg.length < 200 ? msg : "Something went wrong — please try again." }
}

const blank = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const NOT_FOUND = "That customer couldn't be found — search for them again."

// ─── Reading what was sent ──────────────────────────────────────────────────────────────────

const FEE_RULES: { key: FeeKey; label: string; unit: "%" | "£"; max: number }[] = [
  { key: "commission", label: "commission", unit: "%", max: 100 },
  { key: "lottingFee", label: "lotting fee", unit: "£", max: 100_000 },
  { key: "photographyFee", label: "photography fee", unit: "£", max: 100_000 },
  { key: "unsoldFee", label: "unsold fee", unit: "£", max: 100_000 },
]

/** A number as sent: a number, or a typed one ("£2.50", "25%", "1,000"). Blank / null = not set; anything else unreadable is NaN. */
function asNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number") return v
  if (typeof v === "string") {
    const s = v.trim().replace(/^£/, "").replace(/%$/, "").replace(/,/g, "").trim()
    return s ? Number(s) : null
  }
  return NaN
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function readFee(rule: (typeof FEE_RULES)[number], v: unknown): number | null {
  const n = asNumber(v)
  if (n === null) return null
  const what = cap(rule.label)
  if (!Number.isFinite(n)) throw new Refusal(`${what} isn't a number — type it as a number, or leave it blank for the standard one.`)
  if (n < 0) throw new Refusal(`${what} can't be less than 0.`)
  if (n > rule.max) throw new Refusal(rule.unit === "%" ? `${what} can't be more than ${rule.max}%.` : `${what} looks too big — check it.`)
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new Refusal(`${what} can only go to two decimal places${rule.unit === "£" ? " (pounds and pence)" : ""}.`)
  }
  return Math.round(n * 100) / 100
}

function readReserve(v: unknown): number | null {
  const n = asNumber(v)
  if (n === null) return null
  if (!Number.isFinite(n)) throw new Refusal("The usual reserve isn't a number — type it as a whole percentage (e.g. 60), or leave it blank for the standard one.")
  if (n < 0 || n > 100) throw new Refusal("The usual reserve must be between 0% and 100%.")
  if (!Number.isInteger(n)) throw new Refusal("The usual reserve is a whole percentage — e.g. 60, not 60.5.")
  return n
}

/** Today in London, "YYYY-MM-DD". */
function londonToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** The London day they signed → the stored instant (12:00 UTC that day, so it reads as that day anywhere near London). */
function readSignedOn(v: unknown): Date | null {
  if (v === null || v === undefined || (typeof v === "string" && !v.trim())) return null
  const s = typeof v === "string" ? v.trim() : ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Refusal("The date they signed didn't come through as a date — pick it again.")
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const at = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0))
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) throw new Refusal("That isn't a real date — pick it again.")
  if (s > londonToday()) throw new Refusal("The date they signed can't be in the future.")
  if (y < 1980) throw new Refusal("That date looks too long ago — check the year.")
  return at
}

function readArrangement(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") throw new Refusal("The special arrangement didn't come through — try again.")
  // A tab becomes a space, so what is kept is what the receipt prints (its fonts can't draw a tab).
  const s = v.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/ +$/gm, "").replace(/\n{3,}/g, "\n\n").trim()
  if (!s) return null
  if (s.length > SPECIAL_ARRANGEMENT_MAX) {
    throw new Refusal(`The special arrangement is ${s.length.toLocaleString("en-GB")} characters — keep it to ${SPECIAL_ARRANGEMENT_MAX.toLocaleString("en-GB")} or fewer.`)
  }
  return s
}

// ─── Loading ────────────────────────────────────────────────────────────────────────────────

/** The customer's whole agreement — fees from GoodsInCustomer, the rest from GoodsInAgreement (its own, tolerant query). */
async function load(contactId: string): Promise<CustomerAgreement> {
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, goodsInCustomer: { select: { commission: true, lottingFee: true, photographyFee: true, unsoldFee: true } } },
  })
  if (!c) throw new Refusal(NOT_FOUND)
  const a = await findAgreement(c.id)
  const g = c.goodsInCustomer
  const fee = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null)
  return {
    contactId: c.id,
    fees: { commission: fee(g?.commission), lottingFee: fee(g?.lottingFee), photographyFee: fee(g?.photographyFee), unsoldFee: fee(g?.unsoldFee) },
    reservePercent: a.reservePercent,
    termsSignedAt: a.termsSignedAt,
    termsRecordedBy: a.termsRecordedBy,
    specialArrangement: a.specialArrangement,
    updatedAt: a.updatedAt,
    updatedByName: a.updatedByName,
    ready: a.ready,
  }
}

// ─── The actions ────────────────────────────────────────────────────────────────────────────

/** A customer's fees and agreement, for their Fees & agreement tab (and Check in). Any Goods In user. */
export async function getAgreement(contactId: string): Promise<Result<CustomerAgreement>> {
  try {
    await requireGoodsIn("warehouse")
    const id = blank(contactId)
    if (!id) return { ok: false, error: "Say which customer." }
    return { ok: true, data: await load(id) }
  } catch (e) { return fail(e) }
}

/**
 * Change a customer's fees and agreement. Any Goods In user. Each field is optional — left out =
 * unchanged; null clears it back to standard / not signed / none.
 *  - fees: each ≥ 0, at most 2 decimal places, commission ≤ 100% (a fee over £100,000 is refused as
 *    a typo) → GoodsInCustomer.
 *  - reservePercent: a whole 0–100; termsSignedOn: "YYYY-MM-DD", the London day, not in the future
 *    (recorded by whoever saves it); specialArrangement: trimmed, ≤ 1,000 characters, blank = none
 *    → GoodsInAgreement (refused with AGREEMENT_NOT_READY while the table isn't there).
 * Everything sent is checked before anything is written, and it is written in one transaction, so
 * a save either happens whole or not at all. Answers with the agreement as it now stands.
 */
export async function saveAgreement(contactId: string, patch: AgreementPatch): Promise<Result<CustomerAgreement>> {
  try {
    const me = await requireGoodsIn("warehouse")
    const id = blank(contactId)
    if (!id) return { ok: false, error: "Say which customer." }
    const p = (patch && typeof patch === "object" ? patch : {}) as AgreementPatch

    // Read and check everything first.
    const fees: Partial<Fees> = {}
    if (p.fees !== undefined) {
      if (!p.fees || typeof p.fees !== "object") throw new Refusal("The fees didn't come through — try again.")
      const sent = p.fees as Record<string, unknown>
      for (const rule of FEE_RULES) if (sent[rule.key] !== undefined) fees[rule.key] = readFee(rule, sent[rule.key])
    }
    const agreement: { reservePercent?: number | null; termsSignedAt?: Date | null; termsRecordedBy?: string | null; specialArrangement?: string | null } = {}
    if (p.reservePercent !== undefined) agreement.reservePercent = readReserve(p.reservePercent)
    if (p.termsSignedOn !== undefined) {
      const at = readSignedOn(p.termsSignedOn)
      agreement.termsSignedAt = at
      agreement.termsRecordedBy = at ? me.name : null
    }
    if (p.specialArrangement !== undefined) agreement.specialArrangement = readArrangement(p.specialArrangement)

    const exists = await prisma.contact.findUnique({ where: { id }, select: { id: true } })
    if (!exists) return { ok: false, error: NOT_FOUND }

    const hasFees = Object.keys(fees).length > 0
    const hasAgreement = Object.keys(agreement).length > 0
    if (!hasFees && !hasAgreement) return { ok: true, data: await load(id) }

    // Whether GoodsInAgreement is there yet — its own query, before the transaction (a failed query
    // inside one aborts it).
    const { ready } = await findAgreement(id)
    if (!ready) {
      // Clearing back to standard / not signed / none is already true without the table.
      const wantsTable = Object.entries(agreement).some(([k, v]) => k !== "termsRecordedBy" && v !== null)
      if (wantsTable) return { ok: false, error: `${AGREEMENT_NOT_READY} Nothing was saved.` }
      if (hasFees) await prisma.goodsInCustomer.upsert({ where: { contactId: id }, create: { contactId: id, ...fees }, update: fees })
    } else {
      await prisma.$transaction(async tx => {
        if (hasFees) await tx.goodsInCustomer.upsert({ where: { contactId: id }, create: { contactId: id, ...fees }, update: fees })
        // Who changed it last — the fees as well as the rest.
        await tx.goodsInAgreement.upsert({
          where: { contactId: id },
          create: { contactId: id, ...agreement, updatedByName: me.name },
          update: { ...agreement, updatedByName: me.name },
        })
      })
    }

    revalidatePath("/tools/warehouse", "layout")
    return { ok: true, data: await load(id) }
  } catch (e) { return fail(e) }
}
