import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { hasAppAccess, type AppKey } from "@/lib/apps"
import { APP_CARD_DEFS, SECTION_DEFS } from "@/lib/app-cards"
import { ensureTrainingSeed } from "@/lib/actions/training"
import { loadTrainingModules, loadMyTrainingProgress } from "@/lib/training-data"
import TrainingHome, { type HomeModule } from "./training-home"

export const dynamic = "force-dynamic"
export const metadata = { title: "Training" }

// IT & Admin → Training. A course per panel of the Hub.
//
// Open to everyone signed in, on purpose: this is where somebody learns a tool, and putting
// the tool's own permission in front of its training is how people never get trained on it.
// What a course does show is whether you can currently open the panel it teaches, so nobody
// finishes a course and then finds the button missing.
export default async function TrainingPage() {
  const session = await getEffectiveSession()
  if (!session) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where:  { id: session.user.id },
    select: { role: true, allowedApps: true },
  })
  const isAdmin = dbUser?.role === "ADMIN"

  await ensureTrainingSeed()

  const [modules, progress] = await Promise.all([
    loadTrainingModules({ activeOnly: !isAdmin }),
    loadMyTrainingProgress(session.user.id),
  ])

  // Which Hub section each panel sits in, so the courses are grouped the way the Hub already
  // groups the tools. Read off the card definitions rather than stored on the module — one
  // source of truth, and a card that moves section moves its course with it.
  const sectionOf = new Map(APP_CARD_DEFS.map(c => [c.key, c.group ?? ""]))
  const sectionLabel = new Map(SECTION_DEFS.map(sd => [sd.key as string, sd.label]))
  const doneBy = new Map(progress.map(p => [p.moduleId, p]))

  const rows: HomeModule[] = modules.map(m => {
    const p = doneBy.get(m.id)
    return {
      ...m,
      section:      sectionLabel.get(sectionOf.get(m.key) ?? "") ?? "Other",
      canOpenPanel: m.appKey
        ? hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], m.appKey as AppKey)
        : true,
      deckRead:  !!p?.deckDoneAt,
      passed:    p?.passedIds.length ?? 0,
      completed: !!p?.completedAt,
    }
  })

  return <TrainingHome modules={rows} isAdmin={isAdmin} />
}
