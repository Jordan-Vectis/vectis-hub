"use server"

import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"
import {
  SETUP_COOKIE, setupCookieUser, readTwoFactor, openSecret, matchTotp, newBackupCodes, hashBackupCode,
} from "@/lib/two-factor"

/**
 * Confirms the person's authenticator works and switches their two-factor on. Allowed only with the
 * set-up pass the login form hands out after a correct password — never by a Hub session alone.
 * The backup codes are returned ONCE, here; only their hashes are kept.
 */
export async function confirmTwoFactorSetup(code: string): Promise<{ ok: boolean; error?: string; codes?: string[] }> {
  try {
    const jar = await cookies()
    const userId = setupCookieUser(jar.get(SETUP_COOKIE)?.value)
    if (!userId) return { ok: false, error: "This set-up page has timed out — sign in again to carry on." }
    const tf = await readTwoFactor(userId)
    if (!tf?.required) return { ok: false, error: "Two-factor isn't switched on for your account any more." }
    if (tf.enabledAt) return { ok: false, error: "Two-factor is already set up — sign in with your code." }
    if (!tf.secret) return { ok: false, error: "Reload this page to get your QR code, then try again." }
    const step = matchTotp(openSecret(tf.secret), code.replace(/\s/g, ""))
    if (step === null) return { ok: false, error: "That code isn't right — check your phone's clock is set automatically, and try the newest code." }

    const codes = newBackupCodes()
    const r = await prisma.userTwoFactor.updateMany({
      where: { userId, enabledAt: null, secret: tf.secret },
      data: { enabledAt: new Date(), lastStep: step, backupCodes: codes.map(hashBackupCode) },
    })
    if (r.count !== 1) return { ok: false, error: "Something changed while you were setting up — sign in again." }
    jar.delete({ name: SETUP_COOKIE, path: "/two-factor" })
    return { ok: true, codes }
  } catch (e: any) {
    console.error("two-factor setup error:", e)
    return { ok: false, error: "Something went wrong. Please try again." }
  }
}
