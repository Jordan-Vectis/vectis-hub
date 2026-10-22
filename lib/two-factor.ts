import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto"
import { prisma } from "@/lib/prisma"

// ─── Two-factor login (2026-10-22) ────────────────────────────────────────────
// An authenticator-app code (TOTP, RFC 6238: SHA-1, 6 digits, 30 s) after the password, for anyone
// whose "Require two-factor" box is ticked in Users & Permissions. Rules in RULES.md → "Two-factor".
// ⚠ Every key below is made from AUTH_SECRET: change AUTH_SECRET and every secret, backup code
// check and remembered device stops working — everyone ticked has to set up again.

export const REMEMBER_COOKIE = "vectis-2fa-device"
export const SETUP_COOKIE = "vectis-2fa-setup"
export const REMEMBER_DAYS = 30
const SETUP_MINUTES = 15
const ISSUER = "Vectis Hub"

function key(label: string): Buffer {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET isn't set — two-factor can't work without it")
  return createHash("sha256").update(`${label}:${secret}`).digest()
}

const b64url = (b: Buffer) => b.toString("base64url")
function sameText(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

// ── Base32 (authenticator apps take the secret in this form) ──
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ""
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of s.replace(/[\s=]/g, "").toUpperCase()) {
    const i = B32.indexOf(c)
    if (i < 0) throw new Error("Not base32")
    value = (value << 5) | i; bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

// ── TOTP ──
export function totpAt(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = createHmac("sha1", base32Decode(secretB32)).update(msg).digest()
  const o = h[h.length - 1] & 15
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
  return String(n % 1_000_000).padStart(6, "0")
}

/** The time step a code matches (one either side allowed for clock drift), or null. */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const step = Math.floor(now / 30_000)
  for (const s of [step, step - 1, step + 1]) if (sameText(totpAt(secretB32, s), code)) return s
  return null
}

export function newSecret(): string { return base32Encode(randomBytes(20)) }

export function otpauthUrl(secretB32: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(`${ISSUER}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`
}

// ── The secret is stored sealed (AES-256-GCM), never as typed into the app ──
export function sealSecret(secretB32: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key("two-factor-secret"), iv)
  const enc = Buffer.concat([c.update(secretB32, "utf8"), c.final()])
  return `v1.${b64url(iv)}.${b64url(c.getAuthTag())}.${b64url(enc)}`
}
export function openSecret(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".")
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unreadable two-factor secret")
  const d = createDecipheriv("aes-256-gcm", key("two-factor-secret"), Buffer.from(iv, "base64url"))
  d.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8")
}

// ── Backup codes: shown once, stored as SHA-256 only ──
export function newBackupCodes(n = 10): string[] {
  return Array.from({ length: n }, () => { const h = randomBytes(4).toString("hex"); return `${h.slice(0, 4)}-${h.slice(4)}` })
}
export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase().replace(/[^0-9a-f]/g, "")).digest("hex")
}

// ── Signed cookies: the remembered device, and the short set-up pass ──
function sign(label: string, body: string) { return b64url(createHmac("sha256", key(label)).update(body).digest()) }

/** "This device is remembered for this person" — dies when their two-factor is reset (enabledAt changes). */
export function makeRememberCookie(userId: string, enabledAt: Date): string {
  const exp = Date.now() + REMEMBER_DAYS * 86_400_000
  return `v1.${userId}.${exp}.${sign("two-factor-device", `${userId}.${exp}.${enabledAt.getTime()}`)}`
}
export function rememberCookieValid(value: string | undefined, userId: string, enabledAt: Date): boolean {
  const [v, id, exp, sig] = (value ?? "").split(".")
  if (v !== "v1" || id !== userId || !sig || !(Number(exp) > Date.now())) return false
  return sameText(sig, sign("two-factor-device", `${id}.${exp}.${enabledAt.getTime()}`))
}

/** Proof the password was right, for the set-up page only — never a Hub session. */
export function makeSetupCookie(userId: string): string {
  const exp = Date.now() + SETUP_MINUTES * 60_000
  return `v1.${userId}.${exp}.${sign("two-factor-setup", `${userId}.${exp}`)}`
}
export function setupCookieUser(value: string | undefined): string | null {
  const [v, id, exp, sig] = (value ?? "").split(".")
  if (v !== "v1" || !id || !sig || !(Number(exp) > Date.now())) return null
  return sameText(sig, sign("two-factor-setup", `${id}.${exp}`)) ? id : null
}
export const SETUP_COOKIE_MAX_AGE = SETUP_MINUTES * 60

export function cookieFrom(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=")
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return undefined
}

// ── Reading a person's row ──
export type TwoFactorRow = {
  userId: string; required: boolean; secret: string | null; enabledAt: Date | null
  backupCodes: string[]; lastStep: number | null
}

function isMissingTable(e: any) {
  return e?.code === "P2021" || e?.code === "42P01" || /does not exist/i.test(String(e?.message ?? ""))
}

/**
 * The person's two-factor row, or null when they have none — or when the table doesn't exist yet
 * (before Run Migrations), so a deploy can never lock everyone out of login. ⚠ Any OTHER fault
 * throws: a database blip must not quietly let a ticked person in on their password alone.
 */
export async function readTwoFactor(userId: string): Promise<TwoFactorRow | null> {
  try {
    return await prisma.userTwoFactor.findUnique({
      where: { userId },
      select: { userId: true, required: true, secret: true, enabledAt: true, backupCodes: true, lastStep: true },
    })
  } catch (e) {
    if (isMissingTable(e)) return null
    throw e
  }
}

export async function twoFactorTableExists(): Promise<boolean> {
  try { await prisma.userTwoFactor.findFirst({ select: { userId: true } }); return true }
  catch (e) { if (isMissingTable(e)) return false; throw e }
}

/**
 * Checks a code typed at login: an authenticator code (each time step used once — a code read over
 * someone's shoulder can't be replayed) or an unused backup code (used up). True = let them in.
 */
export async function useLoginCode(row: TwoFactorRow, typed: string): Promise<boolean> {
  if (!row.secret || !row.enabledAt) return false
  const code = typed.replace(/\s/g, "")
  const step = matchTotp(openSecret(row.secret), code)
  if (step !== null) {
    const r = await prisma.userTwoFactor.updateMany({
      where: { userId: row.userId, OR: [{ lastStep: null }, { lastStep: { lt: step } }] },
      data: { lastStep: step },
    })
    return r.count === 1
  }
  const h = hashBackupCode(code)
  if (!/^[0-9a-f]{8}$/i.test(code.replace(/-/g, "")) || !row.backupCodes.includes(h)) return false
  const r = await prisma.userTwoFactor.updateMany({
    where: { userId: row.userId, backupCodes: { has: h } },
    data: { backupCodes: row.backupCodes.filter(c => c !== h) },
  })
  return r.count === 1
}
