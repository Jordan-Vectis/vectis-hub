"use client"

import { useState, type ReactNode } from "react"
import { findTitle, type CheckExtra, type ScanController, type Snapshot } from "@/lib/goods-in/scan-client/controller"
import type { LookupResponse, ScanHere } from "@/lib/goods-in/scan-client/types"
import { cleanCode } from "@/lib/goods-in/scan-client/device"
import { ProblemList, RecentList, ScanLists, TypeCode } from "./parts"
import { bigBtn, btn, btnTall, card, field, kindWord, mono, plural, when } from "./ui"

// The scanner's four screens. Each is a column of big blocks with its main buttons at the BOTTOM
// (BottomBar), where a thumb reaches them on a scanner held in one hand.

function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 flex gap-2 [&>*]:flex-1">
      {children}
    </div>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────

function Tile({ title, hint, onClick, tone }: { title: string; hint: string; onClick: () => void; tone: string }) {
  return (
    <button type="button" onClick={onClick} className={`w-full min-h-24 rounded-2xl px-5 py-4 text-left transition-colors ${tone}`}>
      <span className="block text-2xl font-extrabold leading-tight">{title}</span>
      <span className="mt-1 block text-base leading-snug opacity-90">{hint}</span>
    </button>
  )
}

export function HomeScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <>
      <div className="space-y-3">
        <Tile
          title="Put away / Move"
          hint="Scan an item, then where it's going. Or scan a location first to put a run of things there."
          onClick={() => ctl.go("move")}
          tone="bg-indigo-600 text-white active:bg-indigo-700"
        />
        <Tile
          title="Find"
          hint={s.online ? "Scan anything — what it is and where it is now." : "Needs the Wi-Fi — you're offline."}
          onClick={() => ctl.go("find")}
          tone="bg-sky-700 text-white active:bg-sky-800"
        />
        <Tile
          title="Check a location"
          hint={s.online ? "Scan a shelf or bay, then everything on it." : "Needs the Wi-Fi — you're offline."}
          onClick={() => ctl.go("check")}
          tone="bg-teal-700 text-white active:bg-teal-800"
        />
        <p className="px-1 text-sm text-gray-600 dark:text-gray-400">A scan on this screen starts Put away / Move.</p>
      </div>
      <ScanLists s={s} ctl={ctl} />
      <Settings s={s} ctl={ctl} />
    </>
  )
}

