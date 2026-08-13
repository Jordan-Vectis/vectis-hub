// Lets a route be called EITHER by a logged-in user OR by the server's own
// background loops (server.js → /api/cron/*), which have no session.
//
// The existing cron routes already authenticate this way; this just puts the
// check in one place so the AI routes the overnight Auto Pipeline queue drives
// can accept it too. CRON_SECRET is a server-only env var and the caller is the
// same container over localhost — a browser can never mint this header.
//
// ⚠ Only ever use this ALONGSIDE the normal session check, never instead of it:
//   const session = await auth()
//   if (!session && !isCronRequest(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

export function isCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get("authorization") === `Bearer ${secret}`
}
