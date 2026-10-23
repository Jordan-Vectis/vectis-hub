"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { previewStorageSettings, saveStorageSettings } from "@/lib/actions/uncollected"
import {
  STORAGE_LIMITS, STORAGE_SETTINGS_NOT_READY, STORAGE_SETTINGS_READ_FAILED, STORAGE_SOURCE_WORDS, formatDateTime,
  storageGraceWarning, storageSettingsWords, type StoragePeriod, type StorageSettings, type StorageSettingsInfo,
} from "@/lib/uncollected"
import { Flash, NO_ANSWER, btn, btnGo, card, cardTitle, field, label, plural, type FlashMessage } from "./ui"

// The panel's "Storage charges" box: how storage is charged on every case — the free days after
// they paid, the charge per lot, per day or per week, and VAT — and who last changed it. Admins only
// (the panel is, and saveStorageSettings / previewStorageSettings re-check on the server). Changing
// it changes every case's figures at once — collected and closed ones too, because storage is
// worked out live and never stored as money — and a change to the free days moves the start of the
// open cases from BC whose start the rule set (never one a person set), each with a timeline line.
// So Save asks first, in the page (previewStorageSettings counts the starts that would move). The
// Hub never charges anything in BC: the figures are for staff to raise the charge.

type Form = { graceDays: string; ratePounds: string; period: StoragePeriod; vatPercent: string }

const formOf = (s: StorageSettingsInfo): Form => ({
  graceDays: String(s.graceDays),
  ratePounds: (s.ratePence / 100).toFixed(2),
  period: s.period,
  vatPercent: String(s.vatPercent),
})

/** What saving would do, as previewStorageSettings answered — shown before anything is saved. */
type Asking = {
  sent: Form
  value: StorageSettings
  graceChanged: boolean
  previousGraceDays: number
  /** Open cases from BC whose start would move; null = couldn't be counted. */
  moves: number | null
}

