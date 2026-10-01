"use server"

// Browser-side callers of lib/lot-ai-check.ts: the Auto Pipeline tab records what a run learned,
// the Review tab ticks a lot as looked at. Advisory data — a signed-in user is the only gate.

import { auth } from "@/auth"
import { recordLotAiCheck, markLotAiCheckSeen, type ObjectCheck } from "@/lib/lot-ai-check"

type Result = { ok: boolean; error?: string }

export async function recordLotAiCheckAction(lotId: string, patch: { assumed?: string[]; objects?: ObjectCheck[]; model?: string | null; source?: string }): Promise<Result> {
  const session = await auth()
  if (!session) return { ok: false, error: "Unauthorised" }
  const ok = await recordLotAiCheck(lotId, patch)
  return ok ? { ok: true } : { ok: false, error: "The database update for AI checks is still waiting" }
}

export async function markLotAiCheckSeenAction(lotId: string): Promise<Result> {
  const session = await auth()
  if (!session) return { ok: false, error: "Unauthorised" }
  const by = session.user?.name || session.user?.email || "unknown"
  const ok = await markLotAiCheckSeen(lotId, by)
  return ok ? { ok: true } : { ok: false, error: "Couldn't mark it as checked" }
}
