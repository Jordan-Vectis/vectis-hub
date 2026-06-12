"use client"

import { useState, useTransition } from "react"
import { generatePhotoUploadToken } from "@/lib/actions/submissions"

export default function PhotoLink({
  submissionId,
  token,
}: {
  submissionId: string
  token: string | null
}) {
  const [currentToken, setCurrentToken] = useState(token)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const link = currentToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/submit/${currentToken}`
    : null

  function handleGenerate() {
    startTransition(async () => {
      const { token: t } = await generatePhotoUploadToken(submissionId)
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

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Photo Request Link</h3>
      {link ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 break-all font-mono bg-gray-50 dark:bg-gray-800 rounded p-2">{link}</p>
          <button
            onClick={handleCopy}
            className="w-full text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className="w-full text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "Generating…" : "Generate photo link"}
        </button>
      )}
    </div>
  )
}
