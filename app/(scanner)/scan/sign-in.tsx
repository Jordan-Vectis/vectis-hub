"use client"

import { useState } from "react"
import { signIn, signOut } from "next-auth/react"
import { bigBtn, btn, field, label } from "./ui"

// Switch user on the handheld scanner — the devices are shared, so the next person signs in right
// here and lands straight back on /scan (the Hub's own sign-in page always goes on to /hub). It is
// the Hub's ordinary sign-in (NextAuth credentials, the same check as /login), just without leaving
// the screen. Every scan made after it is recorded against whoever signs in.
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
  const [busy, setBusy] = useState<"in" | "out" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) { setError("Type your username (or email) and your password."); return }
    setBusy("in")
    setError(null)
    try {
      const res = await signIn("credentials", { email: email.trim(), password, redirect: false, redirectTo: "/scan" })
      if (!res || res.error || !res.ok) {
        setError(res?.error === "CredentialsSignin" || res?.error ? "That username or password isn't right — try again." : "Signing in didn't work just now — check the Wi-Fi and try again.")
        setBusy(null)
        return
      }
      try { await beforeLeave?.() } catch { /* the page reloads anyway */ }
      window.location.replace("/scan")
    } catch {
      setError("The Hub couldn't be reached — signing in needs the Wi-Fi.")
      setBusy(null)
    }
  }

  const out = async () => {
    if (busy) return
    setBusy("out")
    try { await beforeLeave?.() } catch { /* carry on */ }
    try {
      await signOut({ redirectTo: "/login" })
    } catch {
      setError("Signing out needs the Wi-Fi.")
      setBusy(null)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby="scan-signin-title">
      <div>
        <h2 id="scan-signin-title" className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h2>
        {intro && <p className="mt-1 text-base text-gray-700 dark:text-gray-300 leading-relaxed">{intro}</p>}
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
      {error && <p role="alert" className="rounded-xl bg-red-600 px-4 py-3 text-base font-semibold text-white">{error}</p>}
      <button type="submit" className={bigBtn} disabled={!!busy}>{busy === "in" ? "Signing in…" : "Sign in"}</button>
      <div className="flex flex-wrap gap-3">
        {onCancel && <button type="button" className={`${btn} flex-1`} onClick={onCancel} disabled={!!busy}>Cancel</button>}
        <button type="button" className={`${btn} flex-1`} onClick={() => void out()} disabled={!!busy}>{busy === "out" ? "Signing out…" : "Sign out"}</button>
      </div>
    </form>
  )
}
