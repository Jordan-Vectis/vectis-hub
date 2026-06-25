// Plain constants — safe to import from both client and server (no server-only imports,
// and NOT a "use server" module, so non-function exports are allowed).
export const ANNOUNCEMENT_ID = "current"
export const ANNOUNCEMENT_LEVELS = ["info", "warning", "success"] as const
