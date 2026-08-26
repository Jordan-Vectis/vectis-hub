import { redirect } from "next/navigation"
import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { TERMS_TITLE, TERMS_VERSION } from "@/lib/terms"
import MarkSignedButton from "@/components/mark-signed-button"
import RequireResignButton from "@/components/require-resign-button"
import TermsPreviewButton from "@/components/terms-preview-button"

export const dynamic = "force-dynamic"
export const metadata = { title: "Terms & Signatures" }

// Admin view of who has signed the iPad Acceptable Use Policy (current version),
// with their signature + date/time, plus who is still outstanding.
export default async function TermsSignaturesPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  let signed: { id: string; userId: string; userName: string; userEmail: string; signature: string; acceptedAt: Date }[] = []
  let migrated = true
  try {
    signed = await prisma.termsAcceptance.findMany({
      where: { version: TERMS_VERSION },
      orderBy: { acceptedAt: "desc" },
    })
  } catch { migrated = false }

  // Signatures an admin has withdrawn. Try/caught for the same reason as the list above — the
  // table only exists once Run Migrations has been pressed on this environment.
  let revoked: { id: string; userName: string; userEmail: string; version: string; signature: string; acceptedAt: Date; revokedAt: Date; revokedBy: string; reason: string }[] = []
  try {
    revoked = await prisma.termsRevocation.findMany({ orderBy: { revokedAt: "desc" }, take: 200 })
  } catch { /* not migrated yet — the banner on /admin already says so */ }

  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } })
  const userIds = new Set(users.map((u) => u.id))
  const signedCurrent = signed.filter((s) => userIds.has(s.userId))   // ignore orphans left by deleted users
  const signedIds = new Set(signedCurrent.map((s) => s.userId))
  const outstanding = users.filter((u) => !signedIds.has(u.id))

  // Rendered on the server (Railway runs UTC), so pin the zone or BST times show an
  // hour slow in summer. Europe/London handles BST/GMT automatically.
  const fmt = (d: Date) => new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  })
  const card = "bg-white dark:bg-[#1C1C1E] rounded-2xl border border-gray-200 dark:border-gray-800"

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <Link href="/admin" className="text-sm text-gray-400 hover:text-emerald-500">← Admin</Link>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">Terms &amp; Signatures</h1>
      <p className="text-sm text-gray-500 mt-1 mb-4">Signed acceptances of the <span className="font-medium">{TERMS_TITLE}</span>. {signedCurrent.length} of {users.length} staff have signed.</p>
      <div className="mb-6">
        <TermsPreviewButton userName={session.user.name ?? ""} />
      </div>

      {!migrated && (
        <div className={`${card} p-4 mb-6 border-amber-400/60`}>
          <p className="text-sm text-amber-600 dark:text-amber-400">The signatures table doesn&apos;t exist yet — click <span className="font-semibold">Run Migrations</span> on the Admin page, then reload.</p>
        </div>
      )}

      {/* Signed */}
      <div className={`${card} overflow-hidden mb-6`}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">✓ Signed ({signedCurrent.length})</h2>
        </div>
        {signedCurrent.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No signatures yet.</p>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {signedCurrent.map((s) => (
              <div key={s.id} className="flex items-center gap-4 p-4 flex-wrap">
                <div className="min-w-[180px]">
                  <p className="font-semibold text-gray-900 dark:text-white">{s.userName || "(no name)"}</p>
                  {s.userEmail && <p className="text-xs text-gray-500">{s.userEmail}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">{fmt(s.acceptedAt)}</p>
                  <RequireResignButton userId={s.userId} userName={s.userName} />
                </div>
                <div className="ml-auto">
                  {s.signature.startsWith("data:") ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-1">
                      <img src={s.signature} alt={`Signature of ${s.userName}`} className="h-16 w-auto max-w-[260px] object-contain" />
                    </div>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
                      Accepted on their behalf by {s.signature.replace(/^admin:/, "")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Outstanding */}
      <div className={`${card} overflow-hidden`}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-bold text-gray-900 dark:text-white">Not yet signed ({outstanding.length})</h2>
        </div>
        {outstanding.length === 0 ? (
          <p className="p-4 text-sm text-emerald-600 dark:text-emerald-400">Everyone has signed. ✓</p>
        ) : (
          <>
            <div className="p-4 flex flex-wrap gap-2">
              {outstanding.map((u) => (
                <span key={u.id} className="inline-flex items-center text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" title={u.email}>
                  {u.name}
                  <MarkSignedButton userId={u.id} userName={u.name} />
                </span>
              ))}
            </div>
            <p className="px-4 pb-4 text-[11px] text-gray-400">Use “mark signed” only for someone genuinely unable to sign — it records that an admin accepted the policy on their behalf.</p>
          </>
        )}
      </div>

      {/* Withdrawn — what "require re-sign" took away, kept so the audit trail survives it.
          ⚠ Shown only once there is something in it: an empty card every time would suggest the
          feature is broken, and the button that fills it is already visible on each signed row. */}
      {revoked.length > 0 && (
        <div className={`${card} overflow-hidden mt-6`}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">↩ Withdrawn ({revoked.length})</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Acceptances an admin has withdrawn to make somebody sign again. The signature is kept exactly as it was — nothing here is deleted.
            </p>
          </div>
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {revoked.map((r) => (
              <div key={r.id} className="flex items-center gap-4 p-4 flex-wrap">
                <div className="min-w-[180px]">
                  <p className="font-semibold text-gray-900 dark:text-white">{r.userName || "(no name)"}</p>
                  {r.userEmail && <p className="text-xs text-gray-500">{r.userEmail}</p>}
                  <p className="text-xs text-gray-500 mt-0.5">Signed {fmt(r.acceptedAt)}</p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Withdrawn {fmt(r.revokedAt)}{r.revokedBy ? ` by ${r.revokedBy}` : ""}
                  </p>
                  {r.reason && <p className="text-xs text-gray-500 mt-0.5 italic">“{r.reason}”</p>}
                  {r.version !== TERMS_VERSION && (
                    <p className="text-[11px] text-gray-400 mt-0.5">Policy version {r.version}</p>
                  )}
                </div>
                <div className="ml-auto">
                  {r.signature.startsWith("data:") ? (
                    <div className="bg-white rounded-lg border border-gray-200 p-1 opacity-70">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.signature} alt={`Withdrawn signature of ${r.userName}`} className="h-16 w-auto max-w-[260px] object-contain" />
                    </div>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
                      Had been accepted on their behalf by {r.signature.replace(/^admin:/, "")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
