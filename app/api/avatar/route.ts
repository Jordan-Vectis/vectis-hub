import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"

const DID_API = "https://api.d-id.com"

function didAuth() {
  // D-ID key is already in "base64email:secret" format — base64 encode it as-is for Basic auth
  return `Basic ${Buffer.from(process.env.DID_API_KEY ?? "").toString("base64")}`
}

function didHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: didAuth(),
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  if (!process.env.DID_API_KEY) {
    return NextResponse.json({ error: "DID_API_KEY is not configured on this server" }, { status: 500 })
  }

  const body = await req.json()
  const { action } = body

  try {
    switch (action) {

      case "presenters": {
        const res = await fetch(`${DID_API}/clips/presenters?limit=20`, {
          headers: { Authorization: didAuth() },
        })
        if (!res.ok) return NextResponse.json({ error: "Failed to fetch presenters" }, { status: res.status })
        const data = await res.json()
        return NextResponse.json(data.presenters ?? data)
      }

      case "create": {
        const { presenterUrl } = body
        if (!presenterUrl) {
          return NextResponse.json({ error: "No presenter selected" }, { status: 400 })
        }

        const res = await fetch(`${DID_API}/talks/streams`, {
          method:  "POST",
          headers: didHeaders(),
          body:    JSON.stringify({ source_url: presenterUrl }),
        })

        if (!res.ok) {
          const text = await res.text()
          return NextResponse.json({ error: text }, { status: res.status })
        }

        return NextResponse.json(await res.json())
      }

      case "sdp": {
        const { id, session_id, answer } = body
        const res = await fetch(`${DID_API}/talks/streams/${id}/sdp`, {
          method:  "POST",
          headers: didHeaders(),
          body:    JSON.stringify({ answer, session_id }),
        })

        if (!res.ok) return NextResponse.json({ error: "SDP exchange failed" }, { status: res.status })
        return NextResponse.json(await res.json())
      }

      case "ice": {
        const { id, session_id, candidate } = body
        // D-ID requires the candidate fields flattened — NOT nested under a candidate object
        const res = await fetch(`${DID_API}/talks/streams/${id}/ice`, {
          method:  "POST",
          headers: didHeaders(),
          body:    JSON.stringify({
            candidate:     candidate.candidate,
            sdpMid:        candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            session_id,
          }),
        })

        if (!res.ok) return NextResponse.json({ error: "ICE failed" }, { status: res.status })
        return NextResponse.json(await res.json())
      }

      case "speak": {
        const { id, session_id, text } = body
        const res = await fetch(`${DID_API}/talks/streams/${id}`, {
          method:  "POST",
          headers: didHeaders(),
          body:    JSON.stringify({
            script: {
              type:     "text",
              input:    text,
              provider: { type: "microsoft", voice_id: "en-GB-SoniaNeural" },
            },
            session_id,
            config:     { stitch: true },
            driver_url: "bank://lively",
          }),
        })

        if (!res.ok) {
          const errText = await res.text()
          return NextResponse.json({ error: errText }, { status: res.status })
        }

        return NextResponse.json(await res.json())
      }

      case "keepalive": {
        const { id, session_id } = body
        // Fire-and-forget — we don't care if it fails
        fetch(`${DID_API}/talks/streams/${id}/keepalive`, {
          method:  "POST",
          headers: didHeaders(),
          body:    JSON.stringify({ session_id }),
        }).catch(() => {})
        return NextResponse.json({ ok: true })
      }

      case "delete": {
        const { id, session_id } = body
        await fetch(`${DID_API}/talks/streams/${id}`, {
          method:  "DELETE",
          headers: didHeaders(),
          body:    JSON.stringify({ session_id }),
        }).catch(() => {})

        return NextResponse.json({ ok: true })
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 })
    }

  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 })
  }
}
