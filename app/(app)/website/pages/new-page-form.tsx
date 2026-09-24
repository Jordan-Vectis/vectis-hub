"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createSitePage } from "@/lib/actions/site-pages"
import { slugProblem, slugify } from "@/app/(site)/page-editor/pages"

// A new page of the test website: a name and its address (suggested from the name). It opens in
// the editor at once; it isn't on the site until it is published.
export default function NewPageForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)

  const address = slugTouched ? slug : slugify(name)
  const problem = address ? slugProblem(address) : null

  async function create() {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const res = await createSitePage(name, address)
    if (res.ok) router.push(`/website/pages/edit?slug=${encodeURIComponent(res.slug)}`)
    else { setError(res.error); setBusy(false); inFlight.current = false }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-sky-600 px-4 text-sm font-bold text-sky-700 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20">
        ＋ New page
      </button>
    )
  }
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#141416] px-3 min-h-[44px] text-base text-gray-900 dark:text-white focus:outline-none focus:border-sky-500"
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1C1C1E] p-4 space-y-3 max-w-3xl">
      <p className="text-sm font-bold text-gray-900 dark:text-white">A new page</p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
          Name
          <input value={name} onChange={e => setName(e.target.value)} placeholder="About Us" className={`${input} w-64`} autoFocus />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
          Address
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">/</span>
            <input value={address} onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()) }} placeholder="about-us" className={`${input} w-56 font-mono`} />
          </div>
        </label>
      </div>
      {problem && <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
      {error && <p className="text-xs text-red-700 dark:text-red-400">⚠ {error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !name.trim() || !address || !!problem} onClick={create} className="inline-flex min-h-[44px] items-center rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 px-5 text-sm font-bold text-white">
          {busy ? "Making the page…" : "Make the page and open it"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null) }} className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
          Cancel
        </button>
      </div>
    </div>
  )
}
