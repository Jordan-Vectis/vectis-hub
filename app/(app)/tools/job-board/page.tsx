import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import BoardClient from "./board-client"

export default async function JobBoardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const [jobs, itStaff, allUsers] = await Promise.all([
    prisma.iTJob.findMany({
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.user.findMany({ where: { isITStaff: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true, isITStaff: true }, orderBy: { name: "asc" } }),
  ])

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
    date: (j.receivedAt ?? j.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    messages: j.messages.map((m) => ({
      id:         m.id,
      kind:       m.kind,
      authorName: m.authorName,
      body:       m.body,
      when:       m.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
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
