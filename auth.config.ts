import type { NextAuthConfig } from "next-auth"

// Lightweight config used in proxy (Edge runtime — no Prisma/Node.js modules)
export const authConfig: NextAuthConfig = {
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const pathname = nextUrl.pathname

      // The public customer website AND the staff Hub now both sit behind the
      // Hub login (deliberate change 2026-07-09 — the customer site is not yet
      // meant to be publicly visible, so logged-out visitors are bounced to
      // /login). Only the login page, first-run setup and server-to-server API
      // relays stay reachable while logged out. See RULES.md → "Public site is
      // login-gated".
      const publicPaths = ["/login", "/setup", "/api/public", "/api/gap-relay"]
      if (publicPaths.some((p) => pathname.startsWith(p))) return true

      if (!isLoggedIn) return false
      if (isLoggedIn && pathname === "/login") {
        return Response.redirect(new URL("/submissions", nextUrl))
      }
      return true
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        token.role = (user as { role: string }).role
        token.departmentId = (user as { departmentId: string | null }).departmentId
        token.appPermissions = (user as { appPermissions: Record<string, { role: string }> | null }).appPermissions ?? null
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      session.user.role = token.role as string
      session.user.departmentId = token.departmentId as string | null
      session.user.appPermissions = token.appPermissions as Record<string, { role: string }> | null
      return session
    },
  },
  providers: [],
}
