import Link from "next/link"
import type { ReactNode } from "react"
import { CONTAINER_STATUS, type ContainerStatus } from "@/lib/goods-in/model"

// Goods In — the shared look. Every Goods In screen uses these so the section reads as one tool:
// the Hub's own style (dark by default, light with dark: variants that are the LIGHTER value),
// 44px touch targets for the counter iPads, and plain words. Server-safe (no hooks).

export const box = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
export const input = "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2.5 text-base sm:text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
export const label = "block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1"
export const btn = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
export const btnGo = "inline-flex items-center justify-center gap-2 min-h-11 px-5 py-2 text-sm font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
export const btnDanger = "inline-flex items-center justify-center gap-2 min-h-11 px-4 py-2 text-sm font-semibold rounded-lg border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-40"
export const th = "px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap"
export const td = "px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 align-top"
export const mono = "font-mono tracking-tight"

/** Dates and times on Goods In screens are always London time, in British order. */
export const ukDateTime = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(d)) : "—"
export const ukDate = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(d)) : "—"

export function PageHeader({ title, intro, back, actions }: { title: string; intro?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && <Link href={back.href} className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-2 inline-flex items-center gap-1 min-h-8">← {back.label}</Link>}
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {intro && <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">{intro}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

const STATUS_TONE: Record<ContainerStatus, string> = {
  booked: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
  stored: "bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
  bench: "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  catalogued: "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800",
  returned: "bg-violet-50 text-violet-800 border-violet-300 dark:bg-violet-950/50 dark:text-violet-200 dark:border-violet-800",
}

/** A tote/pallet's status as a coloured chip. Wherever chips appear, StatusKey sits nearby (RULES design rule 3). */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = (status && status in CONTAINER_STATUS ? status : "booked") as ContainerStatus
  return <span title={CONTAINER_STATUS[s].help} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_TONE[s]}`}>{CONTAINER_STATUS[s].label}</span>
}

export function StatusKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
      {(Object.keys(CONTAINER_STATUS) as ContainerStatus[]).map(s => (
        <span key={s} className="inline-flex items-center gap-1.5"><StatusBadge status={s} /> {CONTAINER_STATUS[s].help}</span>
      ))}
    </div>
  )
}

export function KindBadge({ kind }: { kind: string }) {
  return <span className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">{kind === "pallet" ? "Pallet" : "Tote"}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className={`${box} px-6 py-10 text-center text-sm text-gray-500 dark:text-gray-400`}>{children}</div>
}

/** Shown in place of a screen when Goods In's tables aren't on this environment yet. */
export function NotReady() {
  return (
    <div className="rounded-xl border border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 px-5 py-4 text-sm leading-relaxed">
      <p className="font-semibold mb-1">Goods In isn&apos;t set up on this environment yet</p>
      <p>Its tables arrive with the next database update. An admin presses <b>Run Migrations</b> (the banner at the top of the Hub), then this screen works.</p>
    </div>
  )
}

export function ErrorBox({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 px-4 py-3 text-sm flex items-start gap-3">
      <span className="flex-1">{children}</span>
      {onDismiss && <button type="button" className="text-xs underline min-h-8" onClick={onDismiss}>Dismiss</button>}
    </div>
  )
}

export function OkBox({ children }: { children: ReactNode }) {
  return <div role="status" className="rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 px-4 py-3 text-sm">{children}</div>
}

/** True when a Prisma/Postgres error means the Goods In tables (or a column) aren't there yet. */
export const isMissingTable = (e: unknown) => /does not exist|P2021|P2022|relation .* does not exist/i.test(String((e as { message?: string; code?: string })?.message ?? "") + " " + String((e as { code?: string })?.code ?? ""))
