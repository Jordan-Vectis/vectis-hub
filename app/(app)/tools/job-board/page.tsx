import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getSignedImageUrl } from "@/lib/r2"
import { cleanEmailHtml, htmlToText } from "@/lib/email-html"
import BoardClient from "./board-client"

type Quoted = { from: string | null; date: string | null; subject: string | null; body: string; isHtml: boolean }

export default async function JobBoardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/hub")

  const [jobs, itStaff, allUsers] = await Promise.all([
    prisma.iTJob.findMany({
      orderBy: [{ receivedAt: "desc" }, { createdAt: "desc" }],
      include: {
        // Job-level images = the original email's (messageId null). Reply images
        // hang off their own message.
        attachments: { where: { messageId: null }, orderBy: { createdAt: "asc" } },
        messages: { orderBy: { createdAt: "asc" }, include: { attachments: { orderBy: { createdAt: "asc" } } } },
      },
    }),
    prisma.user.findMany({ where: { isITStaff: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true, isITStaff: true }, orderBy: { name: "asc" } }),
  ])

  // Pre-sign every attachment's R2 key (URLs valid 1h) so the client can <img> them directly.
  const allAttachments = jobs.flatMap((j) => [...j.attachments, ...j.messages.flatMap((m) => m.attachments)])
  const urlById = new Map<string, string>()
  await Promise.all(
    allAttachments.map(async (a) => {
      try { urlById.set(a.id, await getSignedImageUrl(a.r2Key)) } catch { /* skip broken keys */ }
    })
  )
  const toImage = (a: { id: string; filename: string }) => ({ id: a.id, filename: a.filename, url: urlById.get(a.id) ?? "" })

  // Rewrite inline cid: image refs in email HTML to signed R2 URLs. Inline images
  // are the attachments carrying a Content-ID; all hang off the job (messageId null),
  // so a job's attachment list resolves cids for the original email and its replies.
  function renderHtml(html: string | null, atts: { id: string; contentId: string | null }[]): string | null {
    if (!html) return null
    let out = html
    for (const a of atts) {
      if (!a.contentId) continue
      const url = urlById.get(a.id)
      if (!url) continue
      out = out.replace(new RegExp("cid:" + a.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), url)
    }
    // Drop <img> tags we can't actually load (bare filenames or unmatched cid refs —
    // e.g. iPhone inline photos that also arrive as real attachments/thumbnails),
    // so they don't render as broken icons. Keep http/https/data (incl. the
    // signature logos we just rewrote).
    out = out.replace(/<img\b[^>]*>/gi, (tag) => {
      const m = tag.match(/\ssrc\s*=\s*["']?([^"'\s>]+)/i)
      return /^(https?:|data:)/i.test(m?.[1] ?? "") ? tag : ""
    })
    return stripPlaceholders(out)
  }

  // Strip the leftover "[image0.jpeg]" / "[cid:…]" / "[logo.png]" placeholders mail
  // clients drop into the body where inline images sat (they aren't real content).
  function stripPlaceholders(s: string): string {
    return s
      .replace(/\[cid:[^\]]*\]/gi, "")
      .replace(/\[image\d+\.[a-z0-9]+\]/gi, "")
      .replace(/\[[\w .\-]+\.(?:jpe?g|png|gif|webp|heic|heif|bmp|tiff?|avif)\]/gi, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  // Split a plain-text email into the latest message and the quoted/forwarded
  // history below it, so the older chain can be collapsed. Splits at the earliest
  // Outlook forward header / "Original Message" divider / "On … wrote:" marker.
  function splitQuote(s: string): { main: string; quoted: string | null } {
    const patterns = [
      /^[ \t]*-{2,}\s*Original Message\s*-{2,}/im,
      /^_{5,}\s*$/m,
      /^[ \t]*From:[ \t]*\S.*\r?\n(?:.*\r?\n){0,2}?[ \t]*(?:Sent|Date):[ \t]*\S/im,
      /^[ \t]*On .{0,120}\bwrote:\s*$/im,
    ]
    let idx = -1
    for (const p of patterns) {
      const m = s.match(p)
      if (m && m.index !== undefined && m.index > 0) idx = idx === -1 ? m.index : Math.min(idx, m.index)
    }
    if (idx <= 0) return { main: s, quoted: null }
    return { main: s.slice(0, idx).trim(), quoted: s.slice(idx).trim() || null }
  }

  // Parse a quoted/forwarded block's header (From / Sent|Date / Subject) into
  // fields, and strip that header off the body so it can be shown in its own box.
  function parseQuoted(q: string): { from: string | null; date: string | null; subject: string | null; body: string } {
    const get = (label: string) => {
      const m = q.match(new RegExp("^[ \\t]*" + label + ":[ \\t]*(.+)$", "im"))
      return m ? m[1].trim() : null
    }
    let from = get("From")
    const date = get("Sent") || get("Date")
    const subject = get("Subject")
    let body = q
      .replace(/^[ \t]*(?:-{2,}\s*Original Message\s*-{2,}|_{5,})\s*\r?\n?/i, "")
      .replace(/^(?:[ \t]*(?:From|Sent|Date|To|Cc|Reply-To|Subject)[ \t]*:.*\r?\n?)+/im, "")
      .trim()
    if (!from) {
      const m = q.match(/^On (.+?) wrote:\s*$/im)
      if (m) { from = m[1].trim(); body = q.replace(/^On .+? wrote:\s*\r?\n?/im, "").trim() }
    }
    return { from, date, subject, body }
  }

  // Best-effort: split a forwarded/quoted email out of HTML at the earliest
  // boundary (blockquote, gmail_quote, or an Outlook "From: … Subject:" header),
  // re-balancing each half with the sanitiser, and parse the quoted header.
  function splitHtmlQuote(html: string): { mainHtml: string; quoted: Quoted | null } {
    const candidates: number[] = []
    const bq = html.search(/<blockquote[\s>]/i); if (bq >= 0) candidates.push(bq)
    const gq = html.search(/class=["']?[^"'>]*gmail_quote/i); if (gq >= 0) candidates.push(gq)
    const fm = /\bFrom:\s/i.exec(html)
    if (fm && /Subject:/i.test(htmlToText(html.slice(fm.index, fm.index + 1500)))) candidates.push(fm.index)
    const idx = candidates.length ? Math.min(...candidates) : -1
    if (idx <= 0) return { mainHtml: html, quoted: null }

    const mainHtml = cleanEmailHtml(html.slice(0, idx))
    const quotedHtml = cleanEmailHtml(html.slice(idx))
    const head = htmlToText(quotedHtml).slice(0, 600)
    const get = (label: string) => { const x = head.match(new RegExp("^[ \\t]*" + label + ":[ \\t]*(.+)$", "im")); return x ? x[1].trim() : null }
    return {
      mainHtml,
      quoted: { from: get("From"), date: get("Sent") || get("Date"), subject: get("Subject"), body: quotedHtml, isHtml: true },
    }
  }

  // Build the display fields for a body. HTML (if any) wins — split off any
  // forwarded quote; else split the plain text into main + collapsible quoted.
  function emailFields(text: string, html: string | null, atts: { id: string; contentId: string | null }[]) {
    const renderedHtml = renderHtml(html, atts)
    if (renderedHtml) {
      const { mainHtml, quoted } = splitHtmlQuote(renderedHtml)
      return { body: stripPlaceholders(text), bodyHtml: mainHtml, bodyQuoted: quoted }
    }
    const { main, quoted } = splitQuote(stripPlaceholders(text))
    return { body: main, bodyHtml: null as string | null, bodyQuoted: quoted ? { ...parseQuoted(quoted), isHtml: false } : null }
  }

  // Date-only due info, computed server-side to keep board colours stable (no client/SSR drift).
  const todayUTC = new Date()
  todayUTC.setUTCHours(0, 0, 0, 0)
  function dueInfo(due: Date | null) {
    if (!due) return { dueDate: null as string | null, dueLabel: null as string | null, dueStatus: null as string | null }
    const d = new Date(due)
    d.setUTCHours(0, 0, 0, 0)
    const diffDays = Math.round((d.getTime() - todayUTC.getTime()) / 86400000)
    const dueDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
    const short = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })
    let dueStatus: string, dueLabel: string
    if (diffDays < 0)       { dueStatus = "overdue"; dueLabel = `Overdue · ${short}` }
    else if (diffDays === 0){ dueStatus = "today";   dueLabel = "Due today" }
    else if (diffDays === 1){ dueStatus = "soon";    dueLabel = "Due tomorrow" }
    else if (diffDays <= 3) { dueStatus = "soon";    dueLabel = `Due ${short}` }
    else                    { dueStatus = "later";   dueLabel = `Due ${short}` }
    return { dueDate, dueLabel, dueStatus }
  }

  const jobsPlain = jobs.map((j) => ({
    id:             j.id,
    title:          j.title,
    fromName:       j.fromName,
    fromEmail:      j.fromEmail,
    status:         j.status,
    source:         j.source,
    webLink:        j.webLink,
    assignedToId:   j.assignedToId,
    assignedToName: j.assignedToName,
    hasNewReply:    j.hasNewReply,
    ...dueInfo(j.dueDate),
    date: (j.receivedAt ?? j.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    // Thumbnails = genuine attachments only (no Content-ID); inline images render in the HTML.
    images: j.attachments.filter((a) => !a.contentId && urlById.has(a.id)).map(toImage),
    ...emailFields(j.body, j.bodyHtml, j.attachments),
    messages: j.messages.map((m) => ({
      id:         m.id,
      kind:       m.kind,
      authorName: m.authorName,
      when:       m.createdAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
      images:     m.attachments.filter((a) => !a.contentId && urlById.has(a.id)).map(toImage),
      ...emailFields(m.body, m.bodyHtml, j.attachments),
    })),
  }))

  const secret = process.env.IT_INBOUND_SECRET
  const appUrl = process.env.NEXTAUTH_URL ?? "https://vectis-staging.up.railway.app"
  const inboundUrl = secret ? `${appUrl}/api/it-mailbox/inbound?key=${secret}` : null

  return (
    <BoardClient
      jobs={jobsPlain}
      itStaff={itStaff}
      allUsers={allUsers}
      inboundUrl={inboundUrl}
    />
  )
}
