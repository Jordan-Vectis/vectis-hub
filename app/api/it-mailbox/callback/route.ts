import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

const APP_URL = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.redirect(new URL(`${APP_URL}/login`))

  const { searchParams } = req.nextUrl
  const code  = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error_description") || searchParams.get("error")

  if (error) {
    return NextResponse.redirect(new URL(`${APP_URL}/tools/job-board?mb_error=${encodeURIComponent(error)}`))
  }

  const cookieStore = await cookies()
  const savedState  = cookieStore.get("itmb_oauth_state")?.value
  if (!state || state !== savedState) {
    return NextResponse.redirect(new URL(`${APP_URL}/tools/job-board?mb_error=invalid_state`))
  }
  if (!code) {
    return NextResponse.redirect(new URL(`${APP_URL}/tools/job-board?mb_error=no_code`))
  }

  const clientId     = process.env.GRAPH_CLIENT_ID!
  const clientSecret = process.env.GRAPH_CLIENT_SECRET!
  const tenantId     = process.env.GRAPH_TENANT_ID!
  const redirectUri  = `${APP_URL}/api/it-mailbox/callback`

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
        code,
        scope:         "offline_access https://graph.microsoft.com/Mail.Read.Shared",
      }),
    }
  )

  if (!tokenRes.ok) {
    const err = await tokenRes.text()
    return NextResponse.redirect(new URL(`${APP_URL}/tools/job-board?mb_error=${encodeURIComponent(err.slice(0, 200))}`))
  }

  const tokens = await tokenRes.json()

  await prisma.iTMailboxAuth.upsert({
    where:  { id: "global" },
    create: {
      id:           "global",
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      connectedBy:  session.user.name ?? session.user.email ?? null,
    },
    update: {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt:    new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      connectedBy:  session.user.name ?? session.user.email ?? null,
    },
  })

  const response = NextResponse.redirect(new URL(`${APP_URL}/tools/job-board?mb_connected=1`))
  response.cookies.delete("itmb_oauth_state")
  return response
}
