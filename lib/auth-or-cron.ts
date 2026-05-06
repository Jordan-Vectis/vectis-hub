import { auth } from "@/auth"

// Allows a route to be called either by an authenticated user session
// or by an internal/scheduled cron call with the CRON_SECRET header.
export async function isAuthedOrCron(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const header = req.headers.get("authorization")
    if (header === `Bearer ${secret}`) return true
  }
  const session = await auth()
  return !!session
}
