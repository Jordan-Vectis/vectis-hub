"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { getEffectiveSession } from "@/lib/impersonation"
import { isSlideLayout, isSlideGraphic, isExerciseKind } from "@/lib/training"
import { MODULE_SEEDS, BUILT_IN_COURSES, builtInCourse } from "@/lib/training-seed"

// IT & Admin → Training.
//
// READING a course is open to everyone signed in — the whole point is that anybody can teach
// themselves a panel. WRITING one is admin-only: a lesson is the thing people are told to
// believe, so it carries the same weight as a rule.
//
// Actions RETURN their error rather than throwing — production redacts thrown server-action
// messages (RULES.md), and "an error occurred in the Server Components render" tells the
// person editing a slide nothing at all.

type Res = { ok: true } | { ok: false; error: string }
const fail = (e: any): Res => ({ ok: false, error: e?.message ?? "Something went wrong" })
const s = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max)
const nul = (v: string) => (v ? v : null)

async function requireSignedIn() {
  const session = await getEffectiveSession()
  if (!session) throw new Error("Not signed in")
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id }, select: { role: true, name: true, email: true },
  })
  return {
    id:     session.user.id,
    name:   dbUser?.name || dbUser?.email || "Unknown",
    isAdmin: dbUser?.role === "ADMIN",
  }
}

async function requireAdmin() {
  const me = await requireSignedIn()
  if (!me.isAdmin) throw new Error("Only an admin can change training content")
  return me
}

function refresh(key?: string) {
  revalidatePath("/tools/training")
  if (key) {
    revalidatePath(`/tools/training/${key}`)
    revalidatePath(`/tools/training/${key}/present`)
  }
}

// ─── Seeding ────────────────────────────────────────────────────────────────
// Only ever runs against a COMPLETELY EMPTY table, exactly like the induction deck: once an
// environment has been seeded, editing lib/training-seed.ts changes nothing there.

// Any bigint constant will do — it just has to be the same on every caller. Two people opening
// the tool at once on a fresh environment would otherwise both find an empty table and both
// seed it, leaving a duplicate course for every panel in the Hub to delete by hand.
const SEED_LOCK = 5127_2026

export async function ensureTrainingSeed(): Promise<void> {
  try {
    await requireSignedIn()
  } catch {
    return
  }
  try {
    await prisma.$transaction(async tx => {
      // Held until the transaction ends, so the check-then-write below is atomic across tabs,
      // devices and the two server instances.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${SEED_LOCK})`)

      // ⚠ Checked PER MODULE by key, not by counting the table. Counting meant that if the
      // first module was created and a later one failed for any reason, the table was no
      // longer empty and the missing course could never seed again, silently.
      for (const [i, m] of MODULE_SEEDS.entries()) {
        if (await tx.trainingModule.count({ where: { key: m.key } })) continue
        await tx.trainingModule.create({
          data: {
            key: m.key, title: m.title, icon: m.icon, blurb: m.blurb,
            href: m.href, appKey: m.appKey, accent: m.accent, sortOrder: (i + 1) * 10,
          },
        })
      }

      // The courses that ship written. Guarded on the module having NO slides rather than on
      // the module being new, so an environment seeded before a course existed still picks it
      // up — but one where somebody has already written a slide is never touched.
      for (const [key, course] of Object.entries(BUILT_IN_COURSES)) {
        const mod = await tx.trainingModule.findUnique({ where: { key }, select: { id: true } })
        if (!mod) continue
        if ((await tx.trainingSlide.count({ where: { moduleId: mod.id } })) === 0 && course.slides.length) {
          await tx.trainingSlide.createMany({
            data: course.slides.map((sl, i) => ({
              moduleId: mod.id,
              title: sl.title, subtitle: sl.subtitle ?? null, body: sl.body ?? null,
              layout: sl.layout ?? "CONTENT", graphic: sl.graphic ?? "NONE",
              tryHref: sl.tryHref ?? null, tryLabel: sl.tryLabel ?? null,
              notes: sl.notes ?? null, sortOrder: (i + 1) * 10,
            })),
          })
        }
        if ((await tx.trainingExercise.count({ where: { moduleId: mod.id } })) === 0 && course.exercises.length) {
          await tx.trainingExercise.createMany({
            data: course.exercises.map((ex, i) => ({
              moduleId: mod.id,
              title: ex.title, brief: ex.brief, panel: ex.panel ?? null, kind: ex.kind,
              params: (ex.params ?? {}) as object,
              expected: ex.expected ?? null, hint: ex.hint ?? null, explain: ex.explain ?? null,
              sortOrder: (i + 1) * 10,
            })),
          })
        }
      }
    })
  } catch {
    // Pre-migration this table does not exist. The tool then shows "no courses yet" with the
    // Run Migrations hint, which is the honest state — not a 500.
  }
}

