// Version token clients poll to detect a NEW deployment.
//
// ⚠ Must be stable across replicas and across process restarts of the SAME build —
// it should only change when the deployed code actually changes. Previously this used
// Date.now() set at process start, which changed on every restart (OOM, crash, scaling,
// health-check restart) and differed between replicas, so users saw the "app was updated"
// warning with no actual deploy.
//
// Railway injects RAILWAY_GIT_COMMIT_SHA — the commit of the running deploy. It's identical
// across all replicas of a build and only changes on a real deploy. Fall back to the
// deployment id, then to a fixed string (so it can never spuriously change).
const SERVER_TOKEN =
  process.env.RAILWAY_GIT_COMMIT_SHA ||
  process.env.RAILWAY_DEPLOYMENT_ID ||
  "static"

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ v: SERVER_TOKEN })
}
