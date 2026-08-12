"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"

// The site plan is shown on the PUBLIC first aid page, so the drawing and its name are
// world-readable — never upload a plan holding anything confidential.

type Res = { ok: true } | { ok: false; error: string }
const fail = (e: any): Res => ({ ok: false, error: e?.message ?? "Something went wrong" })
const s = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max)

async function requireSitePlan() {
  const session = await getEffectiveSession()
  if (!session) throw new Error("Not signed in")
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "SITE_PLAN")) throw new Error("No access to Site Plan")
}

// Marking up the plan belongs to whoever owns that equipment — a first aider should not need
// the Site Plan permission to say where a defibrillator is.
async function requireFirstAid() {
  const session = await getEffectiveSession()
  if (!session) throw new Error("Not signed in")
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { allowedApps: true, role: true } })
  if (!hasAppAccess(u?.role ?? "", u?.allowedApps ?? [], "FIRST_AID")) throw new Error("No access to First Aid")
}

const PLAN_TYPES = ["image/jpeg", "image/png", "image/webp"]
const MAX_PLAN_BYTES = 12 * 1024 * 1024

export async function saveSitePlan(fd: FormData): Promise<Res> {
  try {
    await requireSitePlan()
    const id   = s(fd.get("id"), 40)
    const name = s(fd.get("name"), 120)
    if (!name) return { ok: false, error: "Give the plan a name." }

    const file = fd.get("image") as File | null
    let imageKey: string | undefined
    if (file && file.size > 0) {
      // ⚠ Served by the PUBLIC photo proxy, same origin as the Hub — an SVG or HTML here would
      // execute for whoever opened it. PDFs are refused too: pins have to sit on a plain image.
      if (!PLAN_TYPES.includes((file.type || "").toLowerCase())) {
        return { ok: false, error: "The plan must be a PNG, JPG or WEBP image — export it from the PDF first." }
      }
      if (file.size > MAX_PLAN_BYTES) return { ok: false, error: "That image is too big — 12MB is the limit." }
      const buf  = Buffer.from(await file.arrayBuffer())
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      imageKey = await uploadBufferToR2(buf, `site-plans/${Date.now()}-${safe}`, file.type)
    }
    if (!id && !imageKey) return { ok: false, error: "Choose the plan image to upload." }

    const data = { name, active: fd.get("active") === "on", sortOrder: Number(fd.get("sortOrder") ?? 0) || 0, ...(imageKey ? { imageKey } : {}) }
    if (id) await prisma.sitePlan.update({ where: { id }, data })
    else    await prisma.sitePlan.create({ data: { ...data, imageKey: imageKey! } })

    revalidatePath("/tools/site-plan"); revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteSitePlan(id: string): Promise<Res> {
  try {
    await requireSitePlan()
    const row = await prisma.sitePlan.findUnique({ where: { id }, select: { imageKey: true } })
    if (row?.imageKey) await deleteObjectsFromR2([row.imageKey]).catch(() => {})
    // Clear the pins that pointed at it, or kits keep a position on a plan that no longer exists.
    await prisma.firstAidKit.updateMany({ where: { planId: id }, data: { planId: null, pinX: null, pinY: null } })
    await prisma.sitePlan.delete({ where: { id } })
    revalidatePath("/tools/site-plan"); revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Drop (or move) a first aid kit's pin. x/y are percentages of the image, so the pin lands in
// the same place on a phone, a desk monitor and a printout.
export async function setFirstAidKitPin(kitId: string, planId: string | null, x: number | null, y: number | null): Promise<Res> {
  try {
    await requireFirstAid()
    const clamp = (n: number | null) => n === null ? null : Math.min(100, Math.max(0, Math.round(n * 10) / 10))
    await prisma.firstAidKit.update({
      where: { id: kitId },
      data: planId && x !== null && y !== null
        ? { planId, pinX: clamp(x), pinY: clamp(y) }
        : { planId: null, pinX: null, pinY: null },
    })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}