/**
 * Replace a course's content with the built-in version shipped in the code.
 *
 * ⚠ This exists because the seed only ever writes into an EMPTY table. That is the right
 * default — it is what stops a deploy quietly undoing somebody's edits — but it also means an
 * environment seeded last month can never pick up a lesson improved since. So refreshing is a
 * deliberate, admin-only, confirmed action rather than something a deploy does.
 *
 * ⚠ It DELETES the course's current slides and tasks. Anything written in the app is lost, which
 * is exactly why the button asks twice. Progress rows are left alone: a person who passed a task
 * that no longer exists simply stops being counted against it, rather than losing their record.
 */
export async function restoreBuiltInCourse(moduleKey: string): Promise<Res> {
  try {
    await requireAdmin()
    const course = builtInCourse(moduleKey)
    if (!course) return { ok: false, error: "There is no built-in course for this panel — nothing to restore to." }

    const mod = await prisma.trainingModule.findUnique({ where: { key: moduleKey }, select: { id: true } })
    if (!mod) return { ok: false, error: "That course no longer exists" }

    await prisma.$transaction(async tx => {
      await tx.trainingSlide.deleteMany({ where: { moduleId: mod.id } })
      await tx.trainingExercise.deleteMany({ where: { moduleId: mod.id } })
      await tx.trainingSlide.createMany({
        data: course.slides.map((sl, i) => ({
          moduleId: mod.id,
          title: sl.title, subtitle: sl.subtitle ?? null, body: sl.body ?? null,
          layout: sl.layout ?? "CONTENT", graphic: sl.graphic ?? "NONE",
          tryHref: sl.tryHref ?? null, tryLabel: sl.tryLabel ?? null,
          notes: sl.notes ?? null, sortOrder: (i + 1) * 10,
        })),
      })
      await tx.trainingExercise.createMany({
        data: course.exercises.map((ex, i) => ({
          moduleId: mod.id,
          title: ex.title, brief: ex.brief, panel: ex.panel ?? null, kind: ex.kind,
          params: (ex.params ?? {}) as object,
          expected: ex.expected ?? null, hint: ex.hint ?? null, explain: ex.explain ?? null,
          sortOrder: (i + 1) * 10,
        })),
      })
    })
    refresh(moduleKey)
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Modules ────────────────────────────────────────────────────────────────

export async function saveTrainingModule(form: FormData): Promise<Res> {
  try {
    await requireAdmin()
    const id    = s(form.get("id"), 40)
    const title = s(form.get("title"), 120)
    if (!title) return { ok: false, error: "Give the course a title" }

    const data = {
      title,
      icon:   s(form.get("icon"), 8) || "📘",
      blurb:  nul(s(form.get("blurb"), 600)),
      href:   nul(s(form.get("href"), 200)),
      accent: s(form.get("accent"), 20) || "indigo",
      active: form.get("active") === "on",
    }

    if (id) {
      const row = await prisma.trainingModule.update({ where: { id }, data, select: { key: true } })
      refresh(row.key)
    } else {
      const key = s(form.get("key"), 60).toUpperCase().replace(/[^A-Z0-9]+/g, "_")
      if (!key) return { ok: false, error: "Give the course a key — it is how the URL finds it" }
      if (await prisma.trainingModule.count({ where: { key } })) {
        return { ok: false, error: `There is already a course with the key ${key}` }
      }
      const last = await prisma.trainingModule.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } })
      await prisma.trainingModule.create({ data: { ...data, key, sortOrder: (last?.sortOrder ?? 0) + 10 } })
      refresh(key)
    }
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Slides ─────────────────────────────────────────────────────────────────

export async function saveTrainingSlide(form: FormData): Promise<Res> {
  try {
    await requireAdmin()
    const id       = s(form.get("id"), 40)
    const moduleId = s(form.get("moduleId"), 40)
    const title    = s(form.get("title"), 200)
    if (!title) return { ok: false, error: "A slide needs a title" }

    const layout  = s(form.get("layout"), 20)
    const graphic = s(form.get("graphic"), 20)
    const data = {
      title,
      subtitle: nul(s(form.get("subtitle"), 300)),
      body:     nul(s(form.get("body"), 6000)),
      videoUrl: nul(s(form.get("videoUrl"), 400)),
      layout:   isSlideLayout(layout) ? layout : "CONTENT",
      graphic:  isSlideGraphic(graphic) ? graphic : "NONE",
      tryHref:  nul(s(form.get("tryHref"), 200)),
      tryLabel: nul(s(form.get("tryLabel"), 60)),
      notes:    nul(s(form.get("notes"), 3000)),
      active:   form.get("active") === "on",
    }

    const key = s(form.get("moduleKey"), 60)
    if (id) {
      await prisma.trainingSlide.update({ where: { id }, data })
    } else {
      if (!moduleId) return { ok: false, error: "Missing the course this slide belongs to" }
      const last = await prisma.trainingSlide.findFirst({
        where: { moduleId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true },
      })
      await prisma.trainingSlide.create({ data: { ...data, moduleId, sortOrder: (last?.sortOrder ?? 0) + 10 } })
    }
    refresh(key)
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteTrainingSlide(id: string, moduleKey: string): Promise<Res> {
  try {
    await requireAdmin()
    await prisma.trainingSlide.delete({ where: { id } })
    refresh(moduleKey)
    return { ok: true }
  } catch (e) { return fail(e) }
}

/**
 * Move a slide one place up or down. Swaps the two sortOrders rather than renumbering the
 * deck, so two people reordering at once cannot collapse everything onto one number.
 */
export async function moveTrainingSlide(id: string, dir: "up" | "down", moduleKey: string): Promise<Res> {
  try {
    await requireAdmin()
    const me = await prisma.trainingSlide.findUnique({ where: { id }, select: { id: true, moduleId: true, sortOrder: true } })
    if (!me) return { ok: false, error: "That slide has already been deleted" }
    const neighbour = await prisma.trainingSlide.findFirst({
      where: {
        moduleId:  me.moduleId,
        sortOrder: dir === "up" ? { lt: me.sortOrder } : { gt: me.sortOrder },
      },
      orderBy: { sortOrder: dir === "up" ? "desc" : "asc" },
      select:  { id: true, sortOrder: true },
    })
    if (!neighbour) return { ok: true }   // already at the end — not an error
    await prisma.$transaction([
      prisma.trainingSlide.update({ where: { id: me.id },        data: { sortOrder: neighbour.sortOrder } }),
      prisma.trainingSlide.update({ where: { id: neighbour.id }, data: { sortOrder: me.sortOrder } }),
    ])
    refresh(moduleKey)
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Exercises ──────────────────────────────────────────────────────────────

export async function saveTrainingExercise(form: FormData): Promise<Res> {
  try {
    await requireAdmin()
    const id       = s(form.get("id"), 40)
    const moduleId = s(form.get("moduleId"), 40)
    const title    = s(form.get("title"), 200)
    const brief    = s(form.get("brief"), 2000)
    if (!title) return { ok: false, error: "Give the task a title" }
    if (!brief) return { ok: false, error: "Write what the trainee is being asked to do" }

    const kindRaw = s(form.get("kind"), 30)
    const kind    = isExerciseKind(kindRaw) ? kindRaw : "FREE_TEXT"

    // params is a small typed object rather than free JSON — a text box where an admin can
    // paste anything is a text box that will one day hold something the marker cannot read.
    const params: Record<string, unknown> = {}
    if (kind === "CHOICE") {
      const options = [0, 1, 2, 3]
        .map(i => s(form.get(`option${i}`), 200))
        .filter(Boolean)
      if (options.length < 2) return { ok: false, error: "A multiple choice needs at least two options" }
      const correct = Number(s(form.get("correct"), 3) || "0")
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) {
        return { ok: false, error: "Tick which option is the right one" }
      }
      params.options = options
      params.correct = correct
    } else if (kind === "FREE_TEXT") {
      const expected = s(form.get("expectedAnswer"), 300)
      if (!expected) return { ok: false, error: "A typed-answer task needs the answer to mark against" }
      params.q = expected
    } else {
      // Live kinds. FIXED pins the task to one lot; PICK is the default and the one that
      // cannot go stale.
      const mode = s(form.get("mode"), 10) === "FIXED" ? "FIXED" : "PICK"
      params.mode = mode
      if (mode === "FIXED") {
        const q = s(form.get("fixedQ"), 60)
        if (!q) return { ok: false, error: "Pinned to one lot, but no number was given" }
        params.q = q
      }
      const type = s(form.get("type"), 10)
      if (type === "receipt" || type === "tote" || type === "vendor") params.type = type
      const min = Number(s(form.get("min"), 4))
      if (Number.isInteger(min) && min > 0) params.min = min
    }

    const data = {
      title, brief, kind,
      panel:   nul(s(form.get("panel"), 20)),
      params:  params as object,
      hint:    nul(s(form.get("hint"), 1000)),
      explain: nul(s(form.get("explain"), 2000)),
      active:  form.get("active") === "on",
    }

    const key = s(form.get("moduleKey"), 60)
    if (id) {
      await prisma.trainingExercise.update({ where: { id }, data })
    } else {
      if (!moduleId) return { ok: false, error: "Missing the course this task belongs to" }
      const last = await prisma.trainingExercise.findFirst({
        where: { moduleId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true },
      })
      await prisma.trainingExercise.create({ data: { ...data, moduleId, sortOrder: (last?.sortOrder ?? 0) + 10 } })
    }
    refresh(key)
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteTrainingExercise(id: string, moduleKey: string): Promise<Res> {
  try {
    await requireAdmin()
    await prisma.trainingExercise.delete({ where: { id } })
    refresh(moduleKey)
    return { ok: true }
  } catch (e) { return fail(e) }
}

// ─── Progress ───────────────────────────────────────────────────────────────

/**
 * Record that someone has read to the end of a deck. Called from the reader, not the
 * presenter — the presenter is one person driving a room, and stamping the presenter as
 * "trained" while twenty people watch is a record that says the wrong thing.
 */
export async function markDeckRead(moduleId: string, slidesSeen: number): Promise<Res> {
  try {
    const me = await requireSignedIn()
    const now = new Date()
    await prisma.trainingProgress.upsert({
      where:  { userId_moduleId: { userId: me.id, moduleId } },
      create: { userId: me.id, moduleId, userName: me.name, slidesSeen, deckDoneAt: now, lastAt: now },
      update: { userName: me.name, slidesSeen, deckDoneAt: now, lastAt: now },
    })
    return { ok: true }
  } catch (e) { return fail(e) }
}
