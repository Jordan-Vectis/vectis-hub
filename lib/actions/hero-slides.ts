"use server"

import { prisma } from "@/lib/prisma"
import { revalidatePath } from "next/cache"

export type HeroSlideRow = {
  id: string; order: number; title: string; subtitle: string; cta: string; ctaHref: string
  imageKey: string | null; imageFocus: string | null; active: boolean; createdAt: Date; updatedAt: Date
}

// Which part of the picture stays when it is cropped to the banner; anything else is stored as null (centre).
const FOCUS = new Set(["top", "center", "bottom"])
const focus = (v: unknown) => (typeof v === "string" && FOCUS.has(v) ? v : null)

const COLS = { id: true, order: true, title: true, subtitle: true, cta: true, ctaHref: true, imageKey: true, active: true, createdAt: true, updatedAt: true } as const

export async function getHeroSlides(): Promise<HeroSlideRow[]> {
  try {
    return await prisma.heroSlide.findMany({ orderBy: { order: "asc" }, select: { ...COLS, imageFocus: true } })
  } catch {
    // imageFocus arrives with Run Migrations (2026-09-24); until then the slides are read without it.
    const rows = await prisma.heroSlide.findMany({ orderBy: { order: "asc" }, select: COLS })
    return rows.map(r => ({ ...r, imageFocus: null }))
  }
}

export async function createHeroSlide(data: {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey?: string | null
  imageFocus?: string | null
  order?: number
}) {
  const maxOrder = await prisma.heroSlide.aggregate({ _max: { order: true } })
  await prisma.heroSlide.create({
    data: {
      ...data,
      imageFocus: focus(data.imageFocus),
      order: data.order ?? (maxOrder._max.order ?? -1) + 1,
    },
  })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function updateHeroSlide(
  id: string,
  data: Partial<{
    title: string
    subtitle: string
    cta: string
    ctaHref: string
    imageKey: string | null
    imageFocus: string | null
    active: boolean
    order: number
  }>
) {
  await prisma.heroSlide.update({ where: { id }, data: { ...data, ...("imageFocus" in data ? { imageFocus: focus(data.imageFocus) } : {}) } })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function deleteHeroSlide(id: string) {
  await prisma.heroSlide.delete({ where: { id } })
  revalidatePath("/")
  revalidatePath("/website/banner")
}

export async function reorderHeroSlides(ids: string[]) {
  await Promise.all(
    ids.map((id, i) => prisma.heroSlide.update({ where: { id }, data: { order: i } }))
  )
  revalidatePath("/")
  revalidatePath("/website/banner")
}
