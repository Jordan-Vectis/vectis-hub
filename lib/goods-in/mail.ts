import { prisma } from "@/lib/prisma"

// Goods In — emailing receipts. SERVER ONLY.
//
// Receipts go out from the receipts mailbox (RECEIPTS_MAILBOX, default admin@vectis.co.uk) through
// Microsoft Graph, signed in DELEGATED as the person who connected it — the same pattern as the IT
// mailbox (lib/it-mailbox.ts): the existing Entra app registration (GRAPH_CLIENT_ID, "Vectis Hub -
// IT Mailbox") with the delegated Mail.Send.Shared permission, so no tenant-wide application
// permission is needed. The person who connects must have Send As or Send on behalf rights on the
// mailbox. The tokens live in GoodsInMailAuth, one row, id "global".
//
// Until IT has added the permission and the redirect URI, nothing here works and the screens say
// so plainly: receipts can still be printed, or downloaded and emailed by hand.
//
// ⚠ Never log a token, and never put one in an error message. Microsoft's error descriptions are
// passed on (trimmed) because they say what IT needs to fix; token responses are not.

const ROW_ID = "global"
const SCOPE = "offline_access https://graph.microsoft.com/Mail.Send.Shared"
/** Where Microsoft sends the person back to after signing in — must be registered on the app exactly. */
export const CALLBACK_PATH = "/api/goods-in/mail/callback"
/** Graph refuses a sendMail request over 4 MB; base64 makes the PDF a third bigger. */
const MAX_PDF_BYTES = 2_800_000

const env = () => ({
  tenant: process.env.GRAPH_TENANT_ID?.trim() || "",
  client: process.env.GRAPH_CLIENT_ID?.trim() || "",
  secret: process.env.GRAPH_CLIENT_SECRET?.trim() || "",
})

/** The mailbox receipts are sent from. */
export const receiptsMailbox = () => process.env.RECEIPTS_MAILBOX?.trim() || "admin@vectis.co.uk"

/** The GRAPH_* settings this environment is missing (empty when all are there). */
export function missingMailSettings(): string[] {
  const e = env()
  return [
    ...(e.tenant ? [] : ["GRAPH_TENANT_ID"]),
    ...(e.client ? [] : ["GRAPH_CLIENT_ID"]),
    ...(e.secret ? [] : ["GRAPH_CLIENT_SECRET"]),
  ]
}

/** True when the Hub has the Microsoft settings it needs to connect a mailbox at all. */
export function mailConfigured(): boolean {
  return missingMailSettings().length === 0
}

/** The Entra app's client id — not a secret (it is in every sign-in link); shown to admins so IT can find the app. */
export const graphClientId = () => env().client || null

/**
 * This Hub's public address, for the sign-in redirect. NEXTAUTH_URL first (each Railway environment
 * sets its own — the other mailbox sign-ins use it too), then the proxy's forwarded host. The connect
 * and the callback must agree exactly, or Microsoft refuses the code.
 */
