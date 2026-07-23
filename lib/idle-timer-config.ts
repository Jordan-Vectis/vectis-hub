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
}

export interface IdleTimerConfig {
  yellowMins: number
  redMins:    number
  reasons:    IdleReason[]
}

export const DEFAULT_REASONS: IdleReason[] = [
  { key: "LUNCH_BREAK",            label: "Lunch Break",       icon: "🍽️", requiresNotes: false, colour: "bg-amber-100 text-amber-700 border-amber-200",   idleColour: "#f59e0b" },
  { key: "LOTTING_UP",             label: "Lotting Up",        icon: "📦", requiresNotes: false, colour: "bg-blue-100 text-blue-700 border-blue-200",       idleColour: "#3b82f6" },
  { key: "CLERKING",               label: "Clerking",          icon: "🔨", requiresNotes: false, colour: "bg-purple-100 text-purple-700 border-purple-200", idleColour: "#9333ea" },
  { key: "DEALING_WITH_CUSTOMERS", label: "With Customers",    icon: "🤝", requiresNotes: false, colour: "bg-green-100 text-green-700 border-green-200",    idleColour: "#22c55e" },
  { key: "VALUATIONS",             label: "Valuations",        icon: "💰", requiresNotes: false, colour: "bg-rose-100 text-rose-700 border-rose-200",        idleColour: "#f43f5e" },
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

export const DEFAULT_CONFIG: IdleTimerConfig = {
  yellowMins: 4,
  redMins:    10,
  reasons:    DEFAULT_REASONS,
}

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
