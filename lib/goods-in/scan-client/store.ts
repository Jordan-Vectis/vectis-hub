import type { AckRecord, StoredScan } from "./types"

// The handheld scanner — where scans are kept on the device until the Hub has answered for them.
// IndexedDB first; localStorage when IndexedDB can't be opened (some locked-down WebViews, private
// windows); and, only if both are refused, this page's memory (the screen then says plainly that
// scans won't survive the page closing). Every access is in try/catch.
//
// Beside the scans, the same way: the failed-scan pop-up's records (AckRecord, types.ts) — each
// failure while it is on the pop-up, then its acknowledgement until the Hub has it.
//
// ⚠ Nothing is ever dropped without an answer: prune() only removes scans the Hub has answered
// for, and never a refused or stale one that nobody has dismissed yet — nor one the pop-up hasn't
// been given yet; and only acknowledgements the Hub has answered for (never one on the pop-up or
// waiting to be sent).

export type StoreKind = "indexeddb" | "localstorage" | "memory"

export interface ScanStore {
  kind: StoreKind
  /** Every scan kept, in scan order. */
  all(): Promise<StoredScan[]>
  put(scan: StoredScan): Promise<void>
  update(id: string, patch: Partial<StoredScan>): Promise<StoredScan | undefined>
  /** Forget answered scans beyond the newest KEEP_ANSWERED (never waiting ones, never undismissed problems), and sent acknowledgements beyond KEEP_ACKS. */
  prune(): Promise<void>
  /** Every failed-scan record kept (on the pop-up, acknowledged, sent), in order. */
  allAcks(): Promise<AckRecord[]>
  /** Add or replace one (by id). */
  putAck(ack: AckRecord): Promise<void>
  updateAck(id: string, patch: Partial<AckRecord>): Promise<AckRecord | undefined>
  getKV<T>(key: string): Promise<T | undefined>
  setKV(key: string, value: unknown): Promise<void>
  delKV(key: string): Promise<void>
}

const DB_NAME = "vectis-scan"
// 2 (2026-10-21): the "acks" store. An older screen still open elsewhere lets go when asked
// (onversionchange); one that then can't open version 1 falls back to localStorage, which the next
// visit carries back into IndexedDB (openScanStore) — so nothing is stranded.
const DB_VERSION = 2
const SCANS = "scans"
const ACKS = "acks"
const KV = "kv"
const LS_SCANS = "vectis-scan-queue-v1"
const LS_ACKS = "vectis-scan-acks-v1"
const LS_KV = "vectis-scan-kv-v1:"
const KEEP_ANSWERED = 300
const KEEP_ACKS = 100

const bySeq = (a: StoredScan, b: StoredScan) => a.seq - b.seq || a.scannedAt.localeCompare(b.scannedAt)
const ackBySeq = (a: AckRecord, b: AckRecord) => a.seq - b.seq || a.shownAt.localeCompare(b.shownAt)

/** Which scans prune() may forget. */
function forgettable(list: StoredScan[]): Set<string> {
  const answered = list
    .filter(s => s.status !== "waiting" && !((s.status === "refused" || s.status === "stale") && !s.dismissed) && s.flagged !== false)
    .sort((a, b) => b.seq - a.seq)
  return new Set(answered.slice(KEEP_ANSWERED).map(s => s.id))
}

/** Which acknowledgements prune() may forget: answered for by the Hub, beyond the newest KEEP_ACKS. */
function forgettableAcks(list: AckRecord[]): Set<string> {
  const done = list.filter(a => a.status === "sent" || a.status === "refused").sort((a, b) => b.seq - a.seq)
  return new Set(done.slice(KEEP_ACKS).map(a => a.id))
}

// ── IndexedDB ────────────────────────────────────────────────────────────────────────────────

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"))
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"))
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"))
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest
    try {
      if (typeof indexedDB === "undefined") throw new Error("No IndexedDB here")
      r = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (e) {
      reject(e)
      return
    }
    const timer = setTimeout(() => reject(new Error("IndexedDB didn't open in time")), 4000)
    r.onupgradeneeded = () => {
      const db = r.result
      if (!db.objectStoreNames.contains(SCANS)) db.createObjectStore(SCANS, { keyPath: "id" })
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV)
      if (!db.objectStoreNames.contains(ACKS)) db.createObjectStore(ACKS, { keyPath: "id" })
    }
    r.onsuccess = () => { clearTimeout(timer); resolve(r.result) }
    r.onerror = () => { clearTimeout(timer); reject(r.error ?? new Error("IndexedDB refused")) }
    r.onblocked = () => { /* an older tab holds it open; onsuccess follows once it lets go */ }
  })
}

