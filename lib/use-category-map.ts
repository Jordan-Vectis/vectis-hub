import { useEffect, useState } from "react"
import { DEFAULT_CATEGORY_MAP } from "@/lib/lot-categories"

// Client hook: returns the live category → subcategory map from the DB
// (/api/catalogue/categories), falling back to the bundled default instantly so
// the dropdowns never render empty. Managed at /admin/categories.
export function useCategoryMap(): Record<string, string[]> {
  const [map, setMap] = useState<Record<string, string[]>>(DEFAULT_CATEGORY_MAP)
  useEffect(() => {
    fetch("/api/catalogue/categories")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.map && Object.keys(j.map).length) setMap(j.map) })
      .catch(() => {})
  }, [])
  return map
}
