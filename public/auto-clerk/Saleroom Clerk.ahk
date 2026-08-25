#Requires AutoHotkey v2.0
; Saleroom Clerk — a LAUNCHER, not a copy. It starts the Auto Clerk engine in follow mode:
; this instance clerks ONLY the Saleroom, while a person (or the real sale) drives the Vectis screen.
; One code base on purpose — every guard, setting and calibration is shared with the
; main Auto Clerk, so nothing can drift. Keep this file in the SAME folder as
; Auto Clerk.ahk and Auto Clerk OCR.ps1.
main := A_ScriptDir "\\Auto Clerk.ahk"
if !FileExist(main) {
    MsgBox "Auto Clerk.ahk must be in the same folder as this launcher.", "Saleroom Clerk", "Iconx"
    ExitApp
}
Run '"' A_AhkPath '" "' main '" --clerk saleroom'
