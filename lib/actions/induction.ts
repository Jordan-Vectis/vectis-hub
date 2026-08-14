"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { hasAppAccess } from "@/lib/apps"
import { getEffectiveSession } from "@/lib/impersonation"
import { uploadBufferToR2, deleteObjectsFromR2 } from "@/lib/r2"
import { isLiveBlock, isSlideLayout } from "@/lib/induction"
import { SEED_SLIDES, SEED_FORMS } from "@/lib/induction-seed"

// Facilities → Induction. Everything here is behind the login and the INDUCTION app
// permission: the tablet is signed in as an admin and handed to the person being inducted,
// so the SESSION is always a member of staff, never the signer.
//
// Actions RETURN their error rather than throwing — production redacts thrown server-action
// messages (RULES.md), and "an error occurred in the Server Components render" is no use to
// someone standing over a tablet with a new starter waiting.

type Res = { ok: true } | { ok: false; error: string }
const fail = (e: any): Res => ({ ok: false, error: e?.message ?? "Something went wrong" })
const s = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max)

async function requireInduction() {
  const session = await getEffectiveSession()
  if (!session) throw new Error("Not signed in")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { allowedApps: true, role: true, name: true, email: true },
  })
  if (!hasAppAccess(dbUser?.role ?? "", dbUser?.allowedApps ?? [], "INDUCTION")) throw new Error("No access to Induction")
  const name = dbUser?.name || dbUser?.email || "Unknown"
  return {
    id:   session.user.id,
    name,
    role: dbUser?.role ?? "",
    // ⚠ "Taken by" must name the human who was actually stood there. getEffectiveSession
    // returns the IMPERSONATED user, so without this a record could say it was taken by
    // someone who was nowhere near it — and that is precisely the field an HR panel leans on.
    takenById:   session.isImpersonating ? session.adminId : session.user.id,
    takenByName: session.isImpersonating ? `${session.adminName} (signed in as ${name})` : name,
  }
}

function refresh() {
  revalidatePath("/tools/induction")
  revalidatePath("/tools/induction/present")
}

// ─── Seeding ────────────────────────────────────────────────────────────────
// Only ever runs against a COMPLETELY EMPTY table, exactly like the AI instructions:
// once an environment has been seeded, editing lib/induction-seed.ts changes nothing.
// Called from the page, wrapped so a missing table can never 500 the tool.

// Any bigint constant will do — it just has to be the same on every caller. Two tabs opening
// the tool at once on a fresh environment would otherwise both see an empty table and both
// seed it, leaving 42 slides to delete by hand.
const SEED_LOCK = 8471_2026

export async function ensureInductionSeed(): Promise<void> {
  try {
    // The page renders behind the INDUCTION gate, but this is an exported server action and so
    // is callable by any signed-in user — every other export in this file checks, and so must
    // this one.
    await requireInduction()
  } catch {
    return
  }
  try {
    await prisma.$transaction(async tx => {
      // Held until the transaction ends, so the check-then-write below is atomic across tabs,
      // devices and the two server instances.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SEED_LOCK})`)

      if ((await tx.inductionSlide.count()) === 0) {
        await tx.inductionSlide.createMany({
          data: SEED_SLIDES.map((sl, i) => ({
            title: sl.title, subtitle: sl.subtitle ?? null, body: sl.body ?? null,
            videoUrl: sl.videoUrl ?? null, liveBlock: sl.liveBlock ?? "NONE",
            layout: sl.layout ?? "CONTENT",
            notes: sl.notes ?? null, sortOrder: (i + 1) * 10,
          })),
        })
      }

      // ⚠ Checked PER FORM by key, not by counting the table. Counting meant that if the first
      // form was created and the second failed for any reason, the table was no longer empty
      // and the missing one — the actual H&S sign-off — could never seed again, silently.
      for (const [i, f] of SEED_FORMS.entries()) {
        if (await tx.inductionForm.count({ where: { key: f.key } })) continue
        await tx.inductionForm.create({
          data: {
            key: f.key, title: f.title, intro: f.intro ?? null, body: f.body ?? null,
            declaration: f.declaration ?? null,
            askCompany:   f.askCompany   ?? true,
            askJobTitle:  f.askJobTitle  ?? true,
            askStartDate: f.askStartDate ?? false,
            askNotes:     f.askNotes     ?? false,
            sortOrder: (i + 1) * 10,
            items: { create: f.items.map((label, j) => ({ label, sortOrder: (j + 1) * 10 })) },
          },
        })
      }
    })
  } catch {
    // Table not there yet (code deploys before the SQL runs) — the page shows empty and
    // seeds itself on the next load.
  }
}