export function appOrigin(h?: Headers | null): string {
  const set = (process.env.NEXTAUTH_URL || process.env.AUTH_URL || "").trim()
  if (set) {
    try { return new URL(set).origin } catch { /* fall through to the request */ }
  }
  const first = (v: string | null | undefined) => (v ?? "").split(",")[0].trim()
  const host = first(h?.get("x-forwarded-host")) || first(h?.get("host"))
  if (host) {
    const proto = first(h?.get("x-forwarded-proto")) || (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https")
    return `${proto}://${host}`
  }
  return "http://localhost:3000"
}

export class MailNotReadyError extends Error {}

export type MailStatus = {
  /** The Hub has its GRAPH_* settings. */
  configured: boolean
  /** A mailbox sign-in is stored and the settings are there — receipts can be emailed. */
  connected: boolean
  mailbox: string
  connectedBy: string | null
  /** When the stored sign-in was last refreshed or made. */
  updatedAt: Date | null
  missing: string[]
}

export async function mailStatus(): Promise<MailStatus> {
  const missing = missingMailSettings()
  const row = await prisma.goodsInMailAuth.findUnique({ where: { id: ROW_ID }, select: { connectedBy: true, updatedAt: true } })
  return {
    configured: missing.length === 0,
    connected: missing.length === 0 && !!row,
    mailbox: receiptsMailbox(),
    connectedBy: row?.connectedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
    missing,
  }
}

/** The Microsoft sign-in link. `state` is the random value the connect route also puts in a cookie. */
export function authorizeUrl(origin: string, state: string): string {
  const e = env()
  if (!mailConfigured()) throw new MailNotReadyError(`The Hub's Microsoft settings aren't there on this environment (${missingMailSettings().join(", ")}).`)
  const params = new URLSearchParams({
    client_id: e.client,
    response_type: "code",
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    response_mode: "query",
    scope: SCOPE,
    state,
    // Let the person choose the account — the one with Send As rights may not be the one the browser is signed in as.
    prompt: "select_account",
  })
  return `https://login.microsoftonline.com/${encodeURIComponent(e.tenant)}/oauth2/v2.0/authorize?${params}`
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

/** Microsoft's own explanation of a refused token request, trimmed to its first line (no tokens are ever in it). */
function tokenError(body: TokenResponse | null, status: number): string {
  const desc = (body?.error_description || body?.error || "").split(/\r?\n/)[0].replace(/\s*Trace ID:.*$/i, "").trim()
  return desc ? desc.slice(0, 300) : `Microsoft refused the sign-in (HTTP ${status}).`
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const e = env()
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(e.tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.client, client_secret: e.secret, scope: SCOPE, ...form }),
    cache: "no-store",
  })
  const body = (await res.json().catch(() => null)) as TokenResponse | null
  if (!res.ok || !body?.access_token) throw new MailNotReadyError(tokenError(body, res.status))
  return body
}

/**
 * The Microsoft account a token belongs to, for "connected by". Read from the token's own claims
 * when it is a readable JWT; anything unexpected simply gives null (it is only shown, never trusted).
 */
function accountOf(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1]
    if (!part) return null
    const claims = JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>
    const v = claims.upn ?? claims.unique_name ?? claims.preferred_username ?? claims.email
    return typeof v === "string" && v.includes("@") ? v.slice(0, 120) : null
  } catch {
    return null
  }
}

/** Swap the code Microsoft sent back for tokens and store them. `who` is the Hub user who connected. */
export async function exchangeCode(origin: string, code: string, who: string | null): Promise<{ account: string | null }> {
  if (!mailConfigured()) throw new MailNotReadyError(`The Hub's Microsoft settings aren't there on this environment (${missingMailSettings().join(", ")}).`)
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: `${origin}${CALLBACK_PATH}` })
  if (!t.refresh_token) throw new MailNotReadyError("Microsoft didn't hand back a lasting sign-in (no refresh token) — check the app has the offline_access permission.")
  const account = accountOf(t.access_token!)
  const connectedBy = [who?.trim() || null, account ? `(${account})` : null].filter(Boolean).join(" ") || null
  const data = {
    mailbox: receiptsMailbox(),
    accessToken: t.access_token!,
    refreshToken: t.refresh_token,
    expiresAt: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000),
    connectedBy,
  }
  await prisma.goodsInMailAuth.upsert({ where: { id: ROW_ID }, create: { id: ROW_ID, ...data }, update: data })
  return { account }
}

/** Forget the stored sign-in. Receipts can't be emailed until someone connects again. */
export async function disconnect(): Promise<void> {
  await prisma.goodsInMailAuth.deleteMany({ where: { id: ROW_ID } })
}

const NOT_CONNECTED = "Email isn't set up yet — an admin connects the receipts mailbox in Goods In → Settings. Until then, print the receipt, or download it and email it by hand."

/** A usable access token, refreshed when it is within a minute of running out. */
async function accessToken(force = false): Promise<string> {
  if (!mailConfigured()) throw new MailNotReadyError(NOT_CONNECTED)
  const row = await prisma.goodsInMailAuth.findUnique({ where: { id: ROW_ID } })
  if (!row) throw new MailNotReadyError(NOT_CONNECTED)
  if (!force && row.expiresAt.getTime() > Date.now() + 60_000) return row.accessToken
  let t: TokenResponse
  try {
    t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refreshToken })
  } catch (e) {
    throw new MailNotReadyError(`The receipts mailbox sign-in has stopped working (${(e as Error).message}) — an admin needs to press Connect again in Goods In → Settings.`)
  }
  await prisma.goodsInMailAuth.update({
    where: { id: ROW_ID },
    data: { accessToken: t.access_token!, refreshToken: t.refresh_token || row.refreshToken, expiresAt: new Date(Date.now() + (Number(t.expires_in) || 3600) * 1000) },
  })
  return t.access_token!
}

