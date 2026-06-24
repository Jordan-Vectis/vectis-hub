import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { readCategories } from "@/lib/lot-categories-db"
import CategoriesManager from "./categories-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Categories" }

export default async function CategoriesPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const rows = await readCategories()
  const categories = rows.map((c) => ({
    id: c.id,
    name: c.name,
    subcategories: c.subcategories.map((s) => ({ id: s.id, name: s.name })),
  }))

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cataloguing Categories</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          The category &amp; subcategory list used when cataloguing lots. Changes apply everywhere lots are catalogued. Existing lots keep whatever category they were given.
        </p>
      </div>
      <CategoriesManager categories={categories} />
    </div>
  )
}
