"use client"

import { useState } from "react"

// The one write on the public page. Posts to /api/public/first-aid-report, which is where the
// real protection lives (rate limit, length caps, honeypot) — never trust these client checks.
// Nothing is ever read back here: a submitter sees only "thanks", never other people's reports.
export default function ReportForm() {
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    const fd = new FormData(e.currentTarget)
    try {
      const res = await fetch("/api/public/first-aid-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reporterName:  fd.get("reporterName"),
          reporterPhone: fd.get("reporterPhone"),
          injuredName:   fd.get("injuredName"),
          happenedAt:    fd.get("happenedAt"),
          location:      fd.get("location"),
          description:   fd.get("description"),
          website:       fd.get("website"),   // honeypot — real people never see this
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
        <h2 className="text-lg font-bold text-green-800 mt-1">Report sent</h2>
        <p className="text-sm text-green-900 mt-1">
          Thank you. It has gone to the office for the accident book. If anyone is hurt now, find a
          first aider from the list above, or ring 999.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-bold">Report an accident</h2>
      <p className="text-sm text-gray-600 mt-1">
        For the accident book. This is not an emergency alert — if someone needs help now, find a
        first aider above or ring 999.
      </p>

      {!open ? (
        <button onClick={() => setOpen(true)}
          className="mt-4 w-full rounded-xl border-2 border-gray-300 hover:border-red-400 py-3 font-semibold">
          Report an accident
        </button>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field name="reporterName" label="Your name" required maxLength={100} />
          <Field name="reporterPhone" label="Your phone or extension (optional)" maxLength={40} />
          <Field name="injuredName" label="Who was hurt (optional)" maxLength={100} />
          <Field name="happenedAt" label="When did it happen" placeholder="e.g. about 2pm today" maxLength={100} />
          <Field name="location" label="Where did it happen" placeholder="e.g. warehouse, by goods-in" maxLength={150} />
          <div>
            <label htmlFor="description" className="block text-sm font-semibold mb-1">What happened</label>
            <textarea id="description" name="description" required rows={5} maxLength={4000}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-red-500" />
          </div>

          {/* Honeypot: hidden from people, irresistible to bots. Filled in = silently rejected. */}
          <div aria-hidden className="absolute left-[-9999px] w-px h-px overflow-hidden">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button type="submit" disabled={busy}
            className="w-full rounded-xl bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-bold py-3">
            {busy ? "Sending…" : "Send report"}
          </button>
          <p className="text-xs text-gray-500">
            Your name and what you write are stored so the office can follow it up.
          </p>
        </form>
      )}
    </section>
  )
}

function Field({ name, label, required, placeholder, maxLength }: {
  name: string; label: string; required?: boolean; placeholder?: string; maxLength?: number
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-semibold mb-1">{label}</label>
      <input id={name} name={name} required={required} placeholder={placeholder} maxLength={maxLength}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-red-500" />
    </div>
  )
}
