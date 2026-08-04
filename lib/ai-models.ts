// Central registry of every AI "tool slot" in the app + a helper to read the
// admin-configured default model for each. Set in Admin → AI Models (stored in
// the ToolModel table). A missing row falls back to the slot's built-in default,
// then to a global fallback — so a retired model is a one-click admin fix
// instead of a code change scattered across ~20 routes.
//
// Precedence at every call site: an explicit model passed by the request (a
// user's per-session picker) → the admin-configured default → the slot default.

import { prisma } from "@/lib/prisma"

// `claudeOk` marks a slot whose route goes through generateAiText() and can
// therefore run on EITHER provider. Slots without it are Gemini-only for now —
// they still talk to the Gemini SDK directly (images, chat history, Google
// Search grounding), so offering Claude there would just break them. Flip one
// to true only once its route actually uses generateAiText().
export type AiTool = { slot: string; label: string; group: string; default: string; claudeOk?: boolean }

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
  { slot: "catalogue_smart_scan",   group: "Cataloguing",  label: "Smart scan (label detection fallback)", default: "gemini-3-flash-preview" },
  { slot: "catalogue_lot_history",  group: "Cataloguing",  label: "Lot History summary",                  default: "gemini-2.5-flash-preview-04-17", claudeOk: true },
  { slot: "catalogue_lens",         group: "Cataloguing",  label: "Lens (identify an item from a photo)", default: "gemini-3-flash-preview" },
  { slot: "catalogue_chat",         group: "Auction AI",   label: "Chat",                                 default: "gemini-3-flash-preview" },
  { slot: "catalogue_chat_grounded",group: "Auction AI",   label: "Chat with Google Search",              default: "gemini-3-flash-preview" },
  // ── BC Marketing ──
  { slot: "marketing_article",      group: "BC Marketing", label: "Content Generator (articles)",         default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_article_text", group: "BC Marketing", label: "Paste & Generate",                     default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_web",          group: "BC Marketing", label: "Web descriptions",                     default: "gemini-2.5-flash-preview-04-17" },
  { slot: "marketing_social",       group: "BC Marketing", label: "Social posts",                         default: "gemini-2.5-flash-preview-04-17" },
  // ── IT ──
  { slot: "it_help",                group: "IT",           label: "IT Help assistant",                    default: "gemini-3-flash-preview", claudeOk: true },
  { slot: "it_draft_reply",         group: "IT",           label: "Draft reply (IT Tools)",               default: "gemini-3-flash-preview", claudeOk: true },
  { slot: "bc_source_guide",        group: "IT",           label: "BC Source — extension guides",         default: "gemini-3-flash-preview", claudeOk: true },
  { slot: "bc_source_chat",         group: "IT",           label: "BC Source — ask the code",             default: "gemini-3-flash-preview", claudeOk: true },
  // ── Accounts (bookkeeping AI) ──
  { slot: "accounts_extract",       group: "Accounts",     label: "Invoice/receipt extract",              default: "gemini-3-flash-preview" },
  { slot: "accounts_split",         group: "Accounts",     label: "Split multi-doc files",                default: "gemini-3-flash-preview" },
  { slot: "accounts_stitch",        group: "Accounts",     label: "Stitch document pages",                default: "gemini-3-flash-preview" },
  { slot: "accounts_statement",     group: "Accounts",     label: "Bank/card statement parse",            default: "gemini-3-flash-preview" },
  // ── Other ──
  { slot: "photo_prep_crop",        group: "Other",        label: "Photo Prep crop box (hard photos only)", default: "gemini-3-flash-preview" },
  // Image IN, image OUT ("nano banana"). Not claudeOk — Claude writes text, not pictures.
  { slot: "photo_prep_edit",        group: "Other",        label: "Photo Prep AI edit (image editing)",   default: "gemini-3.1-flash-image" },
  { slot: "condition_extract",      group: "Other",        label: "Condition report extract",             default: "gemini-3-flash-preview" },
  { slot: "patch_notes_draft",      group: "Other",        label: "Patch notes draft (summarise a deploy)", default: "gemini-3-flash-preview", claudeOk: true },
  { slot: "jordan_fun",             group: "Other",        label: "Jordan's secret menu (chat, cooking, air fryer)", default: "gemini-3-flash-preview" },
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
  if (m && !RETIRED_MODELS.has(m) && usable(slot, m)) return m
  const map = await loadConfig()
  const configured = map[slot]
  if (configured && usable(slot, configured)) return configured
  return SLOT_DEFAULT[slot] || GLOBAL_FALLBACK_MODEL
}

// ── Claude models ────────────────────────────────────────────────────────────
// Anthropic has no "list models" endpoint we poll like Google's, so the ids live
// here. ⚠ Use these EXACT strings — they carry no date suffix, and appending one
// 404s. Add a row when Anthropic ships a model worth offering.
export const CLAUDE_MODELS: { id: string; displayName: string; description: string; inputTokenLimit: number; outputTokenLimit: number }[] = [
  { id: "claude-opus-5",   displayName: "Claude Opus 5",   inputTokenLimit: 1_000_000, outputTokenLimit: 128_000,
    description: "Anthropic's strongest model for reading and reasoning about code. Best choice for the BC source tools. Costs more per use than Gemini — see Admin → Data & Compliance." },
  { id: "claude-sonnet-5", displayName: "Claude Sonnet 5", inputTokenLimit: 1_000_000, outputTokenLimit: 128_000,
    description: "Nearly as strong as Opus on code, at a lower price. A good middle ground when Gemini isn't quite good enough but Opus is more than you need." },
  { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", inputTokenLimit: 200_000, outputTokenLimit: 64_000,
    description: "Anthropic's fast, cheap tier. Comparable in spirit to Gemini Flash." },
]

const CLAUDE_IDS = new Set(CLAUDE_MODELS.map(m => m.id))
const CLAUDE_OK  = new Set(AI_TOOLS.filter(t => t.claudeOk).map(t => t.slot))

/** True when this slot may run on Claude at all (its route uses generateAiText). */
export function slotSupportsClaude(slot: string): boolean {
  return CLAUDE_OK.has(slot)
}

// ⚠ The safety net that makes the dropdown safe. A Claude model is only usable
// when (a) the slot's route can actually talk to Claude and (b) the key exists
// on this environment. Otherwise we silently fall back to the slot's Gemini
// default — a mis-set dropdown, or a config copied to an environment with no
// Anthropic key, must never take a tool down. Same spirit as RETIRED_MODELS.
function usable(slot: string, modelId: string): boolean {
  if (!CLAUDE_IDS.has(modelId) && modelId.toLowerCase().startsWith("claude-")) return false
  if (!CLAUDE_IDS.has(modelId)) return true
  return CLAUDE_OK.has(slot) && !!process.env.ANTHROPIC_API_KEY
}

// Drop the cache after an admin saves a new config so it takes effect immediately.
export function invalidateToolModelCache(): void {
  cache = null
}
