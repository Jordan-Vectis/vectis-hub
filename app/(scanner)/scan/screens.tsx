"use client"

import { useState, type ReactNode } from "react"
import { findTitle, type CheckExtra, type ScanController, type Snapshot } from "@/lib/goods-in/scan-client/controller"
import type { LookupResponse, ScanHere } from "@/lib/goods-in/scan-client/types"
import { cleanCode } from "@/lib/goods-in/scan-client/device"
import { CheckListIcon, ChevronIcon, FindIcon, MoveIcon, PinIcon } from "./icons"
import { ActionRow, ProblemList, RecentList, ScanLists, TypeCode } from "./parts"
import { bigBtn, btn, btnTall, card, cardTitle, field, kindWord, mono, muted, plural, rowBtn, when } from "./ui"

// The scanner's four screens, compact for a small screen: one slim row for what's going on (the
// location that stays set, the item waiting, the location being checked), then the lists. The top
// bar (parts.tsx) has the way back and the settings cog; the only bottom row is Check's Finish.
// Every button calls the same ScanController method as before — layout only.

/** A thumb-height row along the bottom of the screen — part of the column, never floating over it. */
function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 flex gap-2 [&>*]:flex-1">
      {children}
    </div>
  )
}

/** A short coloured strip: the screen needs the Wi-Fi and hasn't got it. */
function NeedsWifi({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-amber-400 px-3 py-2 text-black">
      <p className="text-[15px] font-bold leading-snug">{title}</p>
      <p className="text-[13px] leading-snug">{children}</p>
    </section>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────────────────────

function Tile({ title, hint, icon, onClick, tone }: { title: string; hint: string; icon: ReactNode; onClick: () => void; tone: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex w-full min-h-16 items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${tone}`}>
      <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15">{icon}</span>
      <span className="min-w-0 flex-1">
        {/* Wrap, never cut: at 320px and 130% text the hint needs two lines (the tile is min-h-16,
            so it grows). ⚠ No `block` beside line-clamp — it overrides the clamp's display. */}
        <span className="block break-words text-base font-bold leading-tight">{title}</span>
        <span className="mt-0.5 line-clamp-2 break-words text-[13px] leading-snug opacity-90">{hint}</span>
      </span>
      <ChevronIcon className="h-5 w-5 shrink-0 opacity-80" />
    </button>
  )
}

export function HomeScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  return (
    <>
      <nav aria-label="Jobs" className="space-y-2">
        <Tile
          title="Put away / Move"
          hint="Item first, then where it goes"
          icon={<MoveIcon className="h-6 w-6" />}
          onClick={() => ctl.go("move")}
          tone="bg-indigo-600 text-white active:bg-indigo-700"
        />
        <Tile
          title="Find"
          hint={s.online ? "Where anything is now" : "Offline — needs the Wi-Fi"}
          icon={<FindIcon className="h-6 w-6" />}
          onClick={() => ctl.go("find")}
          tone="bg-sky-700 text-white active:bg-sky-800"
        />
        <Tile
          title="Check a location"
          hint={s.online ? "A shelf, then what's on it" : "Offline — needs the Wi-Fi"}
          icon={<CheckListIcon className="h-6 w-6" />}
          onClick={() => ctl.go("check")}
          tone="bg-teal-700 text-white active:bg-teal-800"
        />
        <p className={`${muted} px-0.5`}>A scan here starts Put away / Move.</p>
      </nav>
      <ScanLists s={s} ctl={ctl} />
    </>
  )
}

// ── Put away / Move ──────────────────────────────────────────────────────────────────────────

export function MoveScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const [noteOpen, setNoteOpen] = useState(false)
  const placeWords = s.pinned ? [s.pinned.kind ? kindWord(s.pinned.kind) : null, s.pinned.name].filter(Boolean).join(" · ") : ""
  return (
    <>
      {s.pinned ? (
        <section className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border-2 border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-2" aria-label="Location stays set">
          <PinIcon className="h-5 w-5 shrink-0 text-indigo-700 dark:text-indigo-300" />
          <div className="min-w-0 flex-1 basis-32">
            <p className={`${mono} text-lg font-extrabold leading-tight [overflow-wrap:anywhere]`}>{s.pinned.code}</p>
            <p className="text-[13px] leading-snug text-gray-700 dark:text-gray-200 break-words">
              Stays set · {plural(s.pinnedCount, "item")} here{placeWords ? ` · ${placeWords}` : ""}
            </p>
          </div>
          <button type="button" className={`${bigBtn} !w-auto shrink-0`} onClick={ctl.done}>Done</button>
        </section>
      ) : s.pending ? (
        <section className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2" aria-label="Waiting for a location">
          <div className="min-w-0 flex-1 basis-40">
            <p className="text-[13px] font-semibold leading-snug text-emerald-800 dark:text-emerald-200">Now scan where it&apos;s going</p>
            <p className={`${mono} text-lg font-extrabold leading-tight [overflow-wrap:anywhere]`}>{s.pending}</p>
          </div>
          <button type="button" className={`${btn} shrink-0`} onClick={ctl.notThisOne}>Not this one</button>
        </section>
      ) : (
        <p className={`${muted} px-0.5`}>Putting several things in one place? Scan the location first — everything after it goes there until you press Done.</p>
      )}

      <ProblemList s={s} ctl={ctl} />

      <ActionRow>
        {noteOpen || s.note ? (
          <div className={`${card} basis-full min-w-0 p-3 space-y-2`}>
            <label htmlFor="scan-note" className="block text-[13px] font-semibold text-gray-700 dark:text-gray-200">Note for the next move (then it clears)</label>
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
            <button type="button" className={`${btn} w-full`} onClick={() => { ctl.setNote(""); setNoteOpen(false) }}>{s.note ? "Clear the note" : "Close"}</button>
          </div>
        ) : (
          <button type="button" className={`${btn} flex-1 basis-36`} onClick={() => setNoteOpen(true)}>Add a note</button>
        )}
        <TypeCode ctl={ctl} />
      </ActionRow>
      <RecentList s={s} ctl={ctl} />
    </>
  )
}

// ── Find ─────────────────────────────────────────────────────────────────────────────────────

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-gray-600 dark:text-gray-400">{k}</dt>
      <dd className="min-w-0 font-semibold break-words">{children}</dd>
    </>
  )
}

function WhereNow({ res }: { res: LookupResponse }) {
  const w = res.where
  if (!w) return <span>Not put anywhere yet</span>
  return (
    <span>
      <span className={`${mono} text-base font-extrabold`}>{w.code}</span>{" "}
      <span className="font-normal text-gray-700 dark:text-gray-300">
        ({w.kind ? kindWord(w.kind) : "no longer a location"}{w.name ? ` · ${w.name}` : ""}{w.kind && !w.active ? " · switched off" : ""})
      </span>
      {(w.since || w.by) && <span className={`block font-normal ${muted}`}>Put there {when(w.since)}{w.by ? ` by ${w.by}` : ""}</span>}
    </span>
  )
}

/** Totes, pallets and lots — one compact line each: the code, then what it is. */
function GoodsList({ rows }: { rows: ScanHere[] }) {
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-800">
      {rows.map(r => (
        <li key={`${r.type}-${r.code}`} className="py-1.5 min-w-0">
          <span className={`${mono} text-[15px] font-bold [overflow-wrap:anywhere]`}>{r.code || "(no barcode)"}</span>{" "}
          <span className="text-[13px] text-gray-600 dark:text-gray-400 break-words">{r.type === "lot" ? "Lot" : r.type === "pallet" ? "Pallet" : "Tote"}{r.customer ? ` · ${r.customer}` : ""}{r.what ? ` · ${r.what}` : ""}</span>
        </li>
      ))}
    </ul>
  )
}

function HereList({ rows, truncated }: { rows: ScanHere[]; truncated?: boolean }) {
  if (!rows.length) return <p className={muted}>The Hub records nothing here.</p>
  const shown = rows.slice(0, 40)
  return (
    <div>
      <p className="text-[14px] font-semibold">{plural(rows.length, "thing")}{truncated ? "+" : ""} recorded here</p>
      <GoodsList rows={shown} />
      {rows.length > shown.length && <p className={muted}>…and {plural(rows.length - shown.length, "more")}. Check a location lists them all.</p>}
    </div>
  )
}

function FindResult({ res, ctl }: { res: LookupResponse; ctl: ScanController }) {
  const h = res.hit
  if (!h) {
    return (
      <section className={`${card} px-3 py-2.5`}>
        <p className="text-base font-bold leading-snug break-words">Nothing found for <span className={mono}>{res.code}</span></p>
        <p className={`mt-0.5 ${muted}`}>It isn&apos;t a tote, pallet, lot, receipt or location the Hub knows. Check the label and scan again.</p>
      </section>
    )
  }
  // The banner already says findTitle(res); the card names the thing and gives the detail.
  const heading = h.type === "container" ? `${h.kind === "pallet" ? "Pallet" : "Tote"} ${h.id}` : h.type === "lot" ? `Lot ${h.barcode}` : h.type === "location" ? `Location ${h.code}` : h.type === "receipt" ? `Receipt ${h.id}` : `Vendor number ${h.vendorNo ?? res.code}`
  const dl = "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[14px] leading-snug"
  return (
    <section className={`${card} p-3 space-y-2.5`} aria-label={findTitle(res)}>
      <p className={`${mono} text-lg font-extrabold leading-tight [overflow-wrap:anywhere]`}>{heading}</p>
      {h.type === "container" && (
        <>
          <dl className={dl}>
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
          <dl className={dl}>
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
          <p className="text-[14px] text-gray-700 dark:text-gray-300 break-words">{[kindWord(h.kind), h.name].filter(Boolean).join(" · ")}</p>
          <HereList rows={res.here ?? []} truncated={res.hereTruncated} />
          <div className="grid gap-2">
            <button type="button" className={bigBtn} onClick={ctl.checkFromFind}>Check this location</button>
            <button type="button" className={btnTall} onClick={ctl.moveFromFind}>Put things here</button>
          </div>
        </>
      )}
      {h.type === "receipt" && (
        <>
          {/* No customer name when signed in with a card (the lookup route leaves it out). */}
          <p className="text-[14px] break-words">{[h.customer, plural(h.containers, "tote or pallet", "totes and pallets")].filter(Boolean).join(" · ")}</p>
          {res.containers && res.containers.length > 0 && (
            <ul className="divide-y divide-gray-200 dark:divide-gray-800">
              {res.containers.map(c => (
                <li key={c.id} className="py-1.5 flex items-center gap-2 min-w-0">
                  <span className={`${mono} text-[15px] font-bold`}>{c.id}</span>
                  <span className="text-[13px] text-gray-600 dark:text-gray-400">{c.kind === "pallet" ? "Pallet" : "Tote"}</span>
                  <span className={`${mono} ml-auto min-w-0 truncate text-[14px] font-semibold`}>{c.locationCode ?? "not put away"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={muted}>A receipt isn&apos;t moved — scan the label on each tote or pallet.</p>
        </>
      )}
      {h.type === "customer" && <p className="text-[14px] break-words">{h.name ? `${h.name} — a` : "A"} customer&apos;s vendor number. Scan the tote, pallet or lot label instead.</p>}
    </section>
  )
}

export function FindScreen({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  const f = s.find
  return (
    <>
      {!s.online && (
        <NeedsWifi title="Find needs the Wi-Fi">This scanner is offline. Put away / Move still works — moves are saved and sent when the Wi-Fi is back.</NeedsWifi>
      )}
      {f.status === "idle" && s.online && (
        <p className={`${muted} px-0.5`}>A tote, pallet, lot, location or receipt — you&apos;ll see what it is and where the Hub has it now.</p>
      )}
      {f.status === "looking" && (
        <section className={`${card} px-3 py-3`} role="status">
          <p className="text-base font-semibold break-words">Looking up <span className={mono}>{f.code}</span>…</p>
        </section>
      )}
      {f.status === "failed" && (
        <section className={`${card} px-3 py-2.5`}>
          <p className="text-base font-bold break-words">Couldn&apos;t look up <span className={mono}>{f.code}</span></p>
          <p className="mt-0.5 text-[14px] break-words">{f.message}</p>
        </section>
      )}
      {f.status === "done" && <FindResult res={f.res} ctl={ctl} />}
      <ActionRow><TypeCode ctl={ctl} /></ActionRow>
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
          <NeedsWifi title="Checking needs the Wi-Fi">The Hub has to say what should be there. Put away / Move still works offline.</NeedsWifi>
        )}
        <p className={`${muted} px-0.5`}>Then scan everything you can see on it: you&apos;ll see what&apos;s missing, what&apos;s recorded somewhere else (one tap moves it here), and anything the Hub doesn&apos;t know.</p>
        <ActionRow><TypeCode ctl={ctl} placeholder="e.g. A10A1" /></ActionRow>
        <ProblemList s={s} ctl={ctl} />
      </>
    )
  }
  if (c.status === "loading") {
    return <section className={`${card} px-3 py-3`} role="status"><p className="text-base font-semibold break-words">Reading what&apos;s at <span className={mono}>{c.place.code}</span>…</p></section>
  }
  if (c.status === "failed") {
    return (
      <>
        <section className={`${card} px-3 py-2.5`}>
          <p className="text-base font-bold break-words">Can&apos;t check <span className={mono}>{c.place.code}</span></p>
          <p className="mt-0.5 text-[14px] break-words">{c.error}</p>
          <p className="mt-1 text-[14px] font-semibold">Scan the location again to try once more.</p>
        </section>
        <ActionRow><TypeCode ctl={ctl} placeholder="e.g. A10A1" /></ActionRow>
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
      <section className="rounded-xl border-2 border-teal-500 bg-teal-50 dark:bg-teal-950/40 px-3 py-2" aria-label={`Checking ${c.place.code}`}>
        <div className="flex items-baseline gap-2 min-w-0">
          <p className={`${mono} min-w-0 text-xl font-extrabold leading-tight [overflow-wrap:anywhere]`}>{c.place.code}</p>
          <p className="ml-auto shrink-0 text-base font-bold tabular-nums">{c.found.length}/{c.expected.length}{c.truncated ? "+" : ""}</p>
        </div>
        <p className="text-[13px] leading-snug text-gray-700 dark:text-gray-200">
          {c.found.length} of {c.expected.length}{c.truncated ? "+" : ""} found · {missing.length} not scanned yet{movedHere ? ` · ${movedHere} moved here` : ""}
        </p>
      </section>

      {elsewhere.length > 0 && (
        <section className={`${card} px-3 py-2.5`} aria-label="Scanned here, recorded somewhere else">
          <h2 className={cardTitle}>Here, but recorded somewhere else ({elsewhere.length})</h2>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {elsewhere.map(x => (
              <li key={x.code} className="py-2 min-w-0">
                <p className="break-words"><span className={`${mono} text-base font-extrabold`}>{x.code}</span> <span className="text-[13px] font-semibold text-gray-700 dark:text-gray-300">{EXTRA_WORDS[x.state]}</span></p>
                {(x.what || x.where) && <p className={`${muted} break-words`}>{x.what}{x.where ? ` · recorded at ${x.where}` : ""}</p>}
                {(x.state === "elsewhere" || x.state === "offline") && (
                  <button type="button" className={`${rowBtn} mt-1.5`} onClick={() => ctl.moveHere(x.code)}>Move it here ({c.place.code})</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={`${card} px-3 py-2.5`} aria-label="Recorded here but not scanned">
        <h2 className={cardTitle}>Recorded here, not scanned yet ({missing.length})</h2>
        {missing.length === 0 ? (
          <p className="pt-1 text-[14px] font-semibold text-emerald-700 dark:text-emerald-300">{c.expected.length ? "Everything the Hub records here has been scanned." : "The Hub records nothing here."}</p>
        ) : (
          <GoodsList rows={missing} />
        )}
        {c.truncated && <p className={muted}>This location holds more than the scanner can list; anything else scanned is checked with the Hub.</p>}
      </section>

      {strange.length > 0 && (
        <section className={`${card} px-3 py-2.5`} aria-label="Codes the Hub doesn't know">
          <h2 className={cardTitle}>Not goods the Hub knows ({strange.length})</h2>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {strange.map(x => (
              <li key={x.code} className="py-1.5 min-w-0">
                <span className={`${mono} text-[15px] font-bold [overflow-wrap:anywhere]`}>{x.code}</span>{" "}
                <span className="text-[13px] text-gray-600 dark:text-gray-400 break-words">{x.what ?? EXTRA_WORDS[x.state]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ticked.length > 0 && (
        <details className={`${card} px-3`}>
          <summary className={`${cardTitle} min-h-11 flex items-center cursor-pointer`}>Found ({ticked.length})</summary>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800 pb-1">
            {ticked.map(e => <li key={`${e.type}-${e.code}`} className={`${mono} py-1.5 text-[15px] font-bold [overflow-wrap:anywhere]`}>{e.code} ✓</li>)}
          </ul>
        </details>
      )}
      <ActionRow><TypeCode ctl={ctl} /></ActionRow>
      <button type="button" className={`${btn} w-full`} onClick={ctl.restartCheck}>Start this check again</button>
      <ProblemList s={s} ctl={ctl} />
    </>
  )
}

/** Check's bottom row: Finish, once a location is being checked. */
export function CheckBar({ s, ctl }: { s: Snapshot; ctl: ScanController }) {
  if (!s.check) return null
  return (
    <BottomBar>
      <button type="button" className={bigBtn} onClick={ctl.finishCheck}>Finish</button>
    </BottomBar>
  )
}
