/**
 * Deterministic parser for Vectis condition-report request emails.
 *
 * These are system-generated from the website and follow a fixed shape, e.g.:
 *
 *   You have a new condition report request from: Ravi Bhavnani.
 *   NAV ID: C125476
 *   Email: ravib@ravib.com
 *   Phone: +14165514225
 *   Condition report required for Lot: 546 in auction: Specialist Diecast - Day 2 & Slot Cars
 *   Receipt Line ID:
 *   You can view the lot here          ← link to /bidding/<auction-slug>/<lot-slug>
 *   The user has asked for the following information:
 *   <the actual request>
 *   Vectis Ltd, Fleck Way, Thornaby …  ← footer
 *
 * The real requester is in the body — the envelope sender is admin@vectis.co.uk.
 */

import { htmlToText } from "@/lib/email-html"

export type ParsedConditionEmail = {
  requesterName: string | null
  email:         string | null
  phone:         string | null
  navId:         string | null
  lotNumber:     string | null
  auctionName:   string | null
  auctionCode:   string | null   // e.g. "F093" from the lot link
  lotTitle:      string | null   // de-slugified from the lot link
  lotUrl:        string | null
  requestText:   string | null
  /** True when this looks like a Vectis condition-report email at all. */
  matched:       boolean
}

const EMPTY: ParsedConditionEmail = {
  requesterName: null, email: null, phone: null, navId: null,
  lotNumber: null, auctionName: null, auctionCode: null, lotTitle: null,
  lotUrl: null, requestText: null, matched: false,
}

function lineValue(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*([^\\n\\r]+)`, "i")
  const m = text.match(re)
  return m ? m[1].trim() || null : null
}

// Pull the public lot link out of the HTML (preferred) or raw text.
function findLotUrl(html: string | null, text: string): string | null {
  if (html) {
    // The "view the lot here" anchor — grab the first /bidding/ href.
    const m = html.match(/href\s*=\s*["']([^"']*\/bidding\/[^"']+)["']/i)
    if (m) return m[1].trim()
  }
  const t = text.match(/https?:\/\/[^\s"'<>]*\/bidding\/[^\s"'<>]+/i)
  return t ? t[0].trim() : null
}

// De-slugify "dinky-toys-106-austin-atlantic-light-blue" → "Dinky Toys 106 Austin Atlantic Light Blue"
function deslug(s: string): string {
  return s.replace(/-/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, c => c.toUpperCase())
}

// From a /bidding/<auctionSlug>/<lotSlug> URL derive the auction code + lot title.
function fromLotUrl(url: string | null): { auctionCode: string | null; lotTitle: string | null } {
  if (!url) return { auctionCode: null, lotTitle: null }
  const m = url.match(/\/bidding\/([^/?#]+)(?:\/([^/?#]+))?/i)
  if (!m) return { auctionCode: null, lotTitle: null }

  const auctionSlug = m[1] ?? ""
  const lotSlug     = m[2] ?? ""

  // Auction code = leading letter(s)+digits token, e.g. "F093" from "F093-specialist-diecast…"
  const codeMatch = auctionSlug.match(/^([A-Za-z]+\d+)/)
  const auctionCode = codeMatch ? codeMatch[1].toUpperCase() : null

  // Lot title = the slug minus a leading "<lotNo>-" and a trailing "-<numericId>"
  let lotTitle: string | null = null
  if (lotSlug) {
    const mid = lotSlug.replace(/^\d+-/, "").replace(/-\d+$/, "")
    lotTitle = mid ? deslug(mid) : null
  }
  return { auctionCode, lotTitle }
}

export function parseConditionEmail(
  subject: string,
  bodyText: string,
  bodyHtml: string | null,
): ParsedConditionEmail {
  // Work from a plain-text view (HTML stripped) for the labelled fields.
  const text = (bodyHtml ? htmlToText(bodyHtml) : bodyText) || ""

  const isReport = /condition report/i.test(subject) || /condition report required for lot/i.test(text)
  if (!isReport) return EMPTY

  const requesterName = (lineValue(text, "request from") || "").replace(/\.\s*$/, "") || null
  const navId = lineValue(text, "NAV ID")
  const email = lineValue(text, "Email")
  const phone = lineValue(text, "Phone")

  // "… for Lot: 546 in auction: Specialist Diecast - Day 2 & Slot Cars"
  let lotNumber: string | null = null
  let auctionName: string | null = null
  const lotLine = text.match(/for\s+Lot\s*:\s*([^\n\r]+?)\s+in\s+auction\s*:\s*([^\n\r]+)/i)
  if (lotLine) {
    lotNumber   = lotLine[1].trim() || null
    auctionName = lotLine[2].trim() || null
  } else {
    lotNumber   = lineValue(text, "Lot")
    auctionName = lineValue(text, "auction")
  }

  const lotUrl = findLotUrl(bodyHtml, text)
  const { auctionCode, lotTitle } = fromLotUrl(lotUrl)

  // The request itself: everything after "following information:" up to the footer.
  let requestText: string | null = null
  const reqMatch = text.match(/following information\s*:\s*([\s\S]+)/i)
  if (reqMatch) {
    requestText = reqMatch[1]
      .split(/Vectis Ltd[,.]?/i)[0]   // cut the footer
      .replace(/You can view the lot here/i, "")
      .trim() || null
  }

  return {
    requesterName, email, phone, navId,
    lotNumber, auctionName, auctionCode, lotTitle,
    lotUrl, requestText,
    matched: !!(lotNumber || auctionName || requesterName),
  }
}