/** Graph's refusal in plain words — what the counter clerk (or IT) needs to do about it. */
function graphError(status: number, body: string, mailbox: string): string {
  let code = "", message = ""
  try {
    const j = JSON.parse(body) as { error?: { code?: string; message?: string } }
    code = j.error?.code ?? ""
    message = (j.error?.message ?? "").split(/\r?\n/)[0].slice(0, 200)
  } catch { /* not JSON */ }
  if (status === 403 || /SendAsDenied|AccessDenied|ErrorAccessDenied/i.test(code)) {
    return `The account that connected the mailbox isn't allowed to send from ${mailbox}. IT needs to give it Send As or Send on behalf rights on that mailbox (or an admin connects with an account that has them).`
  }
  if (status === 401) return "Microsoft wouldn't accept the mailbox sign-in — an admin needs to press Connect again in Goods In → Settings."
  if (status === 404 || /MailboxNotEnabled|ResourceNotFound|ErrorInvalidUser/i.test(code)) return `Microsoft couldn't find the mailbox ${mailbox} — check the RECEIPTS_MAILBOX setting.`
  if (/InvalidRecipients|ErrorInvalidRecipients/i.test(code)) return "Microsoft refused that email address — check it and try again."
  if (status === 413) return "The receipt is too large to email from the Hub — download it and email it by hand."
  if (status === 429 || status >= 500) return `Microsoft's email service is busy or unavailable (HTTP ${status}) — try again in a minute.`
  return `Microsoft refused to send the email (HTTP ${status}${code ? `, ${code}` : ""}${message ? `: ${message}` : ""}).`
}

type Attachment = { filename: string; bytes: Uint8Array; contentType: string }

async function sendMail(m: { to: string; subject: string; html: string; attachments: Attachment[] }): Promise<void> {
  const mailbox = receiptsMailbox()
  const message = {
    message: {
      subject: m.subject,
      body: { contentType: "HTML", content: m.html },
      toRecipients: [{ emailAddress: { address: m.to } }],
      attachments: m.attachments.map(a => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.filename,
        contentType: a.contentType,
        contentBytes: Buffer.from(a.bytes).toString("base64"),
      })),
    },
    saveToSentItems: true,
  }
  const post = (token: string) =>
    fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
      cache: "no-store",
    })
  let res = await post(await accessToken())
  // A token can be withdrawn before its stated expiry — refresh once and try again.
  if (res.status === 401) res = await post(await accessToken(true))
  if (res.status === 202 || res.ok) return
  const text = await res.text().catch(() => "")
  throw new MailNotReadyError(graphError(res.status, text, mailbox))
}

/** Email a receipt PDF from the receipts mailbox (a copy is kept in its Sent Items). Throws with a plain message. */
export async function sendReceiptEmail(m: { to: string; subject: string; html: string; pdf: Uint8Array; filename: string }): Promise<void> {
  if (m.pdf.byteLength > MAX_PDF_BYTES) throw new MailNotReadyError("The receipt is too large to email from the Hub — download it and email it by hand.")
  await sendMail({ to: m.to, subject: m.subject, html: m.html, attachments: [{ filename: m.filename, bytes: m.pdf, contentType: "application/pdf" }] })
}

/** A short email with no attachment, so an admin can check the connected account is allowed to send. */
export async function sendTestEmail(to: string, who: string | null): Promise<void> {
  const mailbox = receiptsMailbox()
  const html = `<p>This is a test from the Vectis Hub's Goods In settings${who ? `, sent by ${escapeHtml(who)}` : ""}.</p>`
    + `<p>It arrived, so receipts can be emailed to customers from ${escapeHtml(mailbox)}.</p>`
  await sendMail({ to, subject: "Vectis Hub — receipts email test", html, attachments: [] })
}

/** A plausible single email address (what a clerk types at the counter, not a full RFC parser). */
export function cleanEmail(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!s || s.length > 254) return null
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[a-z]{2,}$/i.test(s) ? s : null
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
