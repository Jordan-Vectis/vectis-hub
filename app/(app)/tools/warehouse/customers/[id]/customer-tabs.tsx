"use client"

import Link, { useLinkStatus } from "next/link"

// The customer page's two tabs — Overview and Fees & agreement. Each is a real link (?tab=fees),
// so Back, a refresh and a shared link all land on the same tab. The page is worked out on the
// server, so a tab that is still loading pulses its name and draws its underline (nothing moves).

export type CustomerTab = "overview" | "fees"

function Label({ text }: { text: string }) {
  const { pending } = useLinkStatus()
  return (
    <>
      <span className={pending ? "animate-pulse" : ""}>{text}</span>
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 origin-left bg-indigo-400/70 transition-transform duration-700 ${pending ? "scale-x-100" : "scale-x-0"}`}
      />
    </>
  )
}

export default function CustomerTabs({ id, tab }: { id: string; tab: CustomerTab }) {
  const base = `/tools/warehouse/customers/${encodeURIComponent(id)}`
  const tabs: { key: CustomerTab; label: string; href: string }[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "fees", label: "Fees & agreement", href: `${base}?tab=fees` },
  ]
  return (
    <nav aria-label="This customer" className="mb-6 border-b border-gray-200 dark:border-gray-800">
      <ul className="-mb-px flex gap-1 sm:gap-2">
        {tabs.map(t => {
          const active = t.key === tab
          return (
            <li key={t.key} className="min-w-0">
              <Link
                href={t.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-12 items-center whitespace-nowrap border-b-2 px-3 sm:px-4 text-sm font-semibold transition-colors ${
                  active
                    ? "border-indigo-500 text-indigo-700 dark:text-indigo-300"
                    : "border-transparent text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100"
                }`}
              >
                <Label text={t.label} />
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
