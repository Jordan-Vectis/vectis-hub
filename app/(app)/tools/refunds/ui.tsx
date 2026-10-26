import Link from "next/link"
import type { ReactNode } from "react"
import LinkSpinner from "../accounts/link-spinner"

// Accounts → Refunds — the shared look. The same strings as Paid, not collected (rounded-2xl cards,
// #1C1C1E in dark, emerald accents), dark first, 44px touch targets for the iPads, plain words.
// Server-safe (no hooks), so both the server pages and the client parts use it.

export const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"
export const cardTitle = "text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
export const field = "min-h-11 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-base sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed [color-scheme:light] dark:[color-scheme:dark]"
export const input = `w-full ${field}`
export const label = "block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1"
export const btn = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-xl border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 bg-white dark:bg-[#1C1C1E] hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
export const btnGo = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
export const btnDanger = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40"
export const th = "px-3 py-2.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap"
export const td = "px-3 py-3 text-sm text-gray-800 dark:text-gray-200 align-top"

/** A text link sized for a finger (44px tall), for inside a sentence. */
export const inlineLink = "inline-flex items-center min-h-11 font-semibold underline underline-offset-2"

/** The placeholder grey for "nothing here" (—, Nobody yet, Not known). Lighter in dark mode, never darker. */
export const muted = "text-gray-500 dark:text-gray-400"

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

// Dates come from lib/uncollected.ts (formatDay, formatDateTime, londonDay) and money from
// lib/refunds.ts (formatPence) — one copy, London days throughout.

// ─── Bits ────────────────────────────────────────────────────────────────────────────────────

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} className="inline-flex items-center gap-1 min-h-11 text-sm font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-500">
      ← {children} <LinkSpinner />
    </Link>
  )
}

/** Shown in place of the panel while its tables aren't on this environment yet. */
export function NeedsMigrations() {
  return (
    <div className="rounded-2xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-5 py-4 text-sm leading-relaxed">
      <p className="font-semibold mb-1">Refunds isn&apos;t set up on this environment yet</p>
      <p>Its tables arrive with the next database update. An admin presses <b>Run Migrations</b> (the banner at the top of the Hub), then this panel — and the public refund form — work.</p>
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 px-5 py-4 text-sm leading-relaxed">
      {children}
    </div>
  )
}

/** `link` — somewhere to go next (Sign in to BC). */
export type FlashMessage = { tone: "ok" | "error" | "info"; text: string; link?: { href: string; text: string } }

const FLASH_TONE: Record<FlashMessage["tone"], string> = {
  ok: "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200",
  error: "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200",
  info: "border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-200",
}

/** The answer to a button press, in words — success, a refusal, or "nothing changed" (design rule 7). */
export function Flash({ msg }: { msg: FlashMessage | null }) {
  if (!msg) return null
  return (
    <div role={msg.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl border px-4 py-3 text-sm ${FLASH_TONE[msg.tone]}`}>
      {msg.tone === "ok" && "✓ "}{msg.text}
      {msg.link && <> <a href={msg.link.href} className={inlineLink}>{msg.link.text}</a></>}
    </div>
  )
}

/** What to say when a server action couldn't be reached at all. */
export const NO_ANSWER = "The Hub didn't answer — check the connection and try again. Nothing was saved."

// ─── A message carried back to the list ─────────────────────────────────────────────────────
// Deleting a request goes back to the list, so what the delete has to say ("RF0042 was deleted", or a
// photo that couldn't be removed from storage) is left in this tab's sessionStorage for the list to
// show once. Only the reference and counts — never the customer's details. Browser only (called from
// event handlers and the list's first render); a blocked storage just means no message.

const LIST_NOTE_KEY = "refunds-list-note-v1"

export function leaveListNote(msg: FlashMessage) {
  try { sessionStorage.setItem(LIST_NOTE_KEY, JSON.stringify({ tone: msg.tone, text: msg.text.slice(0, 500) })) } catch { /* no message */ }
}
/** The message as it was stored (a string, so React can compare it), or null. */
export function readListNote(): string | null {
  try { return sessionStorage.getItem(LIST_NOTE_KEY) } catch { return null }
}
export function clearListNote() {
  try { sessionStorage.removeItem(LIST_NOTE_KEY) } catch { /* nothing to clear */ }
}
export function parseListNote(raw: string | null): FlashMessage | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { tone?: unknown; text?: unknown }
    const tone = v.tone === "ok" || v.tone === "error" || v.tone === "info" ? v.tone : "info"
    return typeof v.text === "string" && v.text ? { tone, text: v.text.slice(0, 500) } : null
  } catch {
    return null
  }
}

/** A spinner for a busy line ("Searching…") — the words beside it say what's happening. */
export function Spinner() {
  return <span className="block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" aria-hidden />
}
