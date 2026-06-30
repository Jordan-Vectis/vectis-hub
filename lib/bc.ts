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

/** For cron jobs / system use — picks any valid token from the DB without requiring a session */
export async function getBCTokenAny(): Promise<string | null> {
  // Try a non-expired token first
  const valid = await prisma.bCToken.findFirst({
    where: { expiresAt: { gt: new Date(Date.now() + 60_000) } },
  })
  if (valid) return valid.accessToken

  // Try refreshing any token that has a refresh token
  const any = await prisma.bCToken.findFirst({
    where: { refreshToken: { not: "" } },
  })
  if (!any) return null
  return refreshBCToken(any.userId, any.refreshToken)
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
// sales with thousands of lines. Relies on @odata.count, the same annotation
// bcFetchAllWithProgress reads; falls back to the returned row count if the
// server omits it.
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
  const json = await bcPageJson(token, `${base}?${qs}`)
  const c = json["@odata.count"]
  return typeof c === "number" ? c : (json.value ?? []).length
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
