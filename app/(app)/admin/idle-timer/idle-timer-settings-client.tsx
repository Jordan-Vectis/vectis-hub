"use client"

import { useState, useTransition } from "react"
import type { IdleReason } from "@/lib/idle-timer-config"
import { COLOUR_PRESETS } from "@/lib/idle-timer-config"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toKey(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "")
}

// ─── Reason editor modal ──────────────────────────────────────────────────────

function ReasonModal({
  initial,
  existingKeys,
  onSave,
  onClose,
}: {
  initial?: IdleReason
  existingKeys: string[]
  onSave: (r: IdleReason) => void
  onClose: () => void
}) {
  const [icon,         setIcon]         = useState(initial?.icon         ?? "📝")
  const [label,        setLabel]        = useState(initial?.label        ?? "")
  const [requiresNotes,setRequiresNotes]= useState(initial?.requiresNotes ?? false)
  const [colour,       setColour]       = useState(
    initial?.colour ?? COLOUR_PRESETS[7].colour
  )
  const [idleColour,   setIdleColour]   = useState(
    initial?.idleColour ?? COLOUR_PRESETS[7].idleColour
  )

  const derivedKey = initial?.key ?? toKey(label)
  const keyClash   = !initial && existingKeys.includes(derivedKey) && label.trim() !== ""
  const canSave    = label.trim().length > 0 && !keyClash

  function handleColourPreset(preset: typeof COLOUR_PRESETS[number]) {
    setColour(preset.colour)
    setIdleColour(preset.idleColour)
  }

  function save() {
    if (!canSave) return
    onSave({ key: derivedKey, label: label.trim(), icon, requiresNotes, colour, idleColour })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-5">
          {initial ? "Edit Reason" : "Add Reason"}
        </h3>

        {/* Icon */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Icon (emoji)</label>
        <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={4}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-2xl bg-gray-50 dark:bg-gray-800 mb-4 text-center focus:outline-none focus:border-[#2AB4A6]" />

        {/* Label */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Label</label>
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Lunch Break"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white mb-1 focus:outline-none focus:border-[#2AB4A6]" />
        {keyClash && (
          <p className="text-xs text-red-500 mb-3">A reason with this key already exists.</p>
        )}
        {!keyClash && (
          <p className="text-xs text-gray-400 mb-4">Key: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{derivedKey || "—"}</code></p>
        )}

        {/* Colour preset */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Badge Colour</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {COLOUR_PRESETS.map(p => (
            <button key={p.label} onClick={() => handleColourPreset(p)}
              title={p.label}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${p.colour} ${
                colour === p.colour ? "ring-2 ring-offset-1 ring-[#2AB4A6] scale-105" : "opacity-70 hover:opacity-100"
              }`}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Requires notes toggle */}
        <label className="flex items-center gap-3 cursor-pointer mb-6 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div onClick={() => setRequiresNotes(v => !v)}
            className={`relative w-10 h-6 rounded-full transition-colors ${requiresNotes ? "bg-[#2AB4A6]" : "bg-gray-300 dark:bg-gray-600"}`}>
            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${requiresNotes ? "translate-x-5" : "translate-x-1"}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Requires a note</p>
            <p className="text-xs text-gray-500">Staff must type an explanation before submitting</p>
          </div>
        </label>

        {/* Preview */}
        <div className="mb-5 p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-400 mb-2 uppercase tracking-wider font-semibold">Preview</p>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${colour}`}>
            {icon} {label || "Reason"}
          </span>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={!canSave}
            className="flex-1 py-2.5 rounded-xl bg-[#2AB4A6] hover:bg-[#22a090] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors">
            {initial ? "Save Changes" : "Add Reason"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main settings component ──────────────────────────────────────────────────

export default function IdleTimerSettingsClient({ initialReasons }: { initialReasons: IdleReason[] }) {
  const [reasons,    setReasons]    = useState<IdleReason[]>(initialReasons)

  const [editTarget, setEditTarget] = useState<IdleReason | null | "new">(null)
  const [saveMsg,    setSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending,  start]         = useTransition()

  // ── Reason list mutations ──
  function openAdd()                    { setEditTarget("new") }
  function openEdit(r: IdleReason)      { setEditTarget(r) }
  function closeModal()                 { setEditTarget(null) }

  function handleSaveReason(r: IdleReason) {
    if (editTarget === "new") {
      setReasons(prev => [...prev, r])
    } else {
      setReasons(prev => prev.map(x => x.key === r.key ? r : x))
    }
    setEditTarget(null)
  }

  function deleteReason(key: string) {
    if (reasons.length <= 1) { alert("At least one reason must remain — add a replacement first."); return }
    if (!confirm("Remove this reason? Existing logs using it are not affected.")) return
    setReasons(prev => prev.filter(r => r.key !== key))
  }

  function moveUp(i: number) {
    if (i === 0) return
    setReasons(prev => {
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })
  }
  function moveDown(i: number) {
    setReasons(prev => {
      if (i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }

  // ── Save to DB ──
  function save() {
    setSaveMsg(null)
    start(async () => {
      const res = await fetch("/api/admin/idle-timer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasons }),
      })
      if (res.ok) {
        setSaveMsg({ ok: true, text: "Settings saved." })
      } else {
        const d = await res.json().catch(() => ({}))
        setSaveMsg({ ok: false, text: d.error ?? "Failed to save." })
      }
    })
  }

  const existingKeys = reasons.map(r => r.key)

  return (
    <>
      {/* ── Modals ── */}
      {editTarget !== null && (
        <ReasonModal
          initial={editTarget === "new" ? undefined : editTarget}
          existingKeys={existingKeys}
          onSave={handleSaveReason}
          onClose={closeModal}
        />
      )}

      <div className="space-y-8 max-w-2xl">

        {/* ── Where timing lives now ── */}
        <section className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-2xl p-5">
          <h2 className="text-sm font-bold text-sky-800 dark:text-sky-300 uppercase tracking-wider mb-1">Timing threshold</h2>
          <p className="text-xs text-sky-700 dark:text-sky-300 leading-relaxed">
            There is <b>one timer number per user</b>, set in <b>Admin → Users → (user) → Scan timer</b> — that is the only
            place timing lives. The lot timer turns red after that many minutes, and the idle question appears when a
            cataloguer <b>starts a new lot</b> after a longer gap than that since their last one. Idle time only counts
            <b> working hours (Mon–Fri, 9:00–17:00)</b>; gaps of a full working day or more (holidays, days off) are
            skipped silently.
          </p>
        </section>

        {/* ── Reasons ── */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Idle Reasons</h2>
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-xs font-bold rounded-lg transition-colors">
              + Add Reason
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
            These appear in the idle popup. Drag the arrows to reorder. "Requires note" forces staff to explain before submitting.
          </p>

          {reasons.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              No reasons configured. Add one above.
            </div>
          )}

          <div className="space-y-2">
            {reasons.map((r, i) => (
              <div key={r.key}
                className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 group">

                {/* Reorder */}
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => moveUp(i)} disabled={i === 0}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 leading-none text-xs px-1">▲</button>
                  <button onClick={() => moveDown(i)} disabled={i === reasons.length - 1}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 leading-none text-xs px-1">▼</button>
                </div>

                {/* Badge preview */}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0 ${r.colour}`}>
                  {r.icon} {r.label}
                </span>

                {/* Key */}
                <code className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">{r.key}</code>

                {/* Requires notes badge */}
                {r.requiresNotes && (
                  <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                    note required
                  </span>
                )}

                <div className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(r)}
                    className="text-xs text-[#2AB4A6] hover:text-[#1a8a80] font-semibold px-2 py-1 rounded hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors">
                    Edit
                  </button>
                  <button onClick={() => deleteReason(r.key)}
                    className="text-xs text-red-500 hover:text-red-700 font-semibold px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Save bar ── */}
        <div className="flex items-center gap-4 pb-8">
          <button onClick={save} disabled={isPending}
            className="px-6 py-2.5 bg-[#2AB4A6] hover:bg-[#22a090] disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm">
            {isPending ? "Saving…" : "Save Settings"}
          </button>
          {saveMsg && (
            <span className={`text-sm font-medium ${saveMsg.ok ? "text-green-600" : "text-red-500"}`}>
              {saveMsg.ok ? "✓ " : "✗ "}{saveMsg.text}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
