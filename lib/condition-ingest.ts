/**
 * Shared "turn an email into a ConditionReport" logic, used by both the Graph
 * mailbox sync and the inbound webhook (Power Automate / Make), so the two paths
 * behave identically.
 */

import { prisma } from "@/lib/prisma"
import { extractConditionDetails, type AuctionCandidate } from "@/lib/condition-extract"
import { parseConditionEmail } from "@/lib/condition-parse"

// Match a parsed auction to a local CatalogueAuction — by code first (from the
// lot link, authoritative), then by exact name. Returns the linked date too.
export async function matchAuction(
  code: string | null,
  name: string | null,
): Promise<{ id: string; date: Date | null } | null> {
  if (code) {
    const a = await prisma.catalogueAuction.findFirst({
      where:  { code: { equals: code, mode: "insensitive" } },
      select: { id: true, auctionDate: true },
    })
    if (a) return { id: a.id, date: a.auctionDate }
  }
  if (name) {
    const a = await prisma.catalogueAuction.findFirst({
      where:  { name: { equals: name, mode: "insensitive" } },
      select: { id: true, auctionDate: true },
    })
    if (a) return { id: a.id, date: a.auctionDate }
  }
  return null
}

// The most recent ~60 auctions with a date — candidates for the AI fallback.
export async function loadAuctionCandidates(): Promise<AuctionCandidate[]> {
  const auctions = await prisma.catalogueAuction.findMany({
    where:   { auctionDate: { not: null } },
    orderBy: { auctionDate: "desc" },
    take:    60,
    select:  { id: true, code: true, name: true, auctionDate: true },
  })
  return auctions.map(a => ({
    id:   a.id,
    code: a.code,
    name: a.name,
    date: a.auctionDate ? a.auctionDate.toISOString().slice(0, 10) : null,
  }))
}

export type IngestInput = {
  subject:            string
  text:               string
  html:               string | null
  envelopeFromName?:  string | null
  envelopeFromEmail?: string | null
  messageId?:         string | null     // dedupe key
  webLink?:           string | null
  receivedAt?:        Date | null
}

export type IngestResult = { created: boolean; id?: string; duplicate?: boolean }

/**
 * Parse one email and create a ConditionReport (deduped by messageId).
 * `candidatesLoader` is only invoked when the deterministic parser can't find
 * the essentials and we fall back to AI — pass a memoised loader when looping.
 */
export async function ingestConditionEmail(
  input: IngestInput,
  candidatesLoader?: () => Promise<AuctionCandidate[]>,
): Promise<IngestResult> {
  if (input.messageId) {
    const dupe = await prisma.conditionReport.findUnique({ where: { graphMessageId: input.messageId }, select: { id: true } })
    if (dupe) return { created: false, duplicate: true, id: dupe.id }
  }

  const parsed = parseConditionEmail(input.subject, input.text, input.html)

  // Requester details come from the body (the envelope sender is admin@vectis.co.uk).
  const fromName  = parsed.requesterName ?? input.envelopeFromName  ?? null
  const fromEmail = parsed.email         ?? input.envelopeFromEmail ?? null
  let lotNumber = parsed.lotNumber
  let auctionLabel = parsed.auctionName
  let auctionId: string | null = null
  let auctionDate: Date | null = null

  const match = await matchAuction(parsed.auctionCode, parsed.auctionName)
  if (match) { auctionId = match.id; auctionDate = match.date }

  // Fall back to AI only when the template didn't yield the essentials.
  if (!parsed.matched && candidatesLoader) {
    const ai = await extractConditionDetails(input.subject, input.text || "", await candidatesLoader())
    lotNumber    = ai.lotNumber
    auctionId    = ai.auctionId
    auctionLabel = ai.auctionLabel
    auctionDate  = ai.auctionDate ? new Date(`${ai.auctionDate}T00:00:00.000Z`) : null
  }

  const subject = lotNumber
    ? `Lot ${lotNumber}${parsed.lotTitle ? ` — ${parsed.lotTitle}` : ""}`
    : (input.subject || "(no subject)")

  const body = (parsed.requestText ?? input.text ?? "").slice(0, 8000)

  const rep = await prisma.conditionReport.create({
    data: {
      subject,
      body,
      fromName,
      fromEmail,
      fromPhone:      parsed.phone,
      navId:          parsed.navId,
      status:         "NEW",
      source:         "EMAIL",
      graphMessageId: input.messageId ?? null,
      webLink:        input.webLink ?? null,
      lotUrl:         parsed.lotUrl,
      receivedAt:     input.receivedAt ?? new Date(),
      lotNumber,
      auctionCode:    parsed.auctionCode,
      auctionId,
      auctionLabel,
      auctionDate,
    },
    select: { id: true },
  })
  return { created: true, id: rep.id }
}
