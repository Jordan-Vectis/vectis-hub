import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { authConfig } from "@/auth.config"
import { readTwoFactor, useLoginCode, rememberCookieValid, cookieFrom, REMEMBER_COOKIE } from "@/lib/two-factor"

// Two-factor answers the login form reads (app/login/actions.ts) — the password WAS right for both.
// ⚠ Neither gives a session: "setup" only earns a 15-minute pass to the set-up page.
export class TwoFactorRequired extends CredentialsSignin { code = "2fa_required" }
export class TwoFactorWrong extends CredentialsSignin { code = "2fa_wrong" }
export class TwoFactorSetup extends CredentialsSignin { code = "2fa_setup" }

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name: string
      email: string
      role: string
      departmentId: string | null
      appPermissions: Record<string, { role: string }> | null
    }
  }
  interface User {
    role: string
    departmentId: string | null
    appPermissions: Record<string, { role: string }> | null
  }
}

// Login attempt limit (security review, 2026-10-22). Too many wrong passwords for one name from one
// address, or from one address overall, blocks that pair for 15 minutes. Kept in memory: a deploy
// clears it, which is fine — it only has to slow down guessing.
// shortcut: one server only, in memory — move to the database if the Hub ever runs more than one copy.
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_PER_NAME = 8
const MAX_PER_IP = 30
const loginFails = new Map<string, { count: number; first: number }>()

function tooManyFails(key: string, max: number) {
  const f = loginFails.get(key)
  if (!f) return false
  if (Date.now() - f.first > LOGIN_WINDOW_MS) { loginFails.delete(key); return false }
  return f.count >= max
}

function noteFail(key: string) {
  const f = loginFails.get(key)
  if (!f || Date.now() - f.first > LOGIN_WINDOW_MS) loginFails.set(key, { count: 1, first: Date.now() })
  else f.count++
  if (loginFails.size > 10000) loginFails.clear() // never let a flood fill memory
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        code: { label: "Code", type: "text" },
      },
      authorize: async (credentials, request) => {
        if (!credentials?.email || !credentials?.password) return null

        const input = (credentials.email as string).trim()
        // Last address in the chain is the one Railway's proxy added — the first can be typed in by anyone.
        const ip = request?.headers?.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown"
        const nameKey = `n:${input.toLowerCase()}|${ip}`
        const ipKey = `i:${ip}`
        // Same refusal as a wrong password — never tell a guesser they've been blocked.
        if (tooManyFails(nameKey, MAX_PER_NAME) || tooManyFails(ipKey, MAX_PER_IP)) return null
        const fail = () => { noteFail(nameKey); noteFail(ipKey); return null }
        const isEmail = input.includes("@")
        // Select only the fields login needs — NOT `*`. This keeps login working through the
        // window after a deploy that adds new User columns but before Run Migrations creates
        // them (a full select would reference the missing columns and break login → lockout,
        // since you must be logged in to run migrations).
        const user = await prisma.user.findFirst({
          where: isEmail
            ? { email: { equals: input, mode: "insensitive" } }
            : { username: { equals: input, mode: "insensitive" } },
          select: { id: true, name: true, email: true, password: true, role: true, departmentId: true, appPermissions: true },
        })

        if (!user) return fail()

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )
        if (!valid) return fail()

        // Two-factor (2026-10-22): the "Require two-factor" tick in Users & Permissions.
        const tf = await readTwoFactor(user.id)
        if (tf?.required) {
          if (!tf.enabledAt || !tf.secret) { loginFails.delete(nameKey); throw new TwoFactorSetup() }
          const remembered = rememberCookieValid(cookieFrom(request?.headers?.get("cookie"), REMEMBER_COOKIE), user.id, tf.enabledAt)
          if (!remembered) {
            const code = String(credentials.code ?? "").trim()
            if (!code) throw new TwoFactorRequired()
            if (!(await useLoginCode(tf, code))) { fail(); throw new TwoFactorWrong() }
          }
        }
        loginFails.delete(nameKey)

        const SUPERADMIN_EMAILS = ["it@vectis.co.uk"]
        const effectiveRole = SUPERADMIN_EMAILS.includes(user.email.toLowerCase()) ? "ADMIN" : user.role

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: effectiveRole,
          departmentId: user.departmentId,
          appPermissions: user.appPermissions as Record<string, { role: string }> | null,
        }
      },
    }),
  ],
})
