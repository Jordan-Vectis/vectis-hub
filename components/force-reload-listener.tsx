"use client"

import { useEffect, useRef } from "react"
import { acquireAppSocket, releaseAppSocket } from "@/lib/app-socket"

const POLL_INTERVAL_MS = 30_000 // fallback; the socket makes it near-instant

// Reloads this tab when an admin pushes a refresh from /admin/refresh. Renders
// nothing — it's a listener, not UI.
//
// Jack chose an immediate forced reload (2026-07-17) over prompting, knowing it
// discards a half-entered lot INCLUDING photos taken but not yet uploaded. That's
// deliberate: don't quietly soften it into a prompt. It's why the admin side has a
// confirm dialog spelling out the consequence.
//
// The baseline is captured on MOUNT and never persisted. That's what stops a reload
// loop: after reloading, this remounts, reads the same token, and treats it as the
// new baseline — so it reloads exactly once per push, with no storage to go stale.
export default function ForceReloadListener() {
  const baseline = useRef<string | null>(null)
  const ready    = useRef(false)

  useEffect(() => {
    let cancelled = false

    // undefined = couldn't tell (never act on it). null = nothing pending.
    async function readToken(): Promise<string | null | undefined> {
      try {
        const res = await fetch("/api/app-reload", { cache: "no-store" })
        const d = await res.json()
        if (!d?.ok) return undefined
        return (d.token as string | null) ?? null
      } catch {
        return undefined
      }
    }

    async function check() {
      const token = await readToken()
      if (cancelled || token === undefined) return

      // First successful read establishes what "unchanged" means for this tab.
      if (!ready.current) {
        baseline.current = token
        ready.current = true
        return
      }
      if (token !== baseline.current) {
        // Set the baseline first: if the reload is slow (a busy iPad), a poll
        // landing in the meantime mustn't queue a second one.
        baseline.current = token
        window.location.reload()
      }
    }

    void check()
    const id = setInterval(check, POLL_INTERVAL_MS)

    // Instant path. Only reaches tabs on this replica (no Redis adapter), which is
    // exactly why the poll above is the actual guarantee. Shared with the
    // announcement banner — one socket per tab, not one per listener.
    const socket = acquireAppSocket()
    const onReload = () => { void check() }
    socket.on("app:reload", onReload)

    return () => {
      cancelled = true
      clearInterval(id)
      socket.off("app:reload", onReload)
      releaseAppSocket()
    }
  }, [])

  return null
}
