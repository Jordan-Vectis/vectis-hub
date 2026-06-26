/**
 * Condition-reports mailbox — Microsoft Graph client (delegated OAuth, shared mailbox).
 *
 * Mirrors the IT mailbox: a shared mailbox is read "as" the admin who connected
 * it (delegated Mail.Read.Shared), so no tenant-wide admin consent is needed.
 * Tokens live in the ConditionMailboxAuth singleton (id = "global").
 *
 * The mailbox address itself is configurable via CONDITION_MAILBOX — until that
 * is set, syncing is a no-op so the feature can ship before the address is known.
 */

import { prisma } from "@/lib/prisma"
import { extractConditionDetails, type AuctionCandidate } from "@/lib/condition-extract"
import { parseConditionEmail } from "@/lib/condition-parse"

const TENANT  = process.env.GRAPH_TENANT_ID
const CLIENT  = process.env.GRAPH_CLIENT_ID
const SECRET  = process.env.GRAPH_CLIENT_SECRET
const MAILBOX = process.env.CONDITION_MAILBOX || ""   // e.g. conditionreports@vectis.co.uk — set when known

const SCOPE = "offline_access https://graph.microsoft.com/Mail.Read.Shared"

/** App registration present? (mailbox address is checked separately at sync time.) */
export function conditionMailboxConfigured(): boolean {
  return !!(TENANT && CLIENT && SECRET)
}

export function conditionMailboxAddress(): string {
  return MAILBOX
}

/** Returns a valid access token for the mailbox, refreshing if needed. null = not connected. */
export async function getConditionMailboxToken(): Promise<string | null> {
  if (!conditionMailboxConfigured()) return null

  const row = await prisma.conditionMailboxAuth.findUnique({ where: { id: "global" } })
  if (!row) return null

  // Still valid (60s buffer)
  if (row.expiresAt.getTime() > Date.now() + 60_000) return row.accessToken

  // Refresh
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          grant_type:    "refresh_token",
          client_id:     CLIENT!,
          client_secret: SECRET!,
          refresh_token: row.refreshToken,
          scope:         SCOPE,
        }),
      }
    )
    if (!res.ok) return null
    const tokens = await res.json()

    await prisma.conditionMailboxAuth.update({
      where: { id: "global" },
      data: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token ?? row.refreshToken,
        expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
    })
    return tokens.access_token
  } catch {
    return null
  }
}

export async function conditionMailboxConnected(): Promise<boolean> {
  const row = await prisma.conditionMailboxAuth.findUnique({ where: { id: "global" }, select: { id: true } })
  return !!row
}

export type MailFolder = { id: string; name: string }

