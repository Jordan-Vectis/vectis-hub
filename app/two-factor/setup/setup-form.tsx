"use client"

import { useState } from "react"
import Link from "next/link"
import { confirmTwoFactorSetup } from "./actions"

export default function SetupForm({ name, qr, secret }: { name: string; qr: string; secret: string }) {
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError("")
    const r = await confirmTwoFactorSetup(code)
    setBusy(false)
    if (r.ok) setDone(true)
    else setError(r.error ?? "Something went wrong.")
  }

  if (done) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-green-700">✓ Two-factor is on.</p>
        <p className="text-sm text-gray-700">
          From now on you&apos;ll type the code from your app after your password.
          If you lose your phone, ask an admin to reset your two-factor.
        </p>
        <Link href="/login" className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm">
          Sign in now
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={confirm} className="space-y-4">
      <p className="text-sm text-gray-700">
        {name ? `${name}, your` : "Your"} account needs a code from your phone as well as your password.
      </p>
      <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1">
        <li>Install <strong>Microsoft Authenticator</strong> or <strong>Google Authenticator</strong> on your phone.</li>
        <li>In the app, add an account and scan this QR code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code to scan with your authenticator app" className="mx-auto w-48 h-48" />
      <p className="text-xs text-gray-500 text-center">
        Can&apos;t scan? Type this key into the app instead:<br />
        <span className="font-mono text-sm text-gray-800 select-all">{secret}</span>
      </p>
      <input
        value={code}
        onChange={e => setCode(e.target.value)}
        autoComplete="one-time-code"
        autoFocus
        required
        placeholder="123456"
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full min-h-11 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm disabled:opacity-50">
        {busy ? "Checking…" : "Turn on two-factor"}
      </button>
    </form>
  )
}
