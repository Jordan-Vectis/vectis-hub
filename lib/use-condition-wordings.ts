import { useEffect, useState } from "react"
import { DEFAULT_WORDINGS } from "@/lib/condition"

// Client hook: returns the live box/packaging wording presets from the DB
// (/api/catalogue/condition-wordings), falling back to the built-in defaults instantly so the
// wording picker never renders empty. Managed at /admin/condition-wording.
export function useConditionWordings(): string[] {
  const [wordings, setWordings] = useState<string[]>(DEFAULT_WORDINGS)
  useEffect(() => {
    fetch("/api/catalogue/condition-wordings")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (Array.isArray(j?.wordings) && j.wordings.length) setWordings(j.wordings) })
      .catch(() => {})
  }, [])
  return wordings
}
