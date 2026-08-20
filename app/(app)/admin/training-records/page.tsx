import Link from "next/link"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import TrainingRecordsClient, { type SignatureRow } from "./training-records-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Training Records" }

// Admin → Training Records. Who has signed to say they were trained, on what, and when.
//
// ⚠ Every value shown is read off the SIGNATURE row, never joined back to the course. The course
// is editable and deletable; the record of what somebody signed must not move when it changes.
//
// Try/caught: the table only exists after Run Migrations.

async function loadSignatures(): Promise<SignatureRow[]> {
  try {
    const rows = await prisma.trainingSignature.findMany({
      orderBy: { signedAt: "desc" },
      take:    1000,
      select: {
        id: true, userName: true, userEmail: true, moduleKey: true, moduleTitle: true,
        slidesTotal: true, tasksTotal: true, tasksPassed: true,
        declaration: true, signature: true, signedAt: true,
      },
    })
    return rows.map(r => ({
      id: r.id, userName: r.userName, userEmail: r.userEmail,
      moduleKey: r.moduleKey, moduleTitle: r.moduleTitle,
      slidesTotal: r.slidesTotal, tasksTotal: r.tasksTotal, tasksPassed: r.tasksPassed,
      declaration: r.declaration, signature: r.signature,
      signedAt: r.signedAt.toISOString(),
    }))
  } catch { return [] }
}

export default async function TrainingRecordsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { role: true },
  })
  if (dbUser?.role !== "ADMIN") redirect("/hub")

  const rows = await loadSignatures()

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <Link href="/admin" className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 mb-3 inline-flex items-center gap-1">← Admin</Link>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">✍️ Training Records</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
        Every signed acknowledgement that somebody has been trained on a part of the Hub. Signing
        happens at the end of a course, once all its practice tasks have been passed.
      </p>
      <TrainingRecordsClient rows={rows} />
    </div>
  )
}
