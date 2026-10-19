"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { endCardSession } from "@/lib/goods-in/scan-client/card"
import { bigBtn, btn, field, label } from "./ui"

// Signing in with a username and password on the handheld scanner — the way in for someone without
// a sign-in card (card-sign-in.tsx offers it as "Sign in with username and password instead"). The
// devices are shared, so the next person signs in right here and lands straight back on /scan (the
// Hub's own sign-in page always goes on to /hub). It is the Hub's ordinary sign-in (NextAuth
// credentials, the same check as /login), just without leaving the screen. Every scan made after it
// is recorded against whoever signs in.
//
// Signing in as someone else ends any scanner card session on this device too — once the password
// has been accepted, so a mistyped one doesn't sign the last person out. (A Hub login counts before
// a card anyway, so there is no moment where the card's person is still the one scanning.)
//
// `beforeLeave` runs before the page reloads as the new person (it forgets the offline copy of the
// screen, which was the last person's).

export default function SignInPanel({ title, intro, onCancel, beforeLeave }: {
  title: string
  intro?: string
  onCancel?: () => void
  beforeLeave?: () => Promise<void> | void
}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) { setError("Type your username (or email) and your password."); return }
    setBusy(true)
    setError(null)
    try {
      const res = await signIn("credentials", { email: email.trim(), password, redirect: false, redirectTo: "/scan" })
      if (!res || res.error || !res.ok) {
        setError(res?.error === "CredentialsSignin" || res?.error ? "That username or password isn't right — try again." : "Signing in didn't work just now — check the Wi-Fi and try again.")
        setBusy(false)
        return
      }
      // The last person's card session, if they used one (the new Hub login counts first either way).
      await endCardSession()
      try { await beforeLeave?.() } catch { /* the page reloads anyway */ }
      window.location.replace("/scan")
    } catch {
      setError("The Hub couldn't be reached — signing in needs the Wi-Fi.")
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="scan-signin-title">
      <div>
        <h2 id="scan-signin-title" className="text-lg font-bold leading-tight text-gray-900 dark:text-white break-words">{title}</h2>
        {intro && <p className="mt-1 text-[15px] leading-snug text-gray-700 dark:text-gray-300">{intro}</p>}
      </div>
      <div>
        <label htmlFor="scan-signin-user" className={label}>Username or email</label>
        <input
          id="scan-signin-user"
          className={field}
          value={email}
          onChange={e => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          autoFocus
        />
      </div>
      <div>
        <label htmlFor="scan-signin-pass" className={label}>Password</label>
        <input
          id="scan-signin-pass"
          type="password"
          className={field}
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete="current-password"
          enterKeyHint="go"
        />
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-600 px-3 py-2 text-[14px] font-semibold text-white break-words">{error}</p>}
      <button type="submit" className={bigBtn} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      {onCancel && <button type="button" className={`${btn} w-full`} onClick={onCancel} disabled={busy}>Back to scanning a card</button>}
    </form>
  )
}
