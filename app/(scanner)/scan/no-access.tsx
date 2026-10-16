"use client"

import SignInPanel from "./sign-in"
import { forgetOfflineCopy } from "@/lib/goods-in/scan-client/offline"

// Shown in place of the scanner when the signed-in account has no Goods In access — a plain
// message, and a way to sign in as someone who has it (the devices are shared) or to sign out.

export default function NoAccess({ name }: { name: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-6 space-y-6">
      <div className="rounded-2xl bg-amber-400 px-5 py-4 text-black">
        <p className="text-xl font-bold">This account can&apos;t use the scanner</p>
        <p className="mt-1 text-base leading-relaxed">
          {name} is signed in, but doesn&apos;t have Goods In (Warehouse) access. Ask a Warehouse manager to give it — or sign in below as someone who has it.
        </p>
      </div>
      <SignInPanel title="Sign in as someone else" beforeLeave={forgetOfflineCopy} />
    </div>
  )
}
