import { headers } from "next/headers"
import { prisma } from "@/lib/prisma"
import { atLeast, getGoodsInUser } from "@/lib/goods-in/access"
import { readCounters } from "@/lib/goods-in/numbers"
import { COUNTER_KEYS, COUNTERS } from "@/lib/goods-in/model"
import { appOrigin, CALLBACK_PATH, graphClientId, mailStatus } from "@/lib/goods-in/mail"
import { Empty, ErrorBox, isMissingTable, NotReady, PageHeader } from "../_components/ui"
import NumberSeries, { type SeriesItem } from "./number-series"
import MailPanel from "./mail-panel"

export const dynamic = "force-dynamic"

// Goods In → Settings (Warehouse admins only). Two things live here:
//  • the NUMBER SERIES — where receipts, totes, pallets and vendor numbers carry on from (set on
//    the day BC stops booking goods in; until receipts and totes are set, booking in refuses);
//  • the EMAIL connection — the receipts mailbox, signed in delegated through Microsoft Graph, and
//    exactly what to ask IT for before it can work.

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ mail?: string; reason?: string }> }) {
  const me = await getGoodsInUser()
  const sp = await searchParams
  const header = <PageHeader title="Goods In settings" back={{ href: "/tools/warehouse", label: "Goods In" }} />

  if (!atLeast(me, "admin")) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        {header}
        <Empty>
          Only a Warehouse admin can change Goods In&apos;s settings — the receipt, tote, pallet and vendor numbering, and the mailbox receipts are emailed from.
          If something here needs changing, ask a Warehouse admin.
        </Empty>
      </div>
    )
  }

  let series: SeriesItem[]
  let mail: Awaited<ReturnType<typeof mailStatus>>
  try {
    const [counters, status, lastReceipt, lastTote, lastPallet] = await Promise.all([
      readCounters(),
      mailStatus(),
      prisma.goodsInReceipt.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true } }),
      prisma.goodsInContainer.findFirst({ where: { kind: "tote" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true } }),
      prisma.goodsInContainer.findFirst({ where: { kind: "pallet" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, createdAt: true } }),
    ])
    mail = status
    const set = new Map(counters.map(c => [c.key, c]))
    const last = { receipt: lastReceipt, tote: lastTote, pallet: lastPallet, vendor: null } as const
    series = COUNTER_KEYS.map(key => {
      const c = set.get(key)
      const l = last[key]
      return {
        key,
        label: COUNTERS[key].label,
        defaultPrefix: COUNTERS[key].prefix,
        defaultWidth: COUNTERS[key].width,
        example: COUNTERS[key].example,
        current: c ? { prefix: c.prefix, next: c.next, width: c.width, nextNumber: c.nextNumber, updatedAt: c.updatedAt?.toISOString() ?? null, updatedBy: c.updatedBy } : null,
        last: l ? { id: l.id, at: l.createdAt.toISOString() } : null,
      }
    })
  } catch (e) {
    if (isMissingTable(e)) return <div className="p-4 sm:p-6 lg:p-8">{header}<NotReady /></div>
    console.error("goods-in settings page:", e)
    return <div className="p-4 sm:p-6 lg:p-8">{header}<ErrorBox>The settings couldn&apos;t be loaded: {String((e as Error)?.message ?? e).slice(0, 200)}</ErrorBox></div>
  }

  const origin = appOrigin(await headers())

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-10">
      <div>
        {header}
        <NumberSeries items={series} />
      </div>
      <MailPanel
        status={{ configured: mail.configured, connected: mail.connected, mailbox: mail.mailbox, connectedBy: mail.connectedBy, missing: mail.missing }}
        redirectUri={`${origin}${CALLBACK_PATH}`}
        origin={origin}
        clientId={graphClientId()}
        flash={sp.mail === "connected" ? { ok: true } : sp.mail === "error" ? { ok: false, reason: (sp.reason ?? "").slice(0, 400) } : null}
      />
    </div>
  )
}
