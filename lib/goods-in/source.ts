import type { Prisma } from "@/app/generated/prisma/client"

// Where a Goods In receipt or tote came from (2026-10-23 — Jordan: BC's warehouse records in the
// Hub's own tables "ready for a transition so one day that is taken over in the hub", like
// customers). `source` is "bc" for a row the nightly copy made from Business Central; null or "hub"
// for one booked in the Hub. Plain module — no Prisma client, so screens can import it too.

export const FROM_BC = "bc"
export const isFromBc = (source: string | null | undefined) => source === FROM_BC

/** Rows booked in the Hub itself — the dashboard's figures and the number series' "last given" read these. */
export const HUB_MADE: Prisma.GoodsInReceiptWhereInput = { OR: [{ source: null }, { source: { not: FROM_BC } }] }
export const HUB_MADE_CONTAINER: Prisma.GoodsInContainerWhereInput = { OR: [{ source: null }, { source: { not: FROM_BC } }] }

/** What Goods In says when someone tries to change a BC row before switch day. */
export const BC_OWNS_WAREHOUSE_MESSAGE =
  "This was booked in Business Central, and BC is in charge of it until the Hub takes over — make the change in BC; the Hub's copy follows at the next copy."

/** The copy's name in WarehouseSyncLog. */
export const BC_MIRROR_SOURCE = "goods_in_mirror"
