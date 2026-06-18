import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import BoardClient from "./board-client"

export default async function JobBoardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const [jobs, itStaff, allUsers] = await Promise.all([
    prisma.iTJob.findMany({
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      include: {
        // Job-level images = the original email's (messageId null). Reply images
        // hang off their own message.
        attachments: { where: { messageId: null }, orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } },
      },
    }),
    prisma.user.findMany({ where: { isITStaff: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true, isITStaff: true }, orderBy: { name: "asc" } }),
  ])

  // Pre-sign every attachment's R2 key (URLs valid 1h) so the client can <img> them directly.
  const allAttachments = jobs.flatMap((j) => [...j.attachments, ...j.messages.flatMap((m) => m.attachments)])
  const urlById = new Map<string, string>()
  await Promise.all(
    allAttachments.map(async (a) => {
      try { urlById.set(a.id, await getSignedImageUrl(a.r2Key)) } catch { /* skip broken keys */ }
    })
  )
  const toImage = (a: { id: string; filename: string }) => ({ id: a.id, filename: a.filename, url: urlById.get(a.id) ?? "" })

  // Rewrite inline cid: image refs in email HTML to signed R2 URLs. Inline images
  // are the attachments carrying a Content-ID; all hang off the job (messageId null),
  // so a job's attachment list resolves cids for the original email and its replies.
  function renderHtml(html: string | null, atts: { id: string; contentId: string | null }[]): string | null {
    if (!html) return null
    let out = html
    for (const a of atts) {
      if (!a.contentId) continue
      const url = urlById.get(a.id)
      if (!url) continue
      out = out.replace(new RegExp("cid:" + a.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), url)
    }
    return out
  }

  // Date-only due info, computed server-side to keep board colours stable (no client/SSR drift).
  const todayUTC = new Date()
  todayUTC.setUTCHours(0, 0, 0, 0)
  function dueInfo(due: Date | null) {
    if (!due) return { dueDate: null as string | null, dueLabel: null as string | null, dueStatus: null as string | null }
    const d = new Date(due)
    d.setUTCHours(0, 0, 0, 0)
    const diffDays = Math.round((d.getTime() - todayUTC.getTime()) / 86400000)
    const dueDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    const short = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
    let dueStatus: string, dueLabel: string
    if (diffDays < 0)       { dueStatus = "overdue"; dueLabel = `Overdue · ${short}` }
    else if (diffDays === 0){ dueStatus = "today";   dueLabel = "Due today" }
    else if (diffDays === 1){ dueStatus = "soon";    dueLabel = "Due tomorrow" }
    else if (diffDays <= 3) { dueStatus = "soon";    dueLabel = `Due ${short}` }
    else                    { dueStatus = "later";   dueLabel = `Due ${short}` }
    return { dueDate, dueLabel, dueStatus }
  }

  const jobsPlain = jobs.map((j) => ({
    id:             j.id,
    title:          j.title,
    body:           j.body,
    fromName:       j.fromName,
    fromEmail:      j.fromEmail,
    status:         j.status,
    source:         j.source,
    webLink:        j.webLink,
    assignedToId:   j.assignedToId,
    assignedToName: j.assignedToName,
    hasNewReply:    j.hasNewReply,
    ...dueInfo(j.dueDate),
    date: (j.receivedAt ?? j.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    // Thumbnails = genuine attachments only (no Content-ID); inline images render in the HTML.
    images: j.attachments.filter((a) => !a.contentId && urlById.has(a.id)).map(toImage),
    bodyHtml: renderHtml(j.bodyHtml, j.attachments),
    messages: j.messages.map((m) => ({
      id:         m.id,
      kind:       m.kind,
      authorName: m.authorName,
      body:       m.body,
      when:       m.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      images:     m.attachments.filter((a) => !a.contentId && urlById.has(a.id)).map(toImage),
      bodyHtml:   renderHtml(m.bodyHtml, j.attachments),
    })),
  }))

  const secret = process.env.IT_INBOUND_SECRET
  const appUrl = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"
  const inboundUrl = secret ? `${appUrl}/api/it-mailbox/inbound?key=${secret}` : null

  return (
    <BoardClient
      jobs={jobsPlain}
      itStaff={itStaff}
      allUsers={allUsers}
      inboundUrl={inboundUrl}
    />
  )
}
