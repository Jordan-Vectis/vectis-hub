"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { logLotFieldChanges } from "@/lib/lot-log"

async function requireAuth() {
  const session = await auth()
  if (!session) throw new Error("Not authenticated")
  return session
}

// ── Contacts ───────────────────────────────────────────────────────────────

export async function updateContactDb(id: string, data: {
  name?: string; email?: string; phone?: string
  notes?: string; isBuyer?: boolean; isSeller?: boolean
}) {
  await requireAuth()
  await prisma.contact.update({ where: { id }, data })
  revalidatePath("/databases")
}

// ── Receipts ───────────────────────────────────────────────────────────────

export async function updateReceiptDb(id: string, data: {
  commissionRate?: number; notes?: string; status?: string
}) {
  await requireAuth()
  await prisma.warehouseReceipt.update({ where: { id }, data })
  revalidatePath("/databases")
}

// ── Containers / Totes ─────────────────────────────────────────────────────

export async function updateContainerDb(id: string, data: {
  type?: string; description?: string; category?: string; subcategory?: string
}) {
  await requireAuth()
  await prisma.warehouseContainer.update({ where: { id }, data })
  revalidatePath("/databases")
}

export async function moveContainerDb(containerId: string, locationCode: string, notes?: string) {
  const session = await requireAuth()
  const movedByName = session.user?.name ?? session.user?.email ?? "Unknown"

  // Verify location exists — create it if not (allow freeform codes)
  await prisma.warehouseLocation.upsert({
    where:  { code: locationCode },
    update: {},
    create: { code: locationCode },
  })

  await prisma.warehouseMovement.create({
    data: { containerId, locationCode, notes: notes || null, movedByName },
  })

  revalidatePath("/databases")
  revalidatePath("/tools/warehouse")
}

// ── Lots ───────────────────────────────────────────────────────────────────

export async function updateLotDb(id: string, data: {
  barcode?: string | null
  title?: string
  description?: string
  auctionId?: string
  vendor?: string | null
  receipt?: string | null
  tote?: string | null
  category?: string | null
  subCategory?: string | null
  condition?: string | null
  notes?: string | null
  brand?: string | null
  estimateLow?: number | null
  estimateHigh?: number | null
  reserve?: number | null
  hammerPrice?: number | null
  status?: string
}) {
  const session = await requireAuth()
  const old = await prisma.catalogueLot.findUnique({
    where: { id },
    select: {
      id: true, auctionId: true, barcode: true, title: true,
      vendor: true, receipt: true, tote: true, category: true, subCategory: true,
      condition: true, notes: true, brand: true, estimateLow: true, estimateHigh: true,
      reserve: true, hammerPrice: true, status: true, auction: { select: { code: true } },
    },
  })
  await prisma.catalogueLot.update({ where: { id }, data })
  if (old) {
    await logLotFieldChanges(
      old, data,
      { id: old.id, auctionId: old.auctionId, barcode: old.barcode, title: old.title },
      old.auction?.code ?? "",
      { changedBy: session.user.name ?? session.user.email ?? "Unknown", source: "admin_db" },
    )
  }
  revalidatePath("/databases")
}
