"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import bcrypt from "bcryptjs"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
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
  const role = formData.get("role") as string
  // Departments are multi-select — a person can cover more than one.
  const departmentIds = (formData.getAll("departmentIds") as string[]).filter(Boolean)

  const hashed = await bcrypt.hash(password, 12)

  const roleDefault = role !== "ADMIN"
    ? await prisma.roleDefault.findUnique({ where: { role } })
    : null

  const user = await prisma.user.create({
    data: {
      name,
      email,
      username:       username || null,
      password:       hashed,
      role,
      departmentId:   departmentIds[0] ?? null,
      allowedApps:    roleDefault?.allowedApps ?? [],
      appPermissions: roleDefault?.appPermissions ?? undefined,
    },
  })

  if (departmentIds.length > 0) {
    // Never block creating a user because the department tables aren't
    // migrated yet — the account matters more than the links.
    try {
      await prisma.userDepartment.createMany({
        data: departmentIds.map(departmentId => ({ userId: user.id, departmentId })),
        skipDuplicates: true,
      })
    } catch { /* run migrations, then set departments on the user page */ }
  }

  revalidatePath("/admin/users")
}

export async function updateUser(userId: string, formData: FormData) {
  await requireAdmin()

  const name = formData.get("name") as string
  const email = formData.get("email") as string | null
  const username = formData.get("username") as string | null
  const role = formData.get("role") as string
  const newPassword = formData.get("password") as string | null

  // Departments are saved separately via setUserDepartments — this form no
  // longer carries departmentId, and must not wipe it by reading a null.
  const data: Record<string, unknown> = {
    name,
    ...(role ? { role } : {}),
    ...(email ? { email } : {}),
    username: username || null,
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

// ─── Departments ─────────────────────────────────────────────────────────────
// These return their error rather than throwing: a production build replaces a
// thrown server-action message with a generic one, and "that name is already
// taken" is something the admin needs to actually read.

type ActionResult = { ok: boolean; error?: string }

function revalidateDepartments() {
  revalidatePath("/admin/departments")
  revalidatePath("/admin/users")
}

export async function createDepartment(formData: FormData): Promise<ActionResult> {
  try {
    await requireAdmin()
    const name = ((formData.get("name") as string) ?? "").trim()
    if (!name) return { ok: false, error: "Enter a department name." }

    const clash = await prisma.department.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })
    if (clash) return { ok: false, error: `There is already a department called "${clash.name}".` }

    await prisma.department.create({ data: { name } })
    revalidateDepartments()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not create the department." }
  }
}

/** Rename a department and/or set the auction types it covers. */
export async function updateDepartment(
  id: string,
  input: { name?: string; auctionTypes?: string[] },
): Promise<ActionResult> {
  try {
    await requireAdmin()
    const data: { name?: string; auctionTypes?: string[] } = {}

    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) return { ok: false, error: "Enter a department name." }
      const clash = await prisma.department.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, id: { not: id } },
      })
      if (clash) return { ok: false, error: `There is already a department called "${clash.name}".` }
      data.name = name
    }

    if (input.auctionTypes !== undefined) {
      // A sale type belongs to one department — otherwise two departments both
      // "own" a sale and it stops meaning anything. Take it off the other one.
      const types = [...new Set(input.auctionTypes)]
      if (types.length > 0) {
        const others = await prisma.department.findMany({
          where:  { id: { not: id }, auctionTypes: { hasSome: types } },
          select: { id: true, auctionTypes: true },
        })
        for (const other of others) {
          await prisma.department.update({
            where: { id: other.id },
            data:  { auctionTypes: other.auctionTypes.filter(t => !types.includes(t)) },
          })
        }
      }
      data.auctionTypes = types
    }

    await prisma.department.update({ where: { id }, data })
    revalidateDepartments()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not update the department." }
  }
}

export async function deleteDepartment(id: string): Promise<ActionResult> {
  try {
    await requireAdmin()
    await prisma.department.delete({ where: { id } })
    revalidateDepartments()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not delete the department." }
  }
}

/** Replace the full set of departments a person belongs to. */
export async function setUserDepartments(userId: string, departmentIds: string[]): Promise<ActionResult> {
  try {
    await requireAdmin()
    const ids = [...new Set(departmentIds)].filter(Boolean)
    await prisma.$transaction([
      prisma.userDepartment.deleteMany({ where: { userId } }),
      ...(ids.length > 0
        ? [prisma.userDepartment.createMany({
            data: ids.map(departmentId => ({ userId, departmentId })),
            skipDuplicates: true,
          })]
        : []),
      // Keep the legacy single field roughly in step so any old read still
      // shows something sensible. Nothing uses it for access decisions.
      prisma.user.update({ where: { id: userId }, data: { departmentId: ids[0] ?? null } }),
    ])
    revalidateDepartments()
    revalidatePath(`/admin/users/${userId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not save departments." }
  }
}

// ─── One-off access to a single sale ─────────────────────────────────────────
// For someone working outside their department on one sale. Admins only.

export async function grantAuctionAccess(auctionId: string, userId: string): Promise<ActionResult> {
  try {
    const session = await requireAdmin()
    await prisma.catalogueAuctionAccess.upsert({
      where:  { auctionId_userId: { auctionId, userId } },
      create: { auctionId, userId, grantedBy: session.user.name ?? session.user.email ?? null },
      update: {},
    })
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not add that person to the sale." }
  }
}

export async function revokeAuctionAccess(auctionId: string, userId: string): Promise<ActionResult> {
  try {
    await requireAdmin()
    await prisma.catalogueAuctionAccess.deleteMany({ where: { auctionId, userId } })
    revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Could not remove that person from the sale." }
  }
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
    data: { name, email, password: hashed, role: "ADMIN" },
  })
}
