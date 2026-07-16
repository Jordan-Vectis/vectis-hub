"use client"

import { useState } from "react"

// Guide / Help for the Lot Wizard. A modal rather than a page so it can be
// opened mid-lot without losing the entry in progress.
//
// ⚠ This describes real wizard behaviour — required fields, the warnings, what
// Save does. If you change lot-wizard-tab.tsx, change this too: a guide that is
// quietly wrong is worse than no guide.

const ACCENT = "#2AB4A6"

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-gray-800 pt-4">
      <h3 className="font-semibold text-white mb-2">
        <span className="font-mono mr-2" style={{ color: ACCENT }}>{n}</span>
        {title}
      </h3>
      <div className="space-y-2 text-sm text-gray-300 leading-relaxed">{children}</div>
    </section>
  )
}

function Req() {
  return <span className="text-red-400 font-medium">Must be filled in.</span>
}

export default function LotWizardGuideButton({ tablet }: { tablet?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
        className={`flex-shrink-0 rounded-lg font-medium hover:bg-white/5 transition-colors ${
          tablet ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"
        }`}
      >
        Guide / Help
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#1C1C1E] border border-gray-700 rounded-2xl max-w-2xl w-full my-8 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-700 sticky top-0 bg-[#1C1C1E] rounded-t-2xl">
              <h2 className="text-lg font-bold text-white">Adding a lot — a quick guide</h2>
              <button
                onClick={() => setOpen(false)}
                style={{ touchAction: "manipulation" }}
                className="text-gray-500 hover:text-white text-xl leading-none px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              <div className="rounded-xl bg-black/30 border border-gray-800 px-4 py-3 space-y-2 text-sm text-gray-300">
                <p>
                  You add <strong className="text-white">one lot at a time</strong>, over 8 steps. Use
                  <strong className="text-white"> Next</strong> and <strong className="text-white">Back</strong> to move
                  about — you can go back and change anything.
                </p>
                <p>
                  <strong style={{ color: ACCENT }}>Nothing is saved until you press Save on step 8.</strong> If you
                  walk away halfway through, no lot is created.
                </p>
              </div>

              <Step n="1" title="Vendor &amp; Tote">
                <p>
                  Type or scan the <strong className="text-white">tote number</strong>. The vendor and receipt fill
                  themselves in — you should not need to type them.
                </p>
                <p>
                  Press <strong style={{ color: ACCENT }}>Start cataloguing</strong>. This locks the tote, vendor and
                  receipt for the whole batch, so every lot you add goes to the same one. They are remembered next time
                  you come in, on any device.
                </p>
                <p><Req /> If one of them isn&apos;t 7 characters you&apos;ll get a warning — have a look, then carry on if it&apos;s right.</p>
              </Step>

              <Step n="2" title="Barcode">
                <p>
                  Scan or type the barcode on the item&apos;s label. <Req />
                </p>
                <p>
                  <strong className="text-white">⊕ Next Barcode Number</strong> fills in the next number in sequence, if
                  you&apos;re working through a run of them.
                </p>
                <p className="text-gray-400">Two things can stop you here:</p>
                <ul className="list-disc pl-5 space-y-1 text-gray-400">
                  <li>
                    <strong className="text-red-400">Barcode already assigned</strong> — that barcode is already on
                    another lot, and it tells you which one and which sale. Usually it means the barcode has been used
                    twice, or you&apos;ve scanned the wrong label. Press <strong className="text-white">Change barcode</strong> to
                    scan again.
                  </li>
                  <li>
                    <strong className="text-amber-400">Doesn&apos;t look like it belongs to this auction</strong> — the
                    barcode doesn&apos;t start with this sale&apos;s code. Check you&apos;re in the right sale.
                  </li>
                </ul>
                <p className="text-gray-500">
                  Both let you continue anyway if you know you&apos;re right — but have a proper look first.
                </p>
              </Step>

              <Step n="3" title="Key Points">
                <p>
                  Type what you know about the item: what it is, any model, class or catalogue numbers on it, damage,
                  and anything missing.
                </p>
                <p>
                  <strong className="text-white">You are not writing the description.</strong> The AI writes that from
                  your key points. Just tell it the facts — short notes are fine.
                </p>
                <p>
                  If you&apos;d rather write it yourself, tick{" "}
                  <strong className="text-amber-300">Exclude from AI</strong> and type the full description in the box.
                </p>
                <p className="text-gray-500">
                  Optional — you can leave it empty. If a word looks misspelled you&apos;ll get a gentle nudge to check it.
                </p>
              </Step>

              <Step n="4" title="Categories">
                <p>
                  Pick a <strong className="text-white">Main Category</strong>, then a{" "}
                  <strong className="text-white">Sub Category</strong>, and the brand if you know it. Start typing and
                  pick from the list.
                </p>
                <p>
                  <strong className="text-white">Use the list.</strong> If you type something that isn&apos;t on it, you&apos;ll
                  be warned it won&apos;t match up in Business Central. If it&apos;s only the capitals that are different,
                  there&apos;s a one-tap button to correct it.
                </p>
                <p>
                  <strong className="text-white">📌 Pin</strong> keeps that category for the next lot — handy when a
                  whole tote is the same sort of thing.
                </p>
                <p className="text-gray-500">Optional, but fill it in if you can.</p>
              </Step>

              <Step n="5" title="Estimate">
                <p>
                  A <strong className="text-white">Low</strong> and a <strong className="text-white">High</strong>. Tap
                  a common value or type your own. <Req />
                </p>
                <p>
                  If the Low is higher than the High you&apos;ll be told they look the wrong way round, with a button to{" "}
                  <strong className="text-white">Swap them</strong>. The same figure twice is fine.
                </p>
              </Step>

              <Step n="6" title="Condition">
                <p>
                  Tap the condition. Tap it again to unpick it.
                </p>
                <p>
                  <strong className="text-white">Condition To</strong> is for a range — pick Good and then Excellent for
                  &ldquo;Good to Excellent&rdquo;. Leave it alone for a single condition.
                </p>
                <p>
                  If the box or packaging is a different condition to the item, tick{" "}
                  <strong className="text-white">Add a separate box / packaging condition</strong> and set it there.
                </p>
                <p className="text-gray-500">Optional.</p>
              </Step>

              <Step n="7" title="Parcel Size">
                <p>
                  How it&apos;ll be posted: Small, Medium, Large, Contact or Collection Only. <Req />
                </p>
              </Step>

              <Step n="8" title="Photos &amp; Save">
                <p>
                  Take photos of the item, or skip it — photos can be added later in Photography.
                </p>
                <p>
                  Press <strong style={{ color: ACCENT }}>Save</strong>. That is the moment the lot is created.
                </p>
                <p>
                  You&apos;ll go straight back to <strong className="text-white">step 2</strong> ready for the next
                  barcode. The tote, vendor and receipt stay locked, so just keep scanning.
                </p>
              </Step>

              <section className="border-t border-gray-800 pt-4">
                <h3 className="font-semibold text-white mb-2">If you get stuck</h3>
                <div className="space-y-2 text-sm text-gray-300 leading-relaxed">
                  <p>
                    <strong className="text-amber-400">Amber</strong> means &ldquo;have a look at this&rdquo; — it might
                    be fine. <strong className="text-red-400">Red</strong> means something definitely clashes with a lot
                    that already exists.
                  </p>
                  <p>
                    A warning won&apos;t stop you working — there&apos;s always a way to continue. But they&apos;re
                    usually right, so read them before you carry on.
                  </p>
                  <p className="text-gray-500">
                    If a lot goes in wrong, it can be fixed on the Lots tab — nothing here is permanent.
                  </p>
                </div>
              </section>
            </div>

            <div className="px-6 py-4 border-t border-gray-700">
              <button
                onClick={() => setOpen(false)}
                style={{ background: ACCENT, color: "#1C1C1E", touchAction: "manipulation" }}
                className="w-full py-2.5 rounded-lg font-semibold"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