// ─── Slides ─────────────────────────────────────────────────────────────────

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/heic", "image/heif"]
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

async function saveSlideImage(file: File | null): Promise<string | undefined> {
  if (!file || file.size === 0) return undefined
  if (!IMAGE_TYPES.includes((file.type || "").toLowerCase())) {
    throw new Error("That file type is not allowed — use a JPEG, PNG, WEBP or HEIC image.")
  }
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is too big — 8MB is the limit.")
  const buf  = Buffer.from(await file.arrayBuffer())
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
  return uploadBufferToR2(buf, `induction/slides/${Date.now()}-${safe}`, file.type)
}

export async function saveInductionSlide(fd: FormData): Promise<Res> {
  try {
    await requireInduction()
    const id       = s(fd.get("id"), 40)
    const live     = s(fd.get("liveBlock"), 30) || "NONE"
    const layout   = s(fd.get("layout"), 30) || "CONTENT"
    // ⚠ Validate BEFORE uploading. Uploading first meant a save rejected for a blank title left
    // the image sitting in R2 with nothing pointing at it, for ever.
    if (!s(fd.get("title"), 150)) return { ok: false, error: "The slide needs a title." }
    const previousKey = id
      ? (await prisma.inductionSlide.findUnique({ where: { id }, select: { imageKey: true } }))?.imageKey ?? null
      : null
    const imageKey = await saveSlideImage(fd.get("image") as File | null)
    const data = {
      title:     s(fd.get("title"), 150),
      subtitle:  s(fd.get("subtitle"), 200) || null,
      body:      s(fd.get("body"), 8000)    || null,
      videoUrl:  s(fd.get("videoUrl"), 500) || null,
      // TypeScript does not survive the network boundary — an unknown value would render
      // as an empty slide with no explanation.
      liveBlock: isLiveBlock(live) ? live : "NONE",
      layout:    isSlideLayout(layout) ? layout : "CONTENT",
      notes:     s(fd.get("notes"), 4000)   || null,
      sortOrder: Number(fd.get("sortOrder") ?? 0) || 0,
      active:    fd.get("active") === "on",
      ...(imageKey ? { imageKey } : {}),
    }
    if (id) await prisma.inductionSlide.update({ where: { id }, data })
    else    await prisma.inductionSlide.create({ data })
    // Replacing an image used to leave the old object behind on every re-upload.
    if (imageKey && previousKey && previousKey !== imageKey) {
      await deleteObjectsFromR2([previousKey]).catch(() => {})
    }
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteInductionSlide(id: string): Promise<Res> {
  try {
    await requireInduction()
    const row = await prisma.inductionSlide.findUnique({ where: { id }, select: { imageKey: true } })
    if (row?.imageKey) await deleteObjectsFromR2([row.imageKey]).catch(() => {})
    await prisma.inductionSlide.delete({ where: { id } })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function clearInductionSlideImage(id: string): Promise<Res> {
  try {
    await requireInduction()
    const row = await prisma.inductionSlide.findUnique({ where: { id }, select: { imageKey: true } })
    if (row?.imageKey) await deleteObjectsFromR2([row.imageKey]).catch(() => {})
    await prisma.inductionSlide.update({ where: { id }, data: { imageKey: null } })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

/**
 * Writes an AI rewrite onto a slide. Separate from saveInductionSlide so the AI path can only
 * ever touch the three text fields — it must not be able to change the layout, the live block,
 * whether the slide is in the running order, or the presenter note.
 */
export async function applyInductionSlideText(id: string, title: string, subtitle: string, body: string): Promise<Res> {
  try {
    await requireInduction()
    const t = String(title ?? "").trim().slice(0, 150)
    if (!t) return { ok: false, error: "The rewrite came back without a title — discard it." }
    await prisma.inductionSlide.update({
      where: { id },
      data: {
        title: t,
        subtitle: String(subtitle ?? "").trim().slice(0, 200) || null,
        body: String(body ?? "").trim().slice(0, 8000) || null,
      },
    })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

/** Swaps sortOrder with the neighbour above/below, so the order is stable and 1-based drag isn't needed on a tablet. */
export async function moveInductionSlide(id: string, dir: "up" | "down"): Promise<Res> {
  try {
    await requireInduction()
    const all = await prisma.inductionSlide.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, sortOrder: true } })
    const i = all.findIndex(r => r.id === id)
    if (i === -1) return { ok: false, error: "That slide no longer exists." }
    const j = dir === "up" ? i - 1 : i + 1
    // The arrows are disabled from the client's own index, so only a stale tab gets here —
    // and "✓ Moved." over a slide that did not move is worse than saying nothing happened.
    if (j < 0 || j >= all.length) return { ok: false, error: "That slide is already at the end — reload the page." }
    // Rewrite the whole run: seeded rows share tidy gaps, but a hand-edited sortOrder can
    // collide, and swapping two equal numbers would silently do nothing.
    const ids = all.map(r => r.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await prisma.$transaction(ids.map((rid, k) =>
      prisma.inductionSlide.update({ where: { id: rid }, data: { sortOrder: (k + 1) * 10 } })
    ))
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Forms ──────────────────────────────────────────────────────────────────

export async function saveInductionForm(fd: FormData): Promise<Res> {
  try {
    await requireInduction()
    const id = s(fd.get("id"), 40)
    const data = {
      title:        s(fd.get("title"), 200),
      intro:        s(fd.get("intro"), 4000)       || null,
      body:         s(fd.get("body"), 20000)       || null,
      declaration:  s(fd.get("declaration"), 4000) || null,
      askCompany:   fd.get("askCompany")   === "on",
      askJobTitle:  fd.get("askJobTitle")  === "on",
      askStartDate: fd.get("askStartDate") === "on",
      askNotes:     fd.get("askNotes")     === "on",
      active:       fd.get("active")       === "on",
      sortOrder:    Number(fd.get("sortOrder") ?? 0) || 0,
    }
    if (!data.title) return { ok: false, error: "The form needs a title." }
    if (id) {
      await prisma.inductionForm.update({ where: { id }, data })
    } else {
      // The key only matters for finding the seeded forms again; a new one gets a slug.
      const base = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "form"
      let key = base
      let n = 2
      while (await prisma.inductionForm.count({ where: { key } })) key = `${base}-${n++}`
      await prisma.inductionForm.create({ data: { ...data, key } })
    }
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ⚠ Deleting a form does NOT delete anything anyone signed — InductionSignature has no
// foreign key to it and carries its own copy of the wording. That is deliberate.
export async function deleteInductionForm(id: string): Promise<Res> {
  try {
    await requireInduction()
    await prisma.inductionForm.delete({ where: { id } })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function saveInductionFormItem(fd: FormData): Promise<Res> {
  try {
    await requireInduction()
    const id     = s(fd.get("id"), 40)
    const formId = s(fd.get("formId"), 40)
    const data = {
      label:     s(fd.get("label"), 1000),
      detail:    s(fd.get("detail"), 2000) || null,
      required:  fd.get("required") === "on",
      sortOrder: Number(fd.get("sortOrder") ?? 0) || 0,
    }
    if (!data.label) return { ok: false, error: "The item needs some wording." }
    if (id) {
      await prisma.inductionFormItem.update({ where: { id }, data })
    } else {
      if (!formId) return { ok: false, error: "No form given." }
      const last = await prisma.inductionFormItem.findFirst({ where: { formId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
      await prisma.inductionFormItem.create({ data: { ...data, formId, sortOrder: data.sortOrder || (last?.sortOrder ?? 0) + 10 } })
    }
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteInductionFormItem(id: string): Promise<Res> {
  try {
    await requireInduction()
    await prisma.inductionFormItem.delete({ where: { id } })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Signing ────────────────────────────────────────────────────────────────

export type SignInput = {
  formId: string
  /** The form's updatedAt as it was when the signing screen rendered. See the check below. */
  formUpdatedAt?: string
  personName: string
  company?: string
  jobTitle?: string
  startDate?: string
  notes?: string
  ticked: string[]        // ids of the items they ticked
  signature: string       // PNG data URL
}

// A signature PNG from the pad is ~10-40KB. The cap is generous but stops a crafted
// call parking megabytes of base64 in a TEXT column.
const MAX_SIGNATURE_CHARS = 600_000

export async function signInductionForm(input: SignInput): Promise<Res> {
  try {
    const who = await requireInduction()

    const name = String(input.personName ?? "").trim().slice(0, 150)
    if (!name) return { ok: false, error: "Please type the name of the person signing." }

    const sig = String(input.signature ?? "")
    if (!sig.startsWith("data:image/png;base64,")) return { ok: false, error: "The signature did not come through — please sign again." }
    if (sig.length > MAX_SIGNATURE_CHARS) return { ok: false, error: "That signature is too large to store." }

    const form = await prisma.inductionForm.findUnique({
      where: { id: String(input.formId ?? "") },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    })
    if (!form) return { ok: false, error: "That form no longer exists — reload the page." }
    if (!form.active) return { ok: false, error: "That form has been switched off — reload the page." }

    // ⚠ The signing screen renders from a copy of the form loaded when the page did, but the
    // snapshot below is taken from the DB now. A tablet left open while someone edits the form
    // on another device would therefore store wording the signer never saw, under their
    // signature. Refuse instead: an unusable form beats a false record.
    const renderedAt = String(input.formUpdatedAt ?? "")
    if (renderedAt && renderedAt !== form.updatedAt.toISOString()) {
      return { ok: false, error: "This form was edited while it was open. Reload the page and take the signature again — nothing has been saved." }
    }

    // Re-check the required ticks HERE, not just in the browser: this is the record that
    // says someone confirmed each point, so it must not be possible to save one without them.
    const tickedIds = new Set(Array.isArray(input.ticked) ? input.ticked.map(String) : [])
    const missing   = form.items.filter(it => it.required && !tickedIds.has(it.id))
    if (missing.length) {
      return { ok: false, error: `${missing.length} item${missing.length === 1 ? " has" : "s have"} not been confirmed yet.` }
    }

    await prisma.inductionSignature.create({
      data: {
        formId: form.id,
        formKey: form.key,
        // Snapshot what was on the screen — the form stays editable, and a record that
        // silently changes meaning afterwards is worth nothing.
        formTitle: form.title,
        bodySnapshot: [form.intro, form.body].filter(Boolean).join("\n\n") || null,
        declarationSnapshot: form.declaration,
        // `required` and `detail` are stored, not just the label: without them a blank line on a
        // printed record cannot be told apart from a point that was skipped.
        items: form.items.map(it => ({
          label: it.label, detail: it.detail ?? null, required: it.required, ticked: tickedIds.has(it.id),
        })),
        personName: name,
        company:   String(input.company   ?? "").trim().slice(0, 150) || null,
        jobTitle:  String(input.jobTitle  ?? "").trim().slice(0, 150) || null,
        startDate: String(input.startDate ?? "").trim().slice(0, 40)  || null,
        notes:     String(input.notes     ?? "").trim().slice(0, 4000) || null,
        signature: sig,
        takenById: who.takenById,
        takenByName: who.takenByName,
      },
    })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}

// Signed records are evidence, so removing one is ADMIN-only — the INDUCTION permission
// is enough to take a signature, never to make one disappear.
export async function deleteInductionSignature(id: string): Promise<Res> {
  try {
    const who = await requireInduction()
    if (who.role !== "ADMIN") return { ok: false, error: "Only an admin can delete a signed record." }
    await prisma.inductionSignature.delete({ where: { id } })
    refresh()
    return { ok: true }
  } catch (e) { return fail(e) }
}
