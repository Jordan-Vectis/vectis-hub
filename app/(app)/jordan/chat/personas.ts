// AI personalities for the secret menu's ASK AI chat. The colour scheme of the
// whole panel changes with the selected persona (accent / dim border / glow fill).
// The actual system prompts live server-side in app/api/jordan/chat/route.ts,
// keyed by the same ids — the client never posts instruction text.

export type Persona = {
  id: string
  label: string   // short chip label
  accent: string  // primary text/accent (legible on pure black)
  dim: string     // dim borders / secondary lines
  glow: string    // very dark accent tint for hover / active fills
  thinking: string // in-character "working…" indicator
  intro: string    // empty-state line before the first message
}

// Order = order in the selector. FUNNY is the original (green) and stays default.
export const PERSONAS: Persona[] = [
  {
    id: "funny",
    label: "FUNNY",
    accent: "#33ff66",
    dim: "#1f5c33",
    glow: "#0a2214",
    thinking: "THINKING…",
    intro: "JORDAN.SYS online. Ask me anything —\nthe daft, the useful, the settle-this-argument-for-us.",
  },
  {
    id: "normal",
    label: "NORMAL",
    accent: "#d8dee9",
    dim: "#4c525e",
    glow: "#14161a",
    thinking: "WORKING…",
    intro: "JORDAN.SYS ready.\nAsk a question — I'll give you a straight answer.",
  },
  {
    id: "cortana",
    label: "CORTANA",
    accent: "#38b6ff",
    dim: "#1c5a80",
    glow: "#07141f",
    thinking: "COMPUTING…",
    intro: "Cortana, online and at your service, Jordan.\nI've read everything so you don't have to. What do you need?",
  },
  {
    id: "jarvis",
    label: "JARVIS",
    accent: "#e8b923",
    dim: "#6b5410",
    glow: "#1c1706",
    thinking: "ONE MOMENT…",
    intro: "JARVIS at your service, sir.\nThe Hub is running smoothly. How may I help?",
  },
  {
    id: "hal",
    label: "HAL 9000",
    accent: "#ff414d",
    dim: "#7a2328",
    glow: "#1e0709",
    thinking: "PROCESSING…",
    intro: "Hello, Jordan. This is HAL.\nI'm fully operational and ready to help. What would you like to do?",
  },
  {
    id: "zen",
    label: "ZEN",
    accent: "#b083ff",
    dim: "#4b3a73",
    glow: "#120a1f",
    thinking: "REFLECTING…",
    intro: "Welcome, Jordan. Take a breath.\nAsk what's on your mind — we'll work through it, one clear step at a time.",
  },
]

export const DEFAULT_PERSONA = "funny"
export const PERSONA_KEY = "jordan_chat_persona"

export function getPersona(id: string | null | undefined): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}
