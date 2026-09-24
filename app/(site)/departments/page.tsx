import Link from "next/link"
import { listDepartments } from "./data"

// The departments index on the test website: one tile per department, from the department pages
// collected from vectis.co.uk (Databases → News). Its own design, not the live site's.

export const dynamic = "force-dynamic"
export const metadata = {
  title: "Departments",
  description: "Vectis's specialist departments — what we sell, highlights and results for each.",
}

export default async function DepartmentsPage() {
  const departments = await listDepartments()

  return (
    <div>
      <div className="bg-white border-b border-gray-200">
        <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-8">
          <p className="text-[#DB0606] text-xs font-black tracking-[0.25em] uppercase mb-1">Specialist teams</p>
          <h1 className="text-3xl font-black text-[#32348A] uppercase tracking-tight">Departments</h1>
          <p className="text-gray-500 text-sm mt-1 max-w-3xl">Vectis has a number of specialist departments, each holding a series of auctions through the year. Pick a department for what we sell, highlighted lots, the latest news and past results.</p>
        </div>
      </div>

      <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 xl:px-10 py-10">
        {departments.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">The departments aren&apos;t available here yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
            {departments.map(d => (
              <Link key={d.slug} href={`/departments/${d.slug}`} className="group bg-white border border-gray-200 shadow-sm hover:shadow-md hover:border-[#32348A]/40 transition-all flex flex-col">
                <div className="relative bg-gray-100 aspect-[16/11] overflow-hidden">
                  {d.tile ? (
                    <img src={d.tile} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[#2AB4A6] to-[#32348A]" />
                  )}
                </div>
                <div className="p-4 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-black text-[#32348A] uppercase tracking-wider leading-snug">{d.name}</h2>
                  <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-[#DB0606]">Explore <span aria-hidden="true">→</span></span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
