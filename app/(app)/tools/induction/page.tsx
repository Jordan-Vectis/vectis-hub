import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { ensureInductionSeed } from "@/lib/actions/induction"
import { loadInductionSlides, loadInductionLiveData } from "@/lib/induction-data"
import InductionClient from "./induction-client"

export const dynamic = "force-dynamic"

async function loadForms() {
  try {
    return await prisma.inductionForm.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { items: { orderBy: { sortOrder: "asc" } } },
    })
  } catch { return [] }
}

async function loadSignatures() {
  try {
    // Newest first. The signature PNGs are pulled in too — they are what the Records tab
    // shows, and there are only ever a few hundred of these.
    return await prisma.inductionSignature.findMany({ orderBy: { signedAt: "desc" }, take: 500 })
  } catch { return [] }
}

export default async function InductionPage() {
  await ensureInductionSeed()

  const [session, slides, forms, signatures, live] = await Promise.all([
    getEffectiveSession(),
    loadInductionSlides(),
    loadForms(),
    loadSignatures(),
    loadInductionLiveData(),
  ])

  // Who is holding the tablet — recorded against every signature, and shown on the signing
  // screen so it is obvious the record is being taken by a member of staff.
  const dbUser = session
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true, email: true, role: true } })
    : null
  const isAdmin     = dbUser?.role === "ADMIN"
  const takenByName = dbUser?.name || dbUser?.email || "a member of staff"

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <Link href="/hub" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-3 inline-flex items-center gap-1">← Hub</Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📋 Induction</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
          Run the health and safety induction on the big screen, then hand the tablet over for the forms to be read and
          signed. The slides listing first aiders, kits and defibrillators read the{" "}
          <Link href="/tools/first-aid" className="text-green-600 hover:underline">First Aid</Link> records as they are
          presented, so they cannot go out of date.
        </p>
      </div>

      <InductionClient
        slides={slides}
        forms={forms.map(f => ({
          id: f.id, key: f.key, title: f.title, intro: f.intro, body: f.body, declaration: f.declaration,
          askCompany: f.askCompany, askJobTitle: f.askJobTitle, askStartDate: f.askStartDate, askNotes: f.askNotes,
          active: f.active, sortOrder: f.sortOrder,
          items: f.items.map(i => ({ id: i.id, label: i.label, detail: i.detail, required: i.required, sortOrder: i.sortOrder })),
        }))}
        signatures={signatures.map(sg => ({
          id: sg.id, formId: sg.formId, formTitle: sg.formTitle, personName: sg.personName,
          company: sg.company, jobTitle: sg.jobTitle, startDate: sg.startDate, notes: sg.notes,
          signature: sg.signature, takenByName: sg.takenByName, signedAt: sg.signedAt.toISOString(),
          items: sg.items,
        }))}
        live={live}
        isAdmin={isAdmin}
        takenByName={takenByName}
      />
    </div>
  )
}
