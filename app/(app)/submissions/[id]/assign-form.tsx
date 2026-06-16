"use client"

import { useState, useTransition } from "react"
import { assignSubmission } from "@/lib/actions/submissions"

interface Props {
  submissionId: string
  departments: { id: string; name: string }[]
  cataloguers: { id: string; name: string; department: { name: string } | null }[]
}

export default function AssignForm({ submissionId, departments, cataloguers }: Props) {
  const [departmentId, setDepartmentId] = useState("")
  const [cataloguerId, setCataloguerId] = useState("")
  const [isPending, startTransition] = useTransition()

  const filteredCataloguers = departmentId
    ? cataloguers.filter((c) => c.department?.name === departments.find((d) => d.id === departmentId)?.name)
    : cataloguers

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!departmentId || !cataloguerId) return
    startTransition(async () => {
      await assignSubmission(submissionId, departmentId, cataloguerId)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Department</label>
        <select
          value={departmentId}
          onChange={(e) => { setDepartmentId(e.target.value); setCataloguerId("") }}
          required
          className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select department...</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-1">Assign to cataloguer</label>
        <select
          value={cataloguerId}
          onChange={(e) => setCataloguerId(e.target.value)}
          required
          disabled={!departmentId}
          className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">Select cataloguer...</option>
          {filteredCataloguers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={isPending || !departmentId || !cataloguerId}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold px-5 py-3 rounded-xl transition-colors disabled:opacity-50"
      >
        {isPending ? "Assigning..." : "Assign"}
      </button>
    </form>
  )
}
