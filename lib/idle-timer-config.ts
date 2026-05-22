// Shared types and defaults for the idle-timer config singleton

export interface IdleReason {
  key:           string   // e.g. "LUNCH_BREAK"
  label:         string   // e.g. "Lunch Break"
  icon:          string   // emoji
  requiresNotes: boolean  // forces a note before submission
  colour:        string   // Tailwind badge classes
  idleColour:    string   // hex for charts / timeline
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
