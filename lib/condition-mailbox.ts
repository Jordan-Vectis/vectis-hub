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

type GraphMessage = {
  id: string
  subject?: string
  bodyPreview?: string
  webLink?: string
  receivedDateTime?: string
  from?: { emailAddress?: { name?: string; address?: string } }
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

  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages` +
    `?$top=40&$orderby=receivedDateTime desc&$select=id,subject,bodyPreview,from,receivedDateTime,webLink`

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

    const subject = m.subject?.trim() || "(no subject)"
    const body    = m.bodyPreview?.trim() || ""

    if (candidates === null) candidates = await loadAuctionCandidates()
    const extracted = await extractConditionDetails(subject, body, candidates)

    await prisma.conditionReport.create({
      data: {
        subject,
        body,
        fromName:       m.from?.emailAddress?.name ?? null,
        fromEmail:      m.from?.emailAddress?.address ?? null,
        status:         "NEW",
        source:         "EMAIL",
        graphMessageId: m.id,
        webLink:        m.webLink ?? null,
        receivedAt:     m.receivedDateTime ? new Date(m.receivedDateTime) : null,
        lotNumber:      extracted.lotNumber,
        auctionId:      extracted.auctionId,
        auctionLabel:   extracted.auctionLabel,
        auctionDate:    extracted.auctionDate ? new Date(`${extracted.auctionDate}T00:00:00.000Z`) : null,
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
