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

export const STAGE_LABEL: Record<string, string> = {
  batch:       "Batch run",
  kpcheck:     "Key points",
  doublecheck: "Double check",
  complete:    "Finished",
}

/** The Auto Pipeline settings a queued sale carries, so a Bears sale and a
 *  Trains sale can run back to back on completely different instructions. */
export type QueueSettings = {
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
