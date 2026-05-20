"use client"

import { useState, useEffect, useRef } from "react"
import { geoNaturalEarth1, geoMercator, geoPath } from "d3-geo"
import { feature } from "topojson-client"
import type { FeatureCollection } from "geojson"
import { COUNTRY_NAMES, ISO_NUMERIC, NAME_TO_ALPHA2 } from "@/lib/country-names"

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"

const NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  Object.entries(ISO_NUMERIC).map(([a2, num]) => [num, a2])
)

function heatColor(t: number): string {
  const r = Math.round(14  + t * (0   - 14))
  const g = Math.round(42  + t * (120 - 42))
  const b = Math.round(111 + t * (212 - 111))
  return `rgb(${r},${g},${b})`
}

type Tip = { x: number; y: number; text: string }

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null
  return (
    <div
      className="fixed z-50 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs px-2 py-1.5 rounded pointer-events-none shadow-lg"
      style={{ left: tip.x + 14, top: tip.y - 32 }}
    >
      {tip.text}
    </div>
  )
}

// ─── World choropleth ─────────────────────────────────────────────────────────

export function WorldMap({
  byCountry,
  total,
}: {
  byCountry: { country: string; count: number }[]
  total: number
}) {
  const [topo, setTopo]   = useState<any>(null)
  const [tip, setTip]     = useState<Tip | null>(null)

  useEffect(() => { fetch(GEO_URL).then(r => r.json()).then(setTopo) }, [])

  const countByGeoId: Record<string, number> = {}
  for (const r of byCountry) {
    // Try direct alpha-2 lookup, then fall back to full-name lookup
    const a2  = ISO_NUMERIC[r.country] ? r.country : (NAME_TO_ALPHA2[r.country.toLowerCase()] ?? null)
    const num = a2 ? ISO_NUMERIC[a2] : null
    if (num) countByGeoId[num] = (countByGeoId[num] ?? 0) + r.count
  }
  const max = Math.max(...Object.values(countByGeoId), 1)

  const W = 800, H = 430
  const projection = geoNaturalEarth1().scale(127).translate([W / 2, H / 2])
  const pathGen    = geoPath(projection)

  return (
    <div className="relative rounded border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#080a14]">
      {!topo && <p className="text-gray-600 dark:text-gray-500 text-sm py-8 text-center">Loading map…</p>}
      {topo && (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {(feature(topo, topo.objects.countries) as unknown as FeatureCollection).features.map((feat: any) => {
            const raw   = String(feat.id)
            const id    = raw.replace(/^0+/, "") // strip leading zeros ("036" → "36")
            const count = countByGeoId[id] ?? 0
            const fill  = count > 0 ? heatColor(count / max) : "#131627"
            const a2    = NUMERIC_TO_ALPHA2[id]
            const name  = a2 ? (COUNTRY_NAMES[a2] ?? a2) : raw
            return (
              <path
                key={feat.id}
                d={pathGen(feat) ?? ""}
                fill={fill}
                stroke="#0a0c1a"
                strokeWidth={0.3}
                style={{ cursor: count > 0 ? "pointer" : "default", outline: "none" }}
                onMouseEnter={(e) => {
                  if (!count) return
                  const pct = ((count / total) * 100).toFixed(1)
                  setTip({ x: e.clientX, y: e.clientY, text: `${name}: ${count.toLocaleString()} (${pct}%)` })
                }}
                onMouseLeave={() => setTip(null)}
              />
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
      <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-800">
        <span className="text-gray-600 text-xs">Low</span>
        <div className="flex-1 h-2 rounded" style={{ background: "linear-gradient(to right, rgb(14,42,111), rgb(0,120,212))" }} />
        <span className="text-gray-600 text-xs">High</span>
      </div>
    </div>
  )
}

// ─── UK city bubble map ───────────────────────────────────────────────────────

const UK_COORDS: Record<string, [number, number]> = {
  "London":         [-0.1276, 51.5074],
  "Birmingham":     [-1.8904, 52.4862],
  "Manchester":     [-2.2374, 53.4808],
  "Leeds":          [-1.5491, 53.8008],
  "Glasgow":        [-4.2518, 55.8642],
  "Sheffield":      [-1.4701, 53.3811],
  "Bradford":       [-1.7594, 53.7960],
  "Edinburgh":      [-3.1883, 55.9533],
  "Liverpool":      [-2.9916, 53.4084],
  "Bristol":        [-2.5879, 51.4545],
  "Cardiff":        [-3.1791, 51.4816],
  "Leicester":      [-1.1398, 52.6369],
  "Coventry":       [-1.5224, 52.4068],
  "Nottingham":     [-1.1581, 52.9548],
  "Newcastle":      [-1.6178, 54.9783],
  "Belfast":        [-5.9301, 54.5973],
  "Brighton":       [-0.1363, 50.8225],
  "Plymouth":       [-4.1427, 50.3755],
  "Stoke-on-Trent": [-2.1803, 53.0027],
  "Wolverhampton":  [-2.1294, 52.5870],
  "Derby":          [-1.4759, 52.9225],
  "Swansea":        [-3.9995, 51.6214],
  "Southampton":    [-1.4043, 50.9097],
  "Portsmouth":     [-1.0880, 50.8198],
  "Aberdeen":       [-2.0943, 57.1497],
  "Dundee":         [-2.9707, 56.4620],
  "Oxford":         [-1.2577, 51.7520],
  "Cambridge":      [ 0.1218, 52.2053],
  "York":           [-1.0827, 53.9590],
  "Exeter":         [-3.5275, 50.7184],
  "Norwich":        [ 1.2979, 52.6309],
  "Peterborough":   [-0.2431, 52.5695],
  "Luton":          [-0.4152, 51.8787],
  "Reading":        [-0.9781, 51.4543],
  "Sunderland":     [-1.3829, 54.9047],
  "Middlesbrough":  [-1.2349, 54.5742],
  "Huddersfield":   [-1.7849, 53.6450],
  "Milton Keynes":  [-0.7594, 52.0406],
  "Northampton":    [-0.8932, 52.2405],
  "Ipswich":        [ 1.1550, 52.0567],
  "Warrington":     [-2.5960, 53.3900],
  "Bolton":         [-2.4289, 53.5779],
  "Blackpool":      [-3.0488, 53.8175],
  "Preston":        [-2.7036, 53.7632],
  "Hull":           [-0.3274, 53.7441],
  "Gloucester":     [-2.2440, 51.8642],
  "Cheltenham":     [-2.0779, 51.8994],
  "Guildford":      [-0.5822, 51.2362],
  "Colchester":     [ 0.8986, 51.8959],
  "Wigan":          [-2.6306, 53.5451],
  "Stockport":      [-2.1531, 53.4083],
  "Burnley":        [-2.2481, 53.7892],
  "Wakefield":      [-1.4977, 53.6830],
  "Barnsley":       [-1.4794, 53.5526],
  "Shrewsbury":     [-2.7527, 52.7082],
  "Worcester":      [-2.2227, 52.1920],
  "Chester":        [-2.8910, 53.1905],
  "Wrexham":        [-2.9988, 53.0461],
  "Newport":        [-2.9982, 51.5842],
  "Inverness":      [-4.2247, 57.4778],
  "Perth":          [-3.4305, 56.3950],
  "Stirling":       [-3.9369, 56.1165],
}

export function UKMap({
  byCity,
  total,
}: {
  byCity: { city: string; country: string; count: number }[]
  total: number
}) {
  const [topo, setTopo] = useState<any>(null)
  const [tip, setTip]   = useState<Tip | null>(null)
  const svgRef          = useRef<SVGSVGElement>(null)
  const dragRef         = useRef<{ x: number; y: number; vb: typeof vb } | null>(null)

  const W = 500, H = 780
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H })

  useEffect(() => { fetch(GEO_URL).then(r => r.json()).then(setTopo) }, [])

  const ukRows = byCity.filter(r => r.country === "GB" || r.country === "UK")
  const mapped = ukRows.filter(r => UK_COORDS[r.city])
  const missed = ukRows.filter(r => !UK_COORDS[r.city])
  const max    = Math.max(...mapped.map(r => r.count), 1)

  const projection = geoMercator().center([-2, 54.5]).scale(2800).translate([W / 2, H / 2])
  const pathGen    = geoPath(projection)

  function zoomBy(factor: number, cx = W / 2, cy = H / 2) {
    setVb(v => {
      const newW = Math.max(W / 10, Math.min(W, v.w * factor))
      const newH = Math.max(H / 10, Math.min(H, v.h * factor))
      return {
        x: cx - (cx - v.x) * (newW / v.w),
        y: cy - (cy - v.y) * (newH / v.h),
        w: newW,
        h: newH,
      }
    })
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const cx = vb.x + ((e.clientX - rect.left) / rect.width)  * vb.w
    const cy = vb.y + ((e.clientY - rect.top)  / rect.height) * vb.h
    zoomBy(e.deltaY > 0 ? 1.18 : 0.85, cx, cy)
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY, vb: { ...vb } }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const dx = (e.clientX - dragRef.current.x) * (dragRef.current.vb.w / rect.width)
    const dy = (e.clientY - dragRef.current.y) * (dragRef.current.vb.h / rect.height)
    setVb({ ...dragRef.current.vb, x: dragRef.current.vb.x - dx, y: dragRef.current.vb.y - dy })
  }

  function onPointerUp() { dragRef.current = null }

  return (
    <div className="relative rounded border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-[#080a14]" style={{ maxWidth: 520 }}>
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 flex flex-col gap-1 z-10">
        <button onClick={() => zoomBy(0.7)} className="w-7 h-7 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded text-sm hover:border-gray-500 hover:text-white">+</button>
        <button onClick={() => zoomBy(1.4)} className="w-7 h-7 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 rounded text-sm hover:border-gray-500 hover:text-white">−</button>
        <button onClick={() => setVb({ x: 0, y: 0, w: W, h: H })} className="w-7 h-7 bg-gray-100 dark:bg-[#0d0f1a] border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-500 rounded text-xs hover:border-gray-500 hover:text-white">⌂</button>
      </div>
      {!topo && <p className="text-gray-600 dark:text-gray-500 text-sm py-8 text-center">Loading map…</p>}
      {topo && (
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          className="w-full"
          style={{ cursor: dragRef.current ? "grabbing" : "grab", userSelect: "none" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {(feature(topo, topo.objects.countries) as unknown as FeatureCollection).features
            .filter((f: any) => String(f.id) === "826" || String(f.id) === "372")
            .map((feat: any) => (
              <path
                key={feat.id}
                d={pathGen(feat) ?? ""}
                fill={String(feat.id) === "826" ? "#1e3a5f" : "#131a2e"}
                stroke="#2d4a6a"
                strokeWidth={0.8}
                style={{ outline: "none" }}
              />
            ))}
          {mapped.map((r, i) => {
            const pt     = projection(UK_COORDS[r.city])
            if (!pt) return null
            const [cx, cy] = pt
            const radius   = 3 + (r.count / max) * 18
            const pct      = ((r.count / total) * 100).toFixed(1)
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={radius}
                fill="#0078D4"
                fillOpacity={0.75}
                stroke="#60a5fa"
                strokeWidth={0.8}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, text: `${r.city}: ${r.count.toLocaleString()} (${pct}%)` })}
                onMouseLeave={() => setTip(null)}
              />
            )
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
      {missed.length > 0 && (
        <p className="text-xs text-gray-600 px-3 py-1.5 border-t border-gray-200 dark:border-gray-800">
          {missed.length} UK {missed.length === 1 ? "city" : "cities"} not plotted (unrecognised location)
        </p>
      )}
    </div>
  )
}
