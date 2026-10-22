"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { twoFactorTableExists } from "@/lib/two-factor"

type Result = { ok: boolean; error?: string }

async function admin() {
  const session = await auth()
  return session?.user?.role === "ADMIN" ? session : null
}

/** The "Require two-factor" tick box. Unticking keeps their set-up, so ticking again needs no new QR. */
export async function setTwoFactorRequired(userId: string, required: boolean): Promise<Result> {
  try {
    const session = await admin()
    if (!session) return { ok: false, error: "Only admins can change two-factor." }
    if (!(await twoFactorTableExists())) return { ok: false, error: "Two-factor needs Run Migrations first." }
    await prisma.userTwoFactor.upsert({
      where: { userId },
      create: { userId, required, updatedByName: session.user.name },
      update: { required, updatedByName: session.user.name },
    })
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true }
  } catch (e: any) {
    console.error("setTwoFactorRequired error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}

/** Lost phone: forget their authenticator, backup codes and remembered devices — they set up afresh. */
export async function resetTwoFactor(userId: string): Promise<Result> {
  try {
    const session = await admin()
    if (!session) return { ok: false, error: "Only admins can reset two-factor." }
    if (!(await twoFactorTableExists())) return { ok: false, error: "Two-factor needs Run Migrations first." }
    await prisma.userTwoFactor.updateMany({
      where: { userId },
      data: { secret: null, enabledAt: null, backupCodes: [], lastStep: null, updatedByName: session.user.name },
    })
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true }
  } catch (e: any) {
    console.error("resetTwoFactor error:", e)
    return { ok: false, error: e?.message ?? "Unknown error" }
  }
}
