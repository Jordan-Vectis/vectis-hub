// Auto Pipeline queue — shapes and labels shared by the runner, the server
// actions and the queue panel in the browser.
//
// ⚠ Client-imported: keep this free of prisma, the AI SDKs and anything
// server-only. The work itself lives in lib/pipeline-runner.ts.

export type QueueStatus = "QUEUED" | "RUNNING" | "PAUSED" | "DONE" | "CANCELLED"

export const QUEUE_STATUS_LABEL: Record<string, string> = {
  QUEUED:    "Waiting",
  RUNNING:   "Running",
  PAUSED:    "Paused",
  DONE:      "Finished",
  CANCELLED: "Cancelled",
}

/**
 * ⚠ PAUSED means two different things, and the difference matters to whoever is reading the
 * list: a sale that has NEVER been started (that is how a new one is added — nothing runs until
 * someone presses Start) versus one that was running and got held. `startedAt` is what tells
 * them apart. Always label through here rather than off QUEUE_STATUS_LABEL directly.
 */
export function queueStatusLabel(item: { status: string; startedAt: string | Date | null }): string {
  if (item.status === "PAUSED") return item.startedAt ? "Held" : "Not started"
  return QUEUE_STATUS_LABEL[item.status] ?? item.status
}

/** True when the sale is waiting for a person, not for its turn. */
export function isNotStarted(item: { status: string; startedAt: string | Date | null }): boolean {
  return item.status === "PAUSED" && !item.startedAt
}

export const STAGE_LABEL: Record<string, string> = {
  batch:       "Batch run",
  kpcheck:     "Key points",
  doublecheck: "Double check",
  upgrade:     "AI Upgrade",
  complete:    "Finished",
}

/** What an overnight run actually does: the three-stage Auto Pipeline, or an
 *  AI Upgrade mass rewrite whose results are held for morning review. */
export type QueueKind = "pipeline" | "upgrade"

/** The Auto Pipeline settings a queued sale carries, so a Bears sale and a
 *  Trains sale can run back to back on completely different instructions. */
export type QueueSettings = {
  kind:           QueueKind
  upgradeModes:   string // comma-separated AI Upgrade mode keys (kind "upgrade" only)
  preset:         string
  model:          string
  fallbackModel:  string
  grounded:       boolean
  autoApply:      boolean
  onlyWithPhotos: boolean
  skipHasDesc:    boolean
  kpRelaxed:      boolean
}

export type QueueItem = QueueSettings & {
  id:          string
  code:        string
  position:    number
  status:      string
  stage:       string
  done:        number
  total:       number
  skipped:     number
  retryAfter:  string | null
  lastMessage: string | null
  logText:     string | null
  startedAt:   string | null
  finishedAt:  string | null
  heartbeatAt: string | null
  addedBy:     string | null
  // kind "upgrade" only: how many rewrites exist, and how many a person has accepted.
  upgradeDone:     number
  upgradeAccepted: number
}

/** A queue item is only workable when it's waiting (or already mid-run) and any
 *  backoff has expired. Used by the runner to pick, and by the UI to explain. */
export function isWorkable(item: { status: string; retryAfter: string | Date | null }, now: Date = new Date()): boolean {
  if (item.status !== "QUEUED" && item.status !== "RUNNING") return false
  if (!item.retryAfter) return true
  return new Date(item.retryAfter).getTime() <= now.getTime()
}

/** How long a RUNNING item may go without a heartbeat before another tick may
 *  take it over. Longer than a slow lot, shorter than anyone would wait after a
 *  deploy restarts the server mid-sale. */
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000
