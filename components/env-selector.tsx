"use client"

import { useState, useRef, useEffect } from "react"

// ⚠ Sandbox runs the STAGING code against a Neon branch of PRODUCTION's data (created
// 2026-08-18), so changes can be tried against real lots, totes and sales without touching
// production. Its background jobs are switched off by leaving CRON_SECRET unset — see the
// Sandbox note in the memory. Refresh its data by re-branching from production in Neon.
const ENVIRONMENTS = [
  { name: "Production", url: "https://vectis-production.up.railway.app/hub" },
  { name: "Staging",    url: "https://vectis-staging.up.railway.app/hub" },
  { name: "Sandbox",    url: "https://vectis-hub-sandbox.up.railway.app/hub" },
]

export default function EnvSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleOutside)
    document.addEventListener("touchstart", handleOutside as EventListener)
    return () => {
      document.removeEventListener("mousedown", handleOutside)
      document.removeEventListener("touchstart", handleOutside as EventListener)
    }
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-gray-400 hover:text-white text-sm transition-colors"
      >
        Environments ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-gray-700 rounded-lg shadow-lg z-50 py-1">
          {ENVIRONMENTS.map(env => (
            <a
              key={env.name}
              href={env.url}
              className="block px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            >
              {env.name}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