function Switch({ on, label, hint, onClick }: { on: boolean; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="w-full flex items-center gap-4 min-h-14 px-3 py-2 text-left">
      <span className={`relative inline-flex h-8 w-14 shrink-0 rounded-full transition-colors ${on ? "bg-indigo-600" : "bg-gray-300 dark:bg-gray-600"}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? "translate-x-7" : "translate-x-1"}`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{label}</span>
        <span className="block text-sm text-gray-600 dark:text-gray-400">{hint}</span>
      </span>
    </button>
  )
}

function Settings({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <section className={`${card} divide-y divide-gray-200 dark:divide-gray-800`} aria-label="Scanner settings">
      <Switch on={s.sound} label={`Sound: ${s.sound ? "on" : "off"}`} hint="A pip when a scan is taken, a buzz when it isn't." onClick={ctl.toggleSound} />
      {s.nativeAvailable !== null && (
        <Switch
          on={s.takeDirect}
          label="Take scans straight from the scanner"
          hint={s.takeDirect ? "On — scans come straight to this screen, never into the wrong box." : "Off — the scanner types like a keyboard (other apps work the same way)."}
          onClick={() => void ctl.toggleDirect()}
        />
      )}
      <p className="px-3 py-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
        {s.scannerMode === "native" ? "Reading scans from the scanner app." : "Reading scans typed by the scanner (keyboard mode)."}{" "}
        {s.locationCount ? `${plural(s.locationCount, "location")} saved on this scanner for offline use.` : "No locations saved yet — they're saved the first time the scanner is online."}{" "}
        {s.storeKind === "localstorage" && "Scans are kept in this browser's local storage."}
        {s.persisted === false && s.storeKind !== "memory" && " This browser hasn't promised to keep them: if the device runs very short of space it could clear scans still waiting, so send them when you can."}
      </p>
    </section>
  )
}

// ── Put away / Move ──────────────────────────────────────────────────────────────────────────

export function MoveScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const [noteOpen, setNoteOpen] = useState(false)
  return (
    <>
      {s.pinned ? (
        <section className="rounded-2xl border-4 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 px-4 py-4">
          <p className="text-sm font-bold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">Location stays set</p>
          <p className={`${mono} mt-1 text-4xl font-extrabold break-all`}>{s.pinned.code}</p>
          <p className="mt-1 text-base text-gray-700 dark:text-gray-200">
            {[s.pinned.kind ? kindWord(s.pinned.kind) : null, s.pinned.name].filter(Boolean).join(" · ") || "Location"} · {plural(s.pinnedCount, "item")} scanned here
          </p>
          <p className="mt-2 text-base font-semibold">Scan each item — they all go here. Scan another location to change it.</p>
          <button type="button" className={`${bigBtn} mt-3`} onClick={ctl.done}>Done with {s.pinned.code}</button>
        </section>
      ) : s.pending ? (
        <section className="rounded-2xl border-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-4">
          <p className="text-sm font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">Waiting for a location</p>
          <p className={`${mono} mt-1 text-4xl font-extrabold break-all`}>{s.pending}</p>
          <p className="mt-2 text-base font-semibold">Now scan where it&apos;s going.</p>
          <button type="button" className={`${btnTall} mt-3 w-full`} onClick={ctl.notThisOne}>Not this one</button>
        </section>
      ) : (
        <section className={`${card} px-4 py-4`}>
          <p className="text-lg font-semibold">Scan a tote, pallet or lot — then where it&apos;s going.</p>
          <p className="mt-1 text-base text-gray-700 dark:text-gray-300">Putting a lot of things in one place? Scan the location first: everything after it goes there until you press Done.</p>
        </section>
      )}

      <ProblemList s={s} ctl={ctl} />

      {noteOpen || s.note ? (
        <div className={`${card} p-3 space-y-2`}>
          <label htmlFor="scan-note" className="block text-sm font-semibold text-gray-700 dark:text-gray-200">Note for the next move</label>
          {/* Enter (or the keyboard's Done) puts the cursor back in the scan box, so the next scan
              isn't typed into the note (a scanner's burst into it is caught as a scan anyway). */}
          <input
            id="scan-note"
            className={field}
            value={s.note}
            onChange={e => ctl.setNote(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } }}
            placeholder="e.g. box damaged"
            autoComplete="off"
            enterKeyHint="done"
          />
          <p className="text-sm text-gray-600 dark:text-gray-400">Goes with the next move only, then clears.</p>
          <button type="button" className={`${btn} w-full`} onClick={() => { ctl.setNote(""); setNoteOpen(false) }}>{s.note ? "Clear the note" : "Close"}</button>
        </div>
      ) : (
        <button type="button" className={`${btn} w-full`} onClick={() => setNoteOpen(true)}>Add a note to the next move</button>
      )}
      <TypeCode ctl={ctl} />
      <RecentList s={s} ctl={ctl} />
    </>
  )
}

export function MoveBar({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <BottomBar>
      <button type="button" className={btnTall} onClick={ctl.home}>← Home</button>
      {s.pinned && <button type="button" className={bigBtn} onClick={ctl.done}>Done</button>}
    </BottomBar>
  )
}

export function HomeBar({ ctl }: { ctl: ScanController }) {
  return (
    <BottomBar>
      <button type="button" className={btnTall} onClick={ctl.home}>← Home</button>
    </BottomBar>
  )
}

// ── Find ─────────────────────────────────────────────────────────────────────────────────────

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-gray-600 dark:text-gray-400">{k}</dt>
      <dd className="font-semibold break-words">{children}</dd>
    </>
  )
}

function WhereNow({ res }: { res: LookupResponse }) {
  const w = res.where
  if (!w) return <span>Not put anywhere yet</span>
  return (
    <span>
      <span className={`${mono} text-xl font-extrabold`}>{w.code}</span>{" "}
      <span className="font-normal text-gray-700 dark:text-gray-300">
        ({w.kind ? kindWord(w.kind) : "no longer a location"}{w.name ? ` · ${w.name}` : ""}{w.kind && !w.active ? " · switched off" : ""})
      </span>
      {(w.since || w.by) && <span className="block text-sm font-normal text-gray-600 dark:text-gray-400">Put there {when(w.since)}{w.by ? ` by ${w.by}` : ""}</span>}
    </span>
  )
}

