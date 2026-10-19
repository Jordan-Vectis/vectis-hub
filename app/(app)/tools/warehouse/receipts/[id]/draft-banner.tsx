"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { discardCheckIn } from "@/lib/actions/goods-in-checkin"
import { ErrorBox, OkBox, btn, btnDanger, btnGo, mono } from "../../_components/ui"
import { carryOnHref } from "../_parts"

// The banner on a receipt that hasn't been booked in yet (a check-in left part-way at the counter).
// Two ways on: carry on checking it in, or throw it away. Throwing away asks in place (never
// window.confirm). The server decides what "throw away" does: a check-in with no label printed and
// nothing moved is deleted outright; one with printed labels (or a move) is kept as void with a note
// naming the labels, so a stray labelled tote can still be traced.

export default function DraftBanner({ id, customer, startedBy, printed, moved, rows }: {
  id: string
  customer: string
  startedBy: string | null
  /** Totes/pallets on it whose label has been printed. */
  printed: string[]
  /** Any of its totes/pallets has been put somewhere. */
  moved: boolean
  rows: number
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voided, setVoided] = useState<string[] | null>(null)

  const keep = printed.length > 0 || moved

  const throwAway = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    let res: Awaited<ReturnType<typeof discardCheckIn>>
    try {
      res = await discardCheckIn(id)
    } catch {
      // The connection dropped: it may or may not have gone. Pressing again is safe — a second
      // throw-away of the same check-in just says what happened to it.
      setBusy(false)
      setError("The Hub didn't answer — it may not have been thrown away. Try again.")
      return
    }
    if (!res.ok) { setBusy(false); setError(res.error); return }
    if (res.data.outcome === "deleted") {
      // The receipt no longer exists — land on the list, which says it was thrown away.
      router.replace(`/tools/warehouse/receipts?gone=${encodeURIComponent(id)}`)
      return
    }
    setBusy(false)
    setConfirming(false)
    setVoided(res.data.printed)
    router.refresh()
  }

  if (voided) {
    return (
      <div className="mb-4">
        <OkBox>
          Check-in <span className={`${mono} font-semibold`}>{id}</span> was thrown away. Nothing was booked in.
          {voided.length > 0
            ? <> Labels had been printed for <span className={`${mono} font-semibold`}>{voided.join(", ")}</span>, so it&apos;s kept as void with a note saying so — throw those labels away.</>
            : <> Something on it had been moved, so it&apos;s kept as void for the record.</>}
        </OkBox>
      </div>
    )
  }

  return (
    <div role="note" className="mb-4 rounded-xl border border-amber-300 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/30 px-4 py-4 text-sm text-amber-900 dark:text-amber-100 leading-relaxed space-y-3">
      <div>
        <p className="text-base font-semibold">Not booked in yet</p>
        <p>
          This check-in for <b>{customer}</b>{startedBy ? <> was started by <b>{startedBy}</b> and</> : null} hasn&apos;t been booked in.
          {rows > 0 ? " Its numbers are taken and its labels can be printed; the receipt itself" : " The receipt"} can be printed or emailed once it&apos;s booked in.
        </p>
      </div>

      {!confirming && (
        <div className="flex flex-wrap gap-2">
          <Link href={carryOnHref(id)} className={btnGo}>Carry on checking in</Link>
          <button type="button" className={btnDanger} onClick={() => { setError(null); setConfirming(true) }}>Throw it away</button>
        </div>
      )}

      {confirming && (
        <div role="alertdialog" aria-labelledby="discard-title" className="rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-gray-900 p-4 space-y-3 max-w-2xl text-gray-800 dark:text-gray-100">
          <p id="discard-title" className="font-semibold text-red-800 dark:text-red-200">Throw away check-in <span className={mono}>{id}</span>?</p>
          <p className="text-sm">
            Nothing on it is booked in. {keep
              ? <>
                  {printed.length > 0
                    ? <>Labels have been printed for <span className={`${mono} font-semibold`}>{printed.join(", ")}</span>, so it will be kept as <b>void</b> with a note naming them — throw those labels away.</>
                    : <>Something on it has been moved, so it will be kept as <b>void</b> for the record.</>}
                </>
              : <>It will be deleted. Its receipt{rows > 0 ? ", tote and pallet" : ""} numbers won&apos;t be used again.</>}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-40" disabled={busy} onClick={() => void throwAway()}>
              {busy ? "Throwing away…" : "Yes, throw it away"}
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)}>Keep it</button>
          </div>
        </div>
      )}

      {error && <ErrorBox onDismiss={() => setError(null)}>{error}</ErrorBox>}
    </div>
  )
}
