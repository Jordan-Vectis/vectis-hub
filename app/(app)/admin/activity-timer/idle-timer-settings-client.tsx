"use client"

import { useState, useTransition } from "react"
import type { IdleReason } from "@/lib/idle-timer-config"
import { COLOUR_PRESETS, GROUP_SUGGESTIONS, ICON_CHOICES, PLACEHOLDER_ICON, VECTIS_REASONS, suggestReasonMeta } from "@/lib/idle-timer-config"

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
  // No default emoji. Every reason added before this used the old "📝" pre-fill and nobody
  // changed it, so a dozen reasons ended up identical in the popup — starting blank forces
  // a choice, and the picker below makes choosing quicker than typing.
  const [icon,         setIcon]         = useState(initial?.icon         ?? "")
  const [group,        setGroup]        = useState(initial?.group        ?? "")
  const [label,        setLabel]        = useState(initial?.label        ?? "")
  const [requiresNotes,setRequiresNotes]= useState(initial?.requiresNotes ?? false)
  const [notePrompt,   setNotePrompt]   = useState(initial?.notePrompt    ?? "")
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
    onSave({ key: derivedKey, label: label.trim(), icon: icon.trim() || "•", requiresNotes, colour, idleColour,
             notePrompt: notePrompt.trim() || undefined, group: group.trim() || undefined })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900 dark:text-white mb-5">
          {initial ? "Edit Reason" : "Add Reason"}
        </h3>

        {/* Icon — pick one, or type your own */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Symbol</label>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-14 h-14 shrink-0 flex items-center justify-center text-3xl rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            {icon || <span className="text-xs text-gray-400 font-normal">none</span>}
          </div>
          <input value={icon} onChange={e => setIcon(e.target.value)} maxLength={4}
            placeholder="or paste any emoji"
            className="flex-1 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-lg bg-gray-50 dark:bg-gray-800 text-center focus:outline-none focus:border-[#2AB4A6]" />
        </div>
        <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 p-2 space-y-2">
          {ICON_CHOICES.map(row => (
            <div key={row.group}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{row.group}</p>
              <div className="flex flex-wrap gap-1">
                {row.icons.map(ic => (
                  <button key={ic} type="button" onClick={() => setIcon(ic)} title={ic}
                    className={`w-9 h-9 rounded-lg text-xl flex items-center justify-center transition-all ${
                      icon === ic ? "ring-2 ring-[#2AB4A6] bg-[#2AB4A6]/10" : "hover:bg-gray-100 dark:hover:bg-gray-800"
                    }`}>{ic}</button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Group — the heading this reason sits under in the popup */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Group</label>
        <input value={group} onChange={e => setGroup(e.target.value)} list="idle-group-suggestions"
          placeholder="e.g. Breaks — leave blank to sit on its own at the bottom"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white mb-1 focus:outline-none focus:border-[#2AB4A6]" />
        <datalist id="idle-group-suggestions">
          {GROUP_SUGGESTIONS.map(g => <option key={g} value={g} />)}
        </datalist>
        <p className="text-xs text-gray-400 mb-4">
          Reasons sharing a group appear together under that heading. Groups run in the order they
          first appear in the list below, so drag a reason to move its whole group.
        </p>

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

        {/* Follow-up question (optional) */}
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Follow-up question (optional)</label>
        <input value={notePrompt} onChange={e => setNotePrompt(e.target.value)}
          placeholder={'e.g. "Who for?"'}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white mb-1 focus:outline-none focus:border-[#2AB4A6]" />
        <p className="text-xs text-gray-400 mb-6">Shown as the prompt on the note field when this reason is picked. Turn on &ldquo;Requires a note&rdquo; above to make the answer mandatory.</p>

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

export default function IdleTimerSettingsClient({ initialReasons, initialMessage }: { initialReasons: IdleReason[]; initialMessage?: string }) {
  const [reasons,    setReasons]    = useState<IdleReason[]>(initialReasons)
  // Optional note shown above the reasons in the popup. Empty = no banner at all.
  const [message,    setMessage]    = useState<string>(initialMessage ?? "")

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

  // Fill in what was never chosen: a reason still on the old "📝" default (or with no symbol)
  // gets a suggested one, and a reason with no group gets a suggested group. Anything already
  // set by hand is left completely alone, and nothing saves until Save is pressed.
  const fillable = reasons.filter(r => {
    const s = suggestReasonMeta(r.label)
    const needsIcon  = (!r.icon?.trim() || r.icon === PLACEHOLDER_ICON) && !!s.icon
    const needsGroup = !r.group?.trim() && !!s.group
    return needsIcon || needsGroup
  }).length

  function fillSuggestions() {
    setReasons(prev => prev.map(r => {
      const s = suggestReasonMeta(r.label)
      const icon  = (!r.icon?.trim() || r.icon === PLACEHOLDER_ICON) && s.icon ? s.icon : r.icon
      const group = !r.group?.trim() && s.group ? s.group : r.group
      return { ...r, icon, group }
    }))
    setSaveMsg(null)
  }

  // Replace the list with the full set Vectis actually runs, symbols and groups already set.
  // Staging and production are separate databases, so a fresh environment starts on the six
  // starter reasons — this makes it match the real thing in one click for testing. Nothing is
  // written until Save, so it is always reversible by reloading the page.
  function loadFullList() {
    setReasons(VECTIS_REASONS.map(r => ({ ...r })))
    setSaveMsg({ ok: true, text: `Loaded all ${VECTIS_REASONS.length} activity reasons — press Save to apply them.` })
  }

  // ── Save to DB ──
  function save() {
    setSaveMsg(null)
    start(async () => {
      const res = await fetch("/api/admin/idle-timer-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasons, message }),
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
            place timing lives. The lot timer turns red after that many minutes, and the activity question appears when a
            cataloguer <b>starts a new lot</b> after a longer gap than that since their last one. This time only counts
            <b> working hours (Mon–Fri, 9:00–17:00)</b>; gaps of a full working day or more (holidays, days off) are
            skipped silently.
          </p>
        </section>

        {/* ── Optional message shown at the top of the popup ── */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider mb-1">Message to cataloguers</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Shown in an amber banner above the reasons, every time the popup appears. Leave it empty
            and no banner is shown at all. Use it for something that applies this week — a deadline, a
            reminder to log a particular job — and clear it when it no longer applies.
          </p>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} maxLength={400}
            placeholder="e.g. Stocktake this week — please log time under Laying Out."
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-[#2AB4A6]" />
          <div className="flex items-center justify-between mt-1">
            <p className="text-xs text-gray-400">{message.trim() ? `${message.trim().length}/400` : "No banner will be shown."}</p>
            {message.trim() && (
              <button onClick={() => setMessage("")} className="text-xs text-gray-500 hover:text-red-500">Clear message</button>
            )}
          </div>
        </section>

        {/* ── Reasons ── */}
        <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Activity Reasons</h2>
            <div className="flex items-center gap-2">
              {reasons.length < VECTIS_REASONS.length && (
                <button onClick={loadFullList}
                  title="Replaces the list below with the full set Vectis runs, symbols and groups already set. Nothing is written until you press Save."
                  className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#2AB4A6] hover:text-[#2AB4A6] text-xs font-bold rounded-lg transition-colors">
                  ⬇ Load the full list ({VECTIS_REASONS.length})
                </button>
              )}
              {fillable > 0 && (
                <button onClick={fillSuggestions}
                  title="Only fills reasons with no symbol or no group — anything you have set yourself is left alone"
                  className="px-3 py-1.5 border border-[#2AB4A6] text-[#2AB4A6] hover:bg-[#2AB4A6]/10 text-xs font-bold rounded-lg transition-colors">
                  ✨ Fill in {fillable} missing symbol{fillable === 1 ? "" : "s"} / group{fillable === 1 ? "" : "s"}
                </button>
              )}
              <button onClick={openAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2AB4A6] hover:bg-[#22a090] text-white text-xs font-bold rounded-lg transition-colors">
                + Add Reason
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">
            These appear in the activity popup. Drag the arrows to reorder. &ldquo;Requires note&rdquo; forces staff to explain before submitting.
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

                {/* Group — blank means it sits ungrouped at the bottom of the popup */}
                {r.group?.trim()
                  ? <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{r.group}</span>
                  : <span className="text-xs text-amber-600 dark:text-amber-500 shrink-0">no group</span>}

                {/* Key */}
                <code className="text-xs text-gray-400 dark:text-gray-500 hidden sm:block">{r.key}</code>

                {/* Requires notes badge */}
                {r.requiresNotes && (
                  <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                    note required
                  </span>
                )}

                {/* Follow-up question */}
                {r.notePrompt && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 italic hidden md:block truncate">asks: &ldquo;{r.notePrompt}&rdquo;</span>
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