function idbStore(db: IDBDatabase): ScanStore {
  // A later version opened in another tab asks us to let go; reopening happens on the next call.
  let current: IDBDatabase | null = db
  db.onversionchange = () => { try { db.close() } catch { /* ignore */ } current = null }
  const get = async () => (current ??= await openDb())

  const all = async () => {
    const d = await get()
    const tx = d.transaction(SCANS, "readonly")
    const list = await req(tx.objectStore(SCANS).getAll() as IDBRequest<StoredScan[]>)
    return list.sort(bySeq)
  }

  const allAcks = async () => {
    const d = await get()
    const tx = d.transaction(ACKS, "readonly")
    const list = await req(tx.objectStore(ACKS).getAll() as IDBRequest<AckRecord[]>)
    return list.sort(ackBySeq)
  }

  return {
    kind: "indexeddb",
    all,
    allAcks,
    async putAck(ack) {
      const d = await get()
      const tx = d.transaction(ACKS, "readwrite")
      tx.objectStore(ACKS).put(ack)
      await done(tx)
    },
    async updateAck(id, patch) {
      const d = await get()
      const tx = d.transaction(ACKS, "readwrite")
      const os = tx.objectStore(ACKS)
      const cur = await req(os.get(id) as IDBRequest<AckRecord | undefined>)
      let next: AckRecord | undefined
      if (cur) {
        next = { ...cur, ...patch, id: cur.id }
        os.put(next)
      }
      await done(tx)
      return next
    },
    async put(scan) {
      const d = await get()
      const tx = d.transaction(SCANS, "readwrite")
      tx.objectStore(SCANS).put(scan)
      await done(tx)
    },
    async update(id, patch) {
      const d = await get()
      const tx = d.transaction(SCANS, "readwrite")
      const os = tx.objectStore(SCANS)
      const cur = await req(os.get(id) as IDBRequest<StoredScan | undefined>)
      let next: StoredScan | undefined
      if (cur) {
        next = { ...cur, ...patch, id: cur.id }
        os.put(next)
      }
      await done(tx)
      return next
    },
    async prune() {
      const list = await all()
      const drop = forgettable(list)
      if (drop.size) {
        const d = await get()
        const tx = d.transaction(SCANS, "readwrite")
        const os = tx.objectStore(SCANS)
        for (const id of drop) os.delete(id)
        await done(tx)
      }
      const dropAcks = forgettableAcks(await allAcks())
      if (dropAcks.size) {
        const d = await get()
        const tx = d.transaction(ACKS, "readwrite")
        const os = tx.objectStore(ACKS)
        for (const id of dropAcks) os.delete(id)
        await done(tx)
      }
    },
    async getKV<T>(key: string) {
      const d = await get()
      const tx = d.transaction(KV, "readonly")
      return (await req(tx.objectStore(KV).get(key))) as T | undefined
    },
    async setKV(key, value) {
      const d = await get()
      const tx = d.transaction(KV, "readwrite")
      tx.objectStore(KV).put(value, key)
      await done(tx)
    },
    async delKV(key) {
      const d = await get()
      const tx = d.transaction(KV, "readwrite")
      tx.objectStore(KV).delete(key)
      await done(tx)
    },
  }
}

// ── localStorage ─────────────────────────────────────────────────────────────────────────────