export default function StorageSettingsBox({ settings }: { settings: StorageSettingsInfo }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => formOf(settings))
  const [asking, setAsking] = useState<Asking | null>(null)
  const [msg, setMsg] = useState<FlashMessage | null>(null)
  const [checking, startChecking] = useTransition()
  const [saving, startSaving] = useTransition()
  const busy = checking || saving
  const canSave = settings.ready && !settings.readFailed
  const savedWarning = storageGraceWarning(settings.graceDays)
  const typedDays = /^\s*\d+\s*$/.test(form.graceDays) ? Number(form.graceDays) : null
  const typedWarning = typedDays == null ? null : storageGraceWarning(typedDays)

  function open() {
    setForm(formOf(settings))
    setAsking(null)
    setMsg(null)
    setEditing(true)
  }

  /** Step 1: check the values and count what would move — nothing is saved. */
  function check() {
    if (busy) return
    const sent = form
    setMsg(null)
    startChecking(async () => {
      try {
        const res = await previewStorageSettings(sent)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        if (!res.data.changed) {
          setMsg({ tone: "info", text: "Those are the charges it already has — nothing changed." })
          setEditing(false)
          return
        }
        setAsking({ sent, ...res.data })
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  /** Step 2: save what was confirmed. */
  function save() {
    if (busy || !asking) return
    const sent = asking.sent
    startSaving(async () => {
      try {
        const res = await saveStorageSettings(sent)
        if (!res.ok) { setMsg({ tone: "error", text: res.error }); return }
        const { changed, moved, notMoved, startsUnread } = res.data
        const starts = [
          moved ? `${plural(moved, "case")} from BC had ${moved === 1 ? "its" : "their"} storage start moved to match` : null,
          notMoved ? `${plural(notMoved, "case")} couldn't be moved — try saving again` : null,
          startsUnread ? "the cases from BC couldn't be read to move their storage starts, so the BC check moves them when it next looks at each case" : null,
        ].filter(Boolean).join("; ")
        setMsg(changed
          ? { tone: notMoved || startsUnread ? "error" : "ok", text: `Saved — ${storageSettingsWords(res.data.settings)}. Every case's storage now uses it${starts ? `; ${starts}` : ""}.` }
          : { tone: "info", text: "Those are the charges it already has — nothing changed." })
        setAsking(null)
        setEditing(false)
        router.refresh()
      } catch {
        setMsg({ tone: "error", text: NO_ANSWER })
      }
    })
  }

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    const v = e.target.value
    setAsking(null)
    setForm(f => (k === "period" ? { ...f, period: v === "week" ? "week" : "day" } : { ...f, [k]: v }))
  }

  return (
    <section className={`${card} p-4 sm:p-5 mt-6`} aria-labelledby="storage-settings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-4xl">
          <h2 id="storage-settings-title" className={cardTitle}>Storage charges</h2>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-2">{storageSettingsWords(settings)}.</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {settings.saved
              ? `Last changed${settings.updatedByName ? ` by ${settings.updatedByName}` : ""}${settings.updatedAt ? ` on ${formatDateTime(settings.updatedAt)}` : ""}.`
              : "The standard charges — nobody has changed them."}
            {" "}Storage starts the day after the free days run out, is charged per lot still here, and stops on the day a case is
            closed. It&apos;s worked out live on every case, in London days, so the figures go up each day.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{STORAGE_SOURCE_WORDS}</p>
          {savedWarning && !editing && <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">{savedWarning}</p>}
        </div>
        {!editing && (
          <button type="button" onClick={open} disabled={!canSave} className={btn} title={canSave ? undefined : "Can't be changed just now — see the note below"}>
            ✏️ Change
          </button>
        )}
      </div>

      {(!settings.ready || settings.readFailed) && (
        <p role="status" className="mt-3 rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 text-sm">
          {settings.ready ? STORAGE_SETTINGS_READ_FAILED : STORAGE_SETTINGS_NOT_READY}
        </p>
      )}

      {editing && (
        <form onSubmit={e => { e.preventDefault(); check() }} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className={label}>Free days after they pay</span>
              <input value={form.graceDays} onChange={set("graceDays")} disabled={busy} inputMode="numeric" autoComplete="off" className={`w-full ${field}`} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">0 to {STORAGE_LIMITS.graceDaysMax}. Charges start the day after.</span>
            </label>
            <label className="block">
              <span className={label}>Charge per lot (£, before VAT)</span>
              <input value={form.ratePounds} onChange={set("ratePounds")} disabled={busy} inputMode="decimal" autoComplete="off" className={`w-full ${field}`} />
            </label>
            <label className="block">
              <span className={label}>Charged per</span>
              <select value={form.period} onChange={set("period")} disabled={busy} className={`w-full ${field}`}>
                <option value="day">Day</option>
                <option value="week">Week (a week started counts as a week)</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>VAT (%)</span>
              <input value={form.vatPercent} onChange={set("vatPercent")} disabled={busy} inputMode="decimal" autoComplete="off" className={`w-full ${field}`} />
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">0 for no VAT.</span>
            </label>
          </div>
          {typedWarning && <p className="text-xs text-amber-700 dark:text-amber-300 mt-3">{typedWarning}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
            Saving changes every case&apos;s figures straight away — collected and closed ones too, so a figure already used to raise
            a charge will read differently. Changing the free days also moves the start date of the open cases from BC whose start
            was worked out from the paid date — never one a person set on the case — with a line on each one&apos;s timeline.
          </p>

          {!asking ? (
            <div className="flex flex-wrap gap-2 mt-3">
              <button type="submit" disabled={busy} className={btnGo}>{checking ? "Checking…" : "Save the charges…"}</button>
              <button type="button" disabled={busy} onClick={() => { setEditing(false); setMsg(null) }} className={btn}>Cancel</button>
            </div>
          ) : (
            // Confirmed in the page, so a stray second tap on an iPad changes nothing.
            <div className="mt-3 rounded-xl border border-emerald-500/50 bg-emerald-50/60 dark:bg-emerald-500/5 p-4">
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Save these storage charges?</p>
              <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{storageSettingsWords(asking.value)}.</p>
              <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300 list-disc pl-5">
                <li>Every case&apos;s storage figure changes straight away, including collected and closed cases.</li>
                {asking.graceChanged && (
                  <li>
                    {asking.moves == null
                      ? `The free days go from ${asking.previousGraceDays} to ${asking.value.graceDays}. How many open cases from BC will have their storage start moved couldn't be counted just now — each one that moves gets a line on its timeline.`
                      : asking.moves === 0
                        ? `The free days go from ${asking.previousGraceDays} to ${asking.value.graceDays}. No open case from BC needs its storage start moved.`
                        : `The free days go from ${asking.previousGraceDays} to ${asking.value.graceDays}, so ${plural(asking.moves, "open case")} from BC will have ${asking.moves === 1 ? "its" : "their"} storage start moved, each with a line on its timeline.`}
                  </li>
                )}
                {storageGraceWarning(asking.value.graceDays) && <li className="text-amber-700 dark:text-amber-300">{storageGraceWarning(asking.value.graceDays)}</li>}
              </ul>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={save} disabled={busy} className={btnGo}>
                  {saving ? (asking.graceChanged && asking.moves !== 0 ? "Saving and moving start dates…" : "Saving…") : "Yes, save the charges"}
                </button>
                <button type="button" onClick={() => setAsking(null)} disabled={busy} className={btn}>Back</button>
              </div>
            </div>
          )}
        </form>
      )}

      <Flash msg={msg} />
    </section>
  )
}
