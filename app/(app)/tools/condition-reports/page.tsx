import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { conditionMailboxConfigured, conditionMailboxAddress } from "@/lib/condition-mailbox"
import { lookupLotCataloguer } from "@/lib/condition-bc"
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
    prisma.conditionMailboxAuth.findUnique({ where: { id: "global" }, select: { connectedBy: true, lastSyncAt: true, folderId: true, folderName: true } }),
  ])

  // Live BC lookup per report: who catalogued the lot + where it sits.
  // auctionCode is stored going forward; for older reports derive it from the lot link.
  const codeFromUrl = (url: string | null) => url?.match(/\/bidding\/([A-Za-z]+\d+)/)?.[1]?.toUpperCase() ?? null
  const bcByReport = new Map<string, Awaited<ReturnType<typeof lookupLotCataloguer>>>()
  await Promise.all(reports.map(async r => {
    bcByReport.set(r.id, await lookupLotCataloguer(r.auctionCode ?? codeFromUrl(r.lotUrl), r.lotNumber))
  }))

  const reportsPlain = reports.map(r => {
    const bc = bcByReport.get(r.id)
    return {
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
    notified:       !!r.notifiedAt,
    receivedLabel:  (r.receivedAt ?? r.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    // Business Central — cataloguer + location for this lot
    bcFound:           bc?.found ?? false,
    bcCataloguerName:  bc?.cataloguerName ?? null,
    bcCataloguerEmail: bc?.cataloguerEmail ?? null,
    bcCataloguerCode:  bc?.cataloguerCode ?? null,
    bcLocation:        bc?.location ?? null,
    bcTote:            bc?.toteNo ?? null,
    bcGone:            bc?.gone ?? false,
    }
  })

  const auctionsPlain = auctions.map(a => ({
    id:    a.id,
    code:  a.code,
    name:  a.name,
    date:  isoDate(a.auctionDate),
  }))

  const inboundSecret = process.env.CONDITION_INBOUND_SECRET
  const appUrl = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"
  const inboundUrl = isAdmin && inboundSecret ? `${appUrl}/api/condition-reports/inbound?key=${inboundSecret}` : null

  return (
    <ConditionReportsClient
      reports={reportsPlain}
      users={users}
      auctions={auctionsPlain}
      isAdmin={isAdmin}
      inboundUrl={inboundUrl}
      mailbox={{
        configured:    conditionMailboxConfigured(),
        address:       conditionMailboxAddress(),
        connected:     !!mailbox,
        connectedBy:   mailbox?.connectedBy ?? null,
        folderId:      mailbox?.folderId ?? null,
        folderName:    mailbox?.folderName ?? null,
        lastSyncLabel: mailbox?.lastSyncAt
          ? mailbox.lastSyncAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
          : null,
      }}
    />
  )
}