function lsStore(): ScanStore {
  const read = (): StoredScan[] => {
    const raw = localStorage.getItem(LS_SCANS)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as StoredScan[]) : []
  }
  const write = (list: StoredScan[]) => localStorage.setItem(LS_SCANS, JSON.stringify(list))
  const readAcks = (): AckRecord[] => {
    const raw = localStorage.getItem(LS_ACKS)
    if (!raw) return []
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? (v as AckRecord[]) : []
  }
  const writeAcks = (list: AckRecord[]) => localStorage.setItem(LS_ACKS, JSON.stringify(list))
  return {
    kind: "localstorage",
    async all() { return read().sort(bySeq) },
    async allAcks() { return readAcks().sort(ackBySeq) },
    async putAck(ack) {
      const list = readAcks().filter(a => a.id !== ack.id)
      list.push(ack)
      writeAcks(list)
    },
    async updateAck(id, patch) {
      const list = readAcks()
      const i = list.findIndex(a => a.id === id)
      if (i < 0) return undefined
      list[i] = { ...list[i], ...patch, id }
      writeAcks(list)
      return list[i]
    },
    async put(scan) {
      const list = read().filter(s => s.id !== scan.id)
      list.push(scan)
      write(list)
    },
    async update(id, patch) {
      const list = read()
      const i = list.findIndex(s => s.id === id)
      if (i < 0) return undefined
      list[i] = { ...list[i], ...patch, id }
      write(list)
      return list[i]
    },
    async prune() {
      const list = read()
      const drop = forgettable(list)
      if (drop.size) write(list.filter(s => !drop.has(s.id)))
      const acks = readAcks()
      const dropAcks = forgettableAcks(acks)
      if (dropAcks.size) writeAcks(acks.filter(a => !dropAcks.has(a.id)))
    },
    async getKV<T>(key: string) {
      const raw = localStorage.getItem(LS_KV + key)
      return raw == null ? undefined : (JSON.parse(raw) as T)
    },
    async setKV(key, value) { localStorage.setItem(LS_KV + key, JSON.stringify(value)) },
    async delKV(key) { localStorage.removeItem(LS_KV + key) },
  }
}

// ── This page's memory (the last resort) ─────────────────────────────────────────────────────

function memoryStore(): ScanStore {
  const scans = new Map<string, StoredScan>()
  const acks = new Map<string, AckRecord>()
  const kv = new Map<string, unknown>()
  return {
    kind: "memory",
    async all() { return [...scans.values()].sort(bySeq) },
    async allAcks() { return [...acks.values()].sort(ackBySeq) },
    async putAck(ack) { acks.set(ack.id, ack) },
    async updateAck(id, patch) {
      const cur = acks.get(id)
      if (!cur) return undefined
      const next = { ...cur, ...patch, id }
      acks.set(id, next)
      return next
    },
    async put(scan) { scans.set(scan.id, scan) },
    async update(id, patch) {
      const cur = scans.get(id)
      if (!cur) return undefined
      const next = { ...cur, ...patch, id }
      scans.set(id, next)
      return next
    },
    async prune() {
      for (const id of forgettable([...scans.values()])) scans.delete(id)
      for (const id of forgettableAcks([...acks.values()])) acks.delete(id)
    },
    async getKV<T>(key: string) { return kv.get(key) as T | undefined },
    async setKV(key, value) { kv.set(key, value) },
    async delKV(key) { kv.delete(key) },
  }
}

function lsWorks(): boolean {
  try {
    const k = "vectis-scan-probe"
    localStorage.setItem(k, "1")
    localStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}

/**
 * Open the best store this device allows. If IndexedDB can't be opened but localStorage still
 * holds scans (or failed-scan records) from an earlier visit, they are carried into IndexedDB so
 * none are stranded.
 */
export async function openScanStore(): Promise<ScanStore> {
  try {
    const db = await openDb()
    const store = idbStore(db)
    // Scans left in localStorage by a visit when IndexedDB wasn't available: bring them across.
    if (lsWorks()) {
      try {
        const old = await lsStore().all()
        if (old.length) {
          const have = new Set((await store.all()).map(s => s.id))
          for (const s of old) if (!have.has(s.id)) await store.put(s)
          localStorage.removeItem(LS_SCANS)
        }
      } catch {
        // Left where they are; the next visit tries again.
      }
      try {
        const oldAcks = await lsStore().allAcks()
        if (oldAcks.length) {
          const have = new Set((await store.allAcks()).map(a => a.id))
          for (const a of oldAcks) if (!have.has(a.id)) await store.putAck(a)
          localStorage.removeItem(LS_ACKS)
        }
      } catch {
        // Left where they are; the next visit tries again.
      }
    }
    return store
  } catch {
    if (lsWorks()) return lsStore()
    return memoryStore()
  }
}
