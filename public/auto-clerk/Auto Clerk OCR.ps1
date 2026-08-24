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

param(
    [Parameter(Mandatory = $true)][string]$Dir,
    # The AutoHotkey script's process id. If that process disappears (closed, or killed
    # hard so its OnExit never ran) this helper leaves too — otherwise every hard kill
    # left an orphaned reader watching the same folder.
    [int]$ParentPid = 0
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

function Read-Region([int]$x, [int]$y, [int]$w, [int]$h, [string]$mode) {
    if ($w -lt 4 -or $h -lt 4) { return '' }
    $grab = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $g = [System.Drawing.Graphics]::FromImage($grab)
    $g.CopyFromScreen($x, $y, 0, 0, $grab.Size)
    $g.Dispose()
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
        $grab.Dispose()
        $grab = $inv
    }
    if ($mode -eq 'num') {
        # A NUMBER box. Windows' OCR refuses a lone single character, so the box is
        # trimmed to its ink, scaled to a comfortable glyph height, and the word "Bid"
        # is painted in front at normal word spacing — "5" becomes the line "Bid 5",
        # which always reads. (Measured: "Bid 5", "Bid H 5", "Bid 1,250" all read;
        # the raw boxes gave nothing.) The word has no digits, so it can never be
        # mistaken for the amount.
        $ib = Get-InkBox $grab
        if (-not $ib) { $grab.Dispose(); return '' }
        $crop = $grab.Clone((New-Object System.Drawing.Rectangle -ArgumentList $ib[0], $ib[1], $ib[2], $ib[3]), $grab.PixelFormat)
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
        $bg.DrawImage($crop, 130, 40, $W2, $gh)
        $bg.Dispose()
        $crop.Dispose()
        $grab.Dispose()
    } else {
        # Plain text (the tie-check labels): scaled up three times, nothing added.
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
        $grab.Dispose()
    }
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
    return [string]$r.Text
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
