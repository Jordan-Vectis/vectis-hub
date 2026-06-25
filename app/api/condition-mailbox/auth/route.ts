import { NextResponse } from "next/server"
import { auth } from "@/auth"

const APP_URL = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"

// Starts the delegated sign-in flow to connect the shared condition-reports mailbox.
// Admin only — connecting reads mail as the signed-in admin.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }

    const clientId = process.env.GRAPH_CLIENT_ID
    const tenantId = process.env.GRAPH_TENANT_ID
    if (!clientId || !tenantId) {
      return NextResponse.redirect(new URL(`${APP_URL}/tools/condition-reports?mb_error=not_configured`))
    }

    const redirectUri = `${APP_URL}/api/condition-mailbox/callback`
    const state = crypto.randomUUID()

    const params = new URLSearchParams({
      client_id:     clientId,
      response_type: "code",
      redirect_uri:  redirectUri,
      response_mode: "query",
      scope:         "offline_access https://graph.microsoft.com/Mail.Read.Shared",
      state,
    })

    const authUrl  = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`
    const response = NextResponse.redirect(authUrl)
    response.cookies.set("crmb_oauth_state", state, {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 300, path: "/",
    })
    return response
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 })
  }
}
