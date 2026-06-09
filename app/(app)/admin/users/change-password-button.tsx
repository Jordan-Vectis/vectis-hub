"use client"

import { useState, useTransition } from "react"
import { changePassword } from "@/lib/actions/admin"

export default function ChangePasswordButton({ userId, userName }: { userId: string; userName: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.")
      return
    }
    setError(null)
    const formData = new FormData()
    formData.set("name", userName)
    formData.set("password", password)
    startTransition(async () => {
      try {
        await changePassword(userId, password)
        setOpen(false)
        setPassword("")
        setConfirm("")
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.")
      }
    })
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setOpen(true); setSuccess(false) }}
          className="text-blue-400 hover:text-blue-600 dark:text-blue-400 text-sm"
        >
          Change password
        </button>
        {success && <span className="text-xs text-green-600">Password updated.</span>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5 min-w-0">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
        minLength={8}
        required
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm password"
        required
        className="rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {error && <span className="text-xs text-red-500">{error}</span>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors disabled:opacity-50"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null) }}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
