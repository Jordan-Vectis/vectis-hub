import { notFound, redirect } from "next/navigation"
import { getEffectiveSession } from "@/lib/impersonation"
import { loadTrainingModule, loadTrainingSlides } from "@/lib/training-data"
import TrainingPresenter from "./presenter"

export const dynamic = "force-dynamic"

// The deck on the big screen. Only ACTIVE slides — unticking a slide in the editor is how you
// take something out of the running order without deleting it.
export default async function TrainingPresentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  const m = await loadTrainingModule(key)
  if (!m) notFound()

  const slides = await loadTrainingSlides(m.id, { activeOnly: true })
  return <TrainingPresenter moduleKey={m.key} title={m.title} slides={slides} />
}
