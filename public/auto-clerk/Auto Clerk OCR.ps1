# Auto Clerk OCR helper — reads numbers off the screen for "Auto Clerk.ahk".
#
# Started (hidden) by the AutoHotkey script. It sits in a loop watching for a
# request file in the folder it is given:
#     ocr-req.txt   ->  "x y w h"   (screen rectangle, top-left + size, screen coords)
# and answers with
#     ocr-res.txt   ->  the text Windows' built-in OCR engine read in that rectangle
# "quit" in the request file ends the helper.
#
# Uses Windows.Media.Ocr (part of Windows 10/11 — nothing to install, no internet).
# Measured on Jordan's PC 2026-08-21: ~10 ms per read once warm.
#
# Test hooks (2026-09-29) — the only honest way to test a reading change:
#   -TestPng <file> [-TestMode num|txt|lines]      one saved grab through the same pipeline
#   -TestScreenPng <file> -TestBox "x y w h"       a saved picture stands in for the SCREEN; the
#                                                  box is grabbed from it exactly as from the screen,
#                                                  growth included
# Both print the text in [brackets] (plus the stage that produced it) and exit; last.png and
# last-raw.png are written into -Dir as usual.

param(
    [Parameter(Mandatory = $true)][string]$Dir,
    # The AutoHotkey script's process id. If that process disappears (closed, or killed
    # hard so its OnExit never ran) this helper leaves too — otherwise every hard kill
    # left an orphaned reader watching the same folder.
    [int]$ParentPid = 0,
    [string]$TestPng = '',
    [string]$TestMode = 'num',
    [string]$TestScreenPng = '',
    [string]$TestBox = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStreamReference, Windows.Foundation, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, $t) {
    $m = $asTaskGeneric.MakeGenericMethod($t)
    $task = $m.Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'en-GB')) }

$reqPath   = Join-Path $Dir 'ocr-req.txt'
$resPath   = Join-Path $Dir 'ocr-res.txt'
$tmpPath   = Join-Path $Dir 'ocr-res.tmp'
$readyPath = Join-Path $Dir 'ocr-ready.txt'
$lastPng   = Join-Path $Dir 'last.png'
$lastTmp   = Join-Path $Dir 'last.tmp'
$rawPng    = Join-Path $Dir 'last-raw.png'
$rawTmp    = Join-Path $Dir 'last-raw.tmp'

# The "screen": the real one, or a saved picture under -TestScreenPng.
$script:FakeScreen = $null
$script:FakeOrigin = @(0, 0)
function Grab-Screen([int]$x, [int]$y, [int]$w, [int]$h) {
    $b = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $g = [System.Drawing.Graphics]::FromImage($b)
    if ($script:FakeScreen) {
        $g.Clear([System.Drawing.Color]::FromArgb(46, 50, 142))
        $g.DrawImage($script:FakeScreen, (New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $w, $h), ($x - $script:FakeOrigin[0]), ($y - $script:FakeOrigin[1]), $w, $h, [System.Drawing.GraphicsUnit]::Pixel)
    } else {
        $g.CopyFromScreen($x, $y, 0, 0, $b.Size)
    }
    $g.Dispose()
    return $b
}

