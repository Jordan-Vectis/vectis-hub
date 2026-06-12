"use client"

import { useState, useTransition } from "react"
import { generateValuationToken } from "@/lib/actions/submissions"

type User = { id: string; name: string; email: string | null }

export default function ValuationLink({
  submissionId,
  token: initialToken,
  customerName,
  items,
  users,
}: {
  submissionId: string
  token: string | null
  customerName: string
  items: { name: string }[]
  users: User[]
}) {
  const [currentToken, setCurrentToken] = useState(initialToken)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [recipientMode, setRecipientMode] = useState<"list" | "custom">("list")
  const [selectedEmail, setSelectedEmail] = useState(users[0]?.email ?? "")
  const [customEmail, setCustomEmail] = useState("")
  const [showEmail, setShowEmail] = useState(false)

  const link = currentToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/value/${currentToken}`
    : null

  function handleGenerate() {
    startTransition(async () => {
      const { token: t } = await generateValuationToken(submissionId)
      setCurrentToken(t)
    })
  }

  function handleCopy() {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleOpenEmail() {
    if (!link) return
    const recipient = recipientMode === "list" ? selectedEmail : customEmail
    const itemList = items.map((i, n) => `${n + 1}. ${i.name}`).join("\n")
    const subject = encodeURIComponent(`Valuation Request — ${customerName}`)
    const body = encodeURIComponent(
      `Dear Colleague,\n\nVectis Auctions would like to request your expert valuation on the following items submitted by ${customerName}:\n\n${itemList}\n\nPlease use the link below to submit your valuation. No login is required:\n\n${link}\n\nIf you have any questions, please contact us on 01983 520 722.\n\nKind regards,\nVectis Auctions`
    )
    window.open(`mailto:${recipient}?subject=${subject}&body=${body}`)
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Valuation Request Link</h3>

      {!currentToken ? (
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className="w-full text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Generating…" : "Generate valuation link"}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 break-all font-mono bg-gray-50 dark:bg-gray-800 rounded p-2">{link}</p>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button
              onClick={() => setShowEmail(v => !v)}
              className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Send email
            </button>
          </div>

          {showEmail && (
            <div className="pt-2 space-y-2 border-t border-gray-100 dark:border-gray-700 mt-2">
              {/* Toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs">
                <button
                  onClick={() => setRecipientMode("list")}
                  className={`flex-1 py-1.5 font-medium transition-colors ${
                    recipientMode === "list"
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  Choose from staff
                </button>
                <button
                  onClick={() => setRecipientMode("custom")}
                  className={`flex-1 py-1.5 font-medium transition-colors ${
                    recipientMode === "custom"
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  }`}
                >
                  Type email
                </button>
              </div>

              {recipientMode === "list" ? (
                <select
                  value={selectedEmail}
                  onChange={e => setSelectedEmail(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.email ?? ""} disabled={!u.email}>
                      {u.name}{u.email ? ` — ${u.email}` : " (no email)"}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="email"
                  placeholder="valuer@example.com"
                  value={customEmail}
                  onChange={e => setCustomEmail(e.target.value)}
                  className="w-full text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              <button
                onClick={handleOpenEmail}
                disabled={recipientMode === "list" ? !selectedEmail : !customEmail}
                className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-2 rounded-lg transition-colors disabled:opacity-40"
              >
                Open in Outlook →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
