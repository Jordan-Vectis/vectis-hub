"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"

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
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif"]
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

async function savePhoto(file: File | null, folder: string): Promise<string | undefined> {
  if (!file || file.size === 0) return undefined
  // ⚠ These photos are served by the PUBLIC proxy, same origin as the Hub. An SVG or HTML file
  // picked here would execute for whoever opened it, so the type is checked on the way IN as
  // well as on the way out. accept="image/*" in the form lets SVG through — this does not.
  if (!PHOTO_TYPES.includes((file.type || "").toLowerCase())) {
    throw new Error("That file type is not allowed — use a JPEG, PNG, WEBP or HEIC photo.")
  }
  if (file.size > MAX_PHOTO_BYTES) throw new Error("That photo is too big — 8MB is the limit.")
  const buf = Buffer.from(await file.arrayBuffer())
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  return uploadBufferToR2(buf, `first-aid/${folder}/${Date.now()}-${safe}`, file.type)
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
    // ⚠ Remove the photo from R2 as well. It is served by the PUBLIC proxy, so leaving it
    // behind means a former employee's face stays fetchable by anyone, for ever.
    const row = await prisma.firstAider.findUnique({ where: { id }, select: { photoKey: true } })
    if (row?.photoKey) await deleteObjectsFromR2([row.photoKey]).catch(() => {})
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
    const row = await prisma.firstAidKit.findUnique({ where: { id }, select: { photoKey: true } })
    if (row?.photoKey) await deleteObjectsFromR2([row.photoKey]).catch(() => {})
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
    // TypeScript does not survive the network boundary — a crafted call could write any string,
    // and the row would then be neither "not yet looked at" nor handled.
    if (status !== "NEW" && status !== "REVIEWED") return { ok: false, error: "Unknown status" }
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

// Part 4 of the accident book — EMPLOYER ONLY. Never on the public form; only reachable here,
// behind the login and the FIRST_AID permission, exactly as the paper book reserves that
// section to the employer. `recordedBy` defaults to whoever signs it off.
export async function saveAccidentReportEmployer(id: string, fd: FormData): Promise<Res> {
  try {
    const who = await requireFirstAid()
    const reported = s(fd.get("reportedOn"), 40)
    const when = reported ? new Date(reported) : null
    const riddor = s(fd.get("riddorReportable"), 10)
    await prisma.accidentReport.update({
      where: { id },
      data: {
        reportedOn:       when && !Number.isNaN(when.getTime()) ? when : null,
        recordedBy:       s(fd.get("recordedBy"), 100) || who.name,
        // Three states on purpose: yes, no, and "not decided yet" (null) — an undecided RIDDOR
        // question must not look like a considered "no".
        riddorReportable: riddor === "yes" ? true : riddor === "no" ? false : null,
        riddorRef:        s(fd.get("riddorRef"), 100) || null,
        employerNotes:    s(fd.get("employerNotes"), 4000) || null,
        // Completing the employer part IS the sign-off.
        status:           "REVIEWED",
        handledBy:        who.name,
        handledAt:        new Date(),
      },
    })
    revalidatePath("/tools/first-aid")
    return { ok: true }
  } catch (e) { return fail(e) }
}
