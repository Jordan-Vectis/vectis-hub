"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { startAgainFromBc } from "@/lib/actions/uncollected"
import { START_AGAIN_WORD } from "@/lib/uncollected"
import { btn, btnDanger, card, cardTitle, field, plural } from "./ui"

// "Start again from BC" — shown on the TEST sites only (the page asks startAgainSite on the server;
// the action asks again). Deletes every case on the list, its timeline and shipping, and every check
// run, so the next Check BC now reads everything fresh. Typed confirmation, never a confirm() box.

export default function StartAgain({ site }: { site: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const ready = word.trim().toUpperCase() === START_AGAIN_WORD

  async function go() {
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await startAgainFromBc(word)
      if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
      setMsg({ ok: true, text: `Deleted ${plural(res.data.cases, "case")} and ${plural(res.data.runs, "check run")}. Now press Check BC now at the top — it reads everything fresh from BC (up to 20 minutes).` })
      setOpen(false)
      setWord("")
      router.refresh()
    } catch {
      setMsg({ ok: false, text: "The Hub didn't answer — reload the page to see whether the cases were deleted." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${card} p-4 sm:p-5 mt-6 border-red-300 dark:border-red-900`} aria-labelledby="start-again-title">
      <h2 id="start-again-title" className={cardTitle}>Start again from BC — {site} only</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 max-w-3xl">
        Deletes <b>every case on this list</b> — from BC and added by hand, open and closed, with their timelines, notes and
        shipment details — and the BC check&apos;s history, so the next <b>Check BC now</b> reads everything fresh. The storage
        settings stay. Only on the test sites ({site} here) — never on the live Hub. Nothing in BC is touched.
      </p>
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(null) }} className={`${btnDanger} mt-3`}>Start again from BC…</button>
      ) : (
        <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:items-end">
          <label className="min-w-0">
            <span className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">Type {START_AGAIN_WORD} to confirm</span>
            <input value={word} onChange={e => setWord(e.target.value)} autoComplete="off" className={`${field} w-full sm:w-64 font-mono`} />
          </label>
          <button type="button" onClick={go} disabled={!ready || busy} className={btnDanger}>
            {busy ? "Deleting…" : "Delete everything and start again"}
          </button>
          <button type="button" onClick={() => { setOpen(false); setWord("") }} disabled={busy} className={btn}>Cancel</button>
        </div>
      )}
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`text-sm mt-3 ${msg.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{msg.text}</p>
      )}
    </section>
  )
}
