import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

const { auth } = NextAuth(authConfig)

export { auth as proxy }

export const config = {
  // Exclude static image assets in /public so they're served without auth —
  // otherwise a logged-out user on a public page (e.g. /submit/[token]) gets
  // redirected to /login when the browser requests an image, breaking it.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)"],
}
