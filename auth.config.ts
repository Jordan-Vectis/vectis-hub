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

      // Facilities → First Aid. Deliberately reachable without logging in so anyone on site
      // (including agency staff and visitors, who have no Hub account) can find a first aider
      // in an emergency. See RULES.md → "Public First Aid page".
      // ⚠ EXACT match, not startsWith like the list above: a prefix entry would also open
      // /first-aid-anything, so a future page could go public by accident. The page reads its
      // own tables server-side and posts to /api/public, so nothing else needed opening.
      // Belt and braces on the trailing slash. Next's own "/:path+/" redirect is applied
      // BEFORE middleware (fsChecker.redirects precedes the middleware step in
      // resolve-routes.js), so "/first-aid/" normally arrives here already trimmed — except
      // in minimalMode, where those redirects are skipped. Cheap to be certain: a QR code
      // ending in a slash must never bounce someone to /login mid-emergency.
      const publicExact = ["/first-aid"]
      const bare = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname
      if (publicExact.includes(bare)) return true

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
