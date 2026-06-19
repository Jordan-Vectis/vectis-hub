"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

// Lets the user pick which report sections show. The choice is stored in the
// mr_sections cookie (read server-side) and the report re-fetches on close.
export default function SectionSelector({
  catalog,
  selected,
}: {
  catalog: { id: string; title: string }[]
  selected: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<string[]>(selected)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)

  function write(next: string[]) {
    setSel(next)
    setDirty(true)
    document.cookie = `mr_sections=${next.join(",")}; path=/; max-age=${60 * 60 * 24 * 365}`
  }

  function close() {
    setOpen(false)
    if (dirty) {
      setDirty(false)
      setPending(true)
      router.refresh()
      setTimeout(() => setPending(false), 800)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className="px-3.5 py-2 rounded-xl text-sm font-semibold border border-transparent bg-gray-100 dark:bg-[#2C2C2E] text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        ⚙ Customise{pending ? "…" : ""}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={close} />
          <div className="absolute right-0 mt-2 w-72 z-50 bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-3 max-h-[75vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Show sections</span>
              <div className="flex gap-2 text-xs">
                <button onClick={() => write(catalog.map((c) => c.id))} className="text-pink-600 dark:text-pink-400 hover:underline font-semibold">All</button>
                <button onClick={() => write([])} className="text-gray-400 hover:underline font-semibold">None</button>
              </div>
            </div>
            {catalog.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sel.includes(c.id)}
                  onChange={() => write(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id])}
                  className="w-4 h-4 accent-pink-600 flex-shrink-0"
                />
                <span className="text-sm text-gray-700 dark:text-gray-200">{c.title}</span>
              </label>
            ))}
            <p className="text-[11px] text-gray-400 px-2 pt-2 mt-1 border-t border-gray-100 dark:border-gray-800">Closes &amp; refreshes when you click away. Saved on this browser.</p>
          </div>
        </>
      )}
    </div>
  )
}
