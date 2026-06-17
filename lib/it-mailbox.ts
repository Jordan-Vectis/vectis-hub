/**
 * IT mailbox — Microsoft Graph client (delegated OAuth, shared mailbox).
 *
 * The shared mailbox IT@vectis.co.uk is read "as" the admin who connected it
 * (delegated Mail.Read.Shared), so no tenant-wide admin consent is needed.
 * Tokens live in the ITMailboxAuth singleton (id = "global").
 */

import { prisma } from "@/lib/prisma"

const TENANT = process.env.GRAPH_TENANT_ID
const CLIENT = process.env.GRAPH_CLIENT_ID
const SECRET = process.env.GRAPH_CLIENT_SECRET
const MAILBOX = process.env.IT_MAILBOX || "IT@vectis.co.uk"

const SCOPE = "offline_access https://graph.microsoft.com/Mail.Read.Shared"

export function itMailboxConfigured(): boolean {
  return !!(TENANT && CLIENT && SECRET)
}

/** Returns a valid access token for the IT mailbox, refreshing if needed. null = not connected. */
export async function getITMailboxToken(): Promise<string | null> {
  if (!itMailboxConfigured()) return null

  const row = await prisma.iTMailboxAuth.findUnique({ where: { id: "global" } })
  if (!row) return null

  // Still valid (60s buffer)
  if (row.expiresAt.getTime() > Date.now() + 60_000) return row.accessToken

  // Refresh
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
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

    await prisma.iTMailboxAuth.update({
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

export async function itMailboxConnected(): Promise<boolean> {
  const row = await prisma.iTMailboxAuth.findUnique({ where: { id: "global" }, select: { id: true } })
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

/**
 * Polls the IT mailbox inbox and creates an ITJob for each new email
 * (deduped by Graph message id). Returns how many new jobs were created.
 */
export async function syncITMailbox(): Promise<{ ok: boolean; created: number; error?: string }> {
  const token = await getITMailboxToken()
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

  let created = 0
  for (const m of messages) {
    if (!m.id) continue
    const existing = await prisma.iTJob.findUnique({ where: { graphMessageId: m.id }, select: { id: true } })
    if (existing) continue

    await prisma.iTJob.create({
      data: {
        title:          m.subject?.trim() || "(no subject)",
        body:           m.bodyPreview?.trim() || "",
        fromName:       m.from?.emailAddress?.name ?? null,
        fromEmail:      m.from?.emailAddress?.address ?? null,
        status:         "NEW",
        source:         "EMAIL",
        graphMessageId: m.id,
        webLink:        m.webLink ?? null,
        receivedAt:     m.receivedDateTime ? new Date(m.receivedDateTime) : null,
      },
    })
    created++
  }

  await prisma.iTMailboxAuth.update({
    where: { id: "global" },
    data:  { lastSyncAt: new Date() },
  }).catch(() => {})

  return { ok: true, created }
}
