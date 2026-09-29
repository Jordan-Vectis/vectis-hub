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
# Test hook (2026-09-29): -TestPng <file> [-TestMode num|txt|lines] runs the SAME pipeline on a
# saved picture instead of the screen, prints the text in [brackets] and exits — the only honest
# way to test a reading change. last.png / last-raw.png are written into -Dir as usual.

param(
    [Parameter(Mandatory = $true)][string]$Dir,
    # The AutoHotkey script's process id. If that process disappears (closed, or killed
    # hard so its OnExit never ran) this helper leaves too — otherwise every hard kill
    # left an orphaned reader watching the same folder.
    [int]$ParentPid = 0,
    [string]$TestPng = '',
    [string]$TestMode = 'num'
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

# Flatten a crop to pure black ink on white.
# ⚠⚠ WHY (2026-09-29, measured on Jordan's own Test read picture): the REAL Vectis clerking page
# shows the current bid as light text on an indigo bar. The inversion below turns that into black
# digits on a YELLOW-OLIVE patch, and Windows' OCR read the composed line "Bid £5" as just "Bid" —
# the coloured patch under the digits was enough for it to drop them (and a dark patch beside the
# word makes it drop the WHOLE line, "Bid" included). The very same picture, flattened, read
# "Bid ES" → £5. The threshold is the midpoint of the crop's own darkest and lightest pixel, so it
# suits black-on-white (the Saleroom trainer) and black-on-olive alike. A crop with no contrast
# is "nothing to read", not ink.
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

# Everything between the grab and the picture the OCR sees. Takes a bitmap (the screen grab, or
# a saved PNG under -TestPng) and returns the picture to recognise — so the test hook and the
# live read cannot drift.
function Prepare-Image($grab, [string]$mode) {
    $w = $grab.Width; $h = $grab.Height
    # Light text on a dark background (the Vectis screen's indigo "Current Bid" bar) reads
    # badly — "£10" came back as "EIO". OCR wants dark-on-light, so if the box is mostly
    # dark, invert it first. Mean luminance from a sparse sample keeps this cheap.
    $sum = 0; $n = 0
    for ($sy = 0; $sy -lt $h; $sy += 3) {
        for ($sx = 0; $sx -lt $w; $sx += 3) {
            $c = $grab.GetPixel($sx, $sy)
            $sum += (0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B)
            $n++
        }
    }
    $dark = ($n -gt 0) -and (($sum / $n) -lt 120)
    if ($dark) {
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
        $grab = $inv
    }
    if ($mode -eq 'num') {
        # A NUMBER box. Windows' OCR refuses a lone single character, so the box is
        # trimmed to its ink, FLATTENED to black on white (see Flatten-Ink), scaled to a
        # comfortable glyph height, and the word "Bid" is painted in front at normal word
        # spacing — "5" becomes the line "Bid 5", which always reads. (Measured: "Bid 5",
        # "Bid H 5", "Bid 1,250" all read; the raw boxes gave nothing.) The word has no
        # digits, so it can never be mistaken for the amount.
        $ib = Get-InkBox $grab
        if (-not $ib) { return $null }
        $crop = $grab.Clone((New-Object System.Drawing.Rectangle -ArgumentList $ib[0], $ib[1], $ib[2], $ib[3]), $grab.PixelFormat)
        $flat = Flatten-Ink $crop
        $crop.Dispose()
        if (-not $flat) { return $null }
        $gh = 40
        $k = $gh / $ib[3]
        $W2 = [Math]::Max(1, [int]($ib[2] * $k))
        $big = New-Object System.Drawing.Bitmap -ArgumentList ([int](130 + $W2 + 80)), ([int]($gh + 80))
        $bg = [System.Drawing.Graphics]::FromImage($big)
        $bg.Clear([System.Drawing.Color]::White)
        $bg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
        $wordFont = New-Object System.Drawing.Font('Segoe UI', $gh, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $bg.DrawString('Bid', $wordFont, [System.Drawing.Brushes]::Black, 30, 30)
        $bg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $bg.DrawImage($flat, 130, 40, $W2, $gh)
        $bg.Dispose()
        $flat.Dispose()
        return $big
    }
    # Plain text (the tie-check labels, the bid feed): scaled up three times, nothing added.
    # (Computed first: inside New-Object's brackets a comma binds tighter than *, so
    #  "$w * $scale, $h * $scale" multiplied by an array and threw.)
    $scale = 3
    $W2 = [int]($w * $scale)
    $H2 = [int]($h * $scale)
    $big = New-Object System.Drawing.Bitmap -ArgumentList $W2, $H2
    $bg = [System.Drawing.Graphics]::FromImage($big)
    $bg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $bg.DrawImage($grab, 0, 0, $W2, $H2)
    $bg.Dispose()
    return $big
}

function Ocr-Image($big, [string]$mode) {
    if (-not $big) { return '' }
    $ms = New-Object System.IO.MemoryStream
    $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $big.Dispose()
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

function Read-Region([int]$x, [int]$y, [int]$w, [int]$h, [string]$mode) {
    if ($w -lt 4 -or $h -lt 4) { return '' }
    $grab = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $g = [System.Drawing.Graphics]::FromImage($grab)
    $g.CopyFromScreen($x, $y, 0, 0, $grab.Size)
    $g.Dispose()
    # The untouched grab too — exactly the box that was drawn — beside the composed picture,
    # so a bad read can be told apart from a bad box (Jordan, 2026-09-29: "not using the exact
    # box I draw").
    Save-Png $grab $rawTmp $rawPng
    $big = Prepare-Image $grab $mode
    $grab.Dispose()
    return Ocr-Image $big $mode
}

# ── Test hook: one saved picture through the same pipeline, then out ──────────────────────
if ($TestPng -ne '') {
    $grab = [System.Drawing.Bitmap]::FromFile($TestPng)
    Save-Png $grab $rawTmp $rawPng
    $big = Prepare-Image $grab $TestMode
    $t = Ocr-Image $big $TestMode
    Write-Output ('[' + $t + ']')
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
