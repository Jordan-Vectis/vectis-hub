"use client"

import { useState } from "react"

// The one write on the public page. Laid out to follow the UK statutory accident book (BI 510):
// part 1 the injured person, part 2 whoever is filling it in, part 3 the accident itself.
// ⚠ Part 4 of the book is EMPLOYER ONLY (date reported, who recorded it, whether it is RIDDOR
// reportable) and is deliberately absent here — it is filled in inside the Hub, behind the login
// and the First Aid permission, exactly as the paper book keeps that section to the employer.
//
// Nothing is ever read back: a submitter sees "thanks", never anyone else's entry. That mirrors
// the paper book's detachable pages, which exist so one person cannot read another's record.
export default function ReportForm() {
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forSelf, setForSelf] = useState(true)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    const fd = new FormData(e.currentTarget)
    const get = (k: string) => String(fd.get(k) ?? "")
    try {
      const res = await fetch("/api/public/first-aid-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporterName:       get("reporterName"),
          reporterPhone:      get("reporterPhone"),
          reporterAddress:    get("reporterAddress"),
          reporterOccupation: get("reporterOccupation"),
          forSelf,
          injuredName:        forSelf ? get("reporterName")       : get("injuredName"),
          injuredAddress:     forSelf ? get("reporterAddress")    : get("injuredAddress"),
          injuredOccupation:  forSelf ? get("reporterOccupation") : get("injuredOccupation"),
          happenedOn:         get("happenedOn"),
          location:           get("location"),
          description:        get("description"),
          injuryDetails:      get("injuryDetails"),
          hp_ref:             get("hp_ref"),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Could not send that just now.")
      setDone(true)
    } catch (err: any) {
      setError(err?.message ?? "Could not send that just now.")
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section className="rounded-2xl border-2 border-green-300 bg-green-50 p-5 text-center">
        <p className="text-3xl">✓</p>
        <h2 className="text-lg font-bold text-green-800 mt-1">Entry sent to the accident book</h2>
        <p className="text-sm text-green-900 mt-1">
          Thank you. The office will complete their part of the record. If anyone is hurt now, find
          a first aider from the list above, or ring 999.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold">Report an accident</h2>
      <p className="text-sm text-gray-600 mt-1">
        This goes into the accident book. It is not an emergency alert — if someone needs help now,
        find a first aider above or ring 999.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="mt-4 w-full rounded-xl border-2 border-gray-300 hover:border-green-500 py-3 font-semibold">
          Report an accident
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-5">
          <Part n={1} title="About you">
            <Field name="reporterName" label="Your full name" required maxLength={100} />
            <Field name="reporterOccupation" label="Your job" maxLength={100} />
            <Area name="reporterAddress" label="Your address" rows={2} maxLength={300}
              hint="The accident book asks for this. Leave it blank if you would rather give it to the office." />
            <Field name="reporterPhone" label="Phone or extension" maxLength={40} />
          </Part>

          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
            <p className="text-sm font-semibold mb-2">Who was hurt?</p>
            <div className="flex gap-2">
              <Choice on={forSelf} onClick={() => setForSelf(true)}>It was me</Choice>
              <Choice on={!forSelf} onClick={() => setForSelf(false)}>Someone else</Choice>
            </div>
          </div>

          {!forSelf && (
            <Part n={2} title="About the injured person">
              <Field name="injuredName" label="Their full name" maxLength={100} />
              <Field name="injuredOccupation" label="Their job" maxLength={100} />
              <Area name="injuredAddress" label="Their address" rows={2} maxLength={300}
                hint="Only if you know it — the office can fill this in." />
            </Part>
          )}

          <Part n={3} title="About the accident">
            <div>
              <label htmlFor="happenedOn" className="block text-sm font-semibold mb-1">When did it happen</label>
              <input id="happenedOn" name="happenedOn" type="datetime-local"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-green-600" />
            </div>
            <Field name="location" label="Where it happened" placeholder="e.g. warehouse, by goods-in" maxLength={150} />
            <Area name="description" label="How it happened" rows={4} maxLength={4000} required
              hint="Say what led up to it and what went wrong." />
            <Area name="injuryDetails" label="The injury" rows={2} maxLength={1000}
              hint="What was hurt, and how — e.g. cut to left hand, bruised knee." />
          </Part>

          {/* Honeypot — hidden from people, and it no longer discards anything: a filled one only
              flags the entry for a human, because a password manager can fill it for a real person. */}
          <div hidden aria-hidden>
            <input id="hp_ref" name="hp_ref" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-50 text-white font-bold py-3">
            {busy ? "Sending…" : "Send to the accident book"}
          </button>
          <p className="text-xs text-gray-500">
            What you write is stored securely and can only be read by the people who look after the
            accident book — not by other staff. Records are kept for three years.
          </p>
        </form>
      )}
    </section>
  )
}

function Part({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wider text-green-800 border-b border-green-200 pb-1">
        Part {n} — {title}
      </p>
      {children}
    </div>
  )
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-xl border-2 py-2 text-sm font-semibold transition-colors ${
        on ? "border-green-600 bg-green-50 text-green-800" : "border-gray-300 text-gray-600"
      }`}>{children}</button>
  )
}

function Field({ name, label, required, placeholder, maxLength }: {
  name: string; label: string; required?: boolean; placeholder?: string; maxLength?: number
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold mb-1">{label}</label>
      <input id={name} name={name} required={required} placeholder={placeholder} maxLength={maxLength}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-green-600" />
    </div>
  )
}

function Area({ name, label, rows, maxLength, required, hint }: {
  name: string; label: string; rows: number; maxLength: number; required?: boolean; hint?: string
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1">{hint}</p>}
      <textarea id={name} name={name} rows={rows} maxLength={maxLength} required={required}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-green-600" />
    </div>
  )
}
