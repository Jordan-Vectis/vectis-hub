import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { conditionMailboxConfigured, conditionMailboxAddress } from "@/lib/condition-mailbox"
import ConditionReportsClient from "./conditions-client"

export const dynamic = "force-dynamic"

function isoDate(d: Date | null): string | null {
  if (!d) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

export default async function ConditionReportsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const isAdmin = session.user.role === "ADMIN"

  const [reports, users, auctions, mailbox] = await Promise.all([
    prisma.conditionReport.findMany({
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.catalogueAuction.findMany({
      orderBy: [{ auctionDate: "desc" }, { createdAt: "desc" }],
      select:  { id: true, code: true, name: true, auctionDate: true },
      take:    150,
    }),
    prisma.conditionMailboxAuth.findUnique({ where: { id: "global" }, select: { connectedBy: true, lastSyncAt: true } }),
  ])

  const reportsPlain = reports.map(r => ({
    id:             r.id,
    subject:        r.subject,
    body:           r.body,
    fromName:       r.fromName,
    fromEmail:      r.fromEmail,
    fromPhone:      r.fromPhone,
    navId:          r.navId,
    status:         r.status,
    source:         r.source,
    webLink:        r.webLink,
    lotUrl:         r.lotUrl,
    lotNumber:      r.lotNumber,
    auctionId:      r.auctionId,
    auctionLabel:   r.auctionLabel,
    auctionDate:    isoDate(r.auctionDate),
    assignedToId:   r.assignedToId,
    assignedToName: r.assignedToName,
    receivedLabel:  (r.receivedAt ?? r.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
  }))

  const auctionsPlain = auctions.map(a => ({
    id:    a.id,
    code:  a.code,
    name:  a.name,
    date:  isoDate(a.auctionDate),
  }))

  return (
    <ConditionReportsClient
      reports={reportsPlain}
      users={users}
      auctions={auctionsPlain}
      isAdmin={isAdmin}
      mailbox={{
        configured:    conditionMailboxConfigured(),
        address:       conditionMailboxAddress(),
        connected:     !!mailbox,
        connectedBy:   mailbox?.connectedBy ?? null,
        lastSyncLabel: mailbox?.lastSyncAt
          ? mailbox.lastSyncAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
          : null,
      }}
    />
  )
}
