import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { itMailboxConfigured } from "@/lib/it-mailbox"
import BoardClient from "./board-client"

export default async function JobBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ mb_connected?: string; mb_error?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const sp = await searchParams

  const [jobs, mailbox] = await Promise.all([
    prisma.iTJob.findMany({ orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }] }),
    prisma.iTMailboxAuth.findUnique({
      where:  { id: "global" },
      select: { connectedBy: true, lastSyncAt: true },
    }),
  ])

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

  return (
    <BoardClient
      jobs={jobsPlain}
      configured={itMailboxConfigured()}
      connected={!!mailbox}
      connectedBy={mailbox?.connectedBy ?? null}
      lastSync={mailbox?.lastSyncAt ? mailbox.lastSyncAt.toLocaleString("en-GB") : null}
      mbConnected={sp.mb_connected === "1"}
      mbError={sp.mb_error ?? null}
    />
  )
}
