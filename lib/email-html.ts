import sanitizeHtml from "sanitize-html"

// Sanitise untrusted email HTML for safe rendering. Keeps formatting + images
// (inline cid: refs survive — rewritten to signed R2 URLs at render time),
// strips scripts/styles/iframes/event-handlers. Inline styles are kept (emails
// rely on them) but the rendered block is isolated in the modal. Also used at
// render time to re-balance the two halves after splitting off a forwarded quote.
export function cleanEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "h1", "h2", "u", "s", "span", "font", "center", "hr",
      "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "col", "colgroup",
    ]),
    allowedAttributes: {
      "*": ["style", "align", "valign", "dir", "width", "height", "bgcolor", "colspan", "rowspan"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title", "width", "height", "style"],
      font: ["color", "face", "size"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid", "data"] },
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
    textFilter: (t) => t.replace(/VH-CID:\s*\S+/gi, ""),
  }).trim()
}

// Crude HTML → text for parsing forwarded-email headers out of HTML.
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
