"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { uploadBufferToR2 } from "@/lib/r2"

// Everything a first aider or kit row holds is shown on the PUBLIC page, so every write here
// needs the FIRST_AID app permission. Actions RETURN their error rather than throwing —
// production redacts thrown server-action messages (RULES.md).
async function requireFirstAid() {
  const session = await getEffectiveSession()
  if (!session) throw new Error("Not signed in")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "FIRST_AID")) throw new Error("No access to First Aid")
  return { name: dbUser?.name || dbUser?.email || "Unknown" }
}

type Res = { ok: true } | { ok: false; error: string }
const fail = (e: any): Res => ({ ok: false, error: e?.message ?? "Something went wrong" })
const s = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max)

// Photos land under first-aid/, the prefix /api/public/photo is allowed to serve — anything
// else would 404 on the public page.
async function savePhoto(file: File | null, folder: string): Promise<string | undefined> {
  if (!file || file.size === 0) return undefined
  const buf = Buffer.from(await file.arrayBuffer())
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  return uploadBufferToR2(buf, `first-aid/${folder}/${Date.now()}-${safe}`, file.type || "image/jpeg")
}

export async function saveFirstAider(fd: FormData): Promise<Res> {
  try {
    await requireFirstAid()
    const id       = s(fd.get("id"), 40)
    const photoKey = await savePhoto(fd.get("photo") as File | null, "aiders")
    const data = {
      name:      s(fd.get("name"), 100),
      roleTitle: s(fd.get("roleTitle"), 100) || null,
      location:  s(fd.get("location"), 150)  || null,
      phone:     s(fd.get("phone"), 40)      || null,
      sortOrder: Number(fd.get("sortOrder") ?? 0) || 0,
      active:    fd.get("active") === "on",
      ...(photoKey ? { photoKey } : {}),
    }
    if (!data.name) return { ok: false, error: "A name is needed." }
    if (id) await prisma.firstAider.update({ where: { id }, data })
    else    await prisma.firstAider.create({ data })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteFirstAider(id: string): Promise<Res> {
  try {
    await requireFirstAid()
    await prisma.firstAider.delete({ where: { id } })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function saveFirstAidKit(fd: FormData): Promise<Res> {
  try {
    await requireFirstAid()
    const id       = s(fd.get("id"), 40)
    const photoKey = await savePhoto(fd.get("photo") as File | null, "kits")
    const kind     = s(fd.get("kind"), 20)
    const data = {
      kind:      ["KIT", "DEFIB", "EYEWASH", "OTHER"].includes(kind) ? kind : "KIT",
      label:     s(fd.get("label"), 120),
      whereText: s(fd.get("whereText"), 300) || null,
      sortOrder: Number(fd.get("sortOrder") ?? 0) || 0,
      active:    fd.get("active") === "on",
      ...(photoKey ? { photoKey } : {}),
    }
    if (!data.label) return { ok: false, error: "A label is needed." }
    if (id) await prisma.firstAidKit.update({ where: { id }, data })
    else    await prisma.firstAidKit.create({ data })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteFirstAidKit(id: string): Promise<Res> {
  try {
    await requireFirstAid()
    await prisma.firstAidKit.delete({ where: { id } })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function saveFirstAidInfo(fd: FormData): Promise<Res> {
  try {
    await requireFirstAid()
    const data = {
      emergencySteps: s(fd.get("emergencySteps"), 4000) || null,
      siteAddress:    s(fd.get("siteAddress"), 500)     || null,
      assemblyPoint:  s(fd.get("assemblyPoint"), 200)   || null,
      extraNotes:     s(fd.get("extraNotes"), 4000)     || null,
    }
    await prisma.firstAidInfo.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: data })
    revalidatePath("/tools/first-aid"); revalidatePath("/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Accident reports are only ever READ and marked off in here — the public page never sees them.
export async function setAccidentReportStatus(id: string, status: "NEW" | "REVIEWED"): Promise<Res> {
  try {
    const who = await requireFirstAid()
    await prisma.accidentReport.update({
      where: { id },
      data: status === "REVIEWED"
        ? { status, handledBy: who.name, handledAt: new Date() }
        : { status, handledBy: null, handledAt: null },
    })
    revalidatePath("/tools/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}
