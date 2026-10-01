// The office PC model trial (2026-10-01).
//
// Jordan wants better accuracy and not to depend on other companies. The test of whether an
// open-weight model can do the job is to put it in front of REAL lots: a PC in the office runs
// the model and PULLS description jobs from the Hub (the collector-script pattern — no hole in
// the office firewall), writes a description from the SAME prompt and photos Gemini gets, and
// posts it back. Instructions Testing shows the two side by side.
//
// ⚠⚠ PREVIEW ONLY. A LocalAiJob never writes to a CatalogueLot. Do not "helpfully" add an apply.
//
// Pieces: this file (tokens, reply parsing, lease length) · app/api/local-ai/* (session routes
// for the tab, bearer-token routes for the PC) · scripts/local-ai-bridge.mjs (what the PC runs)
// · the Photos row of app/(app)/tools/auction-ai/instructions-test-tab.tsx.

import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { parseModelJson } from "@/lib/model-json"
import { cleanBearsDescription, isBearsPreset, stripToolCallLeak } from "@/lib/description-cleanup"

/** A lot with 24 photos on a consumer card can take minutes; a job the PC went quiet on is re-offered after this. */
export const LOCAL_AI_LEASE_MS = 15 * 60 * 1000

/** How long since the PC last asked for work before the tab calls it offline. */
export const LOCAL_AI_ONLINE_MS = 45 * 1000

export const LOCAL_AI_STATUSES = ["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELLED"] as const
export type LocalAiStatus = typeof LOCAL_AI_STATUSES[number]

/** The token the PC holds. Shown ONCE when made; only its hash is stored. */
export function newWorkerToken(): string {
  return "vhub_" + randomBytes(24).toString("hex")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get("authorization") ?? ""
  const m = h.match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

/** The worker row for a request's bearer token, or null (no token, unknown token, switched off). */
export async function workerFromRequest(req: Request) {
  const token = bearerFrom(req)
  if (!token) return null
  const worker = await prisma.localAiWorker.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!worker || worker.disabledAt) return null
  return worker
}

/**
 * Split a model's reply the way the Batch route does: an optional JSON wrapper, then the
 * "Estimate:" and "FLAG:" lines out of the text, a leaked tool call stripped, the Dolls & Bears
 * clean-up when that instruction is in use. Same rules, so the comparison is fair.
 */
export function parseDescriptionReply(text: string, presetKey: string): { description: string; estimate: string; flag: string; leaked: boolean } {
  let rawText = (text ?? "").trim()
  const parsed = parseModelJson(rawText)
  if (parsed && typeof parsed.description === "string") rawText = parsed.description.trim()

  const lines = rawText.split("\n")
  const estimateLine = lines.find(l => l.toLowerCase().startsWith("estimate:")) ?? ""
  const flagLine     = lines.find(l => l.toLowerCase().startsWith("flag:")) ?? ""
  const rawDescription = lines
    .filter(l => !l.toLowerCase().startsWith("estimate:") && !l.toLowerCase().startsWith("flag:"))
    .join("\n").trim()
  const { text: stripped, leaked } = stripToolCallLeak(rawDescription)
  const description = isBearsPreset(presetKey) ? cleanBearsDescription(stripped) : stripped
  return {
    description,
    estimate: estimateLine.replace(/^Estimate:\s*/i, "").trim(),
    flag:     flagLine.replace(/^flag:\s*/i, "").trim(),
    leaked,
  }
}

/** The content type a photo key implies — R2 keeps the extension the camera gave it. */
export function mimeFromKey(key: string): string {
  const ext = (key.split(".").pop() ?? "").toLowerCase()
  if (ext === "png")  return "image/png"
  if (ext === "webp") return "image/webp"
  if (ext === "gif")  return "image/gif"
  return "image/jpeg"
}

/** Plain-English state of the PC for the tab. */
export function workerPresence(lastSeenAt: Date | null | undefined, now = Date.now()): "online" | "offline" | "never" {
  if (!lastSeenAt) return "never"
  return now - lastSeenAt.getTime() <= LOCAL_AI_ONLINE_MS ? "online" : "offline"
}
