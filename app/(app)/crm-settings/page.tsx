import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import DepartmentForm from "@/app/(app)/admin/departments/department-form"
import DeleteDepartmentButton from "@/app/(app)/admin/departments/delete-button"

export default async function DepartmentSettingsPage() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") redirect("/submissions")

  const departments = await prisma.department.findMany({
    include: { _count: { select: { users: true, submissions: true } } },
    orderBy: { name: "asc" },
  })

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Department Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage the departments used across the Hub</p>
      </div>

      <h2 className="text-base font-semibold text-gray-700 mb-3">Departments</h2>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {departments.length === 0 ? (
              <p className="text-sm text-gray-400 p-6 text-center">No departments yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Staff</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {departments.map((dept) => (
                    <tr key={dept.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3 font-medium text-gray-800">{dept.name}</td>
                      <td className="px-4 py-3 text-gray-500">{dept._count.users}</td>
                      <td className="px-4 py-3 text-right">
                        <DeleteDepartmentButton id={dept.id} name={dept.name} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-800 mb-4">Add Department</h3>
          <DepartmentForm />
        </div>
      </div>
    </div>
  )
}
