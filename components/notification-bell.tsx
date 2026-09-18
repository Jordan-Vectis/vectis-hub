"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import type { MouseEvent as ReactMouseEvent } from "react"
import { acquireAppSocket, releaseAppSocket } from "@/lib/app-socket"
import type { NotificationView } from "@/lib/status/types"

// 🔔 The admin bell, in the top bar just before the settings cog (admins only — top-bar.tsx).
//
// Jordan chose a bell over email alerts (2026-09-10); the Hub sends no email. Today
// its only writer is the Status Centre: it rings after 2 bad checks in a row and
// again on recovery (lib/status/engine.ts). Styled like the BC button's popover.
//
// Unread = newer than when this person last opened the bell (NotificationSeen).
// Opening marks everything read, but the items that WERE new keep their highlight
// for the rest of that open — otherwise the highlight would vanish the instant you
// looked, which is the one moment it's needed.
//
// ⚠ Migration-safe: before Run Migrations the API answers available:false, and the
// bell says so rather than showing an empty list that reads as "all quiet".

type BellData = { unread: number; items: NotificationView[]; seenAt: string | null; available: boolean }

const POLL_MS = 60_000

const LEVEL: Record<NotificationView["level"], { stripe: string; word: string }> = {
  error: { stripe: "bg-red-500", word: "Stopped working" },
  warning: { stripe: "bg-amber-400", word: "Having problems" },
  success: { stripe: "bg-emerald-500", word: "Working again" },
  info: { stripe: "bg-sky-500", word: "Information" },
}

const F_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })
const F_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" })
const F_DAYKEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })

function when(ms: number, nowMs: number): string {
  const t = F_TIME.format(ms)
  const day = F_DAYKEY.format(ms)
  if (day === F_DAYKEY.format(nowMs)) return `${t} today`
  if (day === F_DAYKEY.format(nowMs - 86_400_000)) return `${t} yesterday`
  return `${F_DAY.format(ms)}, ${t}`
}