function Get-InkBox($b) {
    $minX = $b.Width; $maxX = -1; $minY = $b.Height; $maxY = -1
    for ($y = 0; $y -lt $b.Height; $y++) {
        for ($x = 0; $x -lt $b.Width; $x++) {
            if ($b.GetPixel($x, $y).GetBrightness() -lt 0.55) {
                if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt 0) { return $null }
    return @($minX, $minY, ($maxX - $minX + 1), ($maxY - $minY + 1))
}

function Invert-Image($grab) {
    $w = $grab.Width; $h = $grab.Height
    $inv = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $ig = [System.Drawing.Graphics]::FromImage($inv)
    $cm = New-Object System.Drawing.Imaging.ColorMatrix
    $cm.Matrix00 = -1; $cm.Matrix11 = -1; $cm.Matrix22 = -1; $cm.Matrix33 = 1
    $cm.Matrix40 = 1;  $cm.Matrix41 = 1;  $cm.Matrix42 = 1;  $cm.Matrix44 = 1
    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    $ia.SetColorMatrix($cm)
    $rect = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $w, $h
    $ig.DrawImage($grab, $rect, 0, 0, $w, $h, [System.Drawing.GraphicsUnit]::Pixel, $ia)
    $ig.Dispose()
    return $inv
}

# Light text on a dark background (the Vectis screen's indigo "Current Bid" bar) reads
# badly — "£10" came back as "EIO". OCR wants dark-on-light, so if the box is mostly
# dark, invert it first. Mean luminance from a sparse sample keeps this cheap.
function Is-Dark($grab) {
    $sum = 0; $n = 0
    for ($sy = 0; $sy -lt $grab.Height; $sy += 3) {
        for ($sx = 0; $sx -lt $grab.Width; $sx += 3) {
            $c = $grab.GetPixel($sx, $sy)
            $sum += (0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
            $n++
        }
    }
    return ($n -gt 0) -and (($sum / $n) -lt 120)
}

# Does ink touch the left / right edge of the (dark-on-light) picture? A glyph on the edge is
# a CLIPPED glyph, and a clipped glyph is poison — see Grow-IfClipped.
function Edge-Ink($b) {
    $left = $false; $right = $false
    for ($y = 0; $y -lt $b.Height; $y++) {
        if ($b.GetPixel(0, $y).GetBrightness() -lt 0.55) { $left = $true }
        if ($b.GetPixel($b.Width - 1, $y).GetBrightness() -lt 0.55) { $right = $true }
        if ($left -and $right) { break }
    }
    return @($left, $right)
}

# ⚠⚠ NEVER READ A CLIPPED GLYPH (2026-09-29, measured on Jordan's real Vectis bid box). On the
# real Bidpath page the £ sits touching the 5, so a box drawn round the digits — plus the 4 px
# "hair" the clerk pads on — takes in HALF the £. A whole £ reads as "E" (a money marker the
# parser handles: "Bid E30" → £30, read live twice); half a £ reads as "Z" or "2", giving "Bid ZSO"
# (nothing) or "Bid 250" (a phantom £250). Cutting columns off is no better — the digits themselves
# then read as "15". So when ink touches a side of the grab, the grab GROWS on that side, a few
# pixels at a time, until a blank column separates the glyph from the edge — and the whole glyph is
# read. The same rule catches a figure that has outgrown its box ("£1,250" in a box drawn round
# "£50"), which would otherwise lose its last digit in silence. Capped, so a page border that runs
# through the box cannot make it grow for ever.
$GROW_STEP = 6
$GROW_MAX  = 60
function Grow-IfClipped([int]$x, [int]$y, [int]$w, [int]$h, $grab) {
    $dark = Is-Dark $grab
    $view = if ($dark) { Invert-Image $grab } else { $grab }
    $e = Edge-Ink $view
    if ($dark) { $view.Dispose() }
    $growL = 0; $growR = 0
    while (($e[0] -and $growL -lt $GROW_MAX) -or ($e[1] -and $growR -lt $GROW_MAX)) {
        if ($e[0]) { $growL += $GROW_STEP }
        if ($e[1]) { $growR += $GROW_STEP }
        $grab.Dispose()
        $grab = Grab-Screen ($x - $growL) $y ($w + $growL + $growR) $h
        $view = if ($dark) { Invert-Image $grab } else { $grab }
        $e = Edge-Ink $view
        if ($dark) { $view.Dispose() }
    }
    return $grab
}

# Flatten a crop to pure black ink on white.
# ⚠⚠ WHY (2026-09-29, measured on Jordan's own Test read picture): the real Bidpath page shows the
# current bid as light text on an indigo bar. Inverted, that is black digits on a YELLOW-OLIVE
# patch, and Windows' OCR read the composed line "Bid £5" as just "Bid" — the coloured patch under
# the digits was enough for it to drop them. The same picture flattened read "Bid ES" → £5. The
# threshold is the midpoint of the crop's own darkest and lightest pixel, so it suits black-on-white
# (the Saleroom trainer) and black-on-olive alike. A crop with no contrast is "nothing to read".
function Flatten-Ink($b) {
    $lo = 1.0; $hi = 0.0
    for ($y = 0; $y -lt $b.Height; $y++) {
        for ($x = 0; $x -lt $b.Width; $x++) {
            $v = $b.GetPixel($x, $y).GetBrightness()
            if ($v -lt $lo) { $lo = $v }; if ($v -gt $hi) { $hi = $v }
        }
    }
    if (($hi - $lo) -lt 0.15) { return $null }
    $thr = ($lo + $hi) / 2
    $o = New-Object System.Drawing.Bitmap -ArgumentList $b.Width, $b.Height
    for ($y = 0; $y -lt $b.Height; $y++) {
        for ($x = 0; $x -lt $b.Width; $x++) {
            $c = if ($b.GetPixel($x, $y).GetBrightness() -lt $thr) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
            $o.SetPixel($x, $y, $c)
        }
    }
    return $o
}

function Save-Png($bmp, $tmp, $final) {
    # Written via a temp name so a reader never sees a half file.
    try {
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        [System.IO.File]::WriteAllBytes($tmp, $ms.ToArray())
        $ms.Dispose()
        Move-Item -Path $tmp -Destination $final -Force
    } catch { }
}

# "Bid" painted in front of the crop, scaled to a comfortable glyph height. Windows' OCR refuses
# a lone single character, so "5" becomes the line "Bid 5", which reads. (Measured: "Bid 5",
# "Bid H 5", "Bid 1,250" all read; the raw boxes gave nothing.) The word has no digits, so it can
# never be mistaken for the amount.
function Compose-Line($crop, [int]$gh) {
    $k = $gh / $crop.Height
    $W2 = [Math]::Max(1, [int]($crop.Width * $k))
    $big = New-Object System.Drawing.Bitmap -ArgumentList ([int](130 + $W2 + 80)), ([int]($gh + 80))
    $bg = [System.Drawing.Graphics]::FromImage($big)
    $bg.Clear([System.Drawing.Color]::White)
    $bg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $wordFont = New-Object System.Drawing.Font('Segoe UI', $gh, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
    $bg.DrawString('Bid', $wordFont, [System.Drawing.Brushes]::Black, 30, 30)
    $bg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $bg.DrawImage($crop, 130, 40, $W2, $gh)
    $bg.Dispose()
    return $big
}

function Scale-Up($b, [int]$scale) {
    $W2 = [int]($b.Width * $scale)
    $H2 = [int]($b.Height * $scale)
    $big = New-Object System.Drawing.Bitmap -ArgumentList $W2, $H2
    $bg = [System.Drawing.Graphics]::FromImage($big)
    $bg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $bg.DrawImage($b, 0, 0, $W2, $H2)
    $bg.Dispose()
    return $big
}

function Ocr-Bitmap($big, [string]$mode) {
    if (-not $big) { return '' }
    $ms = New-Object System.IO.MemoryStream
    $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    # Keep the exact image the reader saw, so "what is it looking at?" has an answer
    # (Test read in the .ahk shows it). Written via a temp name so a reader never sees a half file.
    try {
        [System.IO.File]::WriteAllBytes($lastTmp, $ms.ToArray())
        Move-Item -Path $lastTmp -Destination $lastPng -Force
    } catch { }
    $ms.Position = 0
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $sb  = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $r   = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
    $ms.Dispose()
    # 'lines' keeps the OCR's line structure (one bid-feed row per line) - .Text
    # space-joins everything, which mashes a list into one unparseable line.
    if ($mode -eq 'lines') { return (($r.Lines | ForEach-Object { $_.Text }) -join "`n") }
    return [string]$r.Text
}

# Does a reading hold anything the clerk could take as a figure? Digits, or the look-alikes the
# parser translates straight after a money marker or the painted word. Mirrors ParseAmount's
# markers in the .ahk — keep them in step.
function Has-Figure([string]$t) {
    # The pound sign as a code point: PowerShell 5 reads this file as ANSI (no BOM), so a
    # literal non-ASCII character in CODE is mangled. Comments are fine.
    $pound = [string][char]0xA3
    return ($t -match '[0-9]') -or ($t -match ('(?:[' + $pound + 'Ef]|Bid)\s?[OoIl|SBG]'))
}

# A number box, dark-on-light by now. Three preparations, cheapest and most proven first; the
# first reading that holds a figure wins, otherwise the first non-empty one. Each costs ~10 ms of
# OCR, against ~170-300 ms for the round trip through the file link.
#   1. trimmed to its ink, FLATTENED, "Bid" painted in front   (v2.1, the lone-digit fix)
#   2. trimmed, as it is, "Bid" painted in front              (v1, what read "Bid E30" live)
#   3. the whole box scaled x3, nothing added                 (a line of words, e.g. a box drawn
#                                                             round all of "Current Bid: £50")
# A money marker in the reading: a pound sign (which OCRs as the sign itself, E or f).
function Has-Marker([string]$t) {
    $pound = [string][char]0xA3
    return ($t -match ('[' + $pound + 'Ef]\s?[0-9OoIl|SBG]'))
}

function Read-Number($view) {
    $script:Stage = ''
    $ib = Get-InkBox $view
    if (-not $ib) { return '' }
    $crop = $view.Clone((New-Object System.Drawing.Rectangle -ArgumentList $ib[0], $ib[1], $ib[2], $ib[3]), $view.PixelFormat)
    # A wide, low ink box is a line of words ("Current Bid: £50"), not a figure — read it as text
    # straight away; the composed readings are still taken as a fallback.
    $wordy = ($ib[2] -gt 4 * $ib[3])
    $order = if ($wordy) { @('text', 'flat', 'plain') } else { @('flat', 'plain', 'text') }
    $reads = @()
    foreach ($stage in $order) {
        $t = ''
        switch ($stage) {
            'flat'  { $flat = Flatten-Ink $crop; if ($flat) { $t = Ocr-Bitmap (Compose-Line $flat 40) 'num'; $flat.Dispose() } }
            'plain' { $t = Ocr-Bitmap (Compose-Line $crop 40) 'num' }
            'text'  { $t = Ocr-Bitmap (Scale-Up $view 3) 'num' }
        }
        $reads += ,@($stage, $t)
        # ⚠ A reading WITH a money marker wins outright. Where the figure carries a pound sign
        # (the Vectis bar), a reading without one means the sign was taken for a digit — the
        # half-pound that read "250" for £50 — so a marker-less figure is never preferred over a
        # marked one, whichever preparation produced it. Boxes with no sign at all (the Saleroom
        # H box) never produce a marker, so for them the first figure still wins.
        if ((Has-Figure $t) -and (Has-Marker $t)) { $script:Stage = $stage; $crop.Dispose(); return $t }
    }
    $crop.Dispose()
    foreach ($r in $reads) { if (Has-Figure $r[1]) { $script:Stage = $r[0]; return $r[1] } }
    foreach ($r in $reads) { if ($r[1].Trim() -ne '') { $script:Stage = 'none'; return $r[1] } }
    $script:Stage = 'none'
    return ''
}

# Everything between the grab and the text. Shared by the live read and both test hooks, so
# they cannot drift.
function Read-Grab($grab, [string]$mode) {
    if ($mode -eq 'num') {
        $view = if (Is-Dark $grab) { Invert-Image $grab } else { $grab }
        $t = Read-Number $view
        if ($view -ne $grab) { $view.Dispose() }
        return $t
    }
    # Plain text (the tie-check labels, the bid feed): inverted if dark, scaled up three
    # times, nothing added.
    $view = if (Is-Dark $grab) { Invert-Image $grab } else { $grab }
    $t = Ocr-Bitmap (Scale-Up $view 3) $mode
    if ($view -ne $grab) { $view.Dispose() }
    return $t
}

function Read-Region([int]$x, [int]$y, [int]$w, [int]$h, [string]$mode) {
    if ($w -lt 4 -or $h -lt 4) { return '' }
    $grab = Grab-Screen $x $y $w $h
    if ($mode -eq 'num') { $grab = Grow-IfClipped $x $y $w $h $grab }
    # The untouched grab too — exactly the box that was read (grown, if it grew) — beside the
    # composed picture, so a bad read can be told apart from a bad box.
    Save-Png $grab $rawTmp $rawPng
    $t = Read-Grab $grab $mode
    $grab.Dispose()
    return $t
}

# ── Test hooks ──────────────────────────────────────────────────────────────────────────
if ($TestPng -ne '') {
    $grab = [System.Drawing.Bitmap]::FromFile($TestPng)
    Save-Png $grab $rawTmp $rawPng
    $t = Read-Grab $grab $TestMode
    Write-Output ('[' + $t + ']  stage=' + $script:Stage)
    exit 0
}
if ($TestScreenPng -ne '') {
    $script:FakeScreen = [System.Drawing.Bitmap]::FromFile($TestScreenPng)
    $p = $TestBox -split '[ ,]+'
    $t = Read-Region ([int]$p[0]) ([int]$p[1]) ([int]$p[2]) ([int]$p[3]) $TestMode
    $raw = [System.Drawing.Bitmap]::FromFile($rawPng)
    Write-Output ('[' + $t + ']  stage=' + $script:Stage + '  grab=' + $raw.Width + 'x' + $raw.Height)
    $raw.Dispose()
    exit 0
}

# Our OWN process id goes in the ready file: "powershell -WindowStyle Hidden" re-launches
# itself, so the id the script got from Run belongs to a parent that has already gone.
Set-Content -Path $readyPath -Value $PID -Encoding ASCII

$lastParentCheck = [Environment]::TickCount
while ($true) {
    if ($ParentPid -gt 0 -and ([Environment]::TickCount - $lastParentCheck) -gt 2000) {
        $lastParentCheck = [Environment]::TickCount
        if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
    }
    if (Test-Path $reqPath) {
        $line = ''
        try { $line = (Get-Content $reqPath -Raw).Trim() } catch { }
        Remove-Item $reqPath -Force -ErrorAction SilentlyContinue
        if ($line -eq 'quit') { break }
        $text = ''
        try {
            $p = $line -split '[ ,]+'
            $m = if ($p.Count -ge 5) { [string]$p[4] } else { 'num' }
            $text = Read-Region ([int]$p[0]) ([int]$p[1]) ([int]$p[2]) ([int]$p[3]) $m
        } catch {
            $text = 'ERR ' + $_.Exception.Message
        }
        Set-Content -Path $tmpPath -Value $text -Encoding UTF8
        Move-Item -Path $tmpPath -Destination $resPath -Force
    } else {
        Start-Sleep -Milliseconds 4
    }
}
Remove-Item $readyPath -Force -ErrorAction SilentlyContinue
