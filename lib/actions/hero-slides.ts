"use server"

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { revalidatePath } from "next/cache"
import { parseSlideStyle, type SlideStyle } from "@/app/(site)/hero-style"

export type HeroSlideRow = {
  id: string; order: number; title: string; subtitle: string; cta: string; ctaHref: string
  imageKey: string | null; imageFocus: string | null
  /** The look as stored (JSON) — parseSlideStyle() turns it into a SlideStyle. */
  style: unknown
  active: boolean; createdAt: Date; updatedAt: Date
}

// Which part of the picture stays when it is cropped to the banner; anything else is stored as null (centre).
const FOCUS = new Set(["top", "center", "bottom"])
const focus = (v: unknown) => (typeof v === "string" && FOCUS.has(v) ? v : null)
// The look is validated on the way in, so the row only ever holds what the site can render.
const styleJson = (v: SlideStyle) => parseSlideStyle(v) as unknown as Prisma.InputJsonValue

const COLS = { id: true, order: true, title: true, subtitle: true, cta: true, ctaHref: true, imageKey: true, active: true, createdAt: true, updatedAt: true } as const

export async function getHeroSlides(): Promise<HeroSlideRow[]> {
  try {
    return await prisma.heroSlide.findMany({ orderBy: { order: "asc" }, select: { ...COLS, imageFocus: true, style: true } })
  } catch {
    // imageFocus and style arrive with Run Migrations (2026-09-24); until then the slides are read without them.
    const rows = await prisma.heroSlide.findMany({ orderBy: { order: "asc" }, select: COLS })
    return rows.map(r => ({ ...r, imageFocus: null, style: null }))
  }
}

export async function createHeroSlide(data: {
  title: string
  subtitle: string
  cta: string
  ctaHref: string
  imageKey?: string | null
  imageFocus?: string | null
  style?: SlideStyle | null
  order?: number
}) {
  const { imageFocus, style, ...rest } = data
  const maxOrder = await prisma.heroSlide.aggregate({ _max: { order: true } })
  await prisma.heroSlide.create({
    data: {
      ...rest,
      imageFocus: focus(imageFocus),
      style: style ? styleJson(style) : undefined,
      order: rest.order ?? (maxOrder._max.order ?? -1) + 1,
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
    style: SlideStyle | null
    active: boolean
    order: number
  }>
) {
  const { imageFocus, style, ...rest } = data
  await prisma.heroSlide.update({
    where: { id },
    data: {
      ...rest,
      ...(imageFocus !== undefined ? { imageFocus: focus(imageFocus) } : {}),
      ...(style !== undefined ? { style: style ? styleJson(style) : Prisma.JsonNull } : {}),
    },
  })
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
