import { VENDOR_TERMS, VENDOR_TERMS_TITLE } from "@/lib/goods-in/vendor-terms"

// Vectis's vendor terms as they are printed on every receipt (lib/goods-in/vendor-terms.ts — the
// one copy of the wording), laid out to read on screen: headings and paragraphs, with a section's
// lettered sub-clauses ("(a) …", "(b) …") indented and a shade quieter, so each heading leads its
// section. A server component, handed to the Fees & agreement tab's fold-out, so the long text is
// never part of the page's JavaScript.

const SUB_CLAUSE = /^\([a-z0-9]+\)/i

export default function VendorTermsText() {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
      <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{VENDOR_TERMS_TITLE}</p>
      {VENDOR_TERMS.map((b, i) => {
        const sub = !b.heading && SUB_CLAUSE.test(b.text)
        return (
          <div key={i} className={sub ? "pl-4" : ""}>
            {b.heading && <h3 className="mb-0.5 font-semibold text-gray-900 dark:text-white">{b.heading}</h3>}
            <p className={sub ? "text-gray-600 dark:text-gray-400" : ""}>{b.text}</p>
          </div>
        )
      })}
    </div>
  )
}
