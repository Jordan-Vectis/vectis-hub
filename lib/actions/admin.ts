"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { Role } from "@/app/generated/prisma/enums"
import bcrypt from "bcryptjs"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== Role.ADMIN) {
    throw new Error("Admin access required")
  }
  return session
}

export async function createUser(formData: FormData) {
  await requireAdmin()

  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const username = (formData.get("username") as string | null) || null
  const password = formData.get("password") as string
  const role = formData.get("role") as Role
  const departmentId = formData.get("departmentId") as string | null

  const hashed = await bcrypt.hash(password, 12)

  const roleDefault = role !== "ADMIN"
    ? await prisma.roleDefault.findUnique({ where: { role } })
    : null

  await prisma.user.create({
    data: {
      name,
      email,
      username:       username || null,
      password:       hashed,
      role,
      departmentId:   departmentId || null,
      allowedApps:    roleDefault?.allowedApps ?? [],
      appPermissions: roleDefault?.appPermissions ?? undefined,
    },
  })

  revalidatePath("/admin/users")
}

export async function updateUser(userId: string, formData: FormData) {
  await requireAdmin()

  const name = formData.get("name") as string
  const email = formData.get("email") as string | null
  const username = formData.get("username") as string | null
  const role = formData.get("role") as Role
  const departmentId = formData.get("departmentId") as string | null
  const newPassword = formData.get("password") as string | null

  const data: Record<string, unknown> = {
    name,
    ...(role ? { role } : {}),
    ...(email ? { email } : {}),
    username: username || null,
    departmentId: departmentId || null,
  }

  if (newPassword) {
    data.password = await bcrypt.hash(newPassword, 12)
  }

  await prisma.user.update({ where: { id: userId }, data })

  revalidatePath("/admin/users")
}

export async function changePassword(userId: string, newPassword: string) {
  await requireAdmin()
  const hashed = await bcrypt.hash(newPassword, 12)
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } })
}

export async function deleteUser(userId: string) {
  await requireAdmin()
  await prisma.user.delete({ where: { id: userId } })
  revalidatePath("/admin/users")
}

export async function createDepartment(formData: FormData) {
  await requireAdmin()
  const name = formData.get("name") as string
  await prisma.department.create({ data: { name } })
  revalidatePath("/admin/departments")
}

export async function updateDepartment(id: string, formData: FormData) {
  await requireAdmin()
  const name = formData.get("name") as string
  await prisma.department.update({ where: { id }, data: { name } })
  revalidatePath("/admin/departments")
}

export async function deleteDepartment(id: string) {
  await requireAdmin()
  await prisma.department.delete({ where: { id } })
  revalidatePath("/admin/departments")
}

export async function seedInitialAdmin(
  name: string,
  email: string,
  password: string
) {
  const count = await prisma.user.count()
  if (count > 0) throw new Error("Users already exist")

  const hashed = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: { name, email, password: hashed, role: Role.ADMIN },
  })
}
