import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

const APP_URL = process.env.NEXTAUTH_URL ?? "https://vectis-production.up.railway.app"

// Where to send the user afterwards: the validated internal path set by
// /api/bc/auth?return=… (cookie), else BC Reports — the original behaviour.
// This lets e.g. BC-Warehouse-only users connect without ever touching BC
// Reports (which their access level can't open).

// Only accept a simple internal path — no scheme, no host, no query.
// (Duplicated in the auth route — route files may only export handlers.)
function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  const path = raw.split("?")[0].split("#")[0]
  return /^\/[A-Za-z0-9\-_/]*$/.test(path) ? path : null
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.redirect(new URL(`${APP_URL}/login`))

  const cookieStore = await cookies()
  const returnPath  = safeReturnPath(cookieStore.get("bc_oauth_return")?.value) ?? "/tools/bc-reports"
  const redirectTo  = (query: string) => {
    const res = NextResponse.redirect(new URL(`${APP_URL}${returnPath}?${query}`))
    res.cookies.delete("bc_oauth_state")
    res.cookies.delete("bc_oauth_return")
    return res
  }

  const { searchParams } = req.nextUrl
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  if (error) {
    return redirectTo(`bc_error=${encodeURIComponent(error)}`)
  }

  // Verify state from cookie
  const savedState = cookieStore.get("bc_oauth_state")?.value
  if (!state || state !== savedState) {
    return redirectTo("bc_error=invalid_state")
  }

  const clientId     = process.env.BC_CLIENT_ID!
  const clientSecret = process.env.BC_CLIENT_SECRET!
  const tenantId     = process.env.BC_TENANT_ID!
  const redirectUri  = `${APP_URL}/api/bc/callback`

  // Exchange code for tokens
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        grant_type:    "authorization_code",
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        code:          code!,
        scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
      }),
    }
  )

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return redirectTo(`bc_error=${encodeURIComponent(err)}`)
  }

  const tokens = await tokenRes.json()

  // Store tokens in DB against the user — avoids cookie size limits entirely
  await prisma.bCToken.upsert({
    where:  { userId: session.user.id },
    create: {
      userId:       session.user.id,
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    },
    update: {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    },
  })

  return redirectTo("bc_connected=1")
}
