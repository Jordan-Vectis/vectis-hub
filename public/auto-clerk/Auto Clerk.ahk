#Requires AutoHotkey v2.0
#SingleInstance Force
Persistent
CoordMode "Mouse", "Screen"
CoordMode "Pixel", "Screen"

; ══════════════════════════════════════════════════════════════════════════════
; Auto Clerk — v1 (2026-08-21)
;
; A clerk that works ANY clerking screen by screen coordinates, like the BC
; macro: you point at each button once (hover + F8 / middle-click, as in the
; Macro Calibrator) and mark the "current bid" figure; from then on it reads
; that figure off the screen with Windows' own OCR and presses the buttons.
; Nothing on the page changes, no scripts pasted — works on the Saleroom
; Trainer, the Vectis Clerk Trainer, and later the real Saleroom / Bidpath pages.
;
; v1 = ONE screen, the rule-card timers (Sync Logic Reference on /tools/auto-clerk):
;   · a new bid resets the clock
;   · 15 s with no new bid          → Fair Warning
;   · 20 s more with no new bid     → Sell / Hammer, then Next
;   · a lot that never gets a bid   → Pass after the same time (optional)
; The two-screen sync (catch the other platform up to the exact amount) is v2 —
; every button it will need is calibrated now so nothing has to be redone.
;
; Hotkeys while it runs:  F9 start/stop · F10 pause · Esc stop (always)
; Files next to this script: Auto Clerk.ini (your calibration + settings),
; Auto Clerk.log (what it did and why), Auto Clerk OCR.ps1 (the reader).
;
; ⚠ This is a COPY-NOTHING tool: it never touches the trainer or any page.
; ══════════════════════════════════════════════════════════════════════════════

global INI := A_ScriptDir "\Auto Clerk.ini"
global LOGF := A_ScriptDir "\Auto Clerk.log"
global OCR_PS1 := A_ScriptDir "\Auto Clerk OCR.ps1"
global OCR_DIR := A_Temp "\AutoClerkOCR"

; ── What each screen has. Order = calibration order. ──────────────────────────
; kind: "btn" = a point to click · "reg" = a rectangle to read (two corners)
global PROFILES := Map(
    "saleroom", {
        title: "Saleroom (GAP) screen",
        fwIsToggle: true,           ; Fair warn on Saleroom toggles — a new bid means we must un-toggle it
        items: [
            { key: "reg_bid",    kind: "reg", label: "the CURRENT BID figure — the H box. Box the WHOLE white box, not just the digits: the number grows as bids climb" },
            { key: "reg_ask",    kind: "reg", label: "the NEXT ASKING figure — the A box (Windows cannot read a lone single digit such as £5, so the asking is read and stepped back one increment instead)" },
            { key: "reg_sname",  kind: "reg", label: "the NAME cell of the TOP row of the bid log — it reads INTERNET or ROOM (needed to spot a same-amount tie, rule 3)" },
            { key: "reg_lot",    kind: "reg", label: "the LOT NUMBER on this screen (optional, but strongly recommended: it spots the lot moving on by itself, and refuses to work when the two screens are on different lots)" },
            { key: "reg_feed",  kind: "reg", label: "the WHOLE bid list — every visible row, names and amounts (optional: it lets the clerk PROVE the standing price traces to a real bidder before selling). Box the full list area" },
            { key: "btn_sale_undo", kind: "btn", label: "the UNDO button on the TOP row next to Sell / Pass — it reverses a COMPLETED sale (how a snipe that arrived with the hammer is recovered). OPTIONAL — press F10 to skip on a page without one" },
            { key: "btn_fw",     kind: "btn", label: "Fair warn button" },
            { key: "btn_sell",   kind: "btn", label: "Sell button" },
            { key: "btn_next",   kind: "btn", label: "Next button" },
            { key: "btn_pass",   kind: "btn", label: "Pass button" },
            { key: "btn_bid",    kind: "btn", label: "Bid button (v2 sync)" },
            { key: "btn_room",   kind: "btn", label: "Room button (v2 sync)" },
            { key: "btn_undo",   kind: "btn", label: "Undo button (v2 sync)" },
            { key: "box_amount", kind: "btn", label: "the small custom-amount box next to A (v2 sync — click target)" },
        ],
    },
    "vectis", {
        title: "Vectis (Bidpath) clerk screen",
        fwIsToggle: false,          ; Vectis clears its own Fair Warning when a bid arrives
        items: [
            { key: "reg_bid",      kind: "reg", label: "the CURRENT BID figure after 'Current Bid:'. Box a WIDE area — from the £ to well past it, the number grows as bids climb" },
            { key: "reg_vtype",    kind: "reg", label: "the BID TYPE chip on the TOP row of the bid list — it reads Vectis Live / Room / Telephone / Saleroom (needed to spot a same-amount tie, rule 3)" },
            { key: "reg_lot",      kind: "reg", label: "the LOT NUMBER on this screen (optional, but strongly recommended: it spots the lot moving on by itself, and refuses to work when the two screens are on different lots)" },
            { key: "reg_feed",    kind: "reg", label: "the WHOLE bid list — every visible row, names and amounts (optional: it lets the clerk PROVE the standing price traces to a real bidder before selling). Box the full list area" },
            { key: "btn_reopen",   kind: "btn", label: "the RE-OPEN LOT button that appears AFTER a hammer — it reverses the sale (how a snipe that arrived with the hammer is recovered). OPTIONAL — hammer a practice lot first so it is on screen, or press F10 to skip" },
            { key: "btn_fw",       kind: "btn", label: "Fair Warning button" },
            { key: "btn_hammer",   kind: "btn", label: "Hammer button (it becomes Next Lot after a sale)" },
            { key: "btn_pass",     kind: "btn", label: "Pass Lot button" },
            { key: "btn_saleroom", kind: "btn", label: "Saleroom: £ button (v2 sync)" },
            { key: "btn_bang",     kind: "btn", label: "the ! beside Saleroom (v2 sync)" },
            { key: "btn_undo",     kind: "btn", label: "Undo Bid button (v2 sync)" },
            { key: "box_asking",   kind: "btn", label: "the Asking Bid £ box (v2 sync — click target)" },
            { key: "btn_askset",   kind: "btn", label: "the SET button beside Asking Bid (v2 sync)" },
        ],
    },
)

; ── Settings (saved in the ini) ───────────────────────────────────────────────
; mode: "single" = clerk the selected screen on the timers · "both" = clerk BOTH screens and keep them in step
; srExact: how an EXACT amount is entered on the Saleroom screen — "enter" = type in the box
; next to A and press Enter (the Saleroom Trainer), "bid" = type then press the Bid button
; (the real Saleroom page, per the rule card).
global CFG := { profile: "saleroom", mode: "single", fwSecs: 15, sellSecs: 20, passNoBids: true, pollMs: 250, srExact: "enter", lotWatch: true,
    ; What the bid lists call things — EDITABLE on the setup screen (Jordan, 2026-08-25:
    ; "it would be good if I could customise all those words in case they change").
    ; Commas separate alternatives. mirrorV/mirrorS = what OUR OWN press shows on each
    ; list; genuineS = a real online bidder on the Saleroom list (its rows also say ROOM
    ; for our presses, so the tie check needs both words there).
    mirrorV: "Saleroom, Sale room", mirrorS: "ROOM", genuineS: "INTERNET" }