// Lists the mailbox's folders (top level + one level of children) so an admin
// can pick which folder condition-report emails are filed into.
export async function listConditionMailboxFolders(): Promise<{ ok: boolean; folders: MailFolder[]; error?: string }> {
  if (!MAILBOX) return { ok: false, folders: [], error: "Mailbox address not configured" }
  const token = await getConditionMailboxToken()
  if (!token) return { ok: false, folders: [], error: "Mailbox not connected" }

  async function fetchFolders(path: string): Promise<any[]> {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/${path}?$top=200&$select=id,displayName,childFolderCount`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (!res.ok) return []
    const d = await res.json()
    return d.value ?? []
  }

  try {
    const top = await fetchFolders("mailFolders")
    const folders: MailFolder[] = []
    for (const f of top) {
      folders.push({ id: f.id, name: f.displayName })
      if (f.childFolderCount > 0) {
        const children = await fetchFolders(`mailFolders/${f.id}/childFolders`)
        for (const c of children) folders.push({ id: c.id, name: `${f.displayName} / ${c.displayName}` })
      }
    }
    return { ok: true, folders }
  } catch (e: any) {
    return { ok: false, folders: [], error: e?.message ?? "Failed to list folders" }
  }
}

type GraphMessage = {
  id: string
  subject?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  webLink?: string
  receivedDateTime?: string
  from?: { emailAddress?: { name?: string; address?: string } }
}

// Match a parsed auction to a local CatalogueAuction — by code first (from the
// lot link, authoritative), then by exact name. Returns the linked date too.
async function matchAuction(
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

// Auctions to offer the AI as match candidates: the most recent ~60 with a date,
// which comfortably covers upcoming and just-passed sales without a huge prompt.
async function loadAuctionCandidates(): Promise<AuctionCandidate[]> {
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

/**
 * Polls the condition-reports inbox and creates a ConditionReport for each new
 * email (deduped by Graph message id). Best-effort AI extraction fills in the
 * lot number / auction / date. Returns how many new reports were created.
 */
export async function syncConditionMailbox(): Promise<{ ok: boolean; created: number; error?: string }> {
  if (!MAILBOX) return { ok: false, created: 0, error: "Mailbox address not configured (CONDITION_MAILBOX)" }

  const token = await getConditionMailboxToken()
  if (!token) return { ok: false, created: 0, error: "Mailbox not connected" }

  // Read from the chosen folder if one is set, otherwise the inbox.
  const authRow = await prisma.conditionMailboxAuth.findUnique({ where: { id: "global" }, select: { folderId: true } })
  const folderSegment = authRow?.folderId ? `mailFolders/${authRow.folderId}` : "mailFolders/inbox"

  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/${folderSegment}/messages` +
    `?$top=40&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,body,from,receivedDateTime,webLink`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    return { ok: false, created: 0, error: `Graph ${res.status}: ${text.slice(0, 300)}` }
  }

  const data = await res.json()
  const messages: GraphMessage[] = data.value ?? []

  // Only load auction candidates once, and only if there is at least one new email.
  let candidates: AuctionCandidate[] | null = null

  let created = 0
  for (const m of messages) {
    if (!m.id) continue
    const existing = await prisma.conditionReport.findUnique({ where: { graphMessageId: m.id }, select: { id: true } })
    if (existing) continue

    const emailSubject = m.subject?.trim() || "(no subject)"
    const rawHtml = m.body?.contentType?.toLowerCase() === "html" ? (m.body?.content ?? null) : null
    const rawText = m.body?.contentType?.toLowerCase() === "text"
      ? (m.body?.content ?? "")
      : (m.bodyPreview ?? "")

    // Deterministic parse first — these emails follow a fixed template.
    const parsed = parseConditionEmail(emailSubject, rawText, rawHtml)

    // Requester details come from the body (the envelope sender is admin@vectis.co.uk).
    const fromName  = parsed.requesterName ?? m.from?.emailAddress?.name ?? null
    const fromEmail = parsed.email         ?? m.from?.emailAddress?.address ?? null
    let lotNumber = parsed.lotNumber
    let auctionLabel = parsed.auctionName
    let auctionId: string | null = null
    let auctionDate: Date | null = null

    const match = await matchAuction(parsed.auctionCode, parsed.auctionName)
    if (match) { auctionId = match.id; auctionDate = match.date }

    // Fallback to AI only when the template didn't yield the essentials.
    if (!parsed.matched) {
      if (candidates === null) candidates = await loadAuctionCandidates()
      const ai = await extractConditionDetails(emailSubject, rawText || m.bodyPreview || "", candidates)
      lotNumber    = ai.lotNumber
      auctionId    = ai.auctionId
      auctionLabel = ai.auctionLabel
      auctionDate  = ai.auctionDate ? new Date(`${ai.auctionDate}T00:00:00.000Z`) : null
    }

    // A meaningful title: "Lot 546 — Dinky Toys 106 Austin Atlantic" beats the
    // generic email subject (which is identical on every request).
    const subject = lotNumber
      ? `Lot ${lotNumber}${parsed.lotTitle ? ` — ${parsed.lotTitle}` : ""}`
      : emailSubject

    await prisma.conditionReport.create({
      data: {
        subject,
        body:           parsed.requestText ?? m.bodyPreview?.trim() ?? "",
        fromName,
        fromEmail,
        fromPhone:      parsed.phone,
        navId:          parsed.navId,
        status:         "NEW",
        source:         "EMAIL",
        graphMessageId: m.id,
        webLink:        m.webLink ?? null,
        lotUrl:         parsed.lotUrl,
        receivedAt:     m.receivedDateTime ? new Date(m.receivedDateTime) : null,
        lotNumber,
        auctionId,
        auctionLabel,
        auctionDate,
      },
    })
    created++
  }

  await prisma.conditionMailboxAuth.update({
    where: { id: "global" },
    data:  { lastSyncAt: new Date() },
  }).catch(() => {})

  return { ok: true, created }
}