function HereList({ rows, truncated }: { rows: ScanHere[]; truncated?: boolean }) {
  if (!rows.length) return <p className="text-base text-gray-600 dark:text-gray-400">The Hub records nothing here.</p>
  const shown = rows.slice(0, 40)
  return (
    <div>
      <p className="text-base font-semibold">{plural(rows.length, "thing")}{truncated ? "+" : ""} recorded here</p>
      <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-800">
        {shown.map(r => (
          <li key={`${r.type}-${r.code}`} className="py-2">
            <span className={`${mono} text-lg font-bold`}>{r.code || "(no barcode)"}</span>{" "}
            <span className="text-sm text-gray-600 dark:text-gray-400">{r.type === "lot" ? "Lot" : r.type === "pallet" ? "Pallet" : "Tote"}{r.customer ? ` · ${r.customer}` : ""}{r.what ? ` · ${r.what}` : ""}</span>
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <p className="text-sm text-gray-600 dark:text-gray-400">…and {plural(rows.length - shown.length, "more")}. Check a location lists them all.</p>}
    </div>
  )
}

function FindResult({ res, ctl }: { res: LookupResponse; ctl: ScanController }) {
  const h = res.hit
  if (!h) {
    return (
      <section className={`${card} p-4`}>
        <p className="text-xl font-bold">Nothing found for <span className={mono}>{res.code}</span></p>
        <p className="mt-1 text-base text-gray-700 dark:text-gray-300">It isn&apos;t a tote, pallet, lot, receipt or location the Hub knows. Check the label and scan again.</p>
      </section>
    )
  }
  // The banner already says findTitle(res); the card names the thing and gives the detail.
  const heading = h.type === "container" ? `${h.kind === "pallet" ? "Pallet" : "Tote"} ${h.id}` : h.type === "lot" ? `Lot ${h.barcode}` : h.type === "location" ? `Location ${h.code}` : h.type === "receipt" ? `Receipt ${h.id}` : `Vendor number ${h.vendorNo ?? res.code}`
  return (
    <section className={`${card} p-4 space-y-3`} aria-label={findTitle(res)}>
      <p className={`${mono} text-2xl font-extrabold break-words`}>{heading}</p>
      {h.type === "container" && (
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-base">
            <Row k="Now at"><WhereNow res={res} /></Row>
            <Row k="Customer">{h.customer}</Row>
            <Row k="Receipt"><span className={mono}>{h.receiptId}</span></Row>
            {(h.category || h.description) && <Row k="What">{[h.category, h.description].filter(Boolean).join(" — ")}</Row>}
            {h.status && <Row k="Status">{h.status === "returned" ? "Returned to the customer" : h.status === "bench" ? "At a bench" : h.status === "stored" ? "In storage" : h.status === "catalogued" ? "Catalogued" : "Booked in"}</Row>}
          </dl>
          <button type="button" className={bigBtn} onClick={ctl.moveFromFind}>Move it</button>
        </>
      )}
      {h.type === "lot" && (
        <>
          <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-base">
            <Row k="Shelf now"><WhereNow res={res} /></Row>
            <Row k="Title">{h.title}</Row>
            {h.auction && <Row k="Sale"><span className={mono}>{h.auction}</span></Row>}
            {h.tote && <Row k="Tote"><span className={mono}>{h.tote}</span></Row>}
            {h.receipt && <Row k="Receipt"><span className={mono}>{h.receipt}</span></Row>}
          </dl>
          <button type="button" className={bigBtn} onClick={ctl.moveFromFind}>Move it</button>
        </>
      )}
      {h.type === "location" && (
        <>
          <p className="text-base text-gray-700 dark:text-gray-300">{[kindWord(h.kind), h.name].filter(Boolean).join(" · ")}</p>
          <HereList rows={res.here ?? []} truncated={res.hereTruncated} />
          <div className="grid gap-2">
            <button type="button" className={bigBtn} onClick={ctl.checkFromFind}>Check this location</button>
            <button type="button" className={btnTall} onClick={ctl.moveFromFind}>Put things here</button>
          </div>
        </>
      )}
      {h.type === "receipt" && (
        <>
          <p className="text-base">{h.customer} · {plural(h.containers, "tote or pallet", "totes and pallets")}</p>
          {res.containers && res.containers.length > 0 && (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {res.containers.map(c => (
                <li key={c.id} className="py-2 flex items-center gap-2">
                  <span className={`${mono} text-lg font-bold`}>{c.id}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{c.kind === "pallet" ? "Pallet" : "Tote"}</span>
                  <span className={`${mono} ml-auto font-semibold`}>{c.locationCode ?? "not put away"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400">A receipt isn&apos;t moved — scan the label on each tote or pallet.</p>
        </>
      )}
      {h.type === "customer" && <p className="text-base">{h.name} — a customer&apos;s vendor number. Scan the tote, pallet or lot label instead.</p>}
    </section>
  )
}

export function FindScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const f = s.find
  return (
    <>
      {!s.online && (
        <section className="rounded-2xl bg-amber-400 px-4 py-4 text-black">
          <p className="text-xl font-bold">Find needs the Wi-Fi</p>
          <p className="mt-1 text-base">This scanner is offline. Put away / Move still works — moves are saved and sent when the Wi-Fi is back.</p>
        </section>
      )}
      {f.status === "idle" && s.online && (
        <section className={`${card} px-4 py-4`}>
          <p className="text-lg font-semibold">Scan anything — a tote, pallet, lot, location or receipt.</p>
          <p className="mt-1 text-base text-gray-700 dark:text-gray-300">You&apos;ll see what it is and where the Hub has it now.</p>
        </section>
      )}
      {f.status === "looking" && (
        <section className={`${card} px-4 py-6`} role="status">
          <p className="text-xl font-semibold">Looking up <span className={mono}>{f.code}</span>…</p>
        </section>
      )}
      {f.status === "failed" && (
        <section className={`${card} px-4 py-4`}>
          <p className="text-xl font-bold">Couldn&apos;t look up <span className={mono}>{f.code}</span></p>
          <p className="mt-1 text-base">{f.message}</p>
        </section>
      )}
      {f.status === "done" && <FindResult res={f.res} ctl={ctl} />}
      <TypeCode ctl={ctl} />
      <ProblemList s={s} ctl={ctl} />
    </>
  )
}

// ── Check a location ─────────────────────────────────────────────────────────────────────────

const EXTRA_WORDS: Record<CheckExtra["state"], string> = {
  checking: "Looking it up…",
  elsewhere: "Recorded somewhere else",
  offline: "Not recorded here (couldn't ask the Hub where)",
  queued: "Move queued",
  moved: "Moved here ✓",
  failed: "Couldn't move it",
  "not-goods": "Not a tote, pallet or lot",
  unknown: "The Hub doesn't know this code",
}

export function CheckScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const c = s.check
  if (!c) {
    return (
      <>
        {!s.online && (
          <section className="rounded-2xl bg-amber-400 px-4 py-4 text-black">
            <p className="text-xl font-bold">Checking needs the Wi-Fi</p>
            <p className="mt-1 text-base">The Hub has to say what should be there. Put away / Move still works offline.</p>
          </section>
        )}
        <section className={`${card} px-4 py-4`}>
          <p className="text-lg font-semibold">Scan the label of the location you&apos;re checking.</p>
          <p className="mt-1 text-base text-gray-700 dark:text-gray-300">Then scan everything you can see on it. You&apos;ll see what&apos;s missing, what&apos;s recorded somewhere else (one tap moves it here), and anything the Hub doesn&apos;t know.</p>
        </section>
        <TypeCode ctl={ctl} placeholder="e.g. A10A1" />
        <ProblemList s={s} ctl={ctl} />
      </>
    )
  }
  if (c.status === "loading") {
    return <section className={`${card} px-4 py-6`} role="status"><p className="text-xl font-semibold">Reading what&apos;s at <span className={mono}>{c.place.code}</span>…</p></section>
  }
  if (c.status === "failed") {
    return (
      <>
        <section className={`${card} px-4 py-4`}>
          <p className="text-xl font-bold">Can&apos;t check <span className={mono}>{c.place.code}</span></p>
          <p className="mt-1 text-base">{c.error}</p>
          <p className="mt-2 text-base font-semibold">Scan the location again to try once more.</p>
        </section>
        <TypeCode ctl={ctl} placeholder="e.g. A10A1" />
        <ProblemList s={s} ctl={ctl} />
      </>
    )
  }
  const foundSet = new Set(c.found)
  const missing = c.expected.filter(e => !foundSet.has(cleanCode(e.code)))
  const ticked = c.expected.filter(e => foundSet.has(cleanCode(e.code)))
  const elsewhere = c.extras.filter(x => x.state === "elsewhere" || x.state === "offline" || x.state === "queued" || x.state === "moved" || x.state === "failed" || x.state === "checking")
  const strange = c.extras.filter(x => x.state === "unknown" || x.state === "not-goods")
  const movedHere = c.extras.filter(x => x.state === "moved").length
  return (
    <>
      <section className="rounded-2xl border-4 border-teal-500 bg-teal-50 dark:bg-teal-950/40 px-4 py-4">
        <p className="text-sm font-bold uppercase tracking-wide text-teal-800 dark:text-teal-200">Checking</p>
        <p className={`${mono} mt-1 text-4xl font-extrabold break-all`}>{c.place.code}</p>
        <p className="mt-2 text-lg font-semibold">
          {c.found.length} of {c.expected.length}{c.truncated ? "+" : ""} found · {missing.length} not scanned yet{movedHere ? ` · ${movedHere} moved here` : ""}
        </p>
      </section>

      {elsewhere.length > 0 && (
        <section className={`${card} p-3`} aria-label="Scanned here, recorded somewhere else">
          <h2 className="text-lg font-bold">Here, but recorded somewhere else ({elsewhere.length})</h2>
          <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-800">
            {elsewhere.map(x => (
              <li key={x.code} className="py-3">
                <p><span className={`${mono} text-xl font-extrabold`}>{x.code}</span> <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{EXTRA_WORDS[x.state]}</span></p>
                {(x.what || x.where) && <p className="text-sm text-gray-600 dark:text-gray-400 break-words">{x.what}{x.where ? ` · recorded at ${x.where}` : ""}</p>}
                {(x.state === "elsewhere" || x.state === "offline") && (
                  <button type="button" className={`${bigBtn} mt-2`} onClick={() => ctl.moveHere(x.code)}>Move it here ({c.place.code})</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} p-3`} aria-label="Recorded here but not scanned">
        <h2 className="text-lg font-bold">Recorded here, not scanned yet ({missing.length})</h2>
        {missing.length === 0 ? (
          <p className="py-2 text-base text-emerald-700 dark:text-emerald-300 font-semibold">{c.expected.length ? "Everything the Hub records here has been scanned." : "The Hub records nothing here."}</p>
        ) : (
          <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-800">
            {missing.map(e => (
              <li key={`${e.type}-${e.code}`} className="py-2">
                <span className={`${mono} text-lg font-bold`}>{e.code || "(no barcode)"}</span>{" "}
                <span className="text-sm text-gray-600 dark:text-gray-400">{e.type === "lot" ? "Lot" : e.type === "pallet" ? "Pallet" : "Tote"}{e.customer ? ` · ${e.customer}` : ""}{e.what ? ` · ${e.what}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {c.truncated && <p className="text-sm text-gray-600 dark:text-gray-400">This location holds more than the scanner can list; anything else scanned is checked with the Hub.</p>}
      </section>

      {strange.length > 0 && (
        <section className={`${card} p-3`} aria-label="Codes the Hub doesn't know">
          <h2 className="text-lg font-bold">Not goods the Hub knows ({strange.length})</h2>
          <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-800">
            {strange.map(x => (
              <li key={x.code} className="py-2">
                <span className={`${mono} text-lg font-bold`}>{x.code}</span>{" "}
                <span className="text-sm text-gray-600 dark:text-gray-400">{x.what ?? EXTRA_WORDS[x.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ticked.length > 0 && (
        <details className={`${card} p-3`}>
          <summary className="min-h-12 flex items-center text-lg font-bold cursor-pointer">Found ({ticked.length})</summary>
          <ul className="mt-1 divide-y divide-gray-200 dark:divide-gray-800">
            {ticked.map(e => <li key={`${e.type}-${e.code}`} className={`${mono} py-2 text-lg font-bold`}>{e.code} ✓</li>)}
          </ul>
        </details>
      )}
      <TypeCode ctl={ctl} />
      <button type="button" className={`${btn} w-full`} onClick={ctl.restartCheck}>Start this check again</button>
      <ProblemList s={s} ctl={ctl} />
    </>
  )
}

export function CheckBar({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <BottomBar>
      <button type="button" className={btnTall} onClick={ctl.home}>← Home</button>
      {s.check && <button type="button" className={bigBtn} onClick={ctl.finishCheck}>Finish</button>}
    </BottomBar>
  )
}
