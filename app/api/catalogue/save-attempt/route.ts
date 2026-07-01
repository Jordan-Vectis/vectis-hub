import { NextResponse } from "next/server"
import { auth } from "@/auth"

export const dynamic = "force-dynamic"

// Diagnostic ONLY — records each activation of the tablet wizard's Save button
// (event characteristics + whether the lot was actually filled in) into a small
// in-memory ring buffer, so we can identify WHAT is auto-firing saves on X069
// (a real touch vs a synthetic/keyboard event). Fire-and-forget from the client;
// never affects saving. Buffer is per-process and cleared on redeploy.
export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ ok: false }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const g = globalThis as { __saveAttempts?: unknown[] }
    g.__saveAttempts = g.__saveAttempts ?? []
    g.__saveAttempts.push({
      ...body,
      // server-authoritative — spread body FIRST so the client can't spoof these
      at:   new Date().toISOString(),
      user: session.user.name ?? session.user.email ?? "?",
    })
    // keep the last 300
    if (g.__saveAttempts.length > 300) g.__saveAttempts.splice(0, g.__saveAttempts.length - 300)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
