import { APP_CARD_DEFS, SECTION_DEFS, type AppCardDef } from "@/lib/app-cards"

// The home page layout set on Admin → Home Page Cards, for everyone. Stored as ONE JSON
// document (HomePageLayout, id "global") of overrides on top of lib/app-cards.ts:
// sections (order, name, icon, colours, hidden, added, removed) and per app card its
// section, icon and colours. Order, name, description, hidden and ★ of a card stay in AppCard.
// Client-safe — the database read is in lib/home-layout-server.ts.

export type StoredSection = {
  key: string
  label?: string | null
  icon?: string | null
  colour?: string | null
  textColour?: string | null
  hidden?: boolean
}
export type StoredCard = {
  group?: string | null   // undefined = the section set in code; null = no section
  icon?: string | null
  colour?: string | null
  textColour?: string | null
}
export type StoredLayout = {
  sections?: StoredSection[]
  removed?: string[]       // built-in sections taken off the home page
  cards?: Record<string, StoredCard>
}

export type HomeSection = {
  key: string
  label: string
  icon: string
  colour: string
  textColour: string | null
  hidden: boolean
  builtIn: boolean
}
export type HomeLayout = {
  sections: HomeSection[]
  removed: string[]
  cards: Record<string, StoredCard>
}

export const DEFAULT_SECTION_COLOUR = "#6366f1"
const HEX = /^#[0-9a-f]{6}$/i
export const validHex = (v: unknown): string | null => typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null

// Tailwind's 500 shades, so the editor's colour picker can open on a card's built-in colour.
const TAILWIND_500: Record<string, string> = {
  amber: "#f59e0b", blue: "#3b82f6", cyan: "#06b6d4", emerald: "#10b981", fuchsia: "#d946ef",
  green: "#22c55e", indigo: "#6366f1", lime: "#84cc16", orange: "#f97316", pink: "#ec4899",
  purple: "#a855f7", red: "#ef4444", rose: "#f43f5e", sky: "#0ea5e9", slate: "#64748b",
  teal: "#14b8a6", violet: "#8b5cf6", yellow: "#eab308",
}
export function cardDefaultHex(def: Pick<AppCardDef, "border">): string {
  return TAILWIND_500[def.border.match(/border-([a-z]+)-/)?.[1] ?? ""] ?? DEFAULT_SECTION_COLOUR
}

export function resolveLayout(stored: StoredLayout | null | undefined): HomeLayout {
  const defs = new Map<string, (typeof SECTION_DEFS)[number]>(SECTION_DEFS.map(d => [d.key, d]))
  const removed = new Set(Array.isArray(stored?.removed) ? stored!.removed : [])
  const seen = new Set<string>()
  const sections: HomeSection[] = []

  for (const s of Array.isArray(stored?.sections) ? stored!.sections : []) {
    if (!s?.key || seen.has(s.key)) continue
    seen.add(s.key)
    const d = defs.get(s.key)
    sections.push({
      key:        s.key,
      label:      s.label?.trim() || d?.label || "New section",
      icon:       s.icon?.trim() || d?.icon || "📁",
      colour:     validHex(s.colour) ?? d?.colour ?? DEFAULT_SECTION_COLOUR,
      textColour: validHex(s.textColour),
      hidden:     !!s.hidden,
      builtIn:    !!d,
    })
  }
  // A section added in code later still turns up, at the end, unless it was removed here.
  for (const d of SECTION_DEFS) {
    if (seen.has(d.key) || removed.has(d.key)) continue
    sections.push({ key: d.key, label: d.label, icon: d.icon, colour: d.colour, textColour: null, hidden: false, builtIn: true })
  }

  const cards = stored?.cards && typeof stored.cards === "object" ? stored.cards : {}
  return { sections, removed: [...removed].filter(k => !seen.has(k)), cards }
}

// Which section a card sits in — the admin's choice, else the code's — or null for none.
export function cardSection(layout: HomeLayout, def: Pick<AppCardDef, "key" | "group">): string | null {
  const valid = new Set(layout.sections.map(s => s.key))
  const chosen = layout.cards[def.key]?.group
  const g = chosen !== undefined ? chosen : def.group ?? null
  return g && valid.has(g) ? g : null
}

// Checks what an admin posted before it is stored. Throws a plain message on anything wrong.
export function sanitiseLayout(input: any): StoredLayout {
  if (!input || typeof input !== "object") throw new Error("No layout sent")
  const text = (v: unknown, max: number, what: string) => {
    if (v == null || v === "") return null
    if (typeof v !== "string") throw new Error(`${what} must be text`)
    const t = v.trim()
    if (t.length > max) throw new Error(`${what} is too long (${max} characters at most)`)
    return t || null
  }
  const colour = (v: unknown, what: string) => {
    if (v == null || v === "") return null
    const h = validHex(v)
    if (!h) throw new Error(`${what} isn't a colour`)
    return h
  }

  const rawSections: any[] = Array.isArray(input.sections) ? input.sections : []
  if (rawSections.length > 40) throw new Error("Too many sections (40 at most)")
  const keys = new Set<string>()
  const sections: StoredSection[] = rawSections.map(s => {
    const key = String(s?.key ?? "")
    if (!/^[A-Z0-9_]{1,40}$/.test(key)) throw new Error("A section has a bad key")
    if (keys.has(key)) throw new Error(`Section ${key} is listed twice`)
    keys.add(key)
    const name = text(s.label, 40, "A section name")
    return {
      key,
      label:      name,
      icon:       text(s.icon, 16, `The icon of ${name ?? key}`),
      colour:     colour(s.colour, `The colour of ${name ?? key}`),
      textColour: colour(s.textColour, `The text colour of ${name ?? key}`),
      hidden:     !!s.hidden,
    }
  })

  const builtIn = new Set<string>(SECTION_DEFS.map(d => d.key))
  const removed = (Array.isArray(input.removed) ? input.removed : [])
    .map(String).filter((k: string) => builtIn.has(k) && !keys.has(k))

  const cardKeys = new Set(APP_CARD_DEFS.map(c => c.key))
  const cards: Record<string, StoredCard> = {}
  for (const [k, c] of Object.entries<any>(input.cards && typeof input.cards === "object" ? input.cards : {})) {
    if (!cardKeys.has(k) || !c || typeof c !== "object") continue
    const out: StoredCard = {}
    if (c.group !== undefined) {
      if (c.group !== null && !keys.has(String(c.group))) throw new Error(`Card ${k} is in a section that doesn't exist`)
      out.group = c.group === null ? null : String(c.group)
    }
    const icon = text(c.icon, 16, `The icon of ${k}`)
    const col  = colour(c.colour, `The colour of ${k}`)
    const txt  = colour(c.textColour, `The text colour of ${k}`)
    if (icon) out.icon = icon
    if (col) out.colour = col
    if (txt) out.textColour = txt
    if (Object.keys(out).length) cards[k] = out
  }

  return { sections, removed, cards }
}

// The sections in home page order with the cards in each — for the permission screens and
// Training, so an app moved on Admin → Home Page Cards moves under that heading there too.
// Hidden sections are kept: who may open an app doesn't depend on the home page.
export type PermissionGroup = { key: string; label: string; cardKeys: string[] }
export function permissionGroups(layout: HomeLayout): PermissionGroup[] {
  return layout.sections.map(s => ({
    key: s.key,
    label: s.label,
    cardKeys: APP_CARD_DEFS.filter(d => cardSection(layout, d) === s.key).map(d => d.key),
  }))
}
