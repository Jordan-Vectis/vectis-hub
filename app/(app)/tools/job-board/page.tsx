import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import BoardClient from "./board-client"

export default async function JobBoardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const jobs = await prisma.iTJob.findMany({
    orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
  })

  const jobsPlain = jobs.map((j) => ({
    id:        j.id,
    title:     j.title,
    body:      j.body,
    fromName:  j.fromName,
    fromEmail: j.fromEmail,
    status:    j.status,
    source:    j.source,
    webLink:   j.webLink,
    date: (j.receivedAt ?? j.createdAt).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    }),
  }))

  // Inbound email webhook — emails forwarded to an inbound-mail service POST here.
  const secret = process.env.IT_INBOUND_SECRET
  const appUrl = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"
  const inboundUrl = secret ? `${appUrl}/api/it-mailbox/inbound?key=${secret}` : null

  return <BoardClient jobs={jobsPlain} inboundUrl={inboundUrl} />
}
