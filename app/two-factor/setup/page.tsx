import Link from "next/link"
import { cookies } from "next/headers"
import bwipjs from "bwip-js"
import Logo from "@/components/logo"
import { prisma } from "@/lib/prisma"
import { SETUP_COOKIE, setupCookieUser, readTwoFactor, newSecret, sealSecret, openSecret, otpauthUrl } from "@/lib/two-factor"
import SetupForm from "./setup-form"

export const dynamic = "force-dynamic"

// Reached only from the login form, after a correct password, for someone whose "Require two-factor"
// box is ticked but who hasn't set it up. Public path (auth.config.ts publicExact); the 15-minute
// set-up pass cookie is the only way in, and it never gives a Hub session.
export default async function TwoFactorSetupPage() {
  const userId = setupCookieUser((await cookies()).get(SETUP_COOKIE)?.value)
  const tf = userId ? await readTwoFactor(userId) : null

  let body: React.ReactNode
  if (!userId || !tf?.required) {
    body = <Notice text="This set-up page has timed out. Sign in again to carry on." />
  } else if (tf.enabledAt) {
    body = <Notice text="Two-factor is already set up on your account. Sign in with the code from your app." />
  } else {
    // A pending secret survives a reload, so a QR code already scanned keeps working.
    let secret = tf.secret ? openSecret(tf.secret) : null
    if (!secret) {
      secret = newSecret()
      await prisma.userTwoFactor.update({ where: { userId }, data: { secret: sealSecret(secret) } })
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } })
    const png = await bwipjs.toBuffer({ bcid: "qrcode", text: otpauthUrl(secret, user?.email ?? "Hub"), scale: 5 })
    body = (
      <SetupForm
        name={user?.name ?? ""}
        qr={`data:image/png;base64,${png.toString("base64")}`}
        secret={secret.match(/.{1,4}/g)!.join(" ")}
      />
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6 gap-3">
          <Logo variant="icon" />
          <p className="text-gray-900 font-bold text-2xl tracking-tight">Set up two-factor</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">{body}</div>
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-700">{text}</p>
      <Link href="/login" className="block w-full text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg text-sm">
        Go to sign in
      </Link>
    </div>
  )
}
