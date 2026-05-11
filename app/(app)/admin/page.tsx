import Link from "next/link"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RunMigrationsButton from "./run-migrations-button"

const sections = [
  {
    href:        "/admin/about",
    label:       "About",
    description: "How every section of the app works, what it depends on, and the rules that govern it.",
    icon:        "📖",
  },
  {
    href:        "/admin/users",
    label:       "Users & Permissions",
    description: "Add and remove users, set roles and control which apps each person can access.",
    icon:        "👤",
  },
  {
    href:        "/admin/departments",
    label:       "Departments",
    description: "Manage cataloguer departments used across the CRM.",
    icon:        "🏢",
  },
  {
    href:        "/admin/home-cards",
    label:       "Home Page",
    description: "Reorder app cards, hide unused ones, feature favourites and customise labels.",
    icon:        "🏠",
  },
  {
    href:        "/admin/role-defaults",
    label:       "Roles & Defaults",
    description: "Create custom roles, set their default app access, and push permissions to existing users.",
    icon:        "🔑",
  },
  {
    href:        "/admin/cataloguing-reports",
    label:       "Cataloguing Reports",
    description: "View time-per-lot reports across all cataloguers — average speed, method breakdown and recent activity.",
    icon:        "📊",
  },
  {
    href:        "/admin/devices",
    label:       "Devices",
    description: "Register and track tablets and other devices used by staff. Record serial numbers and assign to users.",
    icon:        "📱",
  },
  {
    href:        "/admin/memory",
    label:       "Claude Memory",
    description: "Browse what Claude remembers about you, this project, and how to work with you.",
    icon:        "🧠",
  },
]

export default async function AdminOverviewPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/hub")

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
        <p className="text-sm text-gray-500 mt-1">System-wide settings and management</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {sections.map(s => (
          <Link key={s.href} href={s.href}
            className="bg-white border border-gray-200 rounded-xl p-5 hover:border-slate-400 hover:shadow-sm transition-all group">
            <div className="text-3xl mb-3">{s.icon}</div>
            <h2 className="font-semibold text-gray-800 group-hover:text-slate-700 mb-1">{s.label}</h2>
            <p className="text-sm text-gray-500 leading-relaxed">{s.description}</p>
          </Link>
        ))}
      </div>
      <RunMigrationsButton />
    </div>
  )
}
