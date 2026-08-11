"use client"

import type { IdleReason } from "@/lib/idle-timer-config"

/**
 * The activity popup's reason buttons and its optional message banner.
 *
 * ⚠ This exists because the popup markup used to be COPIED into two files —
 * lot-wizard-tab.tsx and idle-prompt-preview.tsx — and the pair kept drifting, so the admin
 * preview stopped matching what cataloguers actually saw. Both now render this. If you change
 * how a reason looks, change it here and it lands in both. Don't inline it back.
 */

// Reasons are grouped by their `group`, in the order the groups first appear in the reasons
// list — so the admin controls the running order by reordering reasons, with no second setting
// to keep in step. Anything without a group (every reason predates this field) falls into one
// unheaded bucket at the end, so an un-grouped setup still renders every button.
export function groupReasons(reasons: IdleReason[]): { group: string; reasons: IdleReason[] }[] {
  const out: { group: string; reasons: IdleReason[] }[] = []
  const byGroup = new Map<string, IdleReason[]>()
  for (const r of reasons) {
    const g = (r.group ?? "").trim()
    if (!byGroup.has(g)) { byGroup.set(g, []); out.push({ group: g, reasons: byGroup.get(g)! }) }
    byGroup.get(g)!.push(r)
  }
  // Ungrouped last, whatever order it was met in.
  return [...out.filter(g => g.group), ...out.filter(g => !g.group)]
}

export function IdleMessageBanner({ message }: { message?: string | null }) {
  if (!message?.trim()) return null
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
      <p className="text-xs text-amber-800 whitespace-pre-wrap leading-relaxed">{message.trim()}</p>
    </div>
  )
}

export function IdleReasonPicker({
  reasons, selected, onToggle,
}: {
  reasons:  IdleReason[]
  selected: string[]
  onToggle: (key: string, isOn: boolean) => void
}) {
  const groups = groupReasons(reasons)
  return (
    <div className="space-y-3 mb-1.5">
      {groups.map(({ group, reasons: rs }) => (
        <div key={group || "_ungrouped"}>
          {group && (
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">{group}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {rs.map(opt => {
              const on = selected.includes(opt.key)
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => onToggle(opt.key, on)}
                  aria-pressed={on}
                  // Unselected uses the reason's OWN colour (already a fixed preset in
                  // lib/idle-timer-config, so Tailwind generates every class). Selected
                  // overrides it with the app teal + a ring, so "picked" reads at a glance
                  // even across a dozen different colours.
                  className={`px-3 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                    on
                      ? "border-[#2AB4A6] bg-[#2AB4A6]/10 text-[#1a8a80] ring-2 ring-[#2AB4A6]/30"
                      : `${opt.colour} hover:brightness-95`
                  }`}
                >
                  <span className="mr-1">{opt.icon}</span>{opt.label}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
