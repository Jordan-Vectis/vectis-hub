"use server"

import { AuthError } from "next-auth"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { signIn } from "@/auth"
import { prisma } from "@/lib/prisma"
import { endScanSession } from "@/lib/goods-in/scanner-pass"
import {
  readTwoFactor, makeRememberCookie, makeSetupCookie,
  REMEMBER_COOKIE, REMEMBER_DAYS, SETUP_COOKIE, SETUP_COOKIE_MAX_AGE,
} from "@/lib/two-factor"

export type LoginState = { error?: string; step?: "code" } | null

const secure = process.env.NODE_ENV === "production"

// Same lookup as auth.ts's authorize — explicit select only (login lockout rule).
async function userIdFor(input: string): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: input.includes("@")
      ? { email: { equals: input, mode: "insensitive" } }
      : { username: { equals: input, mode: "insensitive" } },
    select: { id: true },
  })
  return u?.id ?? null
}

export async function loginAction(
  prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  // Someone signing in here takes the device over: end any handheld-scanner card sign-in left on it
  // (Goods In → scanner sign-in cards), so it can't outlast this person's own Hub session.
  try { await endScanSession() } catch { /* no cookie store here — nothing to clear */ }
  const input = String(formData.get("email") ?? "").trim()
  const code = String(formData.get("code") ?? "").trim()
  try {
    await signIn("credentials", {
      email:      input,
      password:   formData.get("password"),
      code,
      redirectTo: "/hub",
    })
  } catch (error) {
    const isRedirect = (error instanceof Error && error.message === "NEXT_REDIRECT") ||
      (error as any)?.digest?.startsWith("NEXT_REDIRECT")
    if (isRedirect) {
      // Signed in. "Remember this device" only counts when a code was actually typed.
      if (code && formData.get("remember") === "on") {
        try {
          const id = await userIdFor(input)
          const tf = id ? await readTwoFactor(id) : null
          if (id && tf?.enabledAt) {
            (await cookies()).set(REMEMBER_COOKIE, makeRememberCookie(id, tf.enabledAt), {
              httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: REMEMBER_DAYS * 86_400,
            })
          }
        } catch (e) { console.error("two-factor remember cookie:", e) }
      }
      throw error
    }

    if (error instanceof AuthError) {
      const twoFactor = (error as any).code as string | undefined
      if (twoFactor === "2fa_required") return { step: "code" }
      if (twoFactor === "2fa_wrong") return { step: "code", error: "That code isn't right — try the newest one in your app." }
      if (twoFactor === "2fa_setup") {
        const id = await userIdFor(input)
        if (id) {
          (await cookies()).set(SETUP_COOKIE, makeSetupCookie(id), {
            httpOnly: true, secure, sameSite: "lax", path: "/two-factor", maxAge: SETUP_COOKIE_MAX_AGE,
          })
          redirect("/two-factor/setup")
        }
      }
      return { step: prev?.step, error: "Invalid email, username, or password." }
    }
    return { step: prev?.step, error: "Something went wrong. Please try again." }
  }
  return null
}