; A reading must hold this many polls before it counts: rises quickly, DROPS slowly — one
; misread frame ("E60" read as "EGO" → nothing) once undid a whole lot.
global RISE_CONFIRM := 2, DROP_CONFIRM := 4
; ⚠ BLINDNESS IS NEVER BIDS DISAPPEARING (Jordan, 2026-08-24). Only a LEGIBLE number ever
; changes a figure. An illegible read holds the last figure and starts this clock; when it
; runs out the clerk stops pressing, goes red and waits for F10 — it never converts "I can't
; see" into "the bids vanished" (which once meant passing live lots and undoing real bids).
global BLIND_PAUSE_MS := 10000
; Lot watching (optional — only when the lot-number boxes are calibrated). Read once a
; second rather than every tick: a lot change is not a fast event and each read costs
; ~150 ms. Two screens must disagree for this many consecutive checks before the clerk
; holds — one platform legitimately advances a moment before the other.
global LOT_EVERY_N := 4, LOT_MISMATCH_HOLD := 3
; How long the bid boxes must sit perfectly still before a hammer. Pixel-watching is
; ~1 ms, so this is continuous rather than a snapshot — see FinalWatch.
global FINAL_WATCH_MS := 450
; How long AFTER the hammer the screens are checked before Next is pressed — the recovery
; window. Both platforms keep a sale reversible until Next (Saleroom: the sale Undo next to
; Sell/Pass; Vectis: Re-Open Lot), which is what makes this worth doing.
global SOLD_CHECK_MS := 1500
; A catch-up (or undo-down) only starts once the price has sat still for this long —
; while bids are landing, the clerk WAITS rather than clicking into the middle of a
; flurry (Jordan, 2026-08-25: "wait for a moment to let it happen before trying to
; catch up"). The grace handles a bid mirroring itself; this handles live bidding.
global CATCHUP_SETTLE_MS := 2000    ; raised from 1300 (Jordan, 2026-08-25: "a slight delay on the catch up, maybe 2 seconds")
; Rule 3 — same-amount tie. Both figures equal, yet EACH platform holds its OWN bidder
; (Vectis's top bid is not from the Saleroom source; Saleroom's top bid is not ROOM).
; Needs the two label boxes (reg_vtype, reg_sname). Checked once per price, a moment
; after the figures settle.
global TIE_SETTLE_MS := 1200
; Two-screen sync tunables (the browser rig's values)
global SYNC_GRACE_MS := 1500      ; an online bid shows up on the other platform by itself — wait this long before catching up
global SYNC_RETRY_MS := 1800      ; how long a catch-up press gets to land before it is tried again
global MAX_SYNC_TRIES := 4        ; after this many, warn (keep trying every few seconds — never give up silently)
global CAL := Map()     ; profile -> Map(key -> {x,y} or {x,y,w,h})

; ── Run state ─────────────────────────────────────────────────────────────────
global RS := 0         ; 0 = idle, object while running
global BANNER := 0, B_L1 := 0, B_L2 := 0, B_L3 := 0, BANNER_TOP := true
global OCR_PID := 0
global SIM := 0        ; --simboth only: a model of the two screens instead of pixels
global READ_CACHE := Map()   ; box fingerprint → what it read, so an unchanged box costs nothing
; ⚠ WHAT YOU DRAW IS WHAT IT READS. This was 90 px each side, from the days when a box was
; two hovered corners round "£0" and needed rescuing. Once boxes are DRAWN, padding is
; actively harmful: it drags in neighbouring numbers (an estimate, a lot number, the row
; below) and means the picture you lined up is not the picture it reads — Jordan,
; 2026-08-24: "the padding you are adding is making things way harder to line up".
; All that is left is a hair, so a pixel of drawing wobble cannot clip a digit.
global PAD_X := 4, PAD_Y := 4
; ⚠ EVERY top-level "global X := 0" must sit up here, ABOVE LoadIni()/BuildMainGui().
; AutoHotkey runs all top-level lines in file order at start-up, so a declaration
; placed further down the file executes AFTER the window is built and wipes the
; references it just made (that was "Calibrate does nothing", 2026-08-21).
global MAIN := 0, M_STATUS := 0, M_PROF := 0, M_FW := 0, M_SELL := 0, M_PASS := 0, M_CAL := 0, M_MODE := 0, M_ONE := 0, M_EXACT := 0, M_LOT := 0, M_MIRV := 0, M_MIRS := 0, M_GENS := 0
global CALST := 0
global STATUS := 0, S_L1 := 0, S_L2 := 0, S_L3 := 0

; any unexpected error → readable log + message, never a cryptic popup
OnError ErrLog
ErrLog(err, mode) {
    ; Written directly (not via WriteLog) so a fault inside the simulation is recorded too.
    detail := IsObject(err) ? err.Message " (" err.What ") " err.File ":" err.Line : String(err)
    if A_Args.Length >= 1 && SubStr(A_Args[1], 1, 2) = "--" {
        ; a CLI test: print the fault and die — a dialog would hang a headless run,
        ; and the error belongs to the test's output, not Jordan's real log
        try FileAppend "FAIL crashed: " detail "`n", "*"
        ExitApp 1
    }
    try FileAppend FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss") "  ERROR " detail "`r`n", LOGF
    MsgBox "Something went wrong inside the Auto Clerk.`n`nDetails are in:`n" LOGF "`n`nTell Claude and send that file.", "Auto Clerk", "Iconx"
    return 1
}
OnExit((*) => StopOcr())

; ── CLI test modes (Claude's checks — ignore) ────────────────────────────────
if A_Args.Length >= 1 && A_Args[1] = "--selftest" {
    out := ""
    for s in ["Current Bid: E 1,250", "£640", "Hammer: (f640)", "1.250", "0", "", "E 12,500 Asking", "Bid 45", "Jrrent Bid: EIO", "urrent Bid: £1O", "E I,25O", "OM 15", "ROOM", "£O", "Lot: 508 ROOM Est: ROOM 80-110", "Est: 80-110", "ES", "Est", "Jrrent Bid: EGO", "Jrrent Bid: E 15", "Bid 5", "Bid H 5", "Bid O", "Bid 1,250", "Bid IO", "Bid I,25O", "Bid EGO",
                "Bid 15.00", "Bid 1,250.00", "Bid 45.00", "15.00", "£1,250.00", "Bid 1.250", "Bid 5.00", "Bid I5.OO"]
        out .= "[" s "] -> " ParseAmount(s) "`n"
    for a in [10, 15, 45, 50, 60, 110, 220, 550, 1100, 2200, 5500, 5, 7, 0]
        out .= "asking " a " -> bid " BidBeforeAsking(a) "`n"
    FileAppend out, "*"
    ExitApp
}
; ── --simboth: the two-screen logic run against a MODEL of the two screens ──────
; No OCR, no clicks: OcrRead answers from SIM, PressOn updates SIM. Real timers,
; shortened. Proves the rule-card state machine before it meets a real screen.
if A_Args.Length >= 1 && A_Args[1] = "--simboth" {
    CFG.mode := "both", CFG.fwSecs := 2, CFG.sellSecs := 2, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 0, v: 0, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    ; (appends to a PROPERTY — a fat-arrow assigning a plain variable would make a local copy)
    ; Also streamed to stdout as it happens, so a hang still leaves the trace so far.
    Say(t) => (SIM.out .= t "`n", FileAppend(t "`n", "*"))
    t0 := A_TickCount
    SIM.t0 := t0
    lastTrace := 0
    steps := [
        { at: 500,  do: () => (SIM.v := 10),  say: "Vectis room bid £10 — Saleroom should be caught up (box + Bid) after the grace" },
        { at: 3600, do: () => (SIM.s := 20),  say: "Saleroom online bid £20 …" },
        { at: 3800, do: () => (SIM.v := 20),  say: "… and Vectis follows by itself — NO catch-up press expected" },
        { at: 5200, do: () => (SIM.s := 10),  say: "Undo on Saleroom £20 → £10 — Vectis should be brought down with Undo" },
        ; second lot: a same-amount TIE — two different bidders at £45 at nearly the same moment
        { at: 14200, do: () => (SIM.v := 45, SIM.vtype := "Vectis Live"), say: "Lot 2: Vectis Live bidder £45 …" },   ; after lot 1's sold check — 1.5s longer since it exists
        { at: 14900, do: () => (SIM.s := 45, SIM.sname := "INTERNET"),    say: "… and a saleroom.com bidder £45 — a TIE: Vectis was first → ROOM on Saleroom expected" },
    ]
    while A_TickCount - t0 < 32000 {   ; two sold checks longer than it used to need
        el := A_TickCount - t0
        for st in steps {
            if !st.HasProp("done") && el >= st.at {
                st.done := true
                st.do.Call()
                Say("── t=" el "ms  " st.say)
            }
        }
        TickBoth()
        if el - lastTrace >= 500 {
            lastTrace := el
            sS := RS.side["saleroom"], sV := RS.side["vectis"]
            Say("   t=" el " model S=" SIM.s " V=" SIM.v " | seen S=" sS.bid "(high " sS.high ", expect " sS.expect ", behind " (sS.behindSince ? el - (sS.behindSince - t0) : 0) ") V=" sV.bid "(high " sV.high ", expect " sV.expect ") | price " RS.price " phase " RS.phase)
        }
        if RS.lots >= 2
            break
        Sleep 100
    }
    Say("presses: " Join(SIM.presses, " › "))
    ; What must have happened, in order.
    seq := Join(SIM.presses, " ")
    Check(ok, msg) => Say((ok ? "PASS " : "FAIL ") msg)
    Check(InStr(seq, "saleroom.box_amount saleroom.btn_bid"), "Saleroom caught up to the Vectis room bid via the amount box + Bid")
    Check(!InStr(seq, "vectis.btn_saleroom"), "no Vectis catch-up press for the online bid that synced itself")
    Check(InStr(seq, "vectis.btn_undo"), "Vectis brought down with Undo after the Saleroom undo")
    Check(InStr(seq, "vectis.btn_fw") && InStr(seq, "saleroom.btn_fw"), "Fair Warning pressed on both")
    Check(InStr(seq, "vectis.btn_hammer saleroom.btn_sell"), "Hammer on Vectis then Sell on Saleroom")
    Check(InStr(seq, "vectis.btn_hammer saleroom.btn_next"), "Next Lot on Vectis and Next on Saleroom")
    Check(InStr(seq, "saleroom.btn_room"), "tie at £45 resolved with ROOM on Saleroom (Vectis bid first)")
    Check(!InStr(seq, "vectis.btn_bang"), "the ! on Vectis was NOT pressed for that tie")
    Check(RS.lots = 2 && SIM.s = 0 && SIM.v = 0, "two lots closed and both screens back to £0 (S=" SIM.s " V=" SIM.v ")")
    ExitApp
}
/** The model's reaction to a press — what the real screens would do. */
SimPress(nm, key) {
    SIM.presses.Push(nm "." key)
    FileAppend "   t=" (A_TickCount - SIM.t0) " PRESS " nm "." key "`n", "*"
    if nm = "saleroom" {
        if key = "btn_bid"
            SIM.s := SIM.typed, SIM.sname := "ROOM"
        else if key = "btn_room"
            SIM.sname := "ROOM"                           ; the saleroom bidder dropped, price kept
        else if key = "btn_undo"
            SIM.s := SIM.v < SIM.s ? SIM.v : 0          ; one undo removes the top row
        else if key = "btn_sell"
            SIM.soldS := true
        else if key = "btn_pass"
            SIM.soldS := true
        else if key = "btn_next"
            SIM.s := 0, SIM.soldS := false, SIM.sname := "ROOM"
    } else {
        if key = "btn_askset"
            SIM.askV := SIM.typed
        else if key = "btn_saleroom"
            SIM.v := SIM.askV, SIM.vtype := "Saleroom"
        else if key = "btn_bang"
            SIM.vtype := "Saleroom"                       ; the Vectis bidder dropped, price kept
        else if key = "btn_undo"
            SIM.v := SIM.s < SIM.v ? SIM.s : 0
        else if key = "btn_pass"
            SIM.soldV := true
        else if key = "btn_hammer" {
            if SIM.soldV
                SIM.v := 0, SIM.soldV := false, SIM.vtype := "Saleroom"   ; second press = Next Lot
            else
                SIM.soldV := true
        }
    }
}
; ── --snipetest: a bid lands after Fair Warning, near the sell — the sale must NOT go
;    through at the old price; the clock resets, FW is re-issued, the lot sells later ────
if A_Args.Length >= 1 && A_Args[1] = "--snipetest" {
    CFG.mode := "both", CFG.fwSecs := 2, CFG.sellSecs := 2, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 0, v: 0, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayS(t) => FileAppend(t "`n", "*")
    t0 := A_TickCount
    tFw := 0, sniped := false, closedAt := 0
    while A_TickCount - t0 < 20000 {
        el := A_TickCount - t0
        if el >= 300 && SIM.s = 0 {
            SIM.s := 20, SIM.v := 20
            SayS("── t=" el " both screens at £20")
        }
        if !tFw {
            for p in SIM.presses
                if p = "vectis.btn_fw"
                    tFw := el
            if tFw
                SayS("── t=" tFw " Fair Warning seen — snipe arms in 1.5s (sell would fire at +2s)")
        } else if !sniped && el - tFw >= 1500 {
            sniped := true
            SIM.v := 25
            SayS("── t=" el " SNIPE — Vectis £25, half a second before the sell")
        }
        TickBoth()
        if RS.lots >= 1 {
            closedAt := el
            break
        }
        Sleep 100
    }
    fwCount := 0
    for p in SIM.presses
        if p = "vectis.btn_fw"
            fwCount++
    SayS((sniped ? "PASS " : "FAIL ") "the snipe was planted after Fair Warning")
    SayS((closedAt && closedAt >= tFw + 3400 ? "PASS " : "FAIL ") "the sale did NOT go through at the old price — lot closed at t=" closedAt " (FW at " tFw ", snipe at ~" (tFw + 1500) ")")
    SayS((fwCount >= 2 ? "PASS " : "FAIL ") "Fair Warning was re-issued after the snipe (vectis FW pressed " fwCount "×)")
    SayS((RS.lots = 1 && SIM.s = 0 && SIM.v = 0 ? "PASS " : "FAIL ") "the lot then sold and both screens reset (S=" SIM.s " V=" SIM.v ")")
    ExitApp
}
; ── --emptytest: a FRESH LOT shows an empty bid box. That is "no bid yet", not blindness,
;    and it must never pause the run (it used to, ten seconds after every lot change). ──
if A_Args.Length >= 1 && A_Args[1] = "--emptytest" {
    CFG.mode := "both", CFG.fwSecs := 1, CFG.sellSecs := 1, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    ; Both boxes EMPTY — exactly what a lot with no bids on it looks like.
    SIM := { s: "", v: "", typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayE(t) => FileAppend(t "`n", "*")
    t0 := A_TickCount, paused := 0
    while A_TickCount - t0 < 14000 {
        TickBoth()
        if RS.paused && !paused
            paused := A_TickCount - t0
        if RS.lots >= 1
            break
        Sleep 100
    }
    seq := ""
    for p in SIM.presses
        seq .= p " "
    SayE((!paused ? "PASS " : "FAIL ") "an empty box on a fresh lot did NOT pause the run" (paused ? " (paused at t=" paused "ms)" : ""))
    SayE((InStr(seq, "btn_pass") ? "PASS " : "FAIL ") "the lot with no bids was PASSED as normal (presses: " (seq = "" ? "none" : seq) ")")
    ExitApp
}
; ── --hashtest: is the box fingerprint real on BOTH monitors (negative coordinates
;    included) and how fast is it? ───────────────────────────────────────────────────
if A_Args.Length >= 1 && A_Args[1] = "--hashtest" {
    out := ""
    for spot in [{x: 300, y: 300, t: "primary monitor"}, {x: -1600, y: 300, t: "left monitor (negative x)"}] {
        ; A window with a number in it, so there is something real to fingerprint.
        g := Gui("-Caption +AlwaysOnTop +ToolWindow", "HashProbe")
        g.BackColor := "FFFFFF"
        g.SetFont("s24 Bold c000000", "Segoe UI")
        t := g.Add("Text", "w180", "45")
        g.Show("NoActivate x" spot.x " y" spot.y " w200 h50")
        Sleep 350
        t0 := A_TickCount
        h1 := BoxHash(spot.x, spot.y, 200, 50)
        ms := A_TickCount - t0
        h2 := BoxHash(spot.x, spot.y, 200, 50)          ; nothing changed
        t.Text := "50"                                   ; the figure moves on
        Sleep 250
        h3 := BoxHash(spot.x, spot.y, 200, 50)
        g.Destroy()
        out .= spot.t ": " ms " ms per fingerprint`n"
        out .= "  " (h1 != "0-0" && h1 != "" ? "PASS" : "FAIL") " it read the screen at all (a failed grab hashes to 0-0) — " h1 "`n"
        out .= "  " (h1 = h2 ? "PASS" : "FAIL") " STABLE while nothing changes (or the watch would never settle)`n"
        out .= "  " (h1 != h3 ? "PASS" : "FAIL") " CHANGED when 45 became 50 (this is what catches a snipe)`n"
    }
    FileAppend out, "*"
    ExitApp
}
; ── --layouttest: the Test read window must FIT THE SCREEN with every box present —
;    it outgrew 1080p as boxes were added, and an AHK window cannot scroll. ────────
if A_Args.Length >= 1 && A_Args[1] = "--layouttest" {
    Say9(t) => FileAppend(t "`n", "*")
    CAL["saleroom"] := Map(), CAL["vectis"] := Map()
    pic := A_Temp . Chr(92) . "ac-layout-fake.png"
    g0 := Gui("-Caption +ToolWindow")
    g0.BackColor := "FFFFFF"
    g0.SetFont("s48 Bold c000000", "Segoe UI")
    g0.Add("Text", "w560 h170 Center", "Bid 45")
    g0.Show("NoActivate x200 y200 w560 h170")
    Sleep 350
    q := Chr(39)
    RunWait 'powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap 560,170; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(200,200,0,0,(New-Object System.Drawing.Size 560,170)); $b.Save(' q pic q ')"', , "Hide"
    g0.Destroy()
    if !FileExist(pic) {
        Say9("FAIL could not make the fake preview picture")
        ExitApp
    }
    rows := []
    for key in ["reg_bid", "reg_ask", "reg_sname", "reg_vtype", "reg_lot", "reg_feed"]
        rows.Push({ key: key, r: { x: 100, y: 100, w: 90, h: 30 }, pic: pic, txt: "Bid 45", meaning: "£45" })
    ShowTestRead(rows, { amt: 45 }, "Lot watch: both screens read lot 513 — they agree, so the run won't be held.")
    Sleep 600
    if !WinExist("Auto Clerk — test read") {
        Say9("FAIL the test read window did not open")
        ExitApp
    }
    WinGetPos , , &w, &h, "Auto Clerk — test read"
    Say9("window " w " × " h " on a " A_ScreenWidth " × " A_ScreenHeight " screen")
    Say9((h <= A_ScreenHeight - 40 ? "PASS " : "FAIL ") "it fits on the screen with all six boxes shown")
    Say9((w >= 900 ? "PASS " : "FAIL ") "both columns are in use")
    ExitApp
}
; ── --startbidtest: after Next, the FRESH lot opens with a starting bid — at the very
;    same figure the last lot sold for. The old £0 test would blind-retry Next, and on
;    Vectis that is the Hammer: it would sell the new lot on the spot. ────────────
if A_Args.Length >= 1 && A_Args[1] = "--startbidtest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayB(t) => FileAppend(t "`n", "*")
    loop 6 {
        TickBoth()
        Sleep 60
    }
    SayB("settled at £" RS.price " on both — closing the lot")
    ; The moment the NEXT press lands (the SECOND vectis hammer), the new lot opens
    ; with a £20 starting bid — the same figure the old lot just sold for.
    SetTimer WatchNext, 20
    WatchNext() {
        global SIM
        n := 0
        for pr in SIM.presses
            if pr = "vectis.btn_hammer"
                n++
        if n >= 2 {
            SetTimer WatchNext, 0
            SIM.slot := "514", SIM.vlot := "514"
            SIM.s := 0
            SIM.v := 20
            FileAppend "── lot 514 opens with a £20 starting bid — same figure as the hammer`n", "*"
        }
    }
    CloseLotBoth("sold")
    SetTimer WatchNext, 0
    hammers := 0
    for pr in SIM.presses
        if pr = "vectis.btn_hammer"
            hammers++
    SayB((hammers = 2 ? "PASS " : "FAIL ") "the Vectis hammer was pressed exactly twice — sale + Next, NO blind retry (got " hammers ")")
    SayB((RS.lots = 1 ? "PASS " : "FAIL ") "the lot counted as closed and the clerk moved on (lots=" RS.lots ")")
    SayB((SIM.v = 20 && SIM.vlot = "514" ? "PASS " : "FAIL ") "lot 514's £20 starting bid is untouched (V=£" SIM.v " lot " SIM.vlot ")")
    SayB((!RS.paused ? "PASS " : "FAIL ") "the run is not held")
    ExitApp
}
; ── --stucktest: Jordan's stall. A catch-up to £40 is OUTRUN by a genuine £45 in the
;    instant after the press — the £45 is rightly kept, but the catch-up's leftover
;    "expected £40" flag must not hold the closing clock forever once both screens
;    agree at £45. The lot must still reach Fair Warning. ──────────────────────
if A_Args.Length >= 1 && A_Args[1] = "--stucktest" {
    CFG.mode := "both", CFG.fwSecs := 2, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 40, v: 35, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayK(t) => FileAppend(t "`n", "*")
    ; The instant the catch-up's committing press lands, a genuine £45 outruns it —
    ; and the Saleroom mirrors it by itself, so both screens agree at £45.
    SetTimer WatchPress, 25
    WatchPress() {
        global SIM
        for pr in SIM.presses
            if pr = "vectis.btn_saleroom" {
                SetTimer WatchPress, 0
                SIM.v := 45
                SIM.vtype := "Vectis Live"
                SIM.s := 45
                FileAppend "── genuine £45 outran the £40 catch-up; both screens now agree at £45`n", "*"
                return
            }
    }
    t0 := A_TickCount, fwGiven := false, pressed := false
    while A_TickCount - t0 < 14000 {
        TickBoth()
        if !IsObject(RS)
            break
        for pr in SIM.presses {
            if pr = "vectis.btn_saleroom"
                pressed := true
            if pr = "vectis.btn_fw"
                fwGiven := true
        }
        if fwGiven
            break
        Sleep 80
    }
    SetTimer WatchPress, 0
    SayK((pressed ? "PASS " : "FAIL ") "the catch-up press landed (the outrun race was real)")
    SayK((RS.price = 45 ? "PASS " : "FAIL ") "the genuine £45 was kept as the price (price=£" RS.price ")")
    SayK((fwGiven ? "PASS " : "FAIL ") "the closing clock RAN — Fair Warning went out; no stale flag held it (Jordan's stall)")
    ExitApp
}
; ── --verifytest: the after-press verdict on its own. A landing above target on OUR
;    label is undone; a genuine bid that outran the press is kept. ───────────────
if A_Args.Length >= 1 && A_Args[1] = "--verifytest" {
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 45, v: 55, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayV(t) => FileAppend(t "`n", "*")
    VerifyCatchUp("vectis", 45)
    seq := ""
    for pr in SIM.presses
        seq .= pr " "
    SayV((InStr(seq, "vectis.btn_undo") ? "PASS " : "FAIL ") "£55 on OUR label (Saleroom) after a £45 catch-up → undone")
    SIM.presses := [], SIM.v := 55, SIM.vtype := "Vectis Live"
    VerifyCatchUp("vectis", 45)
    seq := ""
    for pr in SIM.presses
        seq .= pr " "
    SayV((!InStr(seq, "vectis.btn_undo") ? "PASS " : "FAIL ") "£55 on a GENUINE label (Vectis Live) → kept, no undo")
    ExitApp
}
; ── --feedtest: provenance. A price with a real bidder behind it sells normally; a price
;    that exists ONLY as our own mirror rows on both feeds is unwound to the best real
;    figure instead of being Fair-Warned and hammered. ─────────────────────────
if A_Args.Length >= 1 && A_Args[1] = "--feedtest" {
    CFG.mode := "both", CFG.fwSecs := 2, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                m[it.key] := { x: nm = "vectis" ? 8000 : 7000, y: 100, w: 200, h: 100 }
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513",
             feedS: "SR2418804 20 INTERNET", feedV: "User: SR1 £20 Vectis Live" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayF(t) => FileAppend(t "`n", "*")
    ; Phase 1 — a real £20: Fair Warning must go out as normal.
    t0 := A_TickCount, fwGenuine := false
    while A_TickCount - t0 < 5000 {
        TickBoth()
        for pr in SIM.presses
            if InStr(pr, "btn_fw")
                fwGenuine := true
        if fwGenuine
            break
        Sleep 80
    }
    SayF((fwGenuine ? "PASS " : "FAIL ") "a REAL £20 passed provenance — Fair Warning went out")
    ; Phase 2 — the phantom: both figures jump to £80 but the feeds show only OUR mirror
    ; rows there; the best real bid anywhere is £70.
    SIM.s := 80, SIM.v := 80
    SIM.feedS := "ROOM 80 ROOM`nSR2418804 70 INTERNET"
    SIM.feedV := "Saleroom £80`nUser: SR1 £70 Vectis Live"
    SayF("── phantom planted: both screens £80, feeds show mirrors only; best real bid £70")
    ; The moment the clerk starts undoing, model both platforms coming back to £70.
    SetTimer WatchUndo, 25
    WatchUndo() {
        global SIM
        for pr in SIM.presses
            if InStr(pr, "btn_undo") {
                SetTimer WatchUndo, 0
                SIM.s := 70, SIM.v := 70
                SIM.feedS := "SR2418804 70 INTERNET"
                SIM.feedV := "User: SR1 £70 Vectis Live"
                FileAppend "── both platforms undone to the real £70`n", "*"
                return
            }
    }
    seen := SIM.presses.Length
    t0 := A_TickCount, fwAt80 := false, fwAt70 := false, undone := false, unwound := false
    while A_TickCount - t0 < 16000 {
        TickBoth()
        if !IsObject(RS)
            break
        while seen < SIM.presses.Length {
            seen++
            pr := SIM.presses[seen]
            ; only the Vectis press means FW was GIVEN — a lone saleroom.btn_fw is
            ; the toggle being CANCELLED after a new bid, which is correct behaviour
            if InStr(pr, "vectis.btn_fw") && RS.price = 80
                fwAt80 := true
            if InStr(pr, "vectis.btn_fw") && RS.price = 70
                fwAt70 := true
            if InStr(pr, "btn_undo")
                undone := true
        }
        if RS.price = 70
            unwound := true
        if fwAt70
            break
        Sleep 80
    }
    SetTimer WatchUndo, 0
    SayF((!fwAt80 ? "PASS " : "FAIL ") "Fair Warning was NEVER given at the phantom £80")
    SayF((unwound ? "PASS " : "FAIL ") "the price was unwound to the best REAL figure — £70 (price=£" RS.price ")")
    SayF((undone ? "PASS " : "FAIL ") "the mirrors were undone on the screens")
    SayF((fwAt70 ? "PASS " : "FAIL ") "Fair Warning then went out at the real £70")
    ExitApp
}
; ── --phantomtest: Jordan's lot 510. A genuine Vectis bid lands BETWEEN our SET and our
;    Saleroom press, re-opening the ladder — so our press mints a bid nobody made. The
;    verification must spot the top-row label is OURS, undo the phantom on the spot, and
;    never mirror it to the other side. And while a side is behind, NO Fair Warning. ──
if A_Args.Length >= 1 && A_Args[1] = "--phantomtest" {
    CFG.mode := "both", CFG.fwSecs := 3, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 40, v: 40, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayP(t) => FileAppend(t "`n", "*")
    loop 6 {
        TickBoth()
        Sleep 60
    }
    SayP("settled at £" RS.price " on both")
    ; A Saleroom internet bid at 45 — Vectis will need catching up.
    SIM.s := 45, SIM.sname := "INTERNET"
    SayP("── Saleroom internet bid £45 — Vectis behind at £40")
    ; THE RACE: the moment our SET lands, a genuine Vectis bid arrives at 45 and the
    ; ladder re-opens — the asking becomes 55, and our queued press will fire at it.
    SetTimer WatchForSet, 20
    WatchForSet() {
        global SIM
        for pr in SIM.presses
            if InStr(pr, "vectis.btn_askset") {
                SetTimer WatchForSet, 0
                SIM.v := 45
                SIM.vtype := "Vectis Live"
                SIM.askV := 55
                FileAppend "── genuine Vectis Live £45 lands after our SET — ladder re-opens, asking now £55`n", "*"
                return
            }
    }
    t0 := A_TickCount, fwWhileBehind := false
    while A_TickCount - t0 < 9000 {
        TickBoth()
        if !IsObject(RS)
            break
        for pr in SIM.presses
            if InStr(pr, "btn_fw") && SIM.v != SIM.s
                fwWhileBehind := true
        Sleep 80
    }
    SetTimer WatchForSet, 0
    seq := ""
    for pr in SIM.presses
        seq .= pr " "
    SayP((InStr(seq, "vectis.btn_askset") ? "PASS " : "FAIL ") "the catch-up began (the race was real)")
    SayP((!InStr(seq, "vectis.btn_saleroom") ? "PASS " : "FAIL ") "the committing press was ABANDONED — the genuine bid was seen in the last instant")
    SayP((!InStr(seq, "vectis.btn_undo") ? "PASS " : "FAIL ") "no phantom was ever made, so nothing needed undoing")
    SayP((SIM.v = 45 && SIM.s = 45 ? "PASS " : "FAIL ") "both screens ended level at the REAL bid — £45 (S=" SIM.s " V=" SIM.v ")")
    SayP((RS.price = 45 ? "PASS " : "FAIL ") "the agreed price is £45, not the phantom (price=£" RS.price ")")
    SayP((!fwWhileBehind ? "PASS " : "FAIL ") "Fair Warning never fired while a side was still behind")
    SayP((InStr(seq, "btn_fw") ? "PASS " : "FAIL ") "Fair Warning DID come once level and quiet (presses: " seq ")")
    ExitApp
}
; ── --reopentest: the UNCATCHABLE snipe — the bid lands only after the hammer is pressed.
;    The sold check must see it before Next and REVERSE the sale (Re-Open Lot / sale Undo),
;    and a lot that closes clean must still press Next as normal. ─────────────────
if A_Args.Length >= 1 && A_Args[1] = "--reopentest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayR(t) => FileAppend(t "`n", "*")
    loop 6 {
        TickBoth()
        Sleep 60
    }
    SayR("settled at £" RS.price " on both")
    ; The snipe appears only once the hammer has ALREADY been pressed — planted by
    ; watching the press list, the way no pre-press guard could ever see it.
    SetTimer WatchForHammer, 25
    WatchForHammer() {
        global SIM
        for pr in SIM.presses
            if InStr(pr, "btn_hammer") {
                SIM.v := 25
                SetTimer WatchForHammer, 0
                FileAppend "── snipe planted: Vectis £25, triggered BY the hammer press itself`n", "*"
                return
            }
    }
    CloseLotBoth("sold")
    SetTimer WatchForHammer, 0
    seq := ""
    for pr in SIM.presses
        seq .= pr " "
    SayR((InStr(seq, "vectis.btn_hammer") ? "PASS " : "FAIL ") "the hammer went down first (the snipe was genuinely uncatchable)")
    SayR((InStr(seq, "vectis.btn_reopen") ? "PASS " : "FAIL ") "Vectis Re-Open Lot pressed")
    SayR((InStr(seq, "saleroom.btn_sale_undo") ? "PASS " : "FAIL ") "Saleroom sale-Undo pressed")
    SayR((!InStr(seq, "btn_next") ? "PASS " : "FAIL ") "Next was NOT pressed — the lot stays live (presses: " seq ")")
    SayR((RS.lots = 0 ? "PASS " : "FAIL ") "the lot did not count as closed")
    SayR((!RS.paused ? "PASS " : "FAIL ") "the run is NOT held — bidding simply continues")
    ; And a clean close must still move on — first let the clerk reconcile at £25
    ; (the reversed snipe is now just the standing bid), then close cleanly.
    loop 15 {
        TickBoth()
        Sleep 60
    }
    SayR("re-settled at £" RS.price " on both after the reversal")
    SIM.presses := []
    RS.lastChangeAt := A_TickCount
    CloseLotBoth("sold")
    seq2 := ""
    for pr in SIM.presses
        seq2 .= pr " "
    SayR((InStr(seq2, "btn_next") ? "PASS " : "FAIL ") "a clean sale still presses Next (presses: " seq2 ")")
    ExitApp
}
; ── --watchtest: the nastiest snipe — the bid lands AFTER the last look has already read
;    the screens, in the gap that used to be pressed straight through. ─────────────────
if A_Args.Length >= 1 && A_Args[1] = "--watchtest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayW(t) => FileAppend(t "`n", "*")
    loop 6 {
        TickBoth()
        Sleep 60
    }
    SayW("settled at £" RS.price " on both")
    ; The snipe lands 200 ms into the close — after the last look has read, while the
    ; boxes are being watched. This is the case that was being hammered through.
    SetTimer(() => (SIM.v := 25, FileAppend("── snipe: Vectis £25, 200 ms into the close (after the last look read)`n", "*")), -200)
    CloseLotBoth("sold")
    seq := ""
    for p in SIM.presses
        seq .= p " "
    hammered := InStr(seq, "vectis.btn_hammer") || InStr(seq, "saleroom.btn_sell")
    SayW((!hammered ? "PASS " : "FAIL ") "the final watch caught it — nothing hammered (presses: " (seq = "" ? "none" : seq) ")")
    SayW((RS.lots = 0 ? "PASS " : "FAIL ") "the lot did NOT close (lots closed: " RS.lots ")")
    ExitApp
}
; ── --lastlooktest: the sniping guard on its own. Both screens settled at £20, then a bid
;    lands with NO tick in between — only the last look can catch it. It must not hammer. ──
if A_Args.Length >= 1 && A_Args[1] = "--lastlooktest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayLL(t) => FileAppend(t "`n", "*")
    loop 6 {                                  ; settle both screens at £20
        TickBoth()
        Sleep 60
    }
    SayLL("settled: price £" RS.price " · Saleroom £" RS.side["saleroom"].bid " · Vectis £" RS.side["vectis"].bid)
    SIM.v := 25                               ; the snipe — no tick sees it first
    SayLL("── snipe planted: Vectis £25, with no tick between it and the sell")
    CloseLotBoth("sold")
    seq := ""
    for p in SIM.presses
        seq .= p " "
    hammered := InStr(seq, "vectis.btn_hammer") || InStr(seq, "saleroom.btn_sell")
    SayLL((!hammered ? "PASS " : "FAIL ") "the last look caught the fresh bid — nothing hammered (presses: " (seq = "" ? "none" : seq) ")")
    SayLL((RS.lots = 0 ? "PASS " : "FAIL ") "the lot did NOT close (lots closed: " RS.lots ")")
    ExitApp
}
; ── --lottest: a lot moves on by itself, then the two screens end up on DIFFERENT lots.
;    Neither may be mistaken for an undo, and the mismatch must HOLD the run. ───────────
if A_Args.Length >= 1 && A_Args[1] = "--lottest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    SayL(t) => FileAppend(t "`n", "*")
    t0 := A_TickCount, moved := false, held := 0
    while A_TickCount - t0 < 20000 {
        el := A_TickCount - t0
        if !moved && el >= 2500 {
            moved := true
            SIM.slot := "514", SIM.s := 0        ; Saleroom jumps to the next lot on its own
            SayL("── t=" el " Saleroom moves to lot 514 by itself (its figure falls to £0); Vectis stays on 513 at £20")
        }
        TickBoth()
        if RS.paused {
            held := el
            break
        }
        Sleep 100
    }
    seq := ""
    for p in SIM.presses
        seq .= p " "
    SayL((!InStr(seq, "btn_undo") ? "PASS " : "FAIL ") "the healthy screen was NOT undone (presses: " (seq = "" ? "none" : seq) ")")
    SayL((held ? "PASS " : "FAIL ") "the run HELD when the screens sat on different lots (at t=" held "ms)")
    SayL((RS.blind ? "PASS " : "FAIL ") "it is showing the red held banner, waiting for F10")
    ; ⚠ And it must never become a trap: resume, and the second disagreement turns the lot
    ; check OFF instead of holding again (bad boxes are commoner than genuine mismatches).
    PauseRun()                                   ; the F10 a person would press
    t1 := A_TickCount, reheld := false
    while A_TickCount - t1 < 9000 {
        TickBoth()
        if RS.paused {
            reheld := true
            break
        }
        Sleep 100
    }
    SayL((!reheld ? "PASS " : "FAIL ") "after F10 it did NOT hold again (it must not be a trap)")
    SayL((RS.lotWatchOff ? "PASS " : "FAIL ") "the lot check turned itself off and said so, leaving the rest running")
    ExitApp
}
; ── --blindtest: one screen goes unreadable mid-lot — the clerk must PAUSE, not act ──────
if A_Args.Length >= 1 && A_Args[1] = "--blindtest" {
    CFG.mode := "both", CFG.fwSecs := 30, CFG.sellSecs := 30, CFG.passNoBids := true
    for nm, prof in PROFILES {
        m := Map()
        for it in prof.items {
            if it.kind != "reg"
                m[it.key] := { x: 0, y: 0 }
            else if it.key = "reg_vtype"
                m[it.key] := { x: 4000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_sname"
                m[it.key] := { x: 3000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_lot"
                m[it.key] := { x: nm = "vectis" ? 6000 : 5000, y: 100, w: 50, h: 20 }
            else if it.key = "reg_feed"
                continue
            else
                m[it.key] := { x: nm = "vectis" ? 2000 : 1000, y: 100, w: 50, h: 20 }
        }
        CAL[nm] := m
    }
    SIM := { s: 20, v: 20, typed: 0, askV: 0, soldV: false, soldS: false, presses: [], out: "", vtype: "Saleroom", sname: "ROOM", slot: "513", vlot: "513" }
    RS := NewRunState(true)
    SIM.t0 := A_TickCount
    Say2(t) => FileAppend(t "`n", "*")
    t0 := A_TickCount
    wentBlind := false
    while A_TickCount - t0 < 16000 {
        el := A_TickCount - t0
        if !wentBlind && el >= 2000 {
            wentBlind := true
            SIM.s := ""                          ; the Saleroom box becomes unreadable ("£" → nothing)
            Say2("── t=" el " Saleroom goes UNREADABLE while both screens hold £20")
        }
        TickBoth()
        if RS.paused
            break
        Sleep 100
    }
    seq := ""
    for p in SIM.presses
        seq .= p " "
    blindAt := A_TickCount - t0
    Say2((RS.paused && RS.blind ? "PASS " : "FAIL ") "clerk went BLIND-paused (at t=" blindAt "ms — expect ~12000)")
    Say2((!InStr(seq, "btn_undo") && !InStr(seq, "btn_pass") && !InStr(seq, "btn_sell") && !InStr(seq, "btn_hammer") ? "PASS " : "FAIL ") "no undo/pass/sell pressed while blind (presses: " (seq = "" ? "none" : seq) ")")
    Say2((RS.side["saleroom"].bid = 20 ? "PASS " : "FAIL ") "the held figure stayed £20 (was " RS.side["saleroom"].bid ")")
    ExitApp
}
if A_Args.Length >= 1 && A_Args[1] = "--helpertest" {
    StartOcr()
    pidStarted := OCR_PID
    alive1 := ProcessExist(pidStarted)
    t0 := A_TickCount
    StopOcr()
    alive2 := ProcessExist(pidStarted)
    Sleep 300
    alive3 := ProcessExist(pidStarted)
    FileAppend "helper pid " pidStarted " · alive after start: " alive1 " · alive right after StopOcr (" (A_TickCount - t0) " ms): " alive2 " · 300 ms later: " alive3 "`n", "*"
    ExitApp
}
if A_Args.Length >= 5 && A_Args[1] = "--ocrtest" {
    StartOcr()
    t0 := A_TickCount
    txt := OcrRead(Integer(A_Args[2]), Integer(A_Args[3]), Integer(A_Args[4]), Integer(A_Args[5]))
    t1 := A_TickCount
    txt2 := OcrRead(Integer(A_Args[2]), Integer(A_Args[3]), Integer(A_Args[4]), Integer(A_Args[5]))
    t2 := A_TickCount
    FileAppend "first read " (t1 - t0) " ms: [" txt "]`nsecond read " (t2 - t1) " ms: [" txt2 "]`namount: " ParseAmount(txt2) "`n", "*"
    StopOcr()
    ExitApp
}

LoadIni()
BuildMainGui()

; ══════════════════════════════════════════════════════════════════════════════
; Settings file
; ══════════════════════════════════════════════════════════════════════════════
LoadIni() {
    global CFG, CAL
    CFG.profile    := IniRead(INI, "settings", "profile", "saleroom")
    CFG.mode       := IniRead(INI, "settings", "mode", "single") = "both" ? "both" : "single"
    CFG.srExact    := IniRead(INI, "settings", "srExact", "enter") = "bid" ? "bid" : "enter"
    CFG.fwSecs     := Integer(IniRead(INI, "settings", "fwSecs", 15))
    CFG.sellSecs   := Integer(IniRead(INI, "settings", "sellSecs", 20))
    CFG.passNoBids := IniRead(INI, "settings", "passNoBids", "1") = "1"
    CFG.lotWatch   := IniRead(INI, "settings", "lotWatch", "1") = "1"
    CFG.mirrorV := IniRead(INI, "settings", "mirrorV", CFG.mirrorV)
    CFG.mirrorS := IniRead(INI, "settings", "mirrorS", CFG.mirrorS)
    CFG.genuineS := IniRead(INI, "settings", "genuineS", CFG.genuineS)
    CFG.pollMs     := Integer(IniRead(INI, "settings", "pollMs", 250))
    if !PROFILES.Has(CFG.profile)
        CFG.profile := "saleroom"
    for name, prof in PROFILES {
        m := Map()
        for it in prof.items {
            v := IniRead(INI, "cal_" name, it.key, "")
            if v = ""
                continue
            p := StrSplit(v, ",")
            if it.kind = "btn" && p.Length >= 2
                m[it.key] := { x: Integer(p[1]), y: Integer(p[2]) }
            else if it.kind = "reg" && p.Length >= 4
                m[it.key] := { x: Integer(p[1]), y: Integer(p[2]), w: Integer(p[3]), h: Integer(p[4]) }
        }
        CAL[name] := m
    }
}
SaveIni() {
    IniWrite CFG.profile, INI, "settings", "profile"
    IniWrite CFG.mode, INI, "settings", "mode"
    IniWrite CFG.srExact, INI, "settings", "srExact"
    IniWrite CFG.fwSecs, INI, "settings", "fwSecs"
    IniWrite CFG.sellSecs, INI, "settings", "sellSecs"
    IniWrite (CFG.passNoBids ? "1" : "0"), INI, "settings", "passNoBids"
    IniWrite (CFG.lotWatch ? "1" : "0"), INI, "settings", "lotWatch"
    IniWrite CFG.mirrorV, INI, "settings", "mirrorV"
    IniWrite CFG.mirrorS, INI, "settings", "mirrorS"
    IniWrite CFG.genuineS, INI, "settings", "genuineS"
    IniWrite CFG.pollMs, INI, "settings", "pollMs"
    for name, m in CAL {
        for key, v in m {
            if v.HasProp("w")
                IniWrite v.x "," v.y "," v.w "," v.h, INI, "cal_" name, key
            else
                IniWrite v.x "," v.y, INI, "cal_" name, key
        }
    }
}
CalCount(name) {
    n := 0
    for it in PROFILES[name].items
        if CAL[name].Has(it.key)
            n++
    return n
}
/** The things a run cannot start without. "both" needs both screens plus the catch-up buttons. */
MissingForRun(name) {
    if name = "both" {
        miss := []
        for k in ["reg_bid", "btn_fw", "btn_sell", "btn_next", "btn_pass", "btn_bid", "btn_undo", "box_amount"]
            if !CAL["saleroom"].Has(k)
                miss.Push("Saleroom " k)
        for k in ["reg_bid", "btn_fw", "btn_hammer", "btn_pass", "btn_saleroom", "btn_undo", "box_asking", "btn_askset"]
            if !CAL["vectis"].Has(k)
                miss.Push("Vectis " k)
        return miss
    }
    need := name = "saleroom" ? ["reg_bid", "btn_fw", "btn_sell", "btn_next", "btn_pass"]
                              : ["reg_bid", "btn_fw", "btn_hammer", "btn_pass"]
    miss := []
    for k in need
        if !CAL[name].Has(k)
            miss.Push(k)
    return miss
}

WriteLog(msg) {
    if IsObject(SIM)                    ; simulation runs stay out of the real log
        return
    ; ⚠ MILLISECONDS. Seconds alone made the sniping question unanswerable: the last look
    ; and the hammer both stamped "16:31:19", so a 450 ms watch was invisible in the log.
    try FileAppend FormatTime(A_Now, "yyyy-MM-dd HH:mm:ss") "." Format("{:03}", A_MSec) "  " msg "`r`n", LOGF
}

; ══════════════════════════════════════════════════════════════════════════════
; Main window
; ══════════════════════════════════════════════════════════════════════════════
BuildMainGui() {
    ; ⚠ EVERY control variable assigned in here must be in this list, or the assignment
    ; quietly makes a LOCAL copy and the real global stays 0 (M_MODE/M_ONE were missed
    ; → "won't open", Integer has no property Value, 2026-08-21 16:22).
    global MAIN, M_STATUS, M_PROF, M_FW, M_SELL, M_PASS, M_CAL, M_MODE, M_ONE, M_EXACT, M_LOT, M_MIRV, M_MIRS, M_GENS
    MAIN := Gui("+AlwaysOnTop", "Auto Clerk")
    MAIN.SetFont("s10", "Segoe UI")
    MAIN.Add("Text", "w560", "Works whatever clerking screen is on the monitor — the trainers now, the real pages later. "
        . "Calibrate once per screen, get the screen fully visible, press Start and keep your hands off the mouse.")
    MAIN.Add("Text", "xm y+12 w120", "Screen:")
    M_PROF := MAIN.Add("DropDownList", "x+4 w260", ["Saleroom (GAP) screen", "Vectis (Bidpath) clerk screen"])
    M_PROF.Value := CFG.profile = "vectis" ? 2 : 1
    M_PROF.OnEvent("Change", (*) => (CFG.profile := M_PROF.Value = 2 ? "vectis" : "saleroom", SaveIni(), RefreshMain()))
    M_CAL := MAIN.Add("Button", "x+10 w160", "🎯 Calibrate this screen")
    M_CAL.OnEvent("Click", (*) => StartCalibration(CFG.profile))
    MAIN.Add("Button", "xm+124 y+6 w110", "🔍 Test read").OnEvent("Click", (*) => TestRead())
    ; One position at a time — changing a single button must not mean redoing them all.
    MAIN.Add("Text", "xm y+10 w120", "Set just one:")
    M_ONE := MAIN.Add("DropDownList", "x+4 w430", ["—"])
    MAIN.Add("Button", "x+10 w160", "🎯 Set just this one").OnEvent("Click", (*) => SetOne())

    MAIN.Add("Text", "xm y+12 w120", "Run:")
    M_MODE := MAIN.Add("DropDownList", "x+4 w430", ["One screen — the one selected above, on the timers", "BOTH screens — clerk Saleroom and Vectis together and keep them in step"])
    M_MODE.Value := CFG.mode = "both" ? 2 : 1
    M_MODE.OnEvent("Change", (*) => (CFG.mode := M_MODE.Value = 2 ? "both" : "single", SaveIni(), RefreshMain()))
    MAIN.Add("Text", "xm y+6 w120", "Saleroom amount:")
    M_EXACT := MAIN.Add("DropDownList", "x+4 w430", ["type in the box next to A, then press ENTER  (the Saleroom Trainer)", "type in the box next to A, then press the BID button  (the real Saleroom page)"])
    M_EXACT.Value := CFG.srExact = "bid" ? 2 : 1
    M_EXACT.OnEvent("Change", (*) => (CFG.srExact := M_EXACT.Value = 2 ? "bid" : "enter", SaveIni()))

    MAIN.Add("Text", "xm y+14 w120", "Fair Warning after")
    M_FW := MAIN.Add("Edit", "x+4 w50 Number", CFG.fwSecs)
    MAIN.Add("Text", "x+4 w150", "seconds with no new bid")
    MAIN.Add("Text", "xm y+6 w120", "Sell / Hammer after")
    M_SELL := MAIN.Add("Edit", "x+4 w50 Number", CFG.sellSecs)
    MAIN.Add("Text", "x+4 w230", "more seconds with no new bid, then Next")
    M_PASS := MAIN.Add("CheckBox", "xm y+8 w560 Checked" (CFG.passNoBids ? 1 : 0), "A lot that gets NO bids at all is Passed after the same time (otherwise it waits for you)")
    ; ⚠ Off is a legitimate setting, not a failure: a lot number that MOVES about the screen
    ; cannot be boxed at all (Jordan, 2026-08-24 — the Vectis lot number has no fixed spot).
    M_LOT := MAIN.Add("CheckBox", "xm y+4 w560 Checked" (CFG.lotWatch ? 1 : 0), "Watch the lot number on each screen (needs a LOT NUMBER box on both — untick it if the lot number moves about)")
    MAIN.Add("Text", "xm y+4 w560 c808080", "Real sale = 15 / 20. For a quick practice run try 6 / 8.")
    MAIN.Add("Text", "xm y+10 w560", "Bid-list wording — what the platforms call things (edit if the real pages use different words; commas separate alternatives):")
    MAIN.Add("Text", "xm y+4 w280 Right", "OUR press shows on the VECTIS list as")
    M_MIRV := MAIN.Add("Edit", "x+6 yp-3 w200", CFG.mirrorV)
    MAIN.Add("Text", "xm y+8 w280 Right", "OUR press shows on the SALEROOM list as")
    M_MIRS := MAIN.Add("Edit", "x+6 yp-3 w200", CFG.mirrorS)
    MAIN.Add("Text", "xm y+8 w280 Right", "a REAL online bidder on the SALEROOM list says")
    M_GENS := MAIN.Add("Edit", "x+6 yp-3 w200", CFG.genuineS)

    M_STATUS := MAIN.Add("Text", "xm y+12 w560 h40", "")
    b := MAIN.Add("Button", "xm y+6 w200 Default", "▶  Start  (F9)")
    b.OnEvent("Click", (*) => ToggleRun())
    MAIN.Add("Button", "x+10 w120", "Open log").OnEvent("Click", (*) => (FileExist(LOGF) ? Run(LOGF) : MsgBox("Nothing logged yet.")))
    MAIN.Add("Text", "x+10 w220 c808080", "F9 start/stop · F10 pause · Esc stop")
    MAIN.OnEvent("Close", (*) => ExitApp())
    Hotkey "F9", (*) => ToggleRun()
    Hotkey "F10", (*) => PauseRun()
    RefreshMain()
    MAIN.Show()
}
/** The "Set just one" list follows the selected screen; a set position shows a tick. */
FillOneList() {
    global M_ONE
    keep := M_ONE.Value
    M_ONE.Delete()
    for it in PROFILES[CFG.profile].items
        M_ONE.Add([(CAL[CFG.profile].Has(it.key) ? "✓ " : "○ ") Short(it.label, 70)])
    M_ONE.Value := (keep >= 1 && keep <= PROFILES[CFG.profile].items.Length) ? keep : 1
}
SetOne() {
    i := M_ONE.Value
    if i < 1
        return
    StartCalibration(CFG.profile, PROFILES[CFG.profile].items[i].key)
}
RefreshMain() {
    global M_STATUS
    FillOneList()
    if CFG.mode = "both" {
        miss := MissingForRun("both")
        txt := "Both screens: Saleroom " CalCount("saleroom") "/" PROFILES["saleroom"].items.Length
             . " · Vectis " CalCount("vectis") "/" PROFILES["vectis"].items.Length " positions set."
        txt .= miss.Length ? "  ⚠ Still needed: " Join(miss, ", ") : "  ✓ Ready to run both."
        if !(CAL["vectis"].Has("reg_vtype") && CAL["saleroom"].Has("reg_sname"))
            txt .= "  (Tie-break off until the two top-row label boxes are set.)"
        if !CFG.lotWatch
            txt .= "  (Lot watch switched off.)"
        else if !(CAL["vectis"].Has("reg_lot") && CAL["saleroom"].Has("reg_lot"))
            txt .= "  (Lot watch off until both lot-number boxes are set.)"
        if !(CAL["vectis"].Has("btn_reopen") && CAL["saleroom"].Has("btn_sale_undo"))
            txt .= "  (Snipe recovery holds for a hand-reverse until the Re-Open Lot / sale-Undo buttons are set.)"
        if !(CAL["vectis"].Has("reg_feed") && CAL["saleroom"].Has("reg_feed"))
            txt .= "  (Real-bidder check off until both bid-feed boxes are set.)"
        M_STATUS.Text := txt
        return
    }
    name := CFG.profile
    n := CalCount(name), total := PROFILES[name].items.Length
    miss := MissingForRun(name)
    txt := PROFILES[name].title ": " n " of " total " positions set."
    txt .= miss.Length ? "  ⚠ Still needed to run: " Join(miss, ", ") : "  ✓ Ready to run."
    M_STATUS.Text := txt
}
Join(arr, sep) {
    s := ""
    for i, v in arr
        s .= (i > 1 ? sep : "") v
    return s
}
ReadSettingsFromGui() {
    CFG.fwSecs := Max(2, Integer(M_FW.Value || 15))
    CFG.sellSecs := Max(2, Integer(M_SELL.Value || 20))
    CFG.passNoBids := M_PASS.Value = 1
    CFG.lotWatch := M_LOT.Value = 1
    ; blank fields fall back to the defaults — an empty mirror word would make
    ; EVERYTHING look genuine and blind the tie check
    CFG.mirrorV := Trim(M_MIRV.Text) != "" ? Trim(M_MIRV.Text) : "Saleroom, Sale room"
    CFG.mirrorS := Trim(M_MIRS.Text) != "" ? Trim(M_MIRS.Text) : "ROOM"
    CFG.genuineS := Trim(M_GENS.Text) != "" ? Trim(M_GENS.Text) : "INTERNET"
    SaveIni()
}

; ══════════════════════════════════════════════════════════════════════════════
; Calibration — hover + F8 / middle-click, banner names each thing (as the Macro Calibrator)
; ══════════════════════════════════════════════════════════════════════════════
StartCalibration(name, onlyKey := "") {
    global CALST
    if IsObject(RS) {
        MsgBox "Stop the run first (Esc), then calibrate.", "Auto Clerk", "Iconi"
        return
    }
    ; The whole screen, or just the one position asked for.
    items := []
    for it in PROFILES[name].items
        if onlyKey = "" || it.key = onlyKey
            items.Push(it)
    if !items.Length
        return
    MAIN.Hide()
    CALST := { name: name, items: items, i: 1, busy: false }
    try StartOcr()      ; so a captured bid box can be read back immediately
    BuildBanner()
    Hotkey "F8",      (*) => OnCalKey("ok"),     "On"
    Hotkey "MButton", (*) => OnCalKey("ok"),     "On"
    Hotkey "F10",     (*) => OnCalKey("skip"),   "On"
    Hotkey "F7",      (*) => OnCalKey("back"),   "On"
    Hotkey "Esc",     (*) => OnCalKey("cancel"), "On"
    ShowCalItem()
    SetTimer CalTick, 100
    MaybeDragCurrent()
}
ShowCalItem() {
    global CALST
    if !IsObject(CALST)
        return
    items := CALST.items
    if CALST.i > items.Length
        return
    it := items[CALST.i]
    have := CAL[CALST.name].Has(it.key) ? "  (currently set)" : ""
    B_L1.SetFont("cFFFFFF")
    if it.kind = "reg" {
        B_L1.Text := "▶  " CALST.i " of " items.Length "  —  " it.label
        B_L2.Text := "Draw a box round it — the screen dims and you drag, like the snipping tool. (F8 draws it again, F10 keeps the old one.)" have
        B_L3.Text := "DRAG to draw the box   ·   F8 = draw it again   ·   F10 = keep the old one   ·   F7 = back one   ·   Esc = stop"
    } else {
        B_L1.Text := "▶  " CALST.i " of " items.Length "  —  " it.label
        B_L2.Text := "Hover over it and press F8 (or middle-click)." have
        B_L3.Text := "F8 or MIDDLE-CLICK = capture   ·   F10 = keep the old position   ·   F7 = back one   ·   Esc = stop"
    }
}
CalTick() {
    global CALST, BANNER, BANNER_TOP
    if !IsObject(CALST) || CALST.busy      ; nothing over the top of the snipping overlay
        return
    MouseGetPos &mx, &my
    ToolTip "F8 / middle-click = capture here   (" mx ", " my ")"
    try {
        BANNER.GetPos(&bx, &by, &bw, &bh)
        if mx >= bx - 40 && mx <= bx + bw + 40 && my >= by - 40 && my <= by + bh + 40 {
            BANNER.Move(, BANNER_TOP ? A_ScreenHeight - bh - 80 : 12)
            BANNER_TOP := !BANNER_TOP
        }
    }
}
OnCalKey(action) {
    global CALST
    if !IsObject(CALST) || CALST.busy
        return
    CALST.busy := true
    items := CALST.items
    it := items[CALST.i]
    if action = "ok" {
        if it.kind = "reg" {
            ; Regions are drawn, not hovered — F8 here just re-opens the snipping overlay.
            CALST.busy := false
            StartDragForCurrent()
            return
        }
        MouseGetPos &cx, &cy
        CAL[CALST.name][it.key] := { x: cx, y: cy }
        FlashBanner("✔  captured " cx ", " cy, "22C55E")
        CALST.i++
    } else if action = "skip" {
        FlashBanner("⏭  kept as it was", "FBBF24")
        CALST.i++
    } else if action = "back" {
        CALST.i := Max(1, CALST.i - 1)
        ShowCalItem()
        CALST.busy := false
        MaybeDragCurrent()
        return
    } else if action = "cancel" {
        if MsgBox("Stop calibrating? Positions captured so far are kept.", "Auto Clerk", "YesNo Icon?") = "Yes" {
            EndCalibration()
            return
        }
    }
    if IsObject(CALST) && CALST.i > items.Length {
        EndCalibration()
        return
    }
    if IsObject(CALST) {
        CALST.busy := false
        ShowCalItem()
        MaybeDragCurrent()      ; the next item may be a box to draw
    }
}
EndCalibration() {
    global CALST
    for k in ["F8", "MButton", "F10", "F7", "Esc"]
        try Hotkey k, "Off"
    SetTimer CalTick, 0
    SetTimer ShowCalItem, 0
    ToolTip
    try BANNER.Destroy()
    CALST := 0
    StopOcr()
    SaveIni()
    RefreshMain()
    MAIN.Show()
}

/** One pass over EVERY box calibrated on the selected screen — the picture each box
 *  produced, what Windows read in it, what that was taken to mean, and the final
 *  verdict the clerk would act on. The quickest way to prove a calibration. */
TestRead() {
    if !CAL[CFG.profile].Has("reg_bid") {
        MsgBox "Calibrate the current-bid box on this screen first.", "Auto Clerk", "Iconi"
        return
    }
    try StartOcr()
    catch as e {
        MsgBox "Could not start the screen reader:`n" e.Message, "Auto Clerk", "Iconx"
        return
    }
    rows := []
    for it in PROFILES[CFG.profile].items {
        if it.kind != "reg" || !CAL[CFG.profile].Has(it.key)
            continue
        r := BidRegion(CFG.profile, it.key)
        isLabel := it.key = "reg_vtype" || it.key = "reg_sname"
        isLot := it.key = "reg_lot"
        isFeed := it.key = "reg_feed"
        txt := OcrRead(r.x, r.y, r.w, r.h, isFeed ? "lines" : isLabel ? "txt" : "num")
        pic := OCR_DIR "\test-" it.key ".png"
        try FileCopy OCR_DIR "\last.png", pic, 1
        levels := ""
        if isFeed {
            for line in StrSplit(txt, "`n") {
                amt := GenuineLineAmount(line, CFG.profile)
                if amt > 0
                    levels .= (levels ? ", " : "") "£" amt
            }
        }
        meaning := isFeed
            ? (Trim(txt) = "" ? "nothing — is the bid list inside the box?" : levels ? "real bids seen at " levels : "rows read, but no real bids picked out")
            : isLabel
            ? (Trim(txt) = "" ? "nothing — is the top bid row inside the box?" : "label used by the tie check")
            : isLot
                ? (LotToken(CFG.profile) != "" ? "lot " LotToken(CFG.profile) : "no lot number found")
                : (ParseAmount(txt) >= 0 ? "£" ParseAmount(txt) : "no number here by itself")
        rows.Push({ key: it.key, r: r, txt: txt, meaning: meaning, pic: pic })
    }
    verdict := ReadBid(CFG.profile)
    ; Both lot boxes at once — they must agree, and a mismatch here is what holds a run.
    lotLine := ""
    if CAL["saleroom"].Has("reg_lot") && CAL["vectis"].Has("reg_lot") {
        ls := LotToken("saleroom"), lv := LotToken("vectis")
        lotLine := ls = "" || lv = ""
            ? "Lot watch: Saleroom [" (ls = "" ? "nothing" : ls) "] · Vectis [" (lv = "" ? "nothing" : lv) "] — one of the lot boxes can't be read."
            : ls = lv
                ? "Lot watch: both screens read lot " ls " — they agree, so the run won't be held."
                : "Lot watch: Saleroom reads " ls " but Vectis reads " lv " — they must MATCH. Either the screens really are on different lots, or a lot box is picking up the wrong text: re-draw it."
    }
    StopOcr()
    ShowTestRead(rows, verdict, lotLine)
}

/** Every box's picture and reading, then the verdict. */
ShowTestRead(rows, verdict, lotLine := "") {
    NAMES := Map("reg_bid", "CURRENT BID box", "reg_ask", "A — next asking box",
                 "reg_vtype", "Vectis top-row Bid Type (tie check)", "reg_sname", "Saleroom top-row Name (tie check)",
                 "reg_lot", "LOT NUMBER box (lot watch)", "reg_feed", "BID FEED — the whole list (real-bidder check)")
    ; ⚠ TWO COLUMNS, pictures scaled to FIT (2026-08-25, Jordan: "the test read seems
    ; to scroll off the page"). One column of 620px-wide pictures outgrew a 1080p screen
    ; once the box count reached six, and an AHK window cannot scroll — so items fill
    ; whichever column is currently shorter, and every picture is measured and shrunk to
    ; its slot instead of being stretched to the full width.
    g := Gui("+AlwaysOnTop" (IsObject(MAIN) ? " +Owner" MAIN.Hwnd : ""), "Auto Clerk — test read")
    g.SetFont("s10", "Segoe UI")
    colX := Map(1, 12, 2, 524)
    colY := Map(1, 10, 2, 10)
    colW := 490
    for row in rows {
        ci := colY[1] <= colY[2] ? 1 : 2
        x := colX[ci], y := colY[ci]
        g.SetFont("s10 Bold")
        g.Add("Text", Format("x{} y{} w{}", x, y, colW), NAMES.Has(row.key) ? NAMES[row.key] : row.key)
        g.SetFont("s9 Norm c606060")
        g.Add("Text", Format("x{} y+2 w{}", x, colW), row.r.x ", " row.r.y "  ·  " row.r.w " × " row.r.h " px — the box you drew")
        g.SetFont("s10 Norm")
        if FileExist(row.pic) {
            pw := 0, ph := 0
            try {
                hbm := LoadPicture(row.pic)
                bi := Buffer(32, 0)
                DllCall("GetObject", "ptr", hbm, "int", 32, "ptr", bi)
                pw := NumGet(bi, 4, "int"), ph := Abs(NumGet(bi, 8, "int"))
                DllCall("DeleteObject", "ptr", hbm)
            }
            if pw > 0 && ph > 0 {
                scale := Min(colW / pw, 150 / ph, 1.5)      ; fit the slot; never blow tiny ones up much
                g.Add("Picture", Format("x{} y+4 w{} h{} Border", x, Round(pw * scale), Round(ph * scale)), row.pic)
            } else {
                g.Add("Picture", Format("x{} y+4 w{} h-1 Border", x, colW), row.pic)
            }
        }
        last := g.Add("Text", Format("x{} y+4 w{} r2", x, colW), "Windows read:  [" Short(row.txt, 60) "]   →   " row.meaning)
        last.GetPos(, &ly, , &lh)
        colY[ci] := ly + lh + 16
    }
    y := Max(colY[1], colY[2]) + 4
    g.SetFont("s11 Bold")
    g.Add("Text", Format("x12 y{} w1002", y), "Verdict — the current bid the clerk would act on:   "
        . (verdict.amt >= 0 ? "£" verdict.amt : "nothing — no bid showing"))
    g.SetFont("s10 Norm")
    if lotLine != "" {
        agree := InStr(lotLine, "they agree")
        g.SetFont(agree ? "s10 Norm" : "s10 Bold cRed")
        g.Add("Text", "x12 y+6 w1002", (agree ? "✓ " : "⚠ ") lotLine)
        g.SetFont("s10 Norm")
    }
    if CFG.profile = "saleroom" && CAL.Has("saleroom") && !CAL["saleroom"].Has("reg_ask") {
        g.SetFont("s10 Bold cRed")
        g.Add("Text", "x12 y+6 w1002", "⚠ The A (next asking) box is NOT set — a lone single-digit bid (£5–£9) reads as nothing until it is. Use 'Set just one'.")
        g.SetFont("s10 Norm")
    }
    if CAL.Has("vectis") && CAL.Has("saleroom") && !(CAL["vectis"].Has("reg_vtype") && CAL["saleroom"].Has("reg_sname"))
        g.Add("Text", "x12 y+4 w1002", "ℹ The same-amount tie check stays off until the two top-row label boxes are set on both screens.")
    g.Add("Text", "x12 y+6 w1002", "The bid verdict tries the CURRENT BID box first; when that shows nothing (a lone digit), the A box is read and stepped back one increment. The label boxes are only consulted when both screens sit at the same figure.")
    g.Add("Button", "x12 w100 y+10 Default", "OK").OnEvent("Click", (*) => g.Destroy())
    g.OnEvent("Close", (*) => g.Destroy())
    g.Show()
}

/** Snipping-tool style region picker: drag a box round something on screen.
 *  Returns {x,y,w,h} in screen coordinates, or 0 if Esc cancelled it.
 *  ⚠ The dimmed overlay covers the WHOLE virtual desktop — both monitors, negative
 *  coordinates included — which is what makes this accurate: the drag can never reach
 *  the page underneath, and the pointer can never turn into a text I-beam over the very
 *  field you are trying to mark (Jordan, 2026-08-24: "my cursor changes to a typing one
 *  so its hard to mark"). Crosshair guides follow the mouse for precision. */
DragRegion(title, sub) {
    ; ⚠ Physical OR logical: the MButton hotkey installs the mouse hook, and the hook
    ; reports injected input as NOT physical — so a "P" test alone can never see a
    ; scripted drag, which is how this gets tested. A real hand satisfies both.
    Held(k) => GetKeyState(k, "P") || GetKeyState(k)
    vx := SysGet(76), vy := SysGet(77), vw := SysGet(78), vh := SysGet(79)

    ov := Gui("-Caption +AlwaysOnTop +ToolWindow", "AutoClerkSnip")
    ov.BackColor := "0B1222"
    ov.Show("NoActivate x" vx " y" vy " w" vw " h" vh)
    WinSetTransparent 110, ov.Hwnd

    guideX := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x20")
    guideX.BackColor := "38BDF8"
    guideX.Show("NoActivate x" vx " y" vy " w" vw " h1")
    guideY := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x20")
    guideY.BackColor := "38BDF8"
    guideY.Show("NoActivate x" vx " y" vy " w1 h" vh)

    band := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x20")
    band.BackColor := "7DD3FC"
    bandShown := false

    hint := Gui("-Caption +AlwaysOnTop +ToolWindow +E0x20")
    hint.BackColor := "111827"
    hint.MarginX := 24, hint.MarginY := 14
    hint.SetFont("s16 Bold cFFFFFF", "Segoe UI")
    hint.Add("Text", "w880 Center", title)
    hint.SetFont("s11 Norm c93C5FD", "Segoe UI")
    hint.Add("Text", "w880 Center", sub)
    hint.SetFont("s11 Norm cD1D5DB", "Segoe UI")
    hSize := hint.Add("Text", "w880 Center", "Click and drag a box round it   ·   Esc to cancel")
    hint.Show("NoActivate")
    hint.GetPos(,, &hw, &hh)
    hintTop := true
    hint.Move(vx + Round((vw - hw) / 2), vy + 14)
    WinSetTransparent 245, hint.Hwnd

    rect := 0
    KeyWait "LButton"
    KeyWait "Esc"
    loop {
        if Held("Esc")
            break
        MouseGetPos &mx, &my
        guideX.Move(, my)
        guideY.Move(mx)
        ; The hint sits opposite the pointer, decided by position (never a flip-flop).
        wantTop := my > vy + 260
        if wantTop != hintTop {
            hintTop := wantTop
            hint.Move(, hintTop ? vy + 14 : vy + vh - hh - 70)
        }
        if Held("LButton") {
            x1 := mx, y1 := my
            while Held("LButton") && !Held("Esc") {
                MouseGetPos &cx, &cy
                bx := Min(x1, cx), by := Min(y1, cy)
                bw := Max(1, Abs(cx - x1)), bh := Max(1, Abs(cy - y1))
                if !bandShown {
                    band.Show("NoActivate x" bx " y" by " w" bw " h" bh)
                    WinSetTransparent 120, band.Hwnd
                    bandShown := true
                } else {
                    band.Move(bx, by, bw, bh)
                }
                guideX.Move(, cy), guideY.Move(cx)
                hSize.Text := bw " × " bh " px"
                Sleep 15
            }
            if Held("Esc")
                break
            MouseGetPos &ex, &ey
            rect := { x: Min(x1, ex), y: Min(y1, ey), w: Abs(ex - x1), h: Abs(ey - y1) }
            break
        }
        Sleep 15
    }
    for g in [ov, band, guideX, guideY, hint]
        try g.Destroy()
    return rect
}

/** Run the drag for the region the calibration is currently on, store it, read it back
 *  and move on. Regions are ALWAYS drawn, never hovered — buttons stay hover + F8. */
StartDragForCurrent() {
    global CALST
    if !IsObject(CALST) || CALST.i > CALST.items.Length
        return
    it := CALST.items[CALST.i]
    if it.kind != "reg"
        return
    CALST.busy := true
    ToolTip
    try BANNER.Hide()
    r := DragRegion("Draw a box round " it.label,
        "Exactly what you draw is what it reads. Include the whole area the figure sits in — wide enough for a big number — and nothing else: another number inside the box can be read INSTEAD of the bid.")
    try BANNER.Show("NoActivate")
    if !IsObject(r) {
        FlashBanner("drag cancelled — F8 to draw it again, F10 to keep the old box", "FBBF24", 1800)
        CALST.busy := false
        return
    }
    if r.w < 6 || r.h < 6 {
        FlashBanner("✖ that box was too small — F8 to draw it again", "F87171", 1800)
        CALST.busy := false
        return
    }
    CAL[CALST.name][it.key] := r
    ; Read it straight back so a mis-drawn box shows itself NOW, not mid-run.
    readTxt := ""
    try {
        rr := BidRegion(CALST.name, it.key)
        readTxt := OcrRead(rr.x, rr.y, rr.w, rr.h, (it.key = "reg_vtype" || it.key = "reg_sname") ? "txt" : "num")
    }
    amtNow := ParseAmount(readTxt)
    isLabel := it.key = "reg_vtype" || it.key = "reg_sname"
    ok := isLabel ? (Trim(readTxt) != "") : (amtNow >= 0)
    FlashBanner("✔ box " r.w "×" r.h " — it reads [" Short(readTxt, 30) "]"
        . (isLabel ? "" : (amtNow >= 0 ? " = £" amtNow : " — no number (fine if the figure is a single digit; otherwise F8 and draw it wider)")),
        ok ? "22C55E" : "FBBF24", 2200)
    CALST.i++
    if CALST.i > CALST.items.Length {
        EndCalibration()
        return
    }
    CALST.busy := false
    ShowCalItem()
    MaybeDragCurrent(1800)      ; read the confirmation before the screen dims again
}
/** A region item starts its drag by itself — no key to press first. `after` is longer when
 *  we have just captured one, so the "it reads […]" confirmation can be read before the
 *  screen dims again for the next box. */
MaybeDragCurrent(after := 150) {
    global CALST
    if !IsObject(CALST) || CALST.i > CALST.items.Length
        return
    if CALST.items[CALST.i].kind = "reg"
        SetTimer StartDragForCurrent, -after
}

BuildBanner() {
    global BANNER, B_L1, B_L2, B_L3, BANNER_TOP
    BANNER := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20", "AutoClerkBanner")
    BANNER.BackColor := "111827"
    BANNER.MarginX := 28, BANNER.MarginY := 14
    BANNER.SetFont("s17 Bold cFFFFFF", "Segoe UI")
    B_L1 := BANNER.Add("Text", "w900 Center", "…")
    BANNER.SetFont("s11 Norm c93C5FD", "Segoe UI")
    B_L2 := BANNER.Add("Text", "w900 Center", "…")
    BANNER.SetFont("s10 Norm cD1D5DB", "Segoe UI")
    B_L3 := BANNER.Add("Text", "w900 Center", "F8 or MIDDLE-CLICK = capture    ·    F10 = keep the old position    ·    F7 = back one    ·    Esc = stop")
    BANNER.Show("NoActivate Hide")
    BANNER.GetPos(,, &w, &h)
    BANNER.Move(Round((A_ScreenWidth - w) / 2), 12)
    BANNER.Show("NoActivate")
    WinSetTransparent 235, BANNER.Hwnd
    BANNER_TOP := true
}
FlashBanner(msg, color, holdMs := 500) {
    B_L1.SetFont("c" color)
    B_L1.Text := msg
    SetTimer ShowCalItem, -holdMs
}

; ══════════════════════════════════════════════════════════════════════════════
; OCR — through the PowerShell helper (Windows' own engine)
; ══════════════════════════════════════════════════════════════════════════════
StartOcr() {
    global OCR_PID
    if OCR_PID && ProcessExist(OCR_PID)
        return true
    if !FileExist(OCR_PS1)
        throw Error("The OCR helper is missing: " OCR_PS1)
    DirCreate OCR_DIR
    for f in ["ocr-req.txt", "ocr-res.txt", "ocr-ready.txt", "ocr-res.tmp"]
        try FileDelete OCR_DIR "\" f
    ; Our own process id goes along so the helper can leave when this script is gone.
    Run 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' OCR_PS1 '" "' OCR_DIR '" ' DllCall("GetCurrentProcessId", "uint"), , "Hide", &pid
    OCR_PID := pid
    t0 := A_TickCount
    while !FileExist(OCR_DIR "\ocr-ready.txt") {
        if A_TickCount - t0 > 15000
            throw Error("The OCR helper did not start within 15 s.")
        Sleep 50
    }
    ; "powershell -WindowStyle Hidden" re-launches itself, so the pid Run gave us is a
    ; parent that has already exited. The helper writes its real pid into the ready file.
    Sleep 30
    try {
        real := Integer(Trim(FileRead(OCR_DIR "\ocr-ready.txt"), " `t`r`n"))
        if real > 0
            OCR_PID := real
    }
    return true
}
StopOcr() {
    global OCR_PID
    if OCR_PID {
        try FileAppend "quit", OCR_DIR "\ocr-req.txt"
        ; Give it a moment to leave on its own, then make sure.
        try ProcessWaitClose OCR_PID, 2
        try ProcessClose OCR_PID
        OCR_PID := 0
    }
}
/** Text Windows reads in the screen rectangle — "" when nothing / on failure.
 *  mode "num" = a number box: the helper trims it to the ink and paints "Bid" in front,
 *  so a lone digit reads. mode "txt" = plain text (the tie-check labels). */
OcrRead(x, y, w, h, mode := "num") {
    if IsObject(SIM) {                   ; --simboth: the screens are a model, not pixels
        if x >= 7500                     ; 8000 = Vectis feed, 7000 = Saleroom feed
            return SIM.feedV
        if x >= 6500
            return SIM.feedS
        if x >= 5500                     ; 6000 = Vectis lot, 5000 = Saleroom lot
            return "Bid " SIM.vlot
        if x >= 4500
            return "Bid " SIM.slot
        if x >= 3500                     ; label boxes: 4000 = Vectis type, 3000 = Saleroom name
            return SIM.vtype
        if x >= 2500
            return SIM.sname
        return "£" (x >= 1500 ? SIM.v : SIM.s)   ; (the padded Vectis box starts at 2000 − PAD_X)
    }
    req := OCR_DIR "\ocr-req.txt", res := OCR_DIR "\ocr-res.txt"
    try FileDelete res
    try FileAppend x " " y " " w " " h " " mode, req
    t0 := A_TickCount
    while !FileExist(res) {
        if A_TickCount - t0 > 1500
            return ""
        Sleep 5
    }
    Sleep 2
    txt := ""
    try txt := FileRead(res, "UTF-8")
    try FileDelete res
    return Trim(txt, " `t`r`n")
}
/** The rectangle actually read: the box you drew, plus a hair so nothing clips.
 *  ⚠ Draw the box round the whole area the figure sits in, not round the digits showing
 *  now: Saleroom's figure is right-aligned (it grows LEFT) and Vectis's is left-aligned
 *  (it grows RIGHT), so a box that fits "£5" today is spilled out of by "£1,250". Include
 *  nothing else — another number in the box can be read instead of the bid. */
BidRegion(name, key := "reg_bid") {
    r := CAL[name][key]
    return { x: r.x - PAD_X, y: r.y - PAD_Y, w: r.w + 2 * PAD_X, h: r.h + 2 * PAD_Y }
}

/** The saleroom's own increment ladder (the Saleroom Trainer / GAP table). */
SrInc(b) {
    if b < 50
        return 5
    if b < 200
        return 10
    if b < 500
        return 20
    if b < 1000
        return 50
    if b < 2000
        return 100
    if b < 5000
        return 200
    return 500
}
/** The bid that produces this asking figure on the saleroom ladder (10 → 5, 60 → 50), or -1. */
BidBeforeAsking(ask) {
    for inc in [5, 10, 20, 50, 100, 200, 500] {
        b := ask - inc
        if b >= 0 && b + SrInc(b) = ask
            return b
    }
    return -1
}

/** One screen's current bid: {txt, amt}. amt is -1 when nothing legible.
 *  ⚠ Windows' OCR NEVER returns a lone single character (measured: "5", "£5", tiled or
 *  scaled, always come back empty; "15" and "Current Bid: 5" read fine). On the Saleroom
 *  screen the H figure sits alone, so a £5–£9 bid is invisible to it. When H reads as
 *  nothing and the A (next asking) box is calibrated, the asking is read instead and
 *  stepped back one increment — £10 asking means the bid is £5. Vectis needs none of
 *  this: its box takes in the words "Current Bid:", and a digit inside a line survives. */
ReadBid(name) {
    ; ⚠ Reading the number costs ~200 ms; fingerprinting the box costs under a
    ; millisecond. So the box is fingerprinted FIRST and the number is only read when the
    ; pixels have actually changed. That is what makes the loop quick enough to keep up —
    ; Jordan, 2026-08-24: "the delay between the bid coming through and the display showing
    ; what the current bid is at". Every tick used to pay for two full reads regardless.
    fp := SnapRegion(name)
    if fp != "" && READ_CACHE.Has(name) {
        c := READ_CACHE[name]
        if c.fp = fp
            return { txt: c.txt, amt: c.amt }
    }
    r := BidRegion(name)
    txt := OcrRead(r.x, r.y, r.w, r.h)
    amt := ParseAmount(txt)
    if amt < 0 && name = "saleroom" && CAL[name].Has("reg_ask") {
        ra := BidRegion(name, "reg_ask")
        askTxt := OcrRead(ra.x, ra.y, ra.w, ra.h)
        ask := ParseAmount(askTxt)
        if ask > 0 {
            b := BidBeforeAsking(ask)
            if b >= 0
                amt := b
        }
        txt .= " | asking [" Short(askTxt, 20) "]" (ask > 0 ? " → bid " amt : "")
    }
    READ_CACHE[name] := { fp: fp, txt: txt, amt: amt }
    return { txt: txt, amt: amt }
}
Short(s, n := 40) {
    s := StrReplace(StrReplace(s, "`r", " "), "`n", " ")
    return StrLen(s) > n ? SubStr(s, 1, n) "…" : s
}

/** The money in an OCR string: "Current Bid: E 1,250" → 1250; "1.250" → 1250; nothing → -1.
 *  ⚠ OCR swaps look-alikes on screen fonts — "£10" came back "EIO" (I for 1, O for 0) on the
 *  Vectis screen. Straight after a £ sign (which itself OCRs as £, E or f) the token is taken
 *  as money even if it is letters, and the look-alikes are translated. Elsewhere only real
 *  digits count, so words like ROOM can never become a bid. */
ParseAmount(txt) {
    ; Case-SENSITIVE on purpose: with i) the "s" of "Est:" matched S and read as £5.
    ; The token must also end cleanly (not run into letters), so "Est" / "ES" never count.
    ; "Bid" counts as a marker too — the helper paints that word in front of every number
    ; box, so "Bid IO" must translate the look-alikes exactly as "£IO" would.
    if RegExMatch(txt, "(?:[£Ef]|Bid)\s?([0-9OoIl|SBG][0-9OoIl|SBG.,]*)(?![A-Za-z])", &m) {
        v := MoneyFromToken(m[1])
        if v >= 0
            return v
    }
    if !RegExMatch(txt, "(\d+(?:[.,]\d{3})*)", &m) {
        ; A lone zero comes back as the letter O ("Bid O") — accept it as £0 when the
        ; text holds no other digits at all.
        if RegExMatch(txt, "(?<![A-Za-z])[Oo](?![A-Za-z])")
            return 0
        return -1
    }
    return MoneyFromToken(m[1])
}

/** Any of the comma-separated words present in the text? (Case-insensitive, trimmed.) */
HasWord(txt, csv) {
    for w in StrSplit(csv, ",") {
        w := Trim(w)
        if w != "" && InStr(txt, w)
            return true
    }
    return false
}
/** Does this label/line show OUR OWN press — the mirror — on the named screen? */
IsMirror(txt, nm) {
    return HasWord(txt, nm = "vectis" ? CFG.mirrorV : CFG.mirrorS)
}

/** Whole POUNDS from an OCR money token, or -1.
 *  ⚠⚠ PENCE (2026-08-24). Every separator used to be stripped, so a screen showing
 *  "15.00" read as £1,500 and "1,250.00" as £125,000 — a hundredfold error that would
 *  have driven the other platform to a nonsense figure and hammered at it. The trainers
 *  show whole pounds, which is why it was never seen; the live pages may not.
 *  A trailing group of ONE or TWO digits after a . or , is a decimal → dropped.
 *  A trailing group of THREE is a thousands separator → kept ("1.250" is still 1250).
 *  Pence are truncated, never rounded up: the figure may never overstate the bid. */
MoneyFromToken(tok) {
    tok := RegExReplace(tok, "[Oo]", "0")
    tok := RegExReplace(tok, "[Il|]", "1")
    tok := StrReplace(StrReplace(StrReplace(tok, "S", "5"), "B", "8"), "G", "6")
    tok := RegExReplace(tok, "[.,](\d{1,2})$", "")      ; drop the pence
    tok := RegExReplace(tok, "[.,]", "")                ; thousands separators
    return RegExMatch(tok, "^\d+$") ? Integer(tok) : -1
}

; ══════════════════════════════════════════════════════════════════════════════
; The run — the rule-card timers on one screen
; ══════════════════════════════════════════════════════════════════════════════
ToggleRun() {
    if IsObject(RS)
        StopRun("stopped by you")
    else
        StartRun()
}
StartRun() {
    global RS
    if IsObject(CALST)
        return
    ReadSettingsFromGui()
    both := CFG.mode = "both"
    miss := MissingForRun(both ? "both" : CFG.profile)
    if miss.Length {
        MsgBox "Calibrate first — still needed: " Join(miss, ", "), "Auto Clerk", "Iconi"
        return
    }
    try StartOcr()
    catch as e {
        MsgBox "Could not start the screen reader:`n" e.Message, "Auto Clerk", "Iconx"
        return
    }
    RS := NewRunState(both)
    READ_CACHE.Clear()
    Hotkey "Esc", (*) => StopRun("Esc"), "On"
    WriteLog("── START · " (both ? "BOTH screens in step" : PROFILES[RS.name].title) " · FW after " CFG.fwSecs "s · sell after " CFG.sellSecs "s more · pass no-bid lots: " (CFG.passNoBids ? "yes" : "no"))
    MAIN.Hide()
    BuildStatus()
    SetTimer RunTick, CFG.pollMs
}
NewRunState(both) {
    r := {
        name: CFG.profile, both: both, paused: false, busy: false, blind: false,
        bid: -1, stable: -1, stableN: 0, lastChangeAt: A_TickCount, lotStartAt: A_TickCount,
        fwAt: 0, phase: "open", presses: 0, lots: 0, lastRead: "", startedAt: A_TickCount,
        blindSince: 0, lot: "", lotTick: 0, mismatchN: 0, lotHolds: 0, lotWatchOff: false, watchFp: Map(), wasUnlevel: false, provN: 0, feedNote: false, winner: "",
        ; two-screen state
        price: 0, fwPressed: false, side: Map(),
        priceSide: "", priceAt: 0, tieCheckedPrice: 0,
    }
    for nm in ["saleroom", "vectis"]
        r.side[nm] := { bid: -1, stable: -1, stableN: 0, lastRead: "", high: 0, expect: 0, syncAt: 0, tries: 0, behindSince: 0, warned: false, blindSince: 0, lot: "" }
    return r
}
StopRun(why) {
    global RS
    SetTimer RunTick, 0
    try Hotkey "Esc", "Off"
    if IsObject(RS)
        WriteLog("── STOP (" why ") · " RS.lots " lots closed · " RS.presses " presses")
    RS := 0
    try STATUS.Destroy()
    ToolTip
    StopOcr()
    MAIN.Show()
}
PauseRun() {
    if !IsObject(RS)
        return
    RS.paused := !RS.paused
    WriteLog(RS.paused ? "⏸ paused" : "▶ resumed — reading the screens afresh")
    if !RS.paused {
        RS.blind := false
        try {
            STATUS.BackColor := "052e16"
            S_L1.Text := "AUTO CLERK running — hands off the mouse"
        }
        ResetLotState()      ; never replay what was on screen before the pause
    }
}

/** Stop pressing, go red, wait for a person. The one way the clerk ever downs tools:
 *  it holds everything exactly where it is rather than acting on something it does not
 *  understand. F10 resumes and reads the screens afresh. */
HoldRun(l1, l2, logMsg) {
    global RS
    if !IsObject(RS) || RS.blind
        return
    RS.blind := true
    RS.paused := true
    WriteLog(logMsg)
    try {
        STATUS.BackColor := "7f1d1d"
        S_L1.Text := l1
        S_L2.Text := l2
    }
}

/** The screen (or one of them) has been unreadable for BLIND_PAUSE_MS. */
BlindPause(label) {
    secs := Round(BLIND_PAUSE_MS / 1000)
    HoldRun("⚠ CAN'T READ " StrUpper(label) " SCREEN — paused. Check it, then F10.",
            "Nothing legible for " secs "s. Nothing is being pressed.",
            "⚠ BLIND — could not read " label " screen for " secs "s. PAUSED — nothing will be pressed. Check the screen, then F10 to resume.")
}

BuildStatus() {
    global STATUS, S_L1, S_L2, S_L3
    STATUS := Gui("+AlwaysOnTop -Caption +ToolWindow +E0x20", "AutoClerkStatus")
    STATUS.BackColor := "052e16"
    STATUS.MarginX := 16, STATUS.MarginY := 8
    STATUS.SetFont("s12 Bold cFFFFFF", "Segoe UI")
    S_L1 := STATUS.Add("Text", "w520", "AUTO CLERK running — hands off the mouse")
    STATUS.SetFont("s10 Norm cBBF7D0", "Segoe UI")
    S_L2 := STATUS.Add("Text", "w520", "…")
    STATUS.SetFont("s9 Norm c86EFAC", "Segoe UI")
    S_L3 := STATUS.Add("Text", "w520", "F9 stop · F10 pause · Esc stop")
    STATUS.Show("NoActivate Hide")
    STATUS.GetPos(,, &w, &h)
    STATUS.Move(A_ScreenWidth - w - 16, A_ScreenHeight - h - 70)
    STATUS.Show("NoActivate")
    WinSetTransparent 230, STATUS.Hwnd
}
SetStatus(l1, l2) {
    try {
        S_L1.Text := l1
        S_L2.Text := l2
    }
}

RunTick() {
    global RS
    if !IsObject(RS) || RS.busy
        return
    if RS.paused {
        SetStatus("⏸ PAUSED — F10 to resume", "Current bid £" (RS.bid > 0 ? RS.bid : 0))
        return
    }
    RS.busy := true
    try (RS.both ? TickBoth() : Tick())
    catch as e {
        WriteLog("tick error: " e.Message " (" e.What ") line " e.Line)
    }
    if IsObject(RS)
        RS.busy := false
}

; ══════════════════════════════════════════════════════════════════════════════
; BOTH screens — the Sync Logic Reference card, read off two bid figures.
;
; The auto-clerk cannot see WHO bid (OCR shows amounts only), and it does not need
; to. It watches both figures:
;   · a figure rising above the agreed price   = a genuine bid → clock reset; the
;     other platform gets SYNC_GRACE_MS to follow by itself (an online bid does),
;     then it is driven to the EXACT amount (Saleroom: amount box + Bid;
;     Vectis: Asking box + SET + the Saleroom button) — rules 1 and 2.
;   · a figure falling below its own high      = an undo there → the other side is
;     brought down with its Undo until they match — rule 6.
;   · our own catch-up landing                 = expected, never a clock reset.
;   · rules 4/5: quiet → Fair Warning on both; quiet still → Hammer + Sell, then
;     Next on both, after a pre-sell reconcile so nothing sells at the wrong price.
;   · rule 3 (same-amount tie-break ROOM / !) is NOT automated — the card says so.
; ══════════════════════════════════════════════════════════════════════════════
TickBoth() {
    global RS
    WatchLots(true)                     ; the lot watch comes first — it can reset the lot
    if !IsObject(RS) || RS.paused
        return
    s := ReadSide("saleroom"), v := ReadSide("vectis")
    if !IsObject(RS)                    ; Esc pressed while those reads were in flight
        return
    if s < 0 || v < 0
        return                          ; waiting for a steady reading on both
    now := A_TickCount
    sS := RS.side["saleroom"], sV := RS.side["vectis"]

    ; ── what changed on each side ──────────────────────────────────────────
    for nm, x in RS.side {
        label := nm = "saleroom" ? "Saleroom" : "Vectis"
        if x.bid > x.high {
            x.high := x.bid
            if x.expect && x.bid = x.expect {
                WriteLog("  ✓ " label " caught up to £" x.bid)
                x.expect := 0, x.tries := 0, x.behindSince := 0, x.warned := false
            } else if x.bid > RS.price {
                RS.price := x.bid
                RS.priceSide := nm, RS.priceAt := now
                RS.lastChangeAt := now
                ; ⚠ a genuine rise supersedes any catch-up still in flight — a stale
                ; expect from an outrun catch-up held the closing clock forever with
                ; both screens agreeing at £45 (Jordan's stall, 2026-08-25)
                x.expect := 0, x.tries := 0, x.behindSince := 0
                RS.winner := label          ; a genuine bid on this platform holds the lot
                WriteLog("bid £" x.bid " on " label (RS.phase = "fw" ? " — after Fair Warning; clock reset" : ""))
                if RS.phase = "fw" && RS.fwPressed && PROFILES["saleroom"].fwIsToggle
                    PressOn("saleroom", "btn_fw", "Fair warn — cancelled by a new bid")
                RS.fwPressed := false
                RS.phase := "open"
            } else {
                WriteLog("  " label " followed to £" x.bid " by itself (online bid)")
                x.expect := 0, x.tries := 0, x.behindSince := 0
            }
        } else if x.bid < x.high {
            WriteLog("↩ " label " dropped £" x.high " → £" x.bid " (undo there)")
            x.high := x.bid
            x.expect := 0, x.tries := 0, x.behindSince := 0
            if x.bid < RS.price
                RS.price := x.bid
        }
    }

    ; ── bring a side into step ─────────────────────────────────────────────
    for nm, x in RS.side {
        label := nm = "saleroom" ? "Saleroom" : "Vectis"
        if x.bid < RS.price {
            if x.expect = RS.price && now - x.syncAt < SYNC_RETRY_MS
                continue                                    ; a press is in flight
            if !x.behindSince
                x.behindSince := now                        ; give an online bid its grace
            if now - x.behindSince < SYNC_GRACE_MS
                continue
            if now - RS.lastChangeAt < CATCHUP_SETTLE_MS
                continue                                    ; bids are still landing — let them
            if x.tries >= MAX_SYNC_TRIES {
                if !x.warned {
                    x.warned := true
                    WriteLog("⚠ " label " stuck at £" x.bid " — target £" RS.price " — will keep trying; check the screen")
                }
                if now - x.syncAt < 4000
                    continue                                ; slow down, but never give up
            }
            CatchUp(nm, RS.price)
        } else if x.bid > RS.price {
            if x.expect = RS.price && now - x.syncAt < SYNC_RETRY_MS
                continue
            if x.tries >= MAX_SYNC_TRIES && now - x.syncAt < 4000
                continue
            if now - RS.lastChangeAt < CATCHUP_SETTLE_MS
                continue                                    ; never undo into live bidding either
            PressOn(nm, "btn_undo", "UNDO — bring " label " down from £" x.bid " to £" RS.price)
            x.expect := RS.price, x.syncAt := now, x.tries++
        } else {
            ; a side sitting AT the agreed price has nothing in flight — clear the
            ; bookkeeping, or a stale expect blocks `level` and the clock never runs
            x.behindSince := 0, x.expect := 0, x.tries := 0
        }
    }

    ; ── rule 3: same-amount tie ────────────────────────────────────────────
    if s = v && s > 0 && RS.tieCheckedPrice != RS.price && s = RS.price
        && !sS.expect && !sV.expect && now - RS.priceAt >= TIE_SETTLE_MS
        && CAL["vectis"].Has("reg_vtype") && CAL["saleroom"].Has("reg_sname") {
        RS.tieCheckedPrice := RS.price
        CheckTie(s)
    }

    ; ── the clock ──────────────────────────────────────────────────────────
    ; ⚠ The Fair Warning clock only runs while the screens are LEVEL (Jordan,
    ; 2026-08-25: "the timer should only start after we are all caught up") — a lot
    ; must never tick towards closing while one platform is still being caught up,
    ; and the quiet time starts afresh from the moment they come back into step.
    level := (s = v && s = RS.price && !sS.expect && !sV.expect)
    if !level {
        RS.wasUnlevel := true
    } else if RS.wasUnlevel {
        RS.wasUnlevel := false
        RS.lastChangeAt := now
    }
    quiet := (now - RS.lastChangeAt) / 1000
    fwS := CFG.fwSecs, sellS := CFG.sellSecs
    inStep := (s = v)
    reading := " · S[" Short(sS.lastRead, 16) "] V[" Short(sV.lastRead, 16) "]"
    head := "Saleroom £" s " · Vectis £" v (RS.winner != "" && RS.price > 0 ? " · " RS.winner " bidder winning" : "") (inStep ? "" : " — catching up")
    if RS.price > 0 {
        if !level {
            SetStatus(head " · catching up", "The closing clock is held until both screens agree" reading)
            return
        }
        if RS.phase = "open" {
            SetStatus(head " · quiet " Round(quiet) "s", "Fair Warning on both in " Max(0, Round(fwS - quiet)) "s" reading)
            if quiet >= fwS {
                ; ── provenance before Fair Warning: is anyone REAL at this price? ──
                res := Provenance(RS.price)
                if !IsObject(RS)
                    return
                if res.verdict = "mirror-only" {
                    RS.provN++
                    if RS.provN = 1
                        WriteLog("  · no real bidder found at £" RS.price " on either feed — checking once more before acting")
                    if RS.provN >= 2 && res.proven > 0
                        UnwindPhantom(res)
                    return
                }
                RS.provN := 0
                PressOn("vectis", "btn_fw", "Fair Warning — " Round(quiet) "s without a new bid")
                PressOn("saleroom", "btn_fw", "Fair warn — " Round(quiet) "s without a new bid")
                RS.fwPressed := true
                RS.phase := "fw", RS.fwAt := now
            }
        } else if RS.phase = "fw" {
            sinceFw := (now - RS.fwAt) / 1000
            SetStatus(head " · FAIR WARNING given", "Selling on both in " Max(0, Round(sellS - sinceFw)) "s unless a bid comes" reading)
            if sinceFw >= sellS
                CloseLotBoth("sold")
        }
    } else {
        if CFG.passNoBids {
            SetStatus("No bids on either screen · quiet " Round(quiet) "s", "Pass on both in " Max(0, Round(fwS + sellS - quiet)) "s unless a bid comes" reading)
            if quiet >= fwS + sellS
                CloseLotBoth("passed")
        } else {
            SetStatus("No bids on either screen · quiet " Round(quiet) "s", "Waiting — lots are not passed automatically" reading)
        }
    }
}

/** The lot number a screen is showing, as a comparable token ("Lot: 513" → "513",
 *  "514A" → "514A"), or "" when nothing legible. Read through the composed path so a
 *  single-digit lot number is readable too, hence the "Bid" prefix to strip. */
LotToken(nm) {
    if !CAL[nm].Has("reg_lot")
        return ""
    r := BidRegion(nm, "reg_lot")
    txt := OcrRead(r.x, r.y, r.w, r.h)
    txt := RegExReplace(txt, "i)\bBid\b", " ")
    if !RegExMatch(txt, "(\d+[A-Za-z]?)", &m)
        return ""
    return StrUpper(m[1])
}

/** ⚠⚠ PROVENANCE — does the standing price trace to a REAL bidder? (Jordan, 2026-08-25.)
 *  Every other guard compares the two screens with each other, and the phantom £80
 *  passed them all because the screens AGREED. This one asks a different question: on
 *  either platform's bid feed, is there a genuine row — not our own mirror press — at
 *  the standing price? A price that exists only on "Saleroom"/"ROOM" rows on BOTH sides
 *  was manufactured by definition, whatever minted it. Needs BOTH reg_feed boxes (a
 *  genuine bid legitimately lives on only one platform); best-effort — an unreadable
 *  feed SKIPS the check and says so, it never blocks the sale on its own failure. */
FeedText(nm) {
    r := BidRegion(nm, "reg_feed")
    return OcrRead(r.x, r.y, r.w, r.h, "lines")
}

/** The best genuine (non-mirror) amount on one feed line, or 0. Our own presses read
 *  "Saleroom" on the Vectis feed and "ROOM" on the Saleroom feed. Name tokens like
 *  SR2418804 cannot leak an amount — a number is only taken standing alone. */
GenuineLineAmount(line, nm) {
    if IsMirror(line, nm)
        return 0
    best := 0, pos := 1
    while pos := RegExMatch(line, "(?<![\dA-Za-z.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?(?![\dA-Za-z])", &m, pos) {
        v := MoneyFromToken(m[1])
        if v > best
            best := v
        pos += StrLen(m[0])
    }
    return best
}

/** verdict: "genuine" (a real bid stands at the price) · "mirror-only" (nobody real bid
 *  it — proven carries the best REAL level to fall back to) · "unreadable" · "skipped". */
Provenance(price) {
    global RS
    if !(CAL["saleroom"].Has("reg_feed") && CAL["vectis"].Has("reg_feed")) {
        if !RS.feedNote {
            RS.feedNote := true
            WriteLog("  · provenance check off — the two bid-feed boxes are not calibrated")
        }
        return { verdict: "skipped", proven: price }
    }
    fs := FeedText("saleroom")
    if !IsObject(RS)
        return { verdict: "unreadable", proven: price }
    fv := FeedText("vectis")
    if !IsObject(RS) || Trim(fs) = "" || Trim(fv) = ""
        return { verdict: "unreadable", proven: price }
    best := 0
    for nm, txt in Map("saleroom", fs, "vectis", fv) {
        for line in StrSplit(txt, "`n") {
            amt := GenuineLineAmount(line, nm)
            if amt = price
                return { verdict: "genuine", proven: price }
            if amt > best && amt < price
                best := amt
        }
    }
    return { verdict: "mirror-only", proven: best }
}

/** The standing price failed provenance twice — fall back to the best level a real
 *  bidder actually holds. The sync loop then undoes both sides down to it. */
UnwindPhantom(res) {
    global RS
    WriteLog("⚠ NO REAL BIDDER at £" RS.price " — both feeds show only our own mirror rows there. "
        . "Unwinding to £" res.proven ", the best figure a real bidder holds; bidding continues.")
    RS.price := res.proven
    RS.lastChangeAt := A_TickCount
    RS.provN := 0
    RS.tieCheckedPrice := 0
}

/** ⚠ THE LOT WATCH (2026-08-24). Without it, a lot moving on by itself — the auctioneer
 *  skipping one, someone pressing Next by hand, the platform advancing — looks exactly
 *  like an undo: the figure falls to zero and the clerk "corrects" the OTHER, perfectly
 *  healthy screen down with it. Worse, two screens sitting on DIFFERENT lots would have
 *  bids synced between them. So: a lot change that we did not cause starts the lot afresh,
 *  and a lasting disagreement holds the run. Optional — nothing changes until the
 *  lot-number boxes are calibrated. */
WatchLots(both) {
    global RS
    if RS.lotWatchOff || !CFG.lotWatch
        return
    RS.lotTick++
    if Mod(RS.lotTick, LOT_EVERY_N) != 0
        return
    if both {
        ls := LotToken("saleroom"), lv := LotToken("vectis")
        if !IsObject(RS)
            return
        moved := ""
        for nm, tok in Map("saleroom", ls, "vectis", lv) {
            x := RS.side[nm]
            if tok = "" || tok = x.lot
                continue
            ; x.lot = "" means "not adopted yet" (a fresh lot, or straight after our own
            ; Next) — take it quietly. Anything else is the lot moving without us.
            if x.lot != ""
                moved .= (moved ? " and " : "") (nm = "saleroom" ? "Saleroom" : "Vectis") " " x.lot " → " tok
            x.lot := tok
        }
        if moved != "" {
            WriteLog("↪ the lot moved on without us (" moved ") — starting this lot afresh, nothing corrected")
            keepS := RS.side["saleroom"].lot, keepV := RS.side["vectis"].lot
            ResetLotState()
            RS.side["saleroom"].lot := keepS, RS.side["vectis"].lot := keepV
            return
        }
        if ls != "" && lv != "" && ls != lv {
            RS.mismatchN++
            if RS.mismatchN >= LOT_MISMATCH_HOLD {
                RS.mismatchN := 0
                RS.lotHolds++
                ; ⚠ ONE loud warning, never a trap. Holding again the moment you resume
                ; makes the clerk useless, and the commonest cause of a "mismatch" is not
                ; two platforms out of step at all — it is a lot box picking up the wrong
                ; text (Jordan, 2026-08-24: boxes reading "109035" and "1"). So the second
                ; time, the lot check switches itself off and says so, and the run carries
                ; on with everything else intact.
                if RS.lotHolds >= 2 {
                    RS.lotWatchOff := true
                    WriteLog("⚠ LOT CHECK TURNED OFF for this run — it has held twice on Saleroom " ls " vs Vectis " lv ". "
                        . "Those rarely look like lot numbers, so the boxes are probably picking up the wrong text: "
                        . "stop, press 🔍 Test read on each screen and re-draw the LOT NUMBER box. "
                        . "Everything else carries on as normal.")
                    SetStatus("⚠ Lot check off — the two lot boxes disagree (" ls " vs " lv "). Everything else is running.",
                              "Re-draw the LOT NUMBER boxes when you get a moment — Test read shows what they see.")
                } else {
                    HoldRun("⚠ THE LOT BOXES DISAGREE — Saleroom " ls " · Vectis " lv,
                            "Either the screens really are on different lots, or a lot box is reading the wrong thing. F10 carries on regardless.",
                            "⚠ LOT BOXES DISAGREE — Saleroom " ls " · Vectis " lv ". HELD. Either the screens are on different lots, "
                            . "or a lot box is picking up the wrong text (check with Test read). F10 to carry on — if it happens again "
                            . "the lot check switches itself off rather than holding the run.")
                }
            }
        } else {
            RS.mismatchN := 0
        }
        return
    }
    tok := LotToken(RS.name)
    if !IsObject(RS) || tok = ""
        return
    if RS.lot != "" && tok != RS.lot {
        WriteLog("↪ the lot moved on without us (" RS.lot " → " tok ") — starting this lot afresh")
        ResetLotState()
    }
    RS.lot := tok
}

/** Rule 3. Both figures are equal — but are they the SAME bid? Read the top-row labels:
 *  Vectis's top bid from the Saleroom source, or Saleroom's top bid marked ROOM, means one
 *  platform is mirroring the other — in step, nothing to do. Anything else means two
 *  different bidders at one price, and only one can win: whoever bid first keeps it.
 *    Vectis first (or a dead heat)  → ROOM on Saleroom   (drops the Saleroom bidder, keeps the price)
 *    Saleroom first                 → ! beside Saleroom on Vectis (drops the Vectis bidder, keeps the price) */
CheckTie(price) {
    global RS
    ; ⚠ AHK names are case-INSENSITIVE: a local "rs" here IS the global RS — it was
    ; overwritten with a rectangle ("Object has no property lastChangeAt").
    regV := BidRegion("vectis", "reg_vtype")
    regS := BidRegion("saleroom", "reg_sname")
    vt := OcrRead(regV.x, regV.y, regV.w, regV.h, "txt")
    sn := OcrRead(regS.x, regS.y, regS.w, regS.h, "txt")
    vectisHoldsSaleroom := IsMirror(vt, "vectis")
    saleroomHoldsRoom   := IsMirror(sn, "saleroom") && !HasWord(sn, CFG.genuineS)
    WriteLog("tie check at £" price ": Vectis top bid [" Short(vt, 24) "] · Saleroom top bid [" Short(sn, 24) "]"
        . (vectisHoldsSaleroom || saleroomHoldsRoom ? " → same bid on both, in step" : " → TWO bidders at one price"))
    if vectisHoldsSaleroom || saleroomHoldsRoom
        return
    if RS.priceSide = "saleroom" {
        PressOn("vectis", "btn_bang", "TIE at £" price " — Saleroom bid first → ! beside Saleroom on Vectis (Vectis bidder dropped, price kept)")
        RS.winner := "Saleroom"
    } else {
        PressOn("saleroom", "btn_room", "TIE at £" price " — " (RS.priceSide = "vectis" ? "Vectis bid first" : "dead heat, favour Vectis") " → ROOM on Saleroom (Saleroom bidder dropped, price kept)")
        RS.winner := "Vectis"
    }
}

/** One side's steady bid figure, or -1 until two polls agree. Logs what the screen says. */
ReadSide(nm) {
    if !IsObject(RS)
        return -1
    x := RS.side[nm]
    rb := ReadBid(nm)
    if !IsObject(RS)
        return -1
    txt := rb.txt, amt := rb.amt
    if txt != x.lastRead {
        WriteLog("read " nm ": [" Short(txt, 60) "] → " (amt < 0 ? "nothing" : "£" amt))
        x.lastRead := txt
    }
    ; ⚠ Blindness is never bids disappearing: an illegible read NEVER changes a figure it
    ; is holding. It keeps the last one and starts the blind clock; at BLIND_PAUSE_MS the
    ; clerk stops pressing and goes red rather than acting on what it cannot see.
    ; ⚠⚠ BUT only when there is a bid to protect. A fresh lot shows an EMPTY box — the
    ; composed read comes back as just "Bid" — and treating that as blindness paused the
    ; run ten seconds after every lot change (Jordan, 2026-08-24: "randomly paused after
    ; moving to the next lot"). Nothing showing and nothing to lose simply means no bid yet.
    if amt < 0 {
        if x.bid > 0 {
            if !x.blindSince
                x.blindSince := A_TickCount
            else if A_TickCount - x.blindSince >= BLIND_PAUSE_MS
                BlindPause(nm = "saleroom" ? "Saleroom" : "Vectis")
            return x.bid
        }
        amt := 0
    }
    x.blindSince := 0
    if amt = x.stable
        x.stableN++
    else
        x.stable := amt, x.stableN := 1
    ; Rises count after RISE_CONFIRM polls, DROPS only after DROP_CONFIRM — and a jump that
    ; no auction makes in one step (10 → 71,402) is treated like a drop until it persists.
    need := RISE_CONFIRM
    if x.bid >= 0 && amt < x.bid
        need := DROP_CONFIRM
    else if x.bid > 0 && amt > x.bid * 3 + 1000
        need := DROP_CONFIRM
    if x.stableN < need
        return x.bid >= 0 ? x.bid : -1
    x.bid := amt
    return amt
}

/** THE LAST LOOK. The highest figure anything shows right now — RAW readings, twice, a
 *  moment apart, so a bid landing during the look itself is still caught.
 *  ⚠⚠ It must NEVER use the confirmed reader (`ReadSide`). That one waits for two agreeing
 *  polls before it will report a new figure, so a bid that has only just landed is
 *  invisible to it — which is precisely how a last-second bid was still being hammered
 *  through at the old price (Jordan, 2026-08-24: "Im still able to snipe bids... the
 *  hotkey isnt picking it up"). A false abort costs one Fair Warning cycle; a wrongful
 *  hammer cannot be undone, so raw-and-jumpy is the right trade here. */
LastLook(names) {
    top := -1
    loop 2 {
        for nm in names {
            a := ReadBid(nm).amt
            if !IsObject(RS)
                return -1
            if a > top
                top := a
        }
        if A_Index = 1
            Sleep 120
    }
    return top
}

/** A cheap fingerprint of a bid box — a grid of pixels, about a millisecond to take.
 *  Reading the number costs 200 ms; noticing that the number CHANGED costs almost
 *  nothing, which is what lets the final watch be continuous instead of a snapshot. */
SnapRegion(nm) {
    if IsObject(SIM)                     ; the model's figure IS its pixels
        return nm = "vectis" ? "V" SIM.v : "S" SIM.s
    r := BidRegion(nm)
    return BoxHash(r.x, r.y, r.w, r.h)
}

/** A fingerprint of a whole screen box — ONE copy of the box, then a spread of samples
 *  from the copy.
 *  ⚠⚠ MEASURED on Jordan's PC 2026-08-24: `PixelGetColor` costs **15.6 ms A CALL** — so
 *  the first version of this, an 18-point grid, took ~280 ms per box and ~560 ms for the
 *  pair. The "continuous" watch was therefore slower than reading the number and sampled
 *  almost nothing, which is why snipes still got through. One BitBlt of the entire box
 *  costs the SAME 15 ms and sees every pixel, so this is ~35× the coverage for nothing.
 *  Never go back to per-pixel calls in a loop. */
BoxHash(x, y, w, h) {
    static hdcScreen := DllCall("GetDC", "ptr", 0, "ptr")
    if w < 1 || h < 1
        return ""
    hdcMem := DllCall("CreateCompatibleDC", "ptr", hdcScreen, "ptr")
    hbm := DllCall("CreateCompatibleBitmap", "ptr", hdcScreen, "int", w, "int", h, "ptr")
    old := DllCall("SelectObject", "ptr", hdcMem, "ptr", hbm, "ptr")
    DllCall("BitBlt", "ptr", hdcMem, "int", 0, "int", 0, "int", w, "int", h,
            "ptr", hdcScreen, "int", x, "int", y, "uint", 0x00CC0020)   ; SRCCOPY
    bi := Buffer(40, 0)
    NumPut("uint", 40, bi, 0), NumPut("int", w, bi, 4), NumPut("int", -h, bi, 8)
    NumPut("ushort", 1, bi, 12), NumPut("ushort", 32, bi, 14)
    px := Buffer(w * h * 4, 0)
    DllCall("GetDIBits", "ptr", hdcMem, "ptr", hbm, "uint", 0, "uint", h, "ptr", px, "ptr", bi, "uint", 0)
    total := w * h
    step := Max(1, total // 600)         ; ~600 samples spread over the box
    a := 0, b := 0, i := 0
    while i < total {
        v := NumGet(px, i * 4, "uint") & 0xFFFFFF
        a := (a + v) & 0xFFFFFFF
        b := (b + a) & 0xFFFFFFF
        i += step
    }
    DllCall("SelectObject", "ptr", hdcMem, "ptr", old)
    DllCall("DeleteObject", "ptr", hbm)
    DllCall("DeleteDC", "ptr", hdcMem)
    return a "-" b
}

/** THE FINAL WATCH — the last thing before a hammer.
 *  ⚠⚠ The last look alone was not enough (Jordan, twice: "still able to snipe bids").
 *  Reading the figures takes ~200 ms per screen, so a bid landing after the final read —
 *  or rendering a moment after it was accepted — was pressed straight through. So after
 *  the last look, the bid boxes are WATCHED pixel-by-pixel for FINAL_WATCH_MS: any change
 *  triggers a real read, and a higher figure aborts. Nothing is pressed until the boxes
 *  have sat still, so the exposed window shrinks from ~200 ms to the press itself.
 *  Returns the aborting figure, or -1 when it is safe to press. */
FinalWatch(names, floor) {
    fp := RS.watchFp
    fp.Clear()
    for nm in names
        fp[nm] := SnapRegion(nm)
    looks := 0
    started := A_TickCount
    t0 := A_TickCount
    while A_TickCount - t0 < FINAL_WATCH_MS {
        looks++
        for nm in names {
            now := SnapRegion(nm)
            if now = fp[nm]
                continue
            fp[nm] := now
            peak := LastLook(names)          ; something moved — read what it really says
            if !IsObject(RS)
                return -1
            WriteLog("  · the " (nm = "saleroom" ? "Saleroom" : "Vectis") " figure moved during the final watch — reads £" peak)
            if peak > floor
                return peak
            t0 := A_TickCount                ; it must sit still again before we press
            for n2 in names
                fp[n2] := SnapRegion(n2)
        }
        Sleep 12
    }
    WriteLog("  · final watch: the figures sat still for " (A_TickCount - started) " ms (" looks " looks at them)")
    return -1
}

/** Has a bid box moved since the final watch settled? A fingerprint costs under a
 *  millisecond, so this is affordable in the instant before the press itself. */
FpMoved(names) {
    if !IsObject(RS)
        return false
    for nm in names
        if RS.watchFp.Has(nm) && SnapRegion(nm) != RS.watchFp[nm]
            return true
    return false
}

/** The very last instant before pressing: if anything moved, read it properly.
 *  Returns the aborting figure, or -1 when it is still safe. */
InstantCheck(names, floor) {
    if !FpMoved(names)
        return -1
    peak := LastLook(names)
    if !IsObject(RS)
        return -1
    return peak > floor ? peak : -1
}

/** THE SOLD CHECK (Jordan's own design, 2026-08-25, from photographing the real platforms).
 *  Every guard before the hammer still leaves the instant of the press itself — a bid the
 *  platform accepted but had not yet painted is unseeable. The platforms' answer: a sale
 *  stays REVERSIBLE until Next (Saleroom has a sale Undo next to Sell/Pass; Vectis grows a
 *  Re-Open Lot button after the hammer). So after hammering, the screens are watched for
 *  SOLD_CHECK_MS before Next: a figure ABOVE the hammer price, read TWICE in a row (one
 *  misread must never reverse a real sale), means a snipe arrived with the hammer.
 *  Returns the sniped figure, or -1 when the sale stands. */
SoldCheck(names, price) {
    hits := 0
    t0 := A_TickCount
    while A_TickCount - t0 < SOLD_CHECK_MS {
        top := -1
        for nm in names {
            a := ReadBid(nm).amt
            if !IsObject(RS)
                return -1
            if a > top
                top := a
        }
        if top > price {
            hits++
            if hits >= 2
                return top
        } else {
            hits := 0
        }
        Sleep 120
    }
    return -1
}

/** Reverse a just-hammered sale on the named screens. True = reversed, bidding continues;
 *  false = a recovery button is missing, so the run is HELD with instructions instead —
 *  never press Next over a sale that should not stand. */
ReverseSale(names, price, peak) {
    global RS
    for nm in names {
        key := nm = "saleroom" ? "btn_sale_undo" : "btn_reopen"
        if !CAL[nm].Has(key) {
            HoldRun("⚠ A BID ARRIVED WITH THE HAMMER — £" peak " against £" price " sold",
                    "Reverse it BY HAND (Vectis: Re-Open Lot · Saleroom: the Undo next to Sell), then F10. Calibrate the recovery buttons to make this automatic.",
                    "⚠ SNIPE ARRIVED WITH THE HAMMER (£" peak " vs £" price " sold) but the " nm " recovery button is not calibrated. "
                    . "HELD — reverse the sale by hand (Vectis: Re-Open Lot · Saleroom: the Undo next to Sell/Pass), then F10. "
                    . "Set the recovery buttons with 'Set just one' to make this automatic.")
            return false
        }
    }
    for nm in names
        PressOn(nm, nm = "saleroom" ? "btn_sale_undo" : "btn_reopen",
                nm = "saleroom" ? "UNDO THE SALE — snipe at £" peak : "RE-OPEN LOT — snipe at £" peak)
    if !IsObject(RS)
        return true
    WriteLog("⏪ SALE REVERSED — £" peak " arrived with the hammer (sold £" price "). The lot is open again and bidding continues.")
    RS.lastChangeAt := A_TickCount
    return true
}

/** Drive one platform to the exact amount — the rule-card way for each screen. */
CatchUp(nm, target) {
    x := RS.side[nm]
    label := nm = "saleroom" ? "Saleroom" : "Vectis"
    ; ⚠⚠ NEVER press onto a platform that is already there (Jordan, 2026-08-25:
    ; "what if it tries to set the bid at 10 right as someone had just bid 15?" —
    ; seen live at 14:21: three catch-ups to a stale £50 pressed into live bidding
    ; at 55–70, each one making a phantom and an undo). Raw-check the instant
    ; before EVERY press; the moment the platform has reached or passed the
    ; target by itself, there is nothing to catch up — walk away, press nothing.
    if CaughtItself(nm, target, label, "before starting")
        return
    if nm = "saleroom" {
        ; Type the exact figure in the box next to A, then Bid — lands on that amount.
        PressOn("saleroom", "box_amount", "amount box → " target)
        TypeAmount(target)
        if CaughtItself(nm, target, label, "before the Bid press")
            return
        if CFG.srExact = "bid" {
            PressOn("saleroom", "btn_bid", "BID at £" target " (catching Saleroom up)")
        } else if IsObject(SIM) {
            SimPress("saleroom", "btn_bid")          ; the model treats Enter and Bid alike
        } else {
            WriteLog("PRESS saleroom.ENTER — bid £" target " (catching Saleroom up)")
            Send "{Enter}"
            Sleep 120
            RS.presses++
        }
    } else {
        ; Set the asking to the exact figure, then the Saleroom button bids that asking.
        PressOn("vectis", "box_asking", "asking box → " target)
        TypeAmount(target)
        PressOn("vectis", "btn_askset", "SET asking £" target)
        Sleep 160
        ; ⚠ the race lives HERE: a genuine bid between SET and the Saleroom press
        ; re-opens the ladder, and the press would fire at the NEW asking.
        if CaughtItself(nm, target, label, "after SET, before the Saleroom press")
            return
        PressOn("vectis", "btn_saleroom", "SALEROOM button at £" target " (catching Vectis up)")
    }
    x.expect := target, x.syncAt := A_TickCount, x.tries++
    VerifyCatchUp(nm, target)
}

/** True when the platform has already reached or passed the target on its own — the
 *  catch-up is abandoned mid-sequence and the normal loop takes the new figure in. */
CaughtItself(nm, target, label, where) {
    global RS
    if !IsObject(RS)
        return true
    raw := ReadBid(nm).amt
    if !IsObject(RS)
        return true
    if raw < target
        return false
    x := RS.side[nm]
    WriteLog("  · " label " reads £" raw " " where " — it got there by itself, catch-up to £" target " abandoned, nothing pressed")
    x.expect := 0, x.behindSince := 0
    return true
}

/** ⚠⚠ THE PHANTOM KILLER (Jordan's lot 510, 2026-08-25). Between our SET and our press
 *  a genuine bid can land and re-open the platform's automatic ladder — so our press
 *  fires at the NEW asking, minting a bid nobody made, which the other side then
 *  faithfully mirrors: both screens agreed at £80 when the last real bid was £70, and
 *  every guard passed because they agreed. So every catch-up is verified: if it landed
 *  ABOVE its target, the top-row label says whose bid that is — our own press reads
 *  "Saleroom" on Vectis / "ROOM" on the Saleroom — and our own phantom is undone on the
 *  spot, before the other side can mirror it. A genuine bid that outran us is kept. */
VerifyCatchUp(nm, target) {
    global RS
    if !IsObject(RS)
        return
    Sleep 300                                   ; let the press paint
    landed := ReadBid(nm).amt
    if !IsObject(RS) || landed <= target
        return
    label := nm = "saleroom" ? "Saleroom" : "Vectis"
    key := nm = "vectis" ? "reg_vtype" : "reg_sname"
    ours := true                                ; unreadable → assume ours: a phantom hammer
    lbl := ""                                   ; cannot be undone, a re-bid can
    if CAL[nm].Has(key) {
        r := BidRegion(nm, key)
        lbl := OcrRead(r.x, r.y, r.w, r.h, "txt")
        if !IsObject(RS)
            return
        if Trim(lbl) != ""
            ours := IsMirror(lbl, nm)
    }
    if !ours {
        WriteLog("  · catch-up on " label " was outrun by a real bid — it shows £" landed " [" Short(lbl, 16) "], keeping it")
        return
    }
    x := RS.side[nm]
    WriteLog("⚠ OUR catch-up landed at £" landed " instead of £" target " — the asking moved under the press. Undoing our own phantom before it spreads.")
    PressOn(nm, "btn_undo", "UNDO — remove our phantom £" landed " on " label)
    x.expect := 0, x.syncAt := A_TickCount
    x.behindSince := 0                  ; a fresh grace + settle before any retry — an
    x.tries := 0                        ; instant retry at a stale target was the undo storm
}

/** Sell (or Pass) on BOTH screens and move both on — reconciling first so nothing
 *  sells at the wrong price, then checking both figures really went back to 0. */
CloseLotBoth(how) {
    global RS
    s := RS.side["saleroom"], v := RS.side["vectis"]
    price := RS.price
    if how = "sold" && price > 0 {
        ; Pre-sell reconcile: never hammer one side at a different figure.
        Loop 2 {
            if s.bid < price
                CatchUp("saleroom", price)
            if v.bid < price
                CatchUp("vectis", price)
            if s.bid < price || v.bid < price {
                Sleep 900
                ReadSide("saleroom"), ReadSide("vectis")
                ReadSide("saleroom"), ReadSide("vectis")
            }
            if s.bid >= price && v.bid >= price
                break
        }
        if s.bid != price || v.bid != price
            WriteLog("⚠ selling with the screens NOT level: Saleroom £" s.bid " · Vectis £" v.bid " · agreed £" price)
        ; ── THE LAST LOOK (sniping, Jordan 2026-08-24) ────────────────────────
        ; One final fresh read of both screens in the instant before the hammer.
        ; A bid that landed while we were deciding aborts the sale — the clock
        ; resets and the Fair Warning cycle starts over, exactly as a human clerk
        ; pulls back when a hand goes up at the last moment.
        peak := LastLook(["saleroom", "vectis"])
        if !IsObject(RS)
            return
        WriteLog("  · last look before selling: highest anything shows is £" peak " (agreed £" price ")")
        if peak <= price
            peak := FinalWatch(["saleroom", "vectis"], price)   ; then watch until they sit still
        if !IsObject(RS)
            return
        if peak <= price
            peak := InstantCheck(["saleroom", "vectis"], price)   ; the final instant
        if !IsObject(RS)
            return
        if peak <= price {
            res := Provenance(price)
            if !IsObject(RS)
                return
            if res.verdict = "mirror-only" && res.proven > 0 {
                UnwindPhantom(res)
                return
            }
        }
        if peak > price {
            WriteLog("🛑 LAST-SECOND BID £" peak " — sale stopped, bidding continues")
            RS.lastChangeAt := A_TickCount
            return
        }
        PressOn("vectis", "btn_hammer", "HAMMER at £" price)
        PressOn("saleroom", "btn_sell", "SELL at £" price)
        ; ── THE SOLD CHECK — the sale is reversible until Next is pressed ─────
        after := SoldCheck(["saleroom", "vectis"], price)
        if !IsObject(RS)
            return
        if after > price {
            ReverseSale(["saleroom", "vectis"], price, after)
            return                      ; no Next either way — the lot is live again, or held
        }
    } else {
        ; The last look before a PASS: any bid at all means the lot is no longer bidless.
        peak := LastLook(["saleroom", "vectis"])
        if !IsObject(RS)
            return
        if peak <= 0
            peak := FinalWatch(["saleroom", "vectis"], 0)
        if !IsObject(RS)
            return
        if peak <= 0
            peak := InstantCheck(["saleroom", "vectis"], 0)
        if !IsObject(RS)
            return
        if peak > 0 {
            WriteLog("🛑 LAST-SECOND BID £" peak " — not passing, bidding continues")
            RS.lastChangeAt := A_TickCount
            return
        }
        PressOn("vectis", "btn_pass", "PASS LOT — no bids")
        PressOn("saleroom", "btn_pass", "PASS — no bids")
    }
    Sleep 700
    prevLot := Map()
    for nm in ["saleroom", "vectis"]
        prevLot[nm] := CFG.lotWatch ? LotToken(nm) : ""
    if !IsObject(RS)
        return
    PressOn("vectis", "btn_hammer", "NEXT LOT")
    PressOn("saleroom", "btn_next", "NEXT lot")

    ; ⚠⚠ Verify both moved on — but a fresh lot NO LONGER always reads £0: a lot can
    ; OPEN with a starting bid already on the book. So moved = the figure left the sold
    ; price (or reads 0), or the lot number changed. And a retry press must NEVER be
    ; blind: on Vectis the Next button IS the Hammer, and pressing it onto a new lot
    ; that opened with a bid sells that lot on the spot (Jordan, 2026-08-25: "not
    ; moving on to the next lot properly on vectis"). Retry only when the lot box
    ; CONFIRMS the old lot is still up.
    for nm, x in RS.side {
        Loop 2 {
            moved := false, stale := false
            t0 := A_TickCount
            while A_TickCount - t0 < 3000 {
                Sleep 150
                a := ReadBid(nm).amt
                if !IsObject(RS)
                    return
                if a <= 0 || (how = "sold" && a != price) {
                    moved := true
                    break
                }
                if prevLot[nm] != "" {
                    tok := LotToken(nm)
                    if !IsObject(RS)
                        return
                    if tok != "" && tok != prevLot[nm] {
                        moved := true
                        break
                    }
                    stale := tok != "" && tok = prevLot[nm]
                }
            }
            if moved
                break
            if A_Index = 1 && stale {
                WriteLog("⚠ " nm " still shows lot " prevLot[nm] " after Next — pressing Next once more")
                PressOn(nm, nm = "saleroom" ? "btn_next" : "btn_hammer", "NEXT (retry)")
            } else if A_Index = 1 {
                WriteLog("⚠ cannot confirm " nm " moved on (the new lot may have opened with a bid at the same figure) — NOT pressing Next again blind; carrying on from what the screen shows")
                break
            } else {
                WriteLog("⚠ could not confirm " nm " moved to a new lot — carrying on from what the screen shows now")
            }
        }
    }
    RS.lots++
    WriteLog((how = "sold" ? "🔨 sold at £" price : "passed") " on both · lot " RS.lots " done · next lot open")
    ResetLotState()
}

/** Forget the lot just closed and read the screens afresh. */
ResetLotState() {
    global RS
    if !IsObject(RS)
        return
    for nm, x in RS.side {
        x.bid := -1, x.stable := -1, x.stableN := 0, x.high := 0, x.blindSince := 0
        x.expect := 0, x.tries := 0, x.behindSince := 0, x.warned := false
        x.lot := ""                     ; re-adopt whatever the screen shows, silently
    }
    RS.bid := -1, RS.stable := -1, RS.stableN := 0, RS.blindSince := 0
    RS.lot := "", RS.mismatchN := 0
    RS.winner := ""
    RS.price := 0, RS.phase := "open", RS.fwPressed := false
    RS.priceSide := "", RS.priceAt := 0, RS.tieCheckedPrice := 0
    RS.lastChangeAt := A_TickCount, RS.fwAt := 0
}

Tick() {
    global RS
    WatchLots(false)
    if !IsObject(RS) || RS.paused
        return
    rb := ReadBid(RS.name)
    if !IsObject(RS)                    ; Esc pressed while the read was in flight
        return
    txt := rb.txt, amt := rb.amt
    if txt != RS.lastRead {
        ; Every change in what the screen says goes in the log — that is how a mis-drawn
        ; box shows itself ("read: [] → nothing" over and over).
        WriteLog("read: [" Short(txt, 60) "] → " (amt < 0 ? "nothing" : "£" amt))
        RS.lastRead := txt
    }
    ; Blindness only counts when there is a figure to protect — see ReadSide.
    if amt < 0 {
        if RS.bid > 0 {
            if !RS.blindSince
                RS.blindSince := A_TickCount
            else if A_TickCount - RS.blindSince >= BLIND_PAUSE_MS
                BlindPause("the")
            return
        }
        amt := 0
    }
    RS.blindSince := 0

    ; Debounce — a reading must hold before it counts (rises quickly, drops slowly). A
    ; screen mid-repaint can read wrong for a moment, and one bad read must never reset
    ; the clock or pass a lot.
    if amt = RS.stable
        RS.stableN++
    else
        RS.stable := amt, RS.stableN := 1
    need := (RS.bid >= 0 && amt < RS.bid) || (RS.bid > 0 && amt > RS.bid * 3 + 1000) ? DROP_CONFIRM : RISE_CONFIRM
    if RS.stableN < need
        return
    if amt != RS.bid {
        if RS.bid >= 0 && amt < RS.bid && amt > 0
            WriteLog("↩ bid DROPPED £" RS.bid " → £" amt " (undo on the screen) — noted, nothing to do on one screen")
        else if amt > 0
            WriteLog("bid £" amt (RS.phase = "fw" ? " — after Fair Warning; clock reset" : ""))
        if amt > 0 && RS.phase = "fw" && PROFILES[RS.name].fwIsToggle {
            ; Saleroom's Fair warn is a toggle: a new bid means un-press it, or the next
            ; press (after the next quiet spell) would turn it OFF instead of on.
            Press("btn_fw", "Fair warn — cancelled by a new bid")
        }
        RS.bid := amt
        RS.lastChangeAt := A_TickCount
        if amt > 0
            RS.phase := "open"
    }

    quiet := (A_TickCount - RS.lastChangeAt) / 1000
    fwS := CFG.fwSecs, sellS := CFG.sellSecs

    reading := " · reads [" Short(RS.lastRead, 24) "]"
    if RS.bid > 0 {
        if RS.phase = "open" {
            SetStatus("Bid £" RS.bid " · quiet " Round(quiet) "s", "Fair Warning in " Max(0, Round(fwS - quiet)) "s" reading)
            if quiet >= fwS {
                Press("btn_fw", "Fair Warning — " Round(quiet) "s without a new bid")
                RS.phase := "fw", RS.fwAt := A_TickCount
            }
        } else if RS.phase = "fw" {
            sinceFw := (A_TickCount - RS.fwAt) / 1000
            SetStatus("Bid £" RS.bid " · FAIR WARNING given", "Selling in " Max(0, Round(sellS - sinceFw)) "s unless a bid comes")
            if sinceFw >= sellS
                CloseLot("sold")
        }
    } else {
        ; No bid showing on this lot.
        if CFG.passNoBids {
            SetStatus("No bids yet · quiet " Round(quiet) "s", "Pass in " Max(0, Round(fwS + sellS - quiet)) "s unless a bid comes" reading)
            if quiet >= fwS + sellS
                CloseLot("passed")
        } else {
            SetStatus("No bids yet · quiet " Round(quiet) "s", "Waiting — this lot will not be passed automatically" reading)
        }
    }
}

/** Sell (or Pass) the lot, move to the next one, and make sure the screen really moved on. */
CloseLot(how) {
    global RS
    before := RS.bid
    ; THE LAST LOOK, then the pixel watch — a bid in the final instant aborts the sale/pass.
    floor := how = "sold" ? before : 0
    fresh := LastLook([RS.name])
    if !IsObject(RS)
        return
    if fresh <= floor
        fresh := FinalWatch([RS.name], floor)
    if !IsObject(RS)
        return
    if fresh <= floor
        fresh := InstantCheck([RS.name], floor)
    if !IsObject(RS)
        return
    if fresh > floor {
        WriteLog("🛑 LAST-SECOND BID £" fresh " — " (how = "sold" ? "sale stopped" : "not passing") ", bidding continues")
        RS.lastChangeAt := A_TickCount
        return
    }
    if how = "sold"
        Press(RS.name = "saleroom" ? "btn_sell" : "btn_hammer", (RS.name = "saleroom" ? "SELL" : "HAMMER") " at £" before)
    else
        Press("btn_pass", RS.name = "saleroom" ? "PASS — no bids" : "PASS LOT — no bids")
    if how = "sold" {
        ; THE SOLD CHECK — reversible until Next (see CloseLotBoth).
        after := SoldCheck([RS.name], before)
        if !IsObject(RS)
            return
        if after > before {
            ReverseSale([RS.name], before, after)
            return
        }
    }
    Sleep 700
    prevLot := CFG.lotWatch ? LotToken(RS.name) : ""
    if !IsObject(RS)
        return
    Press(RS.name = "saleroom" ? "btn_next" : "btn_hammer", RS.name = "saleroom" ? "NEXT lot" : "NEXT LOT")
    ; Verify it moved on — a fresh lot can OPEN with a starting bid, so £0 alone is not
    ; the test, and a blind Next-retry on Vectis is the Hammer (see CloseLotBoth).
    Loop 2 {
        t0 := A_TickCount
        moved := false, stale := false
        while A_TickCount - t0 < 3000 {
            Sleep 150
            a := ReadBid(RS.name).amt
            if !IsObject(RS)
                return
            if a <= 0 || (how = "sold" && a != before) {
                moved := true
                break
            }
            if prevLot != "" {
                tok := LotToken(RS.name)
                if !IsObject(RS)
                    return
                if tok != "" && tok != prevLot {
                    moved := true
                    break
                }
                stale := tok != "" && tok = prevLot
            }
        }
        if moved
            break
        if A_Index = 1 && stale {
            WriteLog("⚠ the screen still shows lot " prevLot " after Next — pressing Next once more")
            Press(RS.name = "saleroom" ? "btn_next" : "btn_hammer", "NEXT lot (retry)")
        } else if A_Index = 1 {
            WriteLog("⚠ cannot confirm the lot moved on (the new lot may have opened with a bid) — NOT pressing Next again blind")
            break
        } else {
            WriteLog("⚠ could not confirm the new lot — carrying on from what the screen shows now")
        }
    }
    RS.lots++
    WriteLog((how = "sold" ? "🔨 sold at £" before : "passed") " · lot " RS.lots " done · next lot open")
    RS.bid := -1, RS.stable := -1, RS.stableN := 0
    RS.phase := "open"
    RS.lastChangeAt := A_TickCount
    RS.fwAt := 0
}

/** Click a calibrated button — and log it, because that is the whole point. */
Press(key, why) {
    PressOn(RS.name, key, why)
}
PressOn(nm, key, why) {
    global RS
    if !IsObject(RS)              ; Esc landed mid-sequence — never press into a dead run
        return
    p := CAL[nm][key]
    WriteLog("PRESS " nm "." key " @" p.x "," p.y " — " why)
    RS.presses++
    if IsObject(SIM) {                   ; --simboth: apply the press to the model instead
        SimPress(nm, key)
        return
    }
    MouseMove p.x, p.y, 0
    Sleep 40
    Click p.x, p.y
    Sleep 120
}
/** Type a figure into the box just clicked (or, in the simulation, remember it).
 *  ⚠ Select-all then type is NOT enough: the Saleroom Trainer moves the caret to the end on
 *  every digit, so the typed figures piled up ("102530" = 10, 25, 30). Delete the selection
 *  with Backspace FIRST, so the box is empty before the first digit goes in. */
TypeAmount(v) {
    if IsObject(SIM) {
        SIM.typed := v
        return
    }
    Send "^a"
    Sleep 40
    Send "{BackSpace}"
    Sleep 40
    SendText String(v)
    Sleep 80
}
