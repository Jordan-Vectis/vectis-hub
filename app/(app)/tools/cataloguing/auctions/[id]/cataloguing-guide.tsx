"use client"

import { useState } from "react"

// Guide / Help for the tablet cataloguing screen. A modal rather than a page so
// it can be opened mid-lot without losing the entry in progress, and it opens on
// whichever tab you are already looking at.
//
// ⚠ This describes REAL behaviour — required fields, what each warning means,
// what Save does. If you change lot-wizard-tab.tsx, photo-only-tab.tsx,
// review-tab.tsx or the Lots list in tablet-tabs.tsx, update this too: a guide
// that is quietly wrong is worse than no guide.
//
// Tone: plain and simple, never condescending — the cataloguers read this.

const ACCENT = "#2AB4A6"

type GuideTab = "manage" | "add-lot" | "photo-only" | "review"

const TABS: { id: GuideTab; emoji: string; label: string }[] = [
  { id: "manage",     emoji: "📋", label: "Lots" },
  { id: "add-lot",    emoji: "➕", label: "Add Lot" },
  { id: "photo-only", emoji: "📷", label: "Photo Only" },
  { id: "review",     emoji: "🔍", label: "Review" },
]

/** One numbered step of the Add Lot wizard. */
function Step({ emoji, n, title, children }: { emoji: string; n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-black/40 border border-gray-700 flex items-center justify-center text-lg">
          {emoji}
        </div>
        <div className="text-[10px] font-mono mt-1 text-gray-600">{n}/8</div>
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <h4 className="font-semibold text-white text-sm mb-1.5">{title}</h4>
        <div className="space-y-1.5 text-sm text-gray-300 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

/** A coloured callout that mirrors a real on-screen message. */
function Callout({ tone, title, children }: { tone: "red" | "amber" | "teal"; title: string; children: React.ReactNode }) {
  const styles = {
    red:   "border-red-600/50 bg-red-950/30 text-red-300",
    amber: "border-amber-600/50 bg-amber-950/30 text-amber-300",
    teal:  "border-[#2AB4A6]/40 bg-[#2AB4A6]/10 text-[#7ad9cf]",
  }[tone]
  return (
    <div className={`rounded-lg border px-3 py-2 ${styles}`}>
      <p className="text-xs font-semibold mb-0.5">{title}</p>
      <div className="text-xs opacity-90 leading-relaxed">{children}</div>
    </div>
  )
}

function Req() {
  return <span className="text-red-400 font-medium">Must be filled in.</span>
}

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500">{children}</p>
}

export default function CataloguingGuideButton({
  tablet,
  currentTab,
}: {
  tablet?: boolean
  /** Opens the guide on the tab you're already using. */
  currentTab?: GuideTab
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState<GuideTab>(currentTab ?? "add-lot")

  function show() {
    setTab(currentTab ?? "add-lot")   // always land on what they're looking at
    setOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        style={{ touchAction: "manipulation", color: ACCENT, border: `1px solid ${ACCENT}66` }}
        className={`flex-shrink-0 rounded-lg font-medium hover:bg-white/5 transition-colors ${
          tablet ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"
        }`}
      >
        ❓ Guide / Help
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[#1C1C1E] border border-gray-700 rounded-2xl max-w-3xl w-full my-8 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-700">
              <div>
                <h2 className="text-lg font-bold text-white">Guide — how to use this screen</h2>
                <p className="text-xs text-gray-500 mt-0.5">Pick a tab below to see how it works.</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ touchAction: "manipulation" }}
                className="text-gray-500 hover:text-white text-xl leading-none px-2"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Section picker — mirrors the real tab bar */}
            <div className="flex border-b border-gray-700 bg-[#161618]">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{ touchAction: "manipulation" }}
                  className={`flex-1 py-3 text-xs sm:text-sm font-semibold border-b-2 transition-colors ${
                    tab === t.id
                      ? "border-[#2AB4A6] text-[#2AB4A6]"
                      : "border-transparent text-gray-500 hover:text-gray-300"
                  }`}
                >
                  <span className="mr-1.5">{t.emoji}</span>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="px-6 py-5">
              {/* ── 📋 LOTS ─────────────────────────────────────────────── */}
              {tab === "manage" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    <span className="text-lg mr-1">📋</span>
                    Everything already added to this sale. The number on the tab is how many there are.
                  </p>

                  <div className="space-y-2.5 text-sm text-gray-300 leading-relaxed">
                    <p>
                      🔎 <strong className="text-white">Search</strong> finds a lot by its{" "}
                      <strong className="text-white">barcode, title, vendor or tote</strong>. Scanning a
                      barcode into the box is the quickest way to find one item.
                    </p>
                    <p>
                      🧑 <strong className="text-white">All cataloguers</strong>{" "}
                      narrows it down to one person&apos;s lots, and you can sort by{" "}
                      <strong className="text-white">lot order, newest or oldest</strong>.
                    </p>
                    <p>
                      👆 <strong className="text-white">Tap any lot to open it</strong>{" "}
                      and change anything — title, barcode, vendor, receipt, description, category, condition,
                      estimate, photos. There&apos;s a <strong className="text-white">Delete</strong> button
                      in there too.
                    </p>
                  </div>

                  <Callout tone="teal" title="Your filters stay put">
                    Search and filters are remembered when you come back out of a lot, so you don&apos;t
                    have to set them up again every time.
                  </Callout>

                  <Tip>
                    A lot showing <em>Uncatalogued</em> in grey just means it has no title yet — usually
                    one added from the Photo Only tab.
                  </Tip>
                </div>
              )}

              {/* ── ➕ ADD LOT ──────────────────────────────────────────── */}
              {tab === "add-lot" && (
                <div className="space-y-4">
                  <div className="rounded-xl bg-black/30 border border-gray-800 px-4 py-3 space-y-1.5 text-sm text-gray-300">
                    <p>
                      <span className="text-lg mr-1">➕</span>
                      One lot at a time, over <strong className="text-white">8 steps</strong>. Use{" "}
                      <strong className="text-white">Next</strong> and <strong className="text-white">Back</strong> —
                      you can go back and change anything.
                    </p>
                    <p>
                      <strong style={{ color: ACCENT }}>Nothing is saved until you press Save on step 8.</strong>{" "}
                      If you walk away halfway through, no lot is created.
                    </p>
                  </div>

                  <div className="pt-1">
                    <Step emoji="📦" n={1} title="Vendor & Tote">
                      <p>
                        Type or scan the <strong className="text-white">tote number</strong> — the vendor
                        and receipt fill themselves in.
                      </p>
                      <p>
                        Press <strong style={{ color: ACCENT }}>Start cataloguing</strong>{" "}
                        to lock all three in for the whole batch, so every lot goes to the same one. They&apos;re
                        remembered next time, on any device.
                      </p>
                      <p><Req /></p>
                      <Tip>If one isn&apos;t 7 characters you&apos;ll get a warning — check it, then carry on if it&apos;s right.</Tip>
                    </Step>

                    <Step emoji="🏷️" n={2} title="Barcode">
                      <p>Scan or type the barcode on the item&apos;s label. <Req /></p>
                      <p>
                        <strong className="text-white">⊕ Next Barcode Number</strong> fills in the next
                        one in sequence.
                      </p>
                      <div className="space-y-2 pt-1">
                        <Callout tone="red" title="🚫 Barcode already assigned">
                          That barcode is already on another lot — it tells you which lot and which sale.
                          Usually the label has been used twice, or the wrong one got scanned. Press{" "}
                          <strong>Change barcode</strong> to scan again.
                        </Callout>
                        <Callout tone="amber" title="⚠ Doesn't look like this auction">
                          The barcode doesn&apos;t start with this sale&apos;s code. Check you&apos;re in
                          the right sale.
                        </Callout>
                      </div>
                      <Tip>Both let you continue anyway if you know you&apos;re right — but have a proper look first.</Tip>
                    </Step>

                    <Step emoji="✍️" n={3} title="Key Points">
                      <p>
                        Type what you know: what it is, any model, class or catalogue numbers on it,
                        damage, anything missing.
                      </p>
                      <Callout tone="teal" title="You are not writing the description">
                        The AI writes that from your key points. Just give it the facts — short notes are
                        perfect.
                      </Callout>
                      <p className="pt-1">
                        Want to write it yourself? Tick{" "}
                        <strong className="text-amber-300">Exclude from AI</strong> and type the full
                        description.
                      </p>
                      <Tip>Optional. If a word looks misspelled you&apos;ll get a nudge to check it.</Tip>
                    </Step>

                    <Step emoji="🗂️" n={4} title="Categories">
                      <p>
                        Pick a <strong className="text-white">Main</strong> and{" "}
                        <strong className="text-white">Sub Category</strong>, plus the brand if you know
                        it. Start typing and pick from the list.
                      </p>
                      <p>
                        <strong className="text-white">Use the list.</strong>{" "}
                        Type something that isn&apos;t on it and you&apos;ll be warned it won&apos;t match up in Business Central. If only
                        the capitals differ there&apos;s a one-tap fix.
                      </p>
                      <p>
                        📌 <strong className="text-white">Pin</strong> keeps that category for the next lot
                        — handy when a whole tote is the same sort of thing.
                      </p>
                      <Tip>Optional, but fill it in if you can.</Tip>
                    </Step>

                    <Step emoji="💷" n={5} title="Estimate">
                      <p>
                        A <strong className="text-white">Low</strong> and a{" "}
                        <strong className="text-white">High</strong>. Tap a common value or type your own.{" "}
                        <Req />
                      </p>
                      <Tip>
                        Got them the wrong way round? You&apos;ll be told, with a button to swap them. The
                        same figure twice is fine.
                      </Tip>
                    </Step>

                    <Step emoji="✨" n={6} title="Condition">
                      <p>Tap the condition. Tap it again to unpick it.</p>
                      <p>
                        <strong className="text-white">Condition To</strong>{" "}
                        is for a range — Good, then Excellent, gives &ldquo;Good to Excellent&rdquo;. Leave it for a single condition.
                      </p>
                      <p>
                        📦 If the box or packaging is a different condition to the item, tick{" "}
                        <strong className="text-white">Add a separate box / packaging condition</strong>.
                      </p>
                      <Tip>Optional.</Tip>
                    </Step>

                    <Step emoji="📮" n={7} title="Parcel Size">
                      <p>
                        How it&apos;ll be posted: Small, Medium, Large, Contact or Collection Only.{" "}
                        <Req />
                      </p>
                    </Step>

                    <Step emoji="📸" n={8} title="Photos & Save">
                      <p>Take photos, or skip — they can be added later in Photography.</p>
                      <p>
                        Press <strong style={{ color: ACCENT }}>Save</strong>. That is the moment the lot
                        is created.
                      </p>
                      <Callout tone="teal" title="↩ Straight on to the next one">
                        You go back to <strong>step 2</strong> ready for the next barcode. The tote, vendor
                        and receipt stay locked — just keep scanning.
                      </Callout>
                    </Step>
                  </div>
                </div>
              )}

              {/* ── 📷 PHOTO ONLY ───────────────────────────────────────── */}
              {tab === "photo-only" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    <span className="text-lg mr-1">📷</span>
                    For when you want the <strong className="text-white">photos done now</strong> and the
                    details filled in later. Scan, snap, save — no description, no estimate, no categories.
                  </p>

                  <div className="space-y-2.5 text-sm text-gray-300 leading-relaxed">
                    <p>
                      1️⃣ <strong className="text-white">Scan the lot barcode</strong> (or type it). You can
                      scan the tote too, and pin it so it stays for the next one.
                    </p>
                    <p>
                      2️⃣ <strong className="text-white">Take your photos</strong> of the item.
                    </p>
                    <p>
                      3️⃣ <strong className="text-white">Save.</strong> The lot is created with just the
                      barcode and the photos.
                    </p>
                  </div>

                  <Callout tone="teal" title="What happens next">
                    It shows on the <strong>Lots</strong> tab as <em>Uncatalogued</em>{" "}
                    until someone adds the details. Open it from there whenever you&apos;re ready.
                  </Callout>

                  <Tip>Use Add Lot instead if you&apos;re doing the whole thing in one go.</Tip>
                </div>
              )}

              {/* ── 🔍 REVIEW ───────────────────────────────────────────── */}
              {tab === "review" && (
                <div className="space-y-4">
                  <p className="text-sm text-gray-300 leading-relaxed">
                    <span className="text-lg mr-1">🔍</span>
                    A checking screen — it hunts out lots that look like they need another look, so
                    problems get caught before the sale goes out.
                  </p>

                  <div className="space-y-2.5 text-sm text-gray-300 leading-relaxed">
                    <p>A lot gets picked out when:</p>
                    <ul className="list-disc pl-5 space-y-1 text-gray-400">
                      <li>it has <strong className="text-white">no description</strong> or{" "}
                        <strong className="text-white">no photos</strong>;</li>
                      <li>something in the <strong className="text-white">key points didn&apos;t make it
                        into the description</strong> — the wording is highlighted so you can see what&apos;s
                        missing;</li>
                      <li>somebody has <strong className="text-white">flagged it</strong>.</li>
                    </ul>
                    <p className="pt-1">
                      ✏️ Fix the wording right there and press{" "}
                      <strong className="text-white">Save description</strong>.
                    </p>
                    <p>
                      🚩 <strong className="text-white">Flag an error</strong>{" "}
                      leaves a note on a lot for someone else to pick up. The filters at the top show only flagged lots, or only one
                      cataloguer&apos;s.
                    </p>
                  </div>

                </div>
              )}
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
