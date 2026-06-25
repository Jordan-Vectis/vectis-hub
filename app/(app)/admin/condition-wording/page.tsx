import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { readWordings } from "@/lib/condition-wordings-db"
import WordingsManager from "./condition-wording-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Condition Wording" }

export default async function ConditionWordingPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  const rows = await readWordings()
  const wordings = rows.map((r) => ({ id: r.id, label: r.label }))

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Condition Wording</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          The wording presets for the separate box / packaging condition (e.g. &ldquo;Box is&rdquo;, &ldquo;Carded Back is&rdquo;).
          A grade is added after the wording, so it reads e.g. &ldquo;Carded Back is Mint&rdquo;. Cataloguers can still type a
          one-off &ldquo;Custom&rdquo; wording per lot. Changes apply everywhere lots are catalogued; existing lots keep their text.
        </p>
      </div>
      <WordingsManager wordings={wordings} />
    </div>
  )
}
