"use server"

import { AuthError } from "next-auth"
import { signIn } from "@/auth"
import { endScanSession } from "@/lib/goods-in/scanner-pass"

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  // Someone signing in here takes the device over: end any handheld-scanner card sign-in left on it
  // (Goods In → scanner sign-in cards), so it can't outlast this person's own Hub session.
  try { await endScanSession() } catch { /* no cookie store here — nothing to clear */ }
  try {
    await signIn("credentials", {
      email:      formData.get("email"),
      password:   formData.get("password"),
      redirectTo: "/hub",
    })
  } catch (error) {
    // NEXT_REDIRECT is thrown by Next.js to perform the redirect — re-throw it
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error
    if ((error as any)?.digest?.startsWith("NEXT_REDIRECT")) throw error

    if (error instanceof AuthError) {
      return "Invalid email, username, or password."
    }
    return "Something went wrong. Please try again."
  }
  return null
}
