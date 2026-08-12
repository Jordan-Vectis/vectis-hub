import { prisma } from "@/lib/prisma"
import ReportForm from "./report-form"

// PUBLIC — no login. Deliberately a TOP-LEVEL route, not inside app/(app): that group's layout
// renders the Hub shell and reads the session, so putting this page there would drag the nav
// (and a logged-out session lookup) onto a page anyone can open.
//
// ⚠ Rules for anything added to this page:
//   1. Every field shown here is world-readable. Never surface anything confidential.
//   2. No links into the Hub, and no session — this page must never be a way in.
//   3. Read straight from the DB server-side. Don't add a public GET endpoint for it.
//   4. The only write is the accident report, which posts to /api/public/first-aid-report.
export const dynamic = "force-dynamic"

export const metadata = {
  title: "First aid — Vectis Auctions",
  // Not somewhere search engines need to index; it is for people already on site.
  robots: { index: false, follow: false },
}

const KIND_ICON: Record<string, string> = { KIT: "🧰", DEFIB: "⚡", EYEWASH: "💧", OTHER: "📍" }

// Every table is newer than the deploy that reads it, so a missing table must leave the page
// standing (people may be looking at it in an emergency) rather than 500 it.
type Aider = { id: string; name: string; roleTitle: string | null; location: string | null; phone: string | null; photoKey: string | null }
type Kit   = { id: string; kind: string; label: string; whereText: string | null; photoKey: string | null }
type Info  = { emergencySteps: string | null; siteAddress: string | null; assemblyPoint: string | null; extraNotes: string | null } | null

async function load(): Promise<{ aiders: Aider[]; kits: Kit[]; info: Info }> {
  // ⚠ allSettled, NOT all: one failing query (a table not yet migrated, say) must not blank the
  // emergency steps and the first aiders too. Each section stands or falls on its own.
  const [aiders, kits, info] = await Promise.allSettled([
    prisma.firstAider.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.firstAidKit.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    prisma.firstAidInfo.findUnique({ where: { id: "global" } }),
  ])
  return {
    aiders: aiders.status === "fulfilled" ? aiders.value : ([] as Aider[]),
    kits:   kits.status   === "fulfilled" ? kits.value   : ([] as Kit[]),
    info:   info.status   === "fulfilled" ? (info.value as Info) : null,
  }
}

export default async function FirstAidPage() {
  const { aiders, kits, info } = await load()
  const steps = (info?.emergencySteps ?? "").split("\n").map(s => s.trim()).filter(Boolean)

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-green-700 text-white px-5 py-6">
        <h1 className="text-2xl font-bold">🩹 First aid</h1>
        <p className="text-sm text-green-100 mt-1">Vectis Auctions — anyone on site can use this page.</p>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-6 space-y-6">
        {/* Emergency first — this is the bit someone needs in a hurry */}
        <section className="rounded-2xl border-2 border-green-300 bg-white p-5">
          <h2 className="text-lg font-bold text-green-800">In an emergency</h2>
          {steps.length > 0 ? (
            <ol className="mt-3 space-y-2 list-decimal list-inside text-[15px] leading-relaxed">
              {steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          ) : (
            <p className="mt-2 text-[15px]">Find a first aider from the list below. If it is serious, ring 999.</p>
          )}
          <a href="tel:999"
            className="mt-4 block text-center bg-green-700 hover:bg-green-800 text-white font-bold text-lg rounded-xl py-3">
            📞 Call 999
          </a>
          {info?.siteAddress && (
            <div className="mt-4 rounded-xl bg-green-50 border border-green-200 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-green-700">Address to give the ambulance</p>
              <p className="text-[15px] font-semibold whitespace-pre-wrap mt-1">{info.siteAddress}</p>
            </div>
          )}
          {info?.assemblyPoint && (
            <p className="mt-3 text-sm"><span className="font-bold">Assembly point:</span> {info.assemblyPoint}</p>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-bold">First aiders on site</h2>
          {aiders.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No first aiders listed yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {aiders.map(a => (
                <li key={a.id} className="py-3 flex items-center gap-3">
                  {a.photoKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/public/photo?key=${encodeURIComponent(a.photoKey)}`} alt=""
                      className="w-12 h-12 rounded-full object-cover bg-gray-100 shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold shrink-0">
                      {a.name.trim().charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.name}</p>
                    <p className="text-sm text-gray-600">
                      {[a.roleTitle, a.location].filter(Boolean).join(" · ") || "First aider"}
                    </p>
                  </div>
                  {a.phone && (
                    <a href={`tel:${a.phone.replace(/\s/g, "")}`}
                      className="shrink-0 px-3 py-2 rounded-lg bg-green-50 text-green-700 font-bold text-sm">
                      {a.phone}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-bold">Kits and equipment</h2>
          {kits.length === 0 ? (
            <p className="mt-2 text-sm text-gray-600">No locations listed yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {kits.map(k => (
                <li key={k.id} className="flex items-start gap-3">
                  <span className="text-2xl shrink-0" aria-hidden>{KIND_ICON[k.kind] ?? "📍"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{k.label}</p>
                    {k.whereText && <p className="text-sm text-gray-600">{k.whereText}</p>}
                    {k.photoKey && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/public/photo?key=${encodeURIComponent(k.photoKey)}`} alt=""
                        className="mt-2 rounded-xl border border-gray-200 max-h-56 object-cover w-full" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {info?.extraNotes && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-bold">Also worth knowing</h2>
            <p className="mt-2 text-[15px] whitespace-pre-wrap leading-relaxed">{info.extraNotes}</p>
          </section>
        )}

        <ReportForm />

        <p className="text-center text-xs text-gray-400 pb-8">
          Vectis Auctions · this page is for first aid only
        </p>
      </main>
    </div>
  )
}
