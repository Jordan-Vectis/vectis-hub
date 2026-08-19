import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess, type AppKey } from "@/lib/apps"
import { ensureTrainingSeed } from "@/lib/actions/training"
import {
  loadTrainingModule, loadTrainingSlides, loadTrainingExercises, loadMyTrainingProgress,
} from "@/lib/training-data"
import ModuleClient from "./module-client"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const m = await loadTrainingModule(key)
  return { title: m ? `${m.title} — Training` : "Training" }
}

export default async function TrainingModulePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  const isAdmin = dbUser?.role === "ADMIN"

  await ensureTrainingSeed()

  const m = await loadTrainingModule(key)
  if (!m) notFound()
  // A hidden course is hidden from the people being trained, not from the person writing it.
  if (!m.active && !isAdmin) notFound()

  const [slides, exercises, progress] = await Promise.all([
    loadTrainingSlides(m.id, { activeOnly: !isAdmin }),
    loadTrainingExercises(m.id, { activeOnly: !isAdmin }),
    loadMyTrainingProgress(session.user.id),
  ])

  const mine = progress.find(p => p.moduleId === m.id)

  return (
    <ModuleClient
      module={m}
      slides={slides}
      exercises={exercises}
      // The practice tab runs the real panel, so it needs the panel's own permission.
      canOpenPanel={m.appKey
        ? hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], m.appKey as AppKey)
        : true}
      isAdmin={isAdmin}
      deckRead={!!mine?.deckDoneAt}
      passedIds={mine?.passedIds ?? []}
      completed={!!mine?.completedAt}
    />
  )
}
