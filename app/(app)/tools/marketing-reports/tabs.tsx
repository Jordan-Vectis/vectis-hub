import Link from "next/link"

// Tab bar shared by Marketing Reports → Analytics and → Business Plan.
// Server component: each page passes which tab it is, so there's no client-side
// pathname read just to underline a link.

const TABS: { key: "analytics" | "plan"; label: string; href: string }[] = [
  { key: "analytics", label: "📈 Analytics",      href: "/tools/marketing-reports" },
  { key: "plan",      label: "🗺 Business Plan",  href: "/tools/marketing-reports/plan" },
]

export default function MarketingTabs({ active }: { active: "analytics" | "plan" }) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-800 mb-5">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
            active === t.key
              ? "border-pink-600 text-pink-600 dark:text-pink-400"
              : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
