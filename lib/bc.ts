/**
 * Business Central OData client — delegated OAuth2 (user token from DB)
 */

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const BC_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/ODataV4/Company('{company}')/"

function baseUrl(): string {
  return BC_BASE
    .replace("{tenantId}",    process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
    .replace("{company}",     encodeURIComponent(process.env.BC_COMPANY ?? "Vectis"))
}

async function refreshBCToken(userId: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${process.env.BC_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type:    "refresh_token",
          client_id:     process.env.BC_CLIENT_ID!,
          client_secret: process.env.BC_CLIENT_SECRET!,
          refresh_token: refreshToken,
          scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
        }),
      }
    )
    if (!res.ok) return null
    const tokens = await res.json()

    await prisma.bCToken.update({
      where: { userId },
      data: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token ?? refreshToken,
        expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      },
    })

    return tokens.access_token
  } catch {
    return null
  }
}

/**
 * Background BC work — the timed BC copy and its reconcile, the report caches, the cron jobs — signs
 * in as this ONE person: the Hub user with this username (compared case-insensitively).
 *
 * ⚠⚠ Never go back to "any stored sign-in". There is no company BC account, and most staff's BC
 * permissions don't cover everything the copy reads. Until 2026-09-14 this took an ARBITRARY stored
 * sign-in (findFirst with no order, which drifts after every UPDATE); from Fri 11 Sept ~20:00 BC
 * answered 403 to every read of the change log (the "Location changes" part of the copy) while every
 * other part of the same run worked — the pattern of a sign-in without change-log permission.
 * Jordan: "make it only use my login as most other people might not have permission". There is
 * deliberately NO fallback to anyone else: if this sign-in lapses, the Status Centre's Business
 * Central light goes red and names who must sign in, rather than the copy quietly running as
 * someone whose permissions don't cover it. getBCTokenForStatus() tests the same person.
 */
export const BACKGROUND_BC_USERNAME = "jordan.orange"

/** The Hub user whose BC sign-in background work uses (BACKGROUND_BC_USERNAME), or null. */
export async function getBackgroundBCUser(): Promise<{ id: string; name: string } | null> {
  return prisma.user.findFirst({
    where:  { username: { equals: BACKGROUND_BC_USERNAME, mode: "insensitive" } },
    select: { id: true, name: true },
  })
}

/** For cron jobs / system use — BACKGROUND_BC_USERNAME's sign-in, and nobody else's. */
export async function getBCTokenAny(): Promise<string | null> {
  const record = await prisma.bCToken.findFirst({
    where: { user: { username: { equals: BACKGROUND_BC_USERNAME, mode: "insensitive" } } },
  })
  if (!record) return null

  // Token still valid (with 60s buffer)
  if (record.expiresAt.getTime() > Date.now() + 60_000) return record.accessToken

  if (!record.refreshToken) return null
  return refreshBCToken(record.userId, record.refreshToken)
}

export async function getBCToken(): Promise<string | null> {
  const session = await auth()
  if (!session) return null

  const record = await prisma.bCToken.findUnique({ where: { userId: session.user.id } })
  if (!record) return null

  // Token still valid (with 60s buffer)
  if (record.expiresAt.getTime() > Date.now() + 60_000) {
    return record.accessToken
  }

  // Try refresh
  if (record.refreshToken) {
    return refreshBCToken(session.user.id, record.refreshToken)
  }

  return null
}

// List every published OData web service (the service root document) so we can
// discover the exact endpoint names BC exposes — e.g. the auction-header /
// statistics table (EVA_AuctionHeader, table 75003). Returns [{ name, url, kind }].
export async function bcListServices(
  token: string,
): Promise<{ name: string; url: string; kind: string | null }[]> {
  const res = await fetch(baseUrl(), {
    headers: {
      Accept:            "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:     `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return (json.value ?? []).map((s: any) => ({
    name: s.name ?? "",
    url:  s.url  ?? "",
    kind: s.kind ?? null,
  }))
}

