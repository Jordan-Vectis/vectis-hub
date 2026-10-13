"use client"

import { useEffect, useState } from "react"

// ─── IT Tools → Craft Apps ────────────────────────────────────────────────────
//
// Installers for the Craft App Suite (storytold's open-source, clean-room
// Photoshop / Illustrator / Word / Excel-style apps), the ArtCraft Launcher and
// Vectis's own build of ArtCraft. Jordan (2026-10-13): the point is that these
// stay installable even if GitHub takes the projects down — the source is cloned
// and built on the office PC, and the installers live in OUR R2 bucket. Nothing
// here links to GitHub.
//
// The list is craft-apps/manifest.json in R2 (scripts/upload-craft-apps.mjs).
// Each app shows its newest version with a Download, and every version it has
// under "All versions". "Built by Vectis" means built here from the source;
// "Official release" is storytold's own installer kept as a fallback. Download
// asks the API for a one-hour signed link that saves the file under its own name.

type CraftFile = { name: string; key: string; sizeBytes: number; sha256: string }
type CraftVersion = { version: string; source: "built" | "official"; notes: string; files: CraftFile[] }
type CraftApp = { id: string; name: string; icon: string; group: string; tagline: string; like: string; versions: CraftVersion[] }
type Bundle = { id: string; label: string; key: string; fileName: string; sizeBytes: number; sha256: string; fileCount: number }
type Manifest = { generatedAt: string | null; apps: CraftApp[]; bundles?: Bundle[] }

const GROUP_LABEL: Record<string, string> = { Creative: "Creative", Office: "Office and drafting", Suite: "The suite itself" }
const GROUP_ORDER = ["Creative", "Office", "Suite"]

const fmtSize = (b: number) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

// Versions are listed newest first by their x.y.z. A -dev.<stamp> build sits one
// patch above the official release it was built from, so it leads naturally; at
// the same x.y.z (the launcher's 0.3.2 and 0.3.2-vectis) the Vectis build leads,
// because it is the one we can rebuild.
const parse = (v: string) => {
  const [core, pre = ""] = v.split("-", 2)
  const n = core.split(".").map(x => parseInt(x, 10) || 0)
  return { n: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], pre }
}
const compareVersions = (a: CraftVersion, b: CraftVersion) => {
  const x = parse(a.version), y = parse(b.version)
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i]
  if (a.source !== b.source) return a.source === "built" ? 1 : -1
  return x.pre.localeCompare(y.pre)
}
const newestFirst = (vs: CraftVersion[]) => [...vs].sort((a, b) => compareVersions(b, a))
// The installer itself, not the portable zip, is what Download gives you.
const mainFile = (v: CraftVersion) => v.files.find(f => /\.(msi|exe)$/i.test(f.name)) ?? v.files[0]

function SourceBadge({ source }: { source: CraftVersion["source"] }) {
  return source === "built"
    ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Built by Vectis</span>
    : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Official release</span>
}

