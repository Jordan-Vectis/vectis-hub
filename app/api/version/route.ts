// A module-level constant that is set once when the server process starts.
// Every Railway deploy restarts the process, so this token changes and
// connected clients can detect the new deployment.
const SERVER_TOKEN = Date.now().toString()

export const dynamic = "force-dynamic"

export async function GET() {
  return Response.json({ v: SERVER_TOKEN })
}
