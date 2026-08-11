// Shared types and defaults for the idle-timer config singleton
//
// NOTE (2026-07-02): timing is a SINGLE per-user threshold — User.timerRedMins,
// edited in Admin → Users ("Warn after"). The lot timer turns red at that many
// minutes AND it doubles as the idle threshold. The old yellow stage was removed
// (User.timerYellowMins remains in the DB, unused). The Admin → Idle Timer page
// manages the REASONS list only.

// ─── Working hours ────────────────────────────────────────────────────────────
// Idle time only counts during working hours: Mon–Fri, 09:00–17:00 local time.
// A gap from 16:30 Friday to 09:20 Monday therefore counts as 50 minutes, not
// a whole weekend.
export const WORK_START_HOUR = 9   // 09:00
export const WORK_END_HOUR   = 17  // 17:00
const WORK_DAYS = new Set([1, 2, 3, 4, 5]) // Mon–Fri (Date.getDay())

// How many milliseconds of WORKING TIME fall between two instants.
// Iterates calendar days (local time, so DST shifts are handled by Date) and
// sums the overlap of [startMs, endMs] with each working day's 09:00–17:00.
export function workingMsBetween(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  let total = 0
  const cursor = new Date(startMs)
  cursor.setHours(0, 0, 0, 0)
  // Safety cap: ~2 years of days; beyond that the answer is "a very long time".
  for (let i = 0; i < 750; i++) {
    const dayStart = cursor.getTime()
    if (dayStart > endMs) break
    if (WORK_DAYS.has(cursor.getDay())) {
      const winStart = new Date(cursor); winStart.setHours(WORK_START_HOUR, 0, 0, 0)
      const winEnd   = new Date(cursor); winEnd.setHours(WORK_END_HOUR, 0, 0, 0)
      const overlap = Math.min(endMs, winEnd.getTime()) - Math.max(startMs, winStart.getTime())
      if (overlap > 0) total += overlap
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return total
}

export interface IdleReason {
  key:           string   // e.g. "LUNCH_BREAK"
  label:         string   // e.g. "Lunch Break"
  icon:          string   // emoji
  requiresNotes: boolean  // forces a note before submission
  colour:        string   // Tailwind badge classes
  idleColour:    string   // hex for charts / timeline
  notePrompt?:   string   // optional follow-up question shown as the note label (e.g. "Who for?")
  group?:        string   // heading the popup files this reason under (blank = ungrouped, shown last)
}

export interface IdleTimerConfig {
  yellowMins: number
  redMins:    number
  reasons:    IdleReason[]
  message?:   string      // optional note shown at the top of the popup; blank = no banner
}

// Group headings offered in the admin editor. Free text is still allowed — the popup groups by
// whatever string is on each reason, in the order the groups first appear in the reasons list,
// so admins control the running order by reordering reasons. Anything ungrouped renders last.
export const GROUP_SUGGESTIONS = ["Breaks", "Warehouse", "Cataloguing", "Saleroom", "Away from the desk"]

// Grouped, deduped for the picker. Skin tones and gendered variants deliberately left out —
// this is a symbol for a button, not a person.
export const ICON_CHOICES: { group: string; icons: string[] }[] = [
  { group: "Breaks & away",  icons: ["🍽️", "☕", "🥪", "🚬", "🌴", "🏖️", "🛌", "🚗", "🏥", "📅"] },
  { group: "Warehouse",      icons: ["📦", "📐", "🪵", "📬", "🗄️", "🏷️", "🧹", "🚛", "🪜", "⚖️"] },
  { group: "Cataloguing",    icons: ["🔍", "✏️", "📋", "📝", "🖊️", "📖", "🔎", "💻", "📸", "🖨️"] },
  { group: "Saleroom & sales", icons: ["🔨", "☎️", "💰", "🤝", "👥", "🎓", "📣", "🎥", "💷", "🧾"] },
  { group: "General",        icons: ["⭐", "❔", "⚙️", "🔔", "🚩", "⏱️", "🧰", "🗂️", "✅", "❗"] },
]

export const DEFAULT_REASONS: IdleReason[] = [
  { key: "LUNCH_BREAK",            label: "Lunch Break",       icon: "🍽️", requiresNotes: false, colour: "bg-amber-100 text-amber-700 border-amber-200",   idleColour: "#f59e0b", group: "Breaks" },
  { key: "LOTTING_UP",             label: "Lotting Up",        icon: "📦", requiresNotes: false, colour: "bg-blue-100 text-blue-700 border-blue-200",       idleColour: "#3b82f6", group: "Warehouse" },
  { key: "CLERKING",               label: "Clerking",          icon: "🔨", requiresNotes: false, colour: "bg-purple-100 text-purple-700 border-purple-200", idleColour: "#9333ea", group: "Saleroom" },
  { key: "DEALING_WITH_CUSTOMERS", label: "With Customers",    icon: "🤝", requiresNotes: false, colour: "bg-green-100 text-green-700 border-green-200",    idleColour: "#22c55e", group: "Saleroom" },
  { key: "VALUATIONS",             label: "Valuations",        icon: "💰", requiresNotes: false, colour: "bg-rose-100 text-rose-700 border-rose-200",        idleColour: "#f43f5e", group: "Saleroom" },
  { key: "OTHER",                  label: "Other",             icon: "✏️", requiresNotes: true,  colour: "bg-gray-100 text-gray-600 border-gray-200",       idleColour: "#9ca3af" },
]

// Pseudo-reason for time the multi-select popup split leaves unassigned — the
// popup logs the leftover under this key ("it marks it down as unallocated").
// Deliberately NOT in DEFAULT_REASONS: it must never be a tappable button in the
// popup or an editable row in the admin list. Merge it into DISPLAY maps only,
// so IdleLog rows with this key render with a friendly label and grey colour.
export const UNALLOCATED_REASON: IdleReason = {
  key: "UNALLOCATED", label: "Unallocated", icon: "❔", requiresNotes: false,
  colour: "bg-gray-100 text-gray-500 border-gray-200", idleColour: "#9ca3af",
}

// The activity popup writes ONE IdleLog row per selected reason, laid out
// sequentially from the gap's start — so the rows for a single answer are
// contiguous. Group them back into "occasions" (one real break) so that
// splitting a break between reasons doesn't inflate break/session counts.
// A row that starts where the previous one ended (within a couple of seconds)
// belongs to the same occasion; genuinely separate breaks are divided by a lot
// save, so they can never be contiguous.
const OCCASION_TOLERANCE_MS = 2000

export function groupIdleOccasions<T extends { idleStartedAt: Date; idleDurationMs: number }>(
  logs: T[],
): { startedAt: Date; totalMs: number; rows: T[] }[] {
  const sorted = [...logs].sort((a, b) => a.idleStartedAt.getTime() - b.idleStartedAt.getTime())
  const out: { startedAt: Date; totalMs: number; rows: T[] }[] = []
  let cur: { startedAt: Date; totalMs: number; rows: T[] } | null = null
  let curEnd = 0
  for (const l of sorted) {
    const start = l.idleStartedAt.getTime()
    if (cur && start <= curEnd + OCCASION_TOLERANCE_MS) {
      cur.totalMs += l.idleDurationMs
      cur.rows.push(l)
      curEnd = Math.max(curEnd, start + l.idleDurationMs)
    } else {
      cur = { startedAt: l.idleStartedAt, totalMs: l.idleDurationMs, rows: [l] }
      out.push(cur)
      curEnd = start + l.idleDurationMs
    }
  }
  return out
}

export const DEFAULT_CONFIG: IdleTimerConfig = {
  yellowMins: 4,
  redMins:    10,
  reasons:    DEFAULT_REASONS,
}

// Sensible symbol + group for the reasons Vectis actually uses, keyed by a loosened label
// (lower case, letters and digits only) so "Lot Corrections/Alterations" and "lot corrections"
// both hit. Drives the admin's one-click fill — every reason added before symbols mattered
// carries the old "📝" default, and setting a dozen of them by hand is nobody's afternoon.
const normLabel = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

const SUGGESTED: Record<string, { icon: string; group: string }> = {
  lunchbreak:            { icon: "🍽️", group: "Breaks" },
  lunch:                 { icon: "🍽️", group: "Breaks" },
  otherbreak:            { icon: "☕",  group: "Breaks" },
  break:                 { icon: "☕",  group: "Breaks" },
  holiday:               { icon: "🌴", group: "Breaks" },
  layingout:             { icon: "📐", group: "Warehouse" },
  lottingup:             { icon: "📦", group: "Warehouse" },
  palletising:           { icon: "🪵", group: "Warehouse" },
  palletizing:           { icon: "🪵", group: "Warehouse" },
  boxingup:              { icon: "📬", group: "Warehouse" },
  research:              { icon: "🔍", group: "Cataloguing" },
  lotcorrectionsalterations: { icon: "✏️", group: "Cataloguing" },
  lotcorrections:        { icon: "✏️", group: "Cataloguing" },
  conditionreports:      { icon: "📋", group: "Cataloguing" },
  valuations:            { icon: "💰", group: "Saleroom" },
  clerking:              { icon: "🔨", group: "Saleroom" },
  telephonebidding:      { icon: "☎️", group: "Saleroom" },
  dealingwithcustomers:  { icon: "🤝", group: "Saleroom" },
  withcustomers:         { icon: "🤝", group: "Saleroom" },
  meeting:               { icon: "👥", group: "Away from the desk" },
  meetings:              { icon: "👥", group: "Away from the desk" },
  training:              { icon: "🎓", group: "Away from the desk" },
}

export function suggestReasonMeta(label: string): { icon?: string; group?: string } {
  return SUGGESTED[normLabel(label)] ?? {}
}

// The icon every reason got before there was a picker — treated as "not chosen yet".
export const PLACEHOLDER_ICON = "📝"

// The full set Vectis actually runs, with symbols and groups filled in. DEFAULT_REASONS only
// ever seeds a brand-new EMPTY table, and staging/production are separate databases — so a
// fresh environment sits on the six starter reasons and can't be tested properly against the
// real thing. Admin → Activity Timer has a button to load this list in one click.
// ⚠ A starting point, not a live mirror of production — once an environment is set up, edit it
// there. Don't wire this into seeding or a sync.
const C = {
  amber:  { colour: "bg-amber-100 text-amber-700 border-amber-200",   idleColour: "#f59e0b" },
  blue:   { colour: "bg-blue-100 text-blue-700 border-blue-200",      idleColour: "#3b82f6" },
  teal:   { colour: "bg-teal-100 text-teal-700 border-teal-200",      idleColour: "#14b8a6" },
  purple: { colour: "bg-purple-100 text-purple-700 border-purple-200", idleColour: "#9333ea" },
  green:  { colour: "bg-green-100 text-green-700 border-green-200",   idleColour: "#22c55e" },
  gray:   { colour: "bg-gray-100 text-gray-600 border-gray-200",      idleColour: "#9ca3af" },
}

export const VECTIS_REASONS: IdleReason[] = [
  { key: "LUNCH_BREAK",             label: "Lunch Break",                icon: "🍽️", group: "Breaks",             requiresNotes: false, ...C.amber },
  { key: "OTHER_BREAK",             label: "Other Break",                icon: "☕",  group: "Breaks",             requiresNotes: false, ...C.amber },
  { key: "HOLIDAY",                 label: "Holiday",                    icon: "🌴", group: "Breaks",             requiresNotes: false, ...C.amber },
  { key: "LAYING_OUT",              label: "Laying Out",                 icon: "📐", group: "Warehouse",          requiresNotes: false, ...C.blue },
  { key: "LOTTING_UP",              label: "Lotting Up",                 icon: "📦", group: "Warehouse",          requiresNotes: false, ...C.blue },
  { key: "PALLETISING",             label: "Palletising",                icon: "🪵", group: "Warehouse",          requiresNotes: false, ...C.blue },
  { key: "BOXING_UP",               label: "Boxing Up",                  icon: "📬", group: "Warehouse",          requiresNotes: false, ...C.blue },
  { key: "RESEARCH",                label: "Research",                   icon: "🔍", group: "Cataloguing",        requiresNotes: false, ...C.teal },
  { key: "CORRECTIONS_ALTERATIONS", label: "Lot Corrections/Alterations", icon: "✏️", group: "Cataloguing",        requiresNotes: false, ...C.teal },
  { key: "CONDITION_REPORTS",       label: "Condition Reports",          icon: "📋", group: "Cataloguing",        requiresNotes: false, ...C.teal },
  { key: "CLERKING",                label: "Clerking",                   icon: "🔨", group: "Saleroom",           requiresNotes: false, ...C.purple },
  { key: "TELEPHONE_BIDDING",       label: "Telephone Bidding",          icon: "☎️", group: "Saleroom",           requiresNotes: false, ...C.purple },
  { key: "VALUATIONS",              label: "Valuations",                 icon: "💰", group: "Saleroom",           requiresNotes: false, ...C.purple },
  { key: "DEALING_WITH_CUSTOMERS",  label: "With Customers",             icon: "🤝", group: "Saleroom",           requiresNotes: false, ...C.purple },
  { key: "MEETING",                 label: "Meeting",                    icon: "👥", group: "Away from the desk", requiresNotes: false, ...C.green },
  { key: "TRAINING",                label: "Training",                   icon: "🎓", group: "Away from the desk", requiresNotes: false, ...C.green },
  { key: "OTHER",                   label: "Other",                      icon: "❔", requiresNotes: true,  ...C.gray },
]

// Preset colour options shown in the admin UI
export const COLOUR_PRESETS: { label: string; colour: string; idleColour: string }[] = [
  { label: "Amber",  colour: "bg-amber-100 text-amber-700 border-amber-200",   idleColour: "#f59e0b" },
  { label: "Blue",   colour: "bg-blue-100 text-blue-700 border-blue-200",       idleColour: "#3b82f6" },
  { label: "Purple", colour: "bg-purple-100 text-purple-700 border-purple-200", idleColour: "#9333ea" },
  { label: "Green",  colour: "bg-green-100 text-green-700 border-green-200",    idleColour: "#22c55e" },
  { label: "Rose",   colour: "bg-rose-100 text-rose-700 border-rose-200",       idleColour: "#f43f5e" },
  { label: "Teal",   colour: "bg-teal-100 text-teal-700 border-teal-200",       idleColour: "#14b8a6" },
  { label: "Orange", colour: "bg-orange-100 text-orange-700 border-orange-200", idleColour: "#f97316" },
  { label: "Gray",   colour: "bg-gray-100 text-gray-600 border-gray-200",       idleColour: "#9ca3af" },
]