export default function CraftAppsTab() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/it-tools/craft-apps")
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Couldn't load the installer list"); return j as Manifest })
      .then(setManifest)
      .catch(e => setListError(e?.message ?? "Couldn't load the installer list"))
  }, [])

  async function download(file: { name: string; key: string }) {
    setActionError(null); setBusyKey(file.key)
    try {
      const r = await fetch(`/api/it-tools/craft-apps/download?key=${encodeURIComponent(file.key)}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) throw new Error(j.error ?? "Couldn't get a download link")
      window.location.assign(j.url)
    } catch (e: any) {
      setActionError(`${file.name}: ${e?.message ?? "download failed"}`)
    } finally {
      setBusyKey(null)
    }
  }

  async function copyHash(f: CraftFile) {
    await navigator.clipboard.writeText(f.sha256)
    setCopied(f.key); setTimeout(() => setCopied(null), 2000)
  }

  if (listError) return <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{listError}</div>
  if (!manifest) return <div className="text-gray-500 dark:text-gray-400 text-sm">Loading…</div>

  const groups = GROUP_ORDER.map(g => ({ g, apps: manifest.apps.filter(a => a.group === g && a.versions.length) })).filter(x => x.apps.length)

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-2">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Free, open-source stand-ins for the Adobe and Microsoft Office apps, kept in the Hub&apos;s own storage so they
          stay available whatever happens to the projects online. Download an installer, run it (it asks for admin
          rights), and the app appears in the Start Menu.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5"><SourceBadge source="built" /> compiled by Vectis from the source code</span>
          <span className="inline-flex items-center gap-1.5"><SourceBadge source="official" /> the project&apos;s own installer, kept as a fallback</span>
          {manifest.generatedAt && <span>List updated {fmtWhen(manifest.generatedAt)}</span>}
        </div>
        {(manifest.bundles ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {(manifest.bundles ?? []).map(b => (
              <button
                key={b.id}
                onClick={() => download({ name: b.fileName, key: b.key })}
                disabled={busyKey === b.key}
                className={`text-sm font-semibold px-4 py-2.5 rounded-lg text-white disabled:opacity-60 ${b.id === "built" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-gray-600 hover:bg-gray-500"}`}
              >
                {busyKey === b.key ? "Preparing…" : `⬇ ${b.label}`}
                <span className="font-normal opacity-80"> · {b.fileCount} installers · {fmtSize(b.sizeBytes)}</span>
              </button>
            ))}
            <span className="text-xs text-gray-500 dark:text-gray-400">One zip each, with a SHA256SUMS.txt and README inside.</span>
          </div>
        )}
      </div>

      {actionError && <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg p-3">{actionError}</div>}

      {groups.length === 0 && (
        <div className="text-gray-500 dark:text-gray-400 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
          No installers have been uploaded yet.
        </div>
      )}

      {groups.map(({ g, apps }) => (
        <div key={g}>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">{GROUP_LABEL[g] ?? g}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 desk:grid-cols-3 gap-3">
            {apps.map(app => {
              const versions = newestFirst(app.versions)
              const latest = versions[0]
              const file = mainFile(latest)
              const showAll = !!open[app.id]
              return (
                <div key={app.id} className="bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="text-3xl leading-none shrink-0">{app.icon}</div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{app.name}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{app.tagline}</p>
                      {app.like && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Like {app.like}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600 dark:text-gray-300">
                    <span className="font-mono">{latest.version}</span>
                    <SourceBadge source={latest.source} />
                    {file && <span className="text-gray-400 dark:text-gray-500">{fmtSize(file.sizeBytes)}</span>}
                  </div>

                  <div className="flex items-center gap-2 mt-auto">
                    {file && (
                      <button
                        onClick={() => download(file)}
                        disabled={busyKey === file.key}
                        className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-400 text-white text-sm font-semibold px-4 py-2.5 rounded-lg"
                      >
                        {busyKey === file.key ? "Preparing…" : "⬇ Download"}
                      </button>
                    )}
                    <button
                      onClick={() => setOpen(o => ({ ...o, [app.id]: !showAll }))}
                      className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white px-2 py-2.5"
                    >
                      {showAll ? "Hide versions" : `All versions (${versions.length})`}
                    </button>
                  </div>

                  {showAll && (
                    <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-3">
                      {versions.map(v => (
                        <div key={v.version} className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap text-xs">
                            <span className="font-mono text-gray-800 dark:text-gray-200">{v.version}</span>
                            <SourceBadge source={v.source} />
                          </div>
                          {v.notes && <p className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{v.notes}</p>}
                          {v.files.map(f => (
                            <div key={f.key} className="flex items-center justify-between gap-2 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
                              <div className="min-w-0">
                                <div className="font-mono text-gray-800 dark:text-gray-200 truncate">{f.name}</div>
                                <div className="text-gray-400 dark:text-gray-500">
                                  {fmtSize(f.sizeBytes)} · SHA-256 <span className="font-mono">{f.sha256.slice(0, 12)}…</span>{" "}
                                  <button onClick={() => copyHash(f)} className="text-cyan-700 dark:text-cyan-400 hover:underline">{copied === f.key ? "✓ copied" : "copy"}</button>
                                </div>
                              </div>
                              <button
                                onClick={() => download(f)}
                                disabled={busyKey === f.key}
                                className="shrink-0 text-cyan-700 dark:text-cyan-400 font-semibold hover:underline disabled:opacity-60 px-2 py-2"
                              >
                                {busyKey === f.key ? "Preparing…" : "Download"}
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
