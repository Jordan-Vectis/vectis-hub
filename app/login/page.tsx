"use client"

import { useActionState, useState } from "react"
import Logo from "@/components/logo"
import { loginAction } from "./actions"

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, null)
  // Kept in state: React empties a form after its action runs, and the code step re-sends both.
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const askCode = state?.step === "code"
  const error = state?.error

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          <Logo variant="icon" />
          <div className="text-center">
            <p className="text-gray-900 font-bold text-2xl tracking-tight">Vectis Hub</p>
            <p className="text-gray-500 text-sm mt-0.5">Internal Platform</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">Sign in</h2>

          <form action={action} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email or username
              </label>
              <input
                id="email"
                name="email"
                type="text"
                required
                autoComplete="username"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@vectis.co.uk or Jordan.Orange"
                value={email}
                onChange={e => setEmail(e.target.value)}
                readOnly={askCode}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                readOnly={askCode}
              />
            </div>

            {askCode && (
              <div>
                <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
                  Code from your authenticator app
                </label>
                <input
                  id="code"
                  name="code"
                  type="text"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="123456"
                />
                <p className="text-xs text-gray-500 mt-1">Lost your phone? Ask an admin to reset your two-factor.</p>
                <label className="flex items-center gap-2 mt-3 text-sm text-gray-700 min-h-11 cursor-pointer">
                  <input type="checkbox" name="remember" className="h-5 w-5" />
                  Remember this device for 30 days
                </label>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {pending ? "Signing in..." : askCode ? "Check code" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