// Raw service-root fetch for diagnostics — returns status + the top-level shape
// so we can see whether BC returns an empty/absent `value` list and why.
export async function bcServiceDocRaw(token: string): Promise<{
  status: number
  ok: boolean
  keys: string[]
  valueLen: number | null
  rawSnippet: string
}> {
  const res = await fetch(baseUrl(), {
    headers: {
      Accept:            "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:     `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(45_000),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return {
    status:     res.status,
    ok:         res.ok,
    keys:       json && typeof json === "object" ? Object.keys(json) : [],
    valueLen:   Array.isArray(json?.value) ? json.value.length : null,
    rawSnippet: text.slice(0, 300),
  }
}

export async function bcPage(
  token: string,
  endpoint: string,
  params: Record<string, string | number>
): Promise<any[]> {
  // Build query string manually:
  // - Keep OData keys ($filter, $top, etc.) unencoded — BC ignores %24filter
  // - Encode values with encodeURIComponent so spaces become %20 (not +)
  const base = baseUrl() + endpoint
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")
  const urlStr = qs ? `${base}?${qs}` : base
  const res = await fetch(urlStr, {
    headers: {
      Accept:            "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:     `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
  return (await res.json()).value ?? []
}

// bcPageWithNext: returns rows AND the @odata.nextLink for server-driven paging.
// BC has a hard $skip limit (often ~38k–40k); past that, $skip starts returning
// empty pages even when more data exists. The @odata.nextLink uses skiptoken
// pagination which has no upper limit — the canonical way to walk a full table.
export async function bcPageWithNext(
  token: string,
  endpointOrUrl: string,
  params?: Record<string, string | number>,
): Promise<{ rows: any[]; nextLink: string | null; count?: number }> {
  let urlStr: string
  if (endpointOrUrl.startsWith("http")) {
    // Full URL (a nextLink from a previous response)
    urlStr = endpointOrUrl
  } else {
    const base = baseUrl() + endpointOrUrl
    const qs = params
      ? Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")
      : ""
    urlStr = qs ? `${base}?${qs}` : base
  }
  const res = await fetch(urlStr, {
    headers: {
      Accept:            "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:     `Bearer ${token}`,
      // include-annotations asks BC to actually emit @odata.nextLink
      // (some BC tenants suppress it unless preferences are explicit)
      Prefer:            "odata.maxpagesize=500, odata.include-annotations=\"*\"",
    },
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return {
    rows:     json.value ?? [],
    nextLink: json["@odata.nextLink"] ?? null,
    count:    json["@odata.count"],
  }
}

// bcCount: returns the number of rows matching `filter` on `endpoint` using
// OData $count — it does NOT download the rows ($top=0), so it's cheap even for
// sales with thousands of lines. THROWS if the @odata.count annotation is
// absent (rather than silently returning 0) so callers can show "—" for an
// unknown count instead of a wrong zero. Single 15s attempt — a count should be
// quick, and the caller treats a failure as "unknown".
export async function bcCount(
  token: string,
  endpoint: string,
  filter: string,
): Promise<number> {
  const base = baseUrl() + endpoint
  const params: Record<string, string | number> = { $filter: filter, $top: 0, $count: "true" }
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&")
  const res = await fetch(`${base}?${qs}`, {
    headers: {
      Accept:             "application/json",
      "OData-MaxVersion": "4.0",
      Authorization:      `Bearer ${token}`,
      // Some BC tenants only emit @odata.count when annotations are explicitly
      // requested (same reason bcPageWithNext sets this).
      Prefer:             'odata.include-annotations="*"',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const c = json["@odata.count"]
  if (typeof c !== "number") throw new Error("BC $count returned no @odata.count annotation")
  return c
}

export async function bcFetchAll(
  token: string,
  endpoint: string,
  filter?: string,
  select?: string,
  batchSize = 500
): Promise<any[]> {
  const all: any[] = []
  let skip = 0
  while (true) {
    const params: Record<string, string | number> = { $top: batchSize, $skip: skip }
    if (filter) params.$filter = filter
    if (select) params.$select = select
    const rows = await bcPage(token, endpoint, params)
    all.push(...rows)
    if (rows.length < batchSize) break
    skip += batchSize
  }
  return all
}

async function bcPageJson(
  token: string,
  url: string,
  retries = 3
): Promise<any> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1500 * attempt))
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "OData-MaxVersion": "4.0", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`BC API ${res.status}: ${await res.text()}`)
      return await res.json()
    } catch (e: any) {
      lastErr = e
    }
  }
  throw lastErr
}

export async function bcFetchAllWithProgress(
  token: string,
  endpoint: string,
  filter: string | undefined,
  select: string | undefined,
  batchSize: number,
  onProgress: (done: number, total: number) => void
): Promise<any[]> {
  const all: any[] = []
  let skip = 0
  let knownTotal = 0
  let firstPage = true

  while (true) {
    const params: Record<string, string | number> = { $top: batchSize, $skip: skip }
    if (filter) params.$filter = filter
    if (select) params.$select = select
    if (firstPage) params["$count"] = "true"

    const base = baseUrl() + endpoint
    const qs = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&")

    const json = await bcPageJson(token, `${base}?${qs}`)
    const rows: any[] = json.value ?? []

    if (firstPage) {
      knownTotal = json["@odata.count"] ?? 0
      firstPage = false
    }

    all.push(...rows)
    onProgress(all.length, Math.max(knownTotal, all.length))

    if (rows.length < batchSize) break
    skip += batchSize
  }
  return all
}

// ── Custom API (eva/tot v1.0 — page 76804 EVA_TOT_ReceiptToteAPI) ───────────
// The Receipt_Totes_Excel ODataV4 web service only publishes totes NOT ticked
// Catalogued (~1,800 of ~20,500 rows) — BC drops a tote from that feed the
// moment it's ticked, and a $filter on EVA_TOT_Catalogued is silently ignored
// (confirmed live 2026-08-06). This custom API page is bound to the SAME
// EVA_TOT_ReceiptTote table with no filter, so it serves the WHOLE list,
// catalogued included. Field names are camelCase (toteNo, receiptNo, …), not
// EVA_TOT_*, and it carries no vendorName — only vendorNo.
// Company must be addressed by GUID here, not by name like ODataV4.
const BC_TOT_API_BASE =
  "https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/eva/tot/v1.0/"

// ⚠ The API PATH IS PER PUBLISHER — it is not always "eva". The receipt-tote page above publishes
// under eva/tot, while the Vendor API (page 75608 EVA_VendorAPI, Evo-auction - Base) publishes
// under **evo/base**, and Microsoft's own vendor entity lives under the standard api/v2.0. Read
// APIPublisher / APIGroup / APIVersion off the AL page before building a URL; guessing "eva"
// silently 404s.
function bcApiRoot(path: string): string {
  return `https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/${path}/`
    .replace("{tenantId}",    process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
}

// Company ids are per API root, so they are cached per root rather than globally.
const cachedApiCompanyId = new Map<string, string>()

async function companyIdFor(root: string, token: string): Promise<string> {
  const hit = cachedApiCompanyId.get(root)
  if (hit) return hit
  const res = await fetch(`${root}companies`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`BC API companies ${res.status}: ${await res.text()}`)
  const companies: { id: string; name: string }[] = (await res.json()).value ?? []
  const wanted  = process.env.BC_COMPANY ?? "Vectis"
  const company = companies.find(c => c.name === wanted)
  if (!company) throw new Error(`BC company "${wanted}" not found in API companies list`)
  cachedApiCompanyId.set(root, company.id)
  return company.id
}

/**
 * URL for any BC API page, standard or custom.
 * `apiPath` is the bit after the environment — "api/evo/base/v1.0" for the Evo Vendor API,
 * "api/v2.0" for Microsoft's standard one. Company is addressed by GUID here, not by name.
 */
export async function bcApiUrl(token: string, apiPath: string, entitySet: string): Promise<string> {
  const root = bcApiRoot(apiPath)
  const id   = await companyIdFor(root, token)
  return `${root}companies(${id})/${entitySet}`
}

let cachedTotCompanyId: string | null = null

export async function bcTotApiUrl(token: string, entitySet: string): Promise<string> {
  const root = BC_TOT_API_BASE
    .replace("{tenantId}",    process.env.BC_TENANT_ID ?? "")
    .replace("{environment}", process.env.BC_ENVIRONMENT ?? "production")
  if (!cachedTotCompanyId) {
    const res = await fetch(`${root}companies`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal:  AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`BC API companies ${res.status}: ${await res.text()}`)
    const companies: { id: string; name: string }[] = (await res.json()).value ?? []
    const wanted  = process.env.BC_COMPANY ?? "Vectis"
    const company = companies.find(c => c.name === wanted)
    if (!company) throw new Error(`BC company "${wanted}" not found in API companies list`)
    cachedTotCompanyId = company.id
  }
  return `${root}companies(${cachedTotCompanyId})/${entitySet}`
}

// ── "Contents Description" — the free text a goods-in clerk writes on a tote ────────────────
//
// ⚠ CONFIRMED on Receipt_Totes_Excel as **EVA_TOT_ContentsDescription** (Jordan, BC API Viewer,
// 2026-09-09 — 30 fields, sample value "green box"). The eva/tot custom API serves camelCase
// instead and has NOT been checked, so the match stays tolerant rather than hardcoding one
// spelling: BC's own caption is matched against the keys a row ACTUALLY arrived with. If a feed
// doesn't publish the column, `field` comes back null, the caller writes nothing, and the Data
// Sync log says which of the two happened — a hardcoded name that silently yields `undefined`
// looks identical to "BC has nothing", which is the failure this avoids.
// ⚠⚠ Receipt_Totes_Excel publishes ONLY totes NOT ticked Catalogued, so a catalogued tote's
// description can arrive only via the totes-all (eva/tot) stage.
const CONTENTS_KEYS = new Set(["contentsdescription", "contentdescription", "contentsdesc"])

export function pickBcContents(row: Record<string, unknown>): { value: string | null; field: string | null } {
  for (const key of Object.keys(row)) {
    // Case, punctuation and the EVA_TOT_ / EVA_ / PTE_ prefixes stripped, so one rule covers both
    // feeds. ⚠ "evatot" must be tried before "eva" or the longer prefix never matches.
    const norm = key.toLowerCase().replace(/[^a-z]/g, "").replace(/^(evatot|eva|pte)/, "")
    if (!CONTENTS_KEYS.has(norm)) continue
    const value = String(row[key] ?? "").trim()
    return { value: value || null, field: key }
  }
  return { value: null, field: null }
}

// ── Status Centre (🚦 /admin/status, 2026-09-10) ─────────────────────────────────────────────
//
// The Business Central light has to say WHOSE sign-in the background work uses — there is NO
// company-wide BC account, so "BC is fine" means little unless a person can be named — and a status
// check must never write to the database. getBCTokenAny() can do neither, and is left alone because
// every sync stage relies on it:
//   • it returns a bare string, so nothing can say whose key it was;
//   • refreshBCToken throws Microsoft's reason away (`if (!res.ok) return null`), so an expired
//     app key, a withdrawn sign-in and a database fault all read as "not connected";
//   • it WRITES the renewed key back. On a read-only database day (2026-09-09) that write fails,
//     refreshBCToken returns null, and BC looks down when the fault is the database.
// ⚠ Both use the SAME one person's sign-in (BACKGROUND_BC_USERNAME, 2026-09-14) — keep them in
// step, or the light can be green on a sign-in the background work never uses.

/** One stored sign-in Microsoft would not renew. Never carries message text — only a short code. */
export interface BCRenewFailure {
  userId: string
  /** refused = that person's sign-in no longer renews (expired, withdrawn, password changed)
   *  app-key = Microsoft refused the Hub's OWN app key or settings — every renewal will fail the same way
   *  unreachable = Microsoft's sign-in service didn't answer · rate-limited = asked too often */
  kind: "refused" | "app-key" | "unreachable" | "rate-limited"
  /** e.g. "AADSTS700082", "invalid_grant", "HTTP 503", "timeout". */
  code: string
}

export type BCStatusToken =
  | { ok: true; token: string; userId: string; name: string; renewed: boolean; renewable: boolean }
  | {
      ok: false
      reason: "no-user" | "no-sign-in" | "none-renewable" | "not-configured" | "renewal-failed"
      userId: string | null
      name: string | null
      /** Only when reason is "renewal-failed" — Microsoft's short code, never its message. */
      failure?: BCRenewFailure
    }

// Entra error codes that mean the Hub's own app registration is at fault, not the person:
// 7000222 secret expired · 7000215 wrong secret · 7000218 secret missing · 700016 app not in tenant ·
// 90002 / 900023 tenant not found or malformed · 7000112 app disabled · 70011 the scope the Hub asks
// for is invalid. Any of these would refuse every person alike — the fix is the Hub's, not the person's.
const APP_KEY_CODES = new Set([7000222, 7000215, 7000218, 700016, 90002, 900023, 7000112, 70011])

async function renewForStatus(
  tenant: string, clientId: string, clientSecret: string, refreshToken: string, timeoutMs: number,
): Promise<{ ok: true; token: string } | { ok: false; kind: BCRenewFailure["kind"]; code: string }> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "refresh_token",
        client_id:     clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null
      return typeof json?.access_token === "string" && json.access_token
        ? { ok: true, token: json.access_token }
        : { ok: false, kind: "unreachable", code: "no key in the answer" }
    }
    // An unread body keeps the connection open until garbage collection — release it at once.
    if (res.status === 429) { void res.body?.cancel().catch(() => {}); return { ok: false, kind: "rate-limited", code: "HTTP 429" } }
    if (res.status >= 500)  { void res.body?.cancel().catch(() => {}); return { ok: false, kind: "unreachable",  code: `HTTP ${res.status}` } }
    const json = (await res.json().catch(() => null)) as { error?: unknown; error_codes?: unknown } | null
    const err = typeof json?.error === "string" ? json.error : ""
    const rawCodes = json?.error_codes
    const codes = Array.isArray(rawCodes) ? rawCodes.filter((n): n is number => typeof n === "number") : []
    const appKey = err === "invalid_client" || err === "unauthorized_client" || codes.some(c => APP_KEY_CODES.has(c))
    return { ok: false, kind: appKey ? "app-key" : "refused", code: codes.length ? `AADSTS${codes[0]}` : (err || `HTTP ${res.status}`) }
  } catch (e) {
    const name = (e as { name?: string })?.name
    return { ok: false, kind: "unreachable", code: name === "TimeoutError" || name === "AbortError" ? "timeout" : "no answer" }
  }
}

/**
 * For the Status Centre ONLY: a BC key the way getBCTokenAny gets one, but it says whose it is and
 * NEVER writes to the database.
 *
 * 1. That one person's key while it is still valid for over a minute — what getBCTokenAny tries
 *    first, so no Microsoft call at all.
 * 2. Otherwise renew it IN MEMORY. Only that person is ever tried, exactly as getBCTokenAny does
 *    (BACKGROUND_BC_USERNAME), so the light tests the sign-in the background work really uses.
 *
 * ⚠ The renewed key is deliberately NOT saved. Microsoft does not withdraw a refresh token when it
 * is redeemed (it stays valid until its own expiry), so the stored key keeps working for the Hub's
 * real renewals, and a database refusing writes can't be mistaken for BC being down. The price is
 * one free sign-in call per check whenever that person holds no live key (overnight).
 */
export async function getBCTokenForStatus(opts: { timeoutMs?: number } = {}): Promise<BCStatusToken> {
  const timeoutMs = Math.min(15_000, opts.timeoutMs ?? 8_000)

  const user = await getBackgroundBCUser()
  if (!user) return { ok: false, reason: "no-user", userId: null, name: null }
  const base = { userId: user.id, name: user.name }

  const row = await prisma.bCToken.findUnique({
    where:  { userId: user.id },
    select: { accessToken: true, refreshToken: true, expiresAt: true },
  })
  if (!row) return { ok: false, reason: "no-sign-in", ...base }

  const renewable = !!row.refreshToken
  if (row.accessToken && row.expiresAt.getTime() > Date.now() + 60_000) {
    return { ok: true, token: row.accessToken, renewed: false, renewable, ...base }
  }
  if (!renewable) return { ok: false, reason: "none-renewable", ...base }

  const tenant = process.env.BC_TENANT_ID, clientId = process.env.BC_CLIENT_ID, clientSecret = process.env.BC_CLIENT_SECRET
  if (!tenant || !clientId || !clientSecret) return { ok: false, reason: "not-configured", ...base }

  const r = await renewForStatus(tenant, clientId, clientSecret, row.refreshToken, timeoutMs)
  if (r.ok) return { ok: true, token: r.token, renewed: true, renewable: true, ...base }
  return { ok: false, reason: "renewal-failed", failure: { userId: user.id, kind: r.kind, code: r.code }, ...base }
}

/** The ODataV4 address of one web service, e.g. bcODataUrl("Totes_Excel") — for a caller that needs
 *  its own fetch, such as the Status Centre's probe with a 15 s timeout instead of bcPage's 45 s. */
export function bcODataUrl(endpoint: string): string {
  return baseUrl() + endpoint
}
