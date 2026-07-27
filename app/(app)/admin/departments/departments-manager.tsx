"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AUCTION_TYPES } from "@/lib/auction-types"
import { createDepartment, updateDepartment, deleteDepartment } from "@/lib/actions/admin"

export type DepartmentRow = {
  id: string
  name: string
  auctionTypes: string[]
  members: { id: string; name: string; role: string }[]
}

type Props = {
  departments: DepartmentRow[]
  typeCounts: Record<string, number>
  migrated: boolean
}

export default function DepartmentsManager({ departments, typeCounts, migrated }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  // Which department currently claims each sale type — a type belongs to one.
  const ownerOf = new Map<string, DepartmentRow>()
  for (const d of departments) for (const t of d.auctionTypes) ownerOf.set(t, d)

  const unassignedTypes = AUCTION_TYPES.filter(t => !ownerOf.has(t.value))

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, id?: string) {
    setError(null)
    setBusyId(id ?? null)
    startTransition(async () => {
      const res = await fn()
      setBusyId(null)
      if (!res.ok) { setError(res.error ?? "Something went wrong."); return }
      router.refresh()
    })
  }

  function addDepartment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    run(async () => {
      const res = await createDepartment(fd)
      if (res.ok) setNewName("")
      return res
    })
  }

  function toggleType(dept: DepartmentRow, type: string) {
    const next = dept.auctionTypes.includes(type)
      ? dept.auctionTypes.filter(t => t !== type)
      : [...dept.auctionTypes, type]
    run(() => updateDepartment(dept.id, { auctionTypes: next }), dept.id)
  }

  function saveRename(dept: DepartmentRow) {
    const name = renameValue.trim()
    if (!name || name === dept.name) { setRenaming(null); return }
    run(async () => {
      const res = await updateDepartment(dept.id, { name })
      if (res.ok) setRenaming(null)
      return res
    }, dept.id)
  }

  function remove(dept: DepartmentRow) {
    const staff = dept.members.length
    const warning = staff > 0
      ? `Delete "${dept.name}"? ${staff} ${staff === 1 ? "person" : "people"} will be unassigned and will go back to seeing every sale.`
      : `Delete "${dept.name}"?`
    if (!confirm(warning)) return
    run(() => deleteDepartment(dept.id), dept.id)
  }

  function salesFor(dept: DepartmentRow) {
    return dept.auctionTypes.reduce((sum, t) => sum + (typeCounts[t] ?? 0), 0)
  }

  return (
    <div>
      {!migrated && (
        <div className="mb-4 rounded-xl border border-amber-400 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          The department tables aren&apos;t in the database yet, so sale types and staff can&apos;t be
          saved. Run the migrations from the banner on Admin, then come back.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-400 dark:border-red-700/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Add + unassigned sale types */}
      <div className="flex flex-wrap items-start gap-4 mb-6">
        <form onSubmit={addDepartment} className="flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">New department</label>
            <input
              name="name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              required
              placeholder="e.g. Diecast"
              className="w-56 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {isPending && busyId === null ? "Adding…" : "Add"}
          </button>
        </form>

        {unassignedTypes.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Sale types not covered by any department
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unassignedTypes.map(t => (
                <span key={t.value} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {t.emoji} {t.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {departments.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-8 text-center">
          No departments yet. Add one above.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map(dept => (
            <div
              key={dept.id}
              className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 transition-opacity ${busyId === dept.id ? "opacity-50" : ""}`}
            >
              {/* Name */}
              <div className="flex items-start justify-between gap-2 mb-3">
                {renaming === dept.id ? (
                  <div className="flex items-center gap-1.5 flex-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") saveRename(dept)
                        if (e.key === "Escape") setRenaming(null)
                      }}
                      className="flex-1 min-w-0 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button onClick={() => saveRename(dept)} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">Save</button>
                    <button onClick={() => setRenaming(null)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                  </div>
                ) : (
                  <>
                    <h2 className="font-semibold text-gray-900 dark:text-white truncate">{dept.name}</h2>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => { setRenaming(dept.id); setRenameValue(dept.name); setError(null) }}
                        className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => remove(dept)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Counts */}
              <div className="flex items-center gap-4 mb-4 text-xs text-gray-500 dark:text-gray-400">
                <span><span className="font-semibold text-gray-800 dark:text-gray-200">{dept.members.length}</span> staff</span>
                <span><span className="font-semibold text-gray-800 dark:text-gray-200">{salesFor(dept)}</span> sales</span>
              </div>

              {/* Sale types */}
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Sale types covered</p>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {AUCTION_TYPES.map(t => {
                  const mine  = dept.auctionTypes.includes(t.value)
                  const owner = ownerOf.get(t.value)
                  const takenByOther = !!owner && owner.id !== dept.id
                  return (
                    <button
                      key={t.value}
                      onClick={() => toggleType(dept, t.value)}
                      disabled={!migrated || isPending}
                      title={takenByOther ? `Currently covered by ${owner!.name} — ticking this moves it here` : undefined}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                        mine
                          ? "bg-blue-50 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 text-blue-700 dark:text-blue-300 font-medium"
                          : takenByOther
                            ? "bg-transparent border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500"
                            : "bg-transparent border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400"
                      }`}
                    >
                      {t.emoji} {t.label}
                      {mine && typeCounts[t.value] ? <span className="ml-1 opacity-70">({typeCounts[t.value]})</span> : null}
                      {takenByOther && <span className="ml-1 opacity-70">· {owner!.name}</span>}
                    </button>
                  )
                })}
              </div>

              {/* Members */}
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Staff</p>
              {dept.members.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Nobody yet — add people from their user page.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {dept.members.map(m => (
                    <span key={m.id} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
