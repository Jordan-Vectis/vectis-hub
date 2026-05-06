export type AppKey = "CRM" | "AUCTION_AI" | "CATALOGUING" | "BC_REPORTS" | "SALEROOM_TRAINER" | "WAREHOUSE" | "AUCTION_CONTROLLER" | "BC_WAREHOUSE" | "AI_PRESENTER"

export const ALL_APPS: { key: AppKey; label: string }[] = [
  { key: "CRM",                label: "CRM" },
  { key: "AUCTION_AI",         label: "Auction AI" },
  { key: "CATALOGUING",        label: "Cataloguing" },
  { key: "BC_REPORTS",         label: "BC Reports" },
  { key: "SALEROOM_TRAINER",   label: "Saleroom Trainer" },
  { key: "WAREHOUSE",          label: "Warehouse" },
  { key: "AUCTION_CONTROLLER", label: "Auction Controller" },
  { key: "BC_WAREHOUSE",       label: "BC Warehouse" },
  { key: "AI_PRESENTER",       label: "AI Presenter" },
]

export function hasAppAccess(role: string, allowedApps: string[], appKey: AppKey): boolean {
  if (role === "ADMIN") return true
  return allowedApps.includes(appKey)
}

export type WarehouseRole = "warehouse" | "manager" | "admin"

export const WAREHOUSE_ROLES: { value: WarehouseRole; label: string }[] = [
  { value: "warehouse", label: "Warehouse (basic)" },
  { value: "manager",   label: "Manager" },
  { value: "admin",     label: "Admin (full)" },
]

export function getWarehouseRole(
  role: string,
  appPermissions: Record<string, { role: string }> | null | undefined
): WarehouseRole | null {
  if (role === "ADMIN") return "admin"
  return (appPermissions?.WAREHOUSE?.role as WarehouseRole) || null
}

export function canAccessWarehouseRoute(whRole: WarehouseRole | null, minRole: WarehouseRole): boolean {
  if (!whRole) return false
  const order: WarehouseRole[] = ["warehouse", "manager", "admin"]
  return order.indexOf(whRole) >= order.indexOf(minRole)
}

// ─── Per-app section definitions ─────────────────────────────────────────────

export const APP_SECTIONS: Partial<Record<AppKey, { key: string; label: string }[]>> = {
  CATALOGUING: [
    { key: "AUCTION_MANAGER",    label: "Auction Manager" },
    { key: "TABLET_CATALOGUING", label: "Tablet Cataloguing" },
    { key: "LOTTING_UP",         label: "Lotting Up" },
    { key: "RESEARCH",           label: "Research" },
  ],
  AUCTION_AI: [
    { key: "chat",         label: "Chat Window" },
    { key: "batch",        label: "Batch Run" },
    { key: "runs",         label: "Saved Runs" },
    { key: "barcode",      label: "Barcode Sorter" },
    { key: "copier",       label: "Description Copier" },
    { key: "instructions", label: "Instructions" },
  ],
  BC_REPORTS: [
    { key: "cataloguing", label: "Cataloguing" },
    { key: "packing",     label: "Packing" },
    { key: "warehouse",   label: "Warehouse" },
    { key: "explorer",    label: "Data Explorer" },
    { key: "location",    label: "Location History" },
    { key: "shipping",    label: "Shipping" },
  ],
}

/**
 * Returns the list of allowed section keys for a given app and user.
 * Returns null when there is no restriction (show everything).
 */
export function getAllowedSections(
  role: string,
  appPermissions: Record<string, any> | null | undefined,
  appKey: AppKey
): string[] | null {
  const sections = APP_SECTIONS[appKey]
  if (!sections) return null              // app has no sections — no restriction
  if (role === "ADMIN") return null       // admins always see everything
  const stored = appPermissions?.[appKey]?.sidebarItems as string[] | undefined
  if (!stored || stored.length === 0) return null  // not configured — show all
  return stored
}

// ─── Cataloguing helpers (kept for backwards compat) ─────────────────────────

export const CATALOGUING_SIDEBAR_ITEMS = APP_SECTIONS.CATALOGUING!

export function getCataloguingSidebarItems(
  role: string,
  appPermissions: Record<string, any> | null | undefined
): string[] {
  return getAllowedSections(role, appPermissions, "CATALOGUING") ??
    CATALOGUING_SIDEBAR_ITEMS.map(i => i.key)
}