function ago(ms: number, nowMs: number): string {
  const min = Math.round(Math.max(0, nowMs - ms) / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export default function NotificationBell() {
  const [data, setData] = useState<BellData | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  /** seenAt as it was when this open began (null = never opened: everything is new). */
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null)
  const [now, setNow] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const dataRef = useRef<BellData | null>(null)
  const openRef = useRef(false)

  useEffect(() => { dataRef.current = data }, [data])

  const load = useCallback(async (): Promise<BellData | null> => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" })
      const j = (await res.json().catch(() => null)) as BellData | null
      if (!res.ok || !j || !Array.isArray(j.items)) { setFailed(true); return null }
      setData(j)
      setFailed(false)
      return j
    } catch {
      setFailed(true)
      return null
    }
  }, [])

  const markSeen = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/notifications/seen", { method: "POST" })
      const j = (await res.json().catch(() => null)) as { ok?: boolean } | null
      return res.ok && !!j?.ok
    } catch {
      return false
    }
  }, [])

  // Instant delivery from createNotification() ("notifications:changed"), polling as the fallback.
  // ⚠ This runs in every admin tab all day, so the poll skips hidden tabs and catches up when one is shown.
  useEffect(() => {
    // First read after the paint, from a callback rather than the effect body (react-hooks/set-state-in-effect).
    const first = setTimeout(() => { void load() }, 0)
    const poll = setInterval(() => { if (document.visibilityState === "visible") void load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === "visible") void load() }
    document.addEventListener("visibilitychange", onVisible)
    const socket = acquireAppSocket()
    const onChanged = () => { void load() }
    socket.on("notifications:changed", onChanged)
    return () => {
      clearTimeout(first)
      clearInterval(poll)
      document.removeEventListener("visibilitychange", onVisible)
      socket.off("notifications:changed", onChanged)
      releaseAppSocket()
    }
  }, [load])

  // Keeps "… ago" true while the list is on screen.
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open])

  const openPopover = () => {
    openRef.current = true
    setOpen(true)
    setNow(Date.now())
    const known = dataRef.current
    if (known) setSeenAtOpen(known.seenAt)
    void (async () => {
      let cur = known
      if (!cur) {
        cur = await load()
        if (cur) setSeenAtOpen(cur.seenAt)
      }
      if (cur && cur.available && cur.unread > 0 && await markSeen()) setData(d => d && { ...d, unread: 0 })
      await load()
    })()
  }

  const closePopover = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    setOpen(false)
    // Anything that arrived while it was open has been seen too — and if the first "mark as read"
    // failed (e.g. the database refusing saves), this is its retry.
    const cur = dataRef.current
    if (cur && cur.available && cur.unread > 0) {
      void (async () => { if (await markSeen()) await load() })()
    }
  }, [load, markSeen])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closePopover() }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closePopover() }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, closePopover])

  // ⚠ A Next <Link> to the page you're already on only pushes history — it fires no "hashchange", so the
  // Status Centre wouldn't open the service's details. In that one case, push the entry ourselves and
  // announce it. ⚠ history.pushState, NOT location.assign: Next patches pushState to carry its own
  // router state onto the new entry; a native fragment navigation leaves that entry with none, and the
  // page's later replaceState then stamps it {} — which Next's back/forward handler answers with a full reload.
  const onItemClick = (e: ReactMouseEvent<HTMLAnchorElement>, href: string) => {
    try {
      const url = new URL(href, window.location.href)
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) {
        e.preventDefault()
        if (window.location.hash !== url.hash) window.history.pushState(null, "", url.href)
        window.dispatchEvent(new HashChangeEvent("hashchange"))
      }
    } catch { /* let the link navigate normally */ }
    closePopover()
  }

  const unread = data?.available ? data.unread : 0
  const title = unread > 0 ? `Alerts — ${unread} new` : "Alerts"
  const seenMs = seenAtOpen ? Date.parse(seenAtOpen) : NaN

  return (
    <div ref={ref} className="relative max-sm:static">
      {/* 40 px to tap, without making the 48 px bar any taller: the negative margin keeps the
          icon's spacing identical to its neighbours. */}
      <button type="button" onClick={() => (open ? closePopover() : openPopover())} title={title} aria-label={title}
        aria-haspopup="dialog" aria-expanded={open}
        className="relative -mx-3 flex items-center justify-center w-10 h-10 rounded text-gray-400 hover:text-white transition-colors">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-4 text-center border border-gray-900">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        // ⚠ On a phone the bell sits ~150 px from the right edge, so a 384 px box anchored to it ran off the
        // LEFT of the screen. Below `sm` the wrapper goes `static` and the panel hangs full width from the
        // TOP BAR instead (2026-09-18) — it used to be `fixed top-12`, which assumed a 48 px bar, and on a
        // phone the bar can now wrap to a second row.
        <div role="dialog" aria-label="Alerts"
          className="absolute right-0 top-full mt-1 w-96 max-w-[calc(100vw-1rem)] max-sm:inset-x-2 max-sm:mt-1 max-sm:w-auto max-sm:max-w-none z-50 rounded-lg border border-gray-700 bg-gray-900 shadow-xl text-sm">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
            <p className="font-semibold text-white">Alerts</p>
            {failed && data && <p className="text-xs text-amber-400">Couldn&apos;t refresh — showing the last list</p>}
          </div>

          <div className="max-h-[65vh] overflow-y-auto">
            {!data ? (
              failed ? (
                <div className="px-3 py-4 text-gray-300">
                  <p>Couldn&apos;t load alerts — the Hub&apos;s server didn&apos;t answer.</p>
                  <button type="button" onClick={() => void load()} className="mt-2 min-h-10 px-3 rounded-lg border border-gray-600 text-gray-200 hover:bg-gray-800">
                    Try again
                  </button>
                </div>
              ) : (
                <p className="px-3 py-4 text-gray-400">Loading…</p>
              )
            ) : !data.available ? (
              <p className="px-3 py-4 text-amber-300">Alerts start once Run Migrations has been pressed.</p>
            ) : data.items.length === 0 ? (
              <p className="px-3 py-4 text-gray-300">
                Nothing yet — you&apos;ll see an alert here when a service stops working, and again when it recovers.
              </p>
            ) : (
              <ul className="divide-y divide-gray-800">
                {data.items.map(n => {
                  const at = Date.parse(n.createdAt)
                  const isNew = !Number.isFinite(seenMs) || at > seenMs
                  const level = LEVEL[n.level] ?? LEVEL.info
                  const inner = (
                    <>
                      <span aria-hidden className={`w-1.5 self-stretch rounded-full shrink-0 ${level.stripe}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span className={`flex-1 ${isNew ? "font-bold text-white" : "font-medium text-gray-200"}`}>{n.title}</span>
                          {isNew && <span className="shrink-0 rounded bg-sky-500/20 text-sky-300 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5">New</span>}
                        </span>
                        {n.body && <span className="block text-xs text-gray-400 mt-0.5 line-clamp-3">{n.body}</span>}
                        {Number.isFinite(at) && <span className="block text-xs text-gray-500 mt-0.5">{ago(at, now || at)} · {when(at, now || at)}</span>}
                      </span>
                    </>
                  )
                  const row = `flex gap-3 px-3 py-2.5 min-h-11 ${isNew ? "bg-gray-800/70" : ""}`
                  return (
                    <li key={n.id}>
                      {n.href ? (
                        <Link href={n.href} onClick={e => onItemClick(e, n.href as string)} className={`${row} hover:bg-gray-800`}>{inner}</Link>
                      ) : (
                        <div className={row}>{inner}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-gray-700 px-3 py-2 space-y-1.5">
            <p className="text-[11px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-2.5 rounded-full bg-red-500" /> stopped working</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-2.5 rounded-full bg-amber-400" /> having problems</span>
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-2.5 rounded-full bg-emerald-500" /> working again</span>
              <span className="inline-flex items-center gap-1"><span className="rounded bg-sky-500/20 text-sky-300 font-bold px-1">NEW</span> since you last looked</span>
            </p>
            <Link href="/admin/status" onClick={closePopover}
              className="flex items-center justify-center min-h-10 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 font-medium">
              Open the Status Centre
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
