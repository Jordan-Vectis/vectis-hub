// Central registry of every AI "tool slot" in the app + a helper to read the
// admin-configured default model for each. Set in Admin → AI Models (stored in
// the ToolModel table). A missing row falls back to the slot's built-in default,
// then to a global fallback — so a retired model is a one-click admin fix
// instead of a code change scattered across ~20 routes.
//
// Precedence at every call site: an explicit model passed by the request (a
// user's per-session picker) → the admin-configured default → the slot default.

import { prisma } from "@/lib/prisma"

export type AiTool = { slot: string; label: string; group: string; default: string }

// Last-resort fallback if a slot has no configured row AND somehow no default.
export const GLOBAL_FALLBACK_MODEL = "gemini-3-flash-preview"

// One entry per AI feature. `default` mirrors what the route used to hardcode.
export const AI_TOOLS: AiTool[] = [
  // ── Cataloguing / Auction AI ──
  { slot: "catalogue_batch",        group: "Cataloguing",  label: "Batch run (descriptions + estimates)", default: "gemini-3-flash-preview" },
  { slot: "catalogue_kpcheck",      group: "Cataloguing",  label: "Key Points Check",                     default: "gemini-2.5-flash-preview-04-17" },
  { slot: "catalogue_doublecheck",  group: "Cataloguing",  label: "Double Check",                         default: "gemini-2.5-flash-preview-04-17" },
  { slot: "catalogue_upgrade",      group: "Cataloguing",  label: "AI Upgrade (rewrite descriptions)",    default: "gemini-3-flash-preview" },
  { slot: "catalogue_flags",        group: "Cataloguing",  label: "Flag auto-fix & re-check",             default: "gemini-3-flash-preview" },
  { slot: "catalogue_lotting_up",   group: "Cataloguing",  label: "Lotting Up (group items from a photo)", default: "gemini-2.5-flash-preview-04-17" },
  { slot: "catalogue_lot_history",  group: "Cataloguing",  label: "Lot History summary",                  default: "gemini-2.5-flash-preview-04-17" },
  { slot: "catalogue_chat",         group: "Auction AI",   label: "Chat",                                 default: "gemini-3-flash-preview" },
  { slot: "catalogue_chat_grounded",group: "Auction AI",   label: "Chat with Google Search",              default: "gemini-3-flash-preview" },
  // ── BC Marketing ──
  { slot: "marketing_article",      group: "BC Marketing", label: "Content Generator (articles)",         default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_article_text", group: "BC Marketing", label: "Paste & Generate",                     default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_web",          group: "BC Marketing", label: "Web descriptions",                     default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_social",       group: "BC Marketing", label: "Social posts",                         default: "gemini-2.5-flash-preview-04-17" },
  // ── IT ──
  { slot: "it_help",                group: "IT",           label: "IT Help assistant",                    default: "gemini-3-flash-preview" },
  { slot: "it_draft_reply",         group: "IT",           label: "Draft reply (IT Tools)",               default: "gemini-3-flash-preview" },
  // ── Accounts (bookkeeping AI) ──
  { slot: "accounts_extract",       group: "Accounts",     label: "Invoice/receipt extract",              default: "gemini-3-flash-preview" },
  { slot: "accounts_split",         group: "Accounts",     label: "Split multi-doc files",                default: "gemini-3-flash-preview" },
  { slot: "accounts_stitch",        group: "Accounts",     label: "Stitch document pages",                default: "gemini-3-flash-preview" },
  { slot: "accounts_statement",     group: "Accounts",     label: "Bank/card statement parse",            default: "gemini-3-flash-preview" },
  // ── Other ──
  { slot: "condition_extract",      group: "Other",        label: "Condition report extract",             default: "gemini-3-flash-preview" },
]

const SLOT_DEFAULT: Record<string, string> = Object.fromEntries(AI_TOOLS.map((t) => [t.slot, t.default]))

// Cache the config briefly so a per-lot batch loop doesn't read the DB every call.
let cache: { at: number; map: Record<string, string> } | null = null
const TTL_MS = 60_000

async function loadConfig(): Promise<Record<string, string>> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.map
  try {
    const rows = await prisma.toolModel.findMany({ select: { slot: true, modelId: true } })
    const map = Object.fromEntries(rows.filter((r) => r.modelId).map((r) => [r.slot, r.modelId]))
    cache = { at: now, map }
    return map
  } catch {
    // Table not migrated yet, or a transient DB error — fall back to defaults.
    return cache?.map ?? {}
  }
}

// Models Google has retired. A stale client (an old cached app bundle on a
// shared iPad, or an old model choice saved in localStorage) can still POST one
// of these as its model, which hard-404s ("model no longer available"). Never
// trust such a value. Add a name here whenever Google retires a model.
const RETIRED_MODELS = new Set([
  "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-2.0-flash-exp", "gemini-2.0-pro",
  "gemini-1.5-flash", "gemini-1.5-flash-latest", "gemini-1.5-flash-002",
  "gemini-1.5-pro", "gemini-1.5-pro-latest", "gemini-1.5-pro-002",
  "gemini-pro", "gemini-pro-vision",
])

// The model a given tool should use. Pass the client's requested model (a user's
// per-session picker) as `clientModel` — it wins ONLY if it's a real, non-retired
// name; a blank or retired value is ignored and the slot's configured default is
// used instead. So a stale client can't break a feature with a dead model name.
// Call as getToolModel(slot) when there is no client model, or
// getToolModel(slot, clientModel) instead of `clientModel || getToolModel(slot)`.
export async function getToolModel(slot: string, clientModel?: string | null): Promise<string> {
  const m = (clientModel ?? "").trim()
  if (m && !RETIRED_MODELS.has(m)) return m
  const map = await loadConfig()
  return map[slot] || SLOT_DEFAULT[slot] || GLOBAL_FALLBACK_MODEL
}

// Drop the cache after an admin saves a new config so it takes effect immediately.
export function invalidateToolModelCache(): void {
  cache = null
}
