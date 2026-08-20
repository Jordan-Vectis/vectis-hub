"use client"

import { useRef, useState, useTransition } from "react"
import SignaturePad, { type SignaturePadHandle } from "@/components/signature-pad"
import { signTrainingModule } from "@/lib/actions/training"

// The popup at the end of a course: you have passed every task, now put your name to it.
//
// ⚠ The declaration wording is NOT passed in from here. The server builds it and snapshots it
// onto the signed row, so a browser cannot create a record against wording of its own, and
// rewording the declaration later cannot change what a past signature appears to say.
//
// ⚠ Closing without signing is allowed and costs nothing — the course stays complete and the
// popup offers itself again next time. A sign-off you cannot decline is not a sign-off.

export default function TrainingSignOff({
  moduleId, moduleTitle, tasksPassed, tasksTotal, userName, onClose, onSigned,
}: {
  moduleId: string
  moduleTitle: string
  tasksPassed: number
  tasksTotal: number
  userName: string
  onClose: () => void
  onSigned: () => void
}) {
  const pad = useRef<SignaturePadHandle | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [pending, start]    = useTransition()

  function submit() {
    const data = pad.current?.toDataUrl()
    if (!data) { setError("Please draw your signature in the box first"); return }
    setError(null)
    start(async () => {
      const res = await signTrainingModule(moduleId, data)
      if (res.ok) onSigned()
      else setError(res.error ?? "Could not save your signature")
    })
  }

  return (
    <div className="fixed inset-0 z-[150] bg-black/60 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl w-full max-w-2xl my-8 border border-gray-200 dark:border-gray-800">
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <p className="text-3xl">🎓</p>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
            You&apos;ve finished {moduleTitle}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {tasksPassed} of {tasksTotal} practice task{tasksTotal === 1 ? "" : "s"} passed.
            Sign below to record that you&apos;ve been trained on this part of the system.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-xl bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-gray-700 px-4 py-3">
            <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">
              I confirm that I have completed the <strong>{moduleTitle}</strong> training in the Vectis
              Hub — I have read the material, worked through the practice tasks, and I understand how to
              use this part of the system. I know who to ask if I am unsure.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Sign here — {userName}
              </span>
              <button
                type="button"
                onClick={() => { pad.current?.clear(); setError(null) }}
                className="text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-2 min-h-[44px]"
              >
                Clear
              </button>
            </div>
            <SignaturePad ref={pad} onInk={setHasInk} />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              Use your finger on a tablet, or the mouse.
            </p>
          </div>

          {error && (
            <div className="rounded-xl border-2 border-red-500/40 bg-red-50 dark:bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-3 min-h-[44px] rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !hasInk}
            className="px-6 py-3 min-h-[44px] rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pending ? "Saving…" : "✓ Sign and finish"}
          </button>
        </div>
      </div>
    </div>
  )
}
