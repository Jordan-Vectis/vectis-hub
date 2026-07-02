import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

// Starts the per-user Business Central OAuth sign-in.
//
// Optional ?return=/tools/bc-warehouse — an INTERNAL path the callback sends the
// user back to afterwards (carried in a short-lived cookie, validated both ends).
// Without it the flow returns to /tools/bc-reports as it always has. This exists
// because users who only have BC Warehouse access can't visit BC Reports, so the
// connect flow must be startable from (and return to) their own tool.

// Only accept a simple internal path — no scheme, no host, no query.
// (Duplicated in the callback route — route files may only export handlers.)
function safeReturnPath(raw: string | null): string | null {
  if (!raw) return null
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  const path = raw.split("?")[0].split("#")[0]
  return /^\/[A-Za-z0-9\-_/]*$/.test(path) ? path : null
}

export async function GET(req: NextRequest) {
  try {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const clientId    = process.env.BC_CLIENT_ID!
  const tenantId    = process.env.BC_TENANT_ID!
  const appUrl      = process.env.NEXTAUTH_URL ?? "https://vectis-production.up.railway.app"
  const redirectUri = `${appUrl}/api/bc/callback`
  const state       = crypto.randomUUID()
  const returnPath  = safeReturnPath(req.nextUrl.searchParams.get("return"))

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         "https://api.businesscentral.dynamics.com/user_impersonation offline_access",
    state,
    response_mode: "query",
  })

  const authUrl  = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
  const response = NextResponse.redirect(authUrl)

  // Set state cookie on the response itself
  response.cookies.set("bc_oauth_state", state, {
    httpOnly: true,
    secure:   true,
    sameSite: "lax",
    maxAge:   300,
    path:     "/",
  })
  if (returnPath) {
    response.cookies.set("bc_oauth_return", returnPath, {
      httpOnly: true,
      secure:   true,
      sameSite: "lax",
      maxAge:   300,
      path:     "/",
    })
  }

  return response
  } catch (e: any) {
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 })
  }
}
