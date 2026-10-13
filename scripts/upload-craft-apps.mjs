// Publish the Craft app installers to the Hub's R2 bucket for IT Tools → Craft Apps.
//
//   node scripts/upload-craft-apps.mjs [--suite "C:\Dev apps\artcraft-suite"] [--dry-run]
//
// Why this exists (Jordan, 2026-10-13): the Craft App Suite (clean-room Office/Adobe-style apps from
// storytold) must stay installable even if GitHub takes the projects down. The source is cloned and
// built on the office PC; this script copies the resulting installers — plus the official releases as
// a fallback — into OUR storage, and IT Tools → Craft Apps serves them from there. Nothing in the Hub
// ever links to GitHub for these.
//
// What it reads (all on the PC that built them):
//   <suite>\ArtCraft Suite Kit\mirror\<app>\<version>\   the 12 launcher-managed apps: every version
//                                                        folder (official x.y.z and built x.y.z-dev.*)
//   <suite>\craft-installers\figcraft-*.msi              FigCraft official (not in the launcher's list)
//   <suite>\craft-installers\artcraft-launcher-*.msi     the official launcher
//   <suite>\craft-launcher-local\dist\*                  the launcher built here (offline-kit feature)
//   <suite>\artcraft\target\release\bundle\nsis\*.exe    ArtCraft built here (no login screen)
//
// What it writes to R2 (bucket from .env — ⚠ the LIVE shared bucket):
//   craft-apps/<app>/<version>/<file>      the installers, content-addressed by name
//   craft-apps/bundles/<bundle>.zip        "Download all": one zip of every Vectis build, one of every
//                                          official release (each app's newest installer of that kind,
//                                          plus SHA256SUMS.txt and a README), stored uncompressed
//   craft-apps/manifest.json               what the Hub page lists: apps, versions, files, bundles,
//                                          sizes, SHA-256
//
// Safe to run again: a file already in the bucket with the same size is skipped; a bundle is rebuilt
// and re-uploaded only when the set of installers inside it has changed (its fingerprint is kept in
// the manifest); the manifest is always rewritten from what is on disk, so a rebuilt app shows up
// after the next run. Every file is hashed here (SHA-256) and the hash is shown on the page so a
// download can be checked.
// Progress is one line per file with its size (design rule 7b); Ctrl+C stops it between files.

import "dotenv/config"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import JSZip from "jszip"

const PREFIX = "craft-apps"
const MAX_FILE_BYTES = 1_000_000_000

// The two "Download all" zips. Each holds every app's NEWEST installer of that kind.
const BUNDLES = [
  { id: "built",    fileName: "craft-apps-vectis-builds.zip",     label: "All Vectis builds",     source: "built" },
  { id: "official", fileName: "craft-apps-official-releases.zip", label: "All official releases", source: "official" },
]

// Display metadata the page shows. Order here is the order on the page.
const APPS = [
  { id: "photocraft",   name: "PhotoCraft",   icon: "🖼️", group: "Creative", tagline: "Image editing",                           like: "Adobe Photoshop" },
  { id: "vectorcraft",  name: "VectorCraft",  icon: "✒️", group: "Creative", tagline: "Vector illustration",                     like: "Adobe Illustrator" },
  { id: "filmcraft",    name: "FilmCraft",    icon: "🎬", group: "Creative", tagline: "Video editing, colour and sound",         like: "Adobe Premiere Pro" },
  { id: "lightcraft",   name: "LightCraft",   icon: "📷", group: "Creative", tagline: "Photo library and raw development",       like: "Adobe Lightroom" },
  { id: "pdfcraft",     name: "PdfCraft",     icon: "📄", group: "Creative", tagline: "Reading, organising and protecting PDFs", like: "Adobe Acrobat" },
  { id: "effectcraft",  name: "EffectCraft",  icon: "✨", group: "Creative", tagline: "Motion graphics and visual effects",      like: "Adobe After Effects" },
  { id: "designcraft",  name: "DesignCraft",  icon: "📐", group: "Creative", tagline: "Page layout and publishing",              like: "Adobe InDesign" },
  { id: "figcraft",     name: "FigCraft",     icon: "🎨", group: "Creative", tagline: "Interface design and prototyping",        like: "Figma" },
  { id: "wordcraft",    name: "WordCraft",    icon: "📝", group: "Office",   tagline: "Writing and document design",             like: "Microsoft Word" },
  { id: "deckcraft",    name: "DeckCraft",    icon: "📊", group: "Office",   tagline: "Presentations and slide shows",           like: "Microsoft PowerPoint" },
  { id: "gridcraft",    name: "GridCraft",    icon: "🧮", group: "Office",   tagline: "Spreadsheets and data",                   like: "Microsoft Excel" },
  { id: "cadcraft",     name: "CADCraft",     icon: "📏", group: "Office",   tagline: "Computer-aided design and drafting",      like: "Autodesk AutoCAD" },
  { id: "soundcraft",   name: "SoundCraft",   icon: "🎧", group: "Office",   tagline: "Recording, editing and mixing audio",     like: "Avid Pro Tools" },
  { id: "artcraft-launcher", name: "ArtCraft Launcher", icon: "🚀", group: "Suite", tagline: "Installs, updates and opens every Craft app from one window", like: "" },
  { id: "artcraft",     name: "ArtCraft",     icon: "🧠", group: "Suite",    tagline: "AI image and video creation — the Vectis build opens without a login screen", like: "" },
]

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const suiteArg = args.indexOf("--suite")
const SUITE = suiteArg >= 0 ? args[suiteArg + 1] : "C:\\Dev apps\\artcraft-suite"

const bucket = process.env.CLOUDFLARE_R2_BUCKET
if (!bucket || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || !process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
  console.error("Missing CLOUDFLARE_* settings in .env — run this from the vectis-hub folder.")
  process.exit(1)
}
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY },
})

const isDir = async (p) => { try { return (await stat(p)).isDirectory() } catch { return false } }
const isFile = async (p) => { try { return (await stat(p)).isFile() } catch { return false } }
const fmtSize = (b) => b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`
const safeName = (s) => /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(s)
// A built-here version carries the build stamp (0.8.3-dev.20261013070634 from `cargo xtask local
// sync --every-commit`), or a -vectis tag for the two we package by hand.
const sourceOf = (version) => /-(dev|vectis)[.-]/.test(version) || /-vectis$/.test(version) ? "built" : "official"
const contentTypeOf = (name) => name.endsWith(".zip") ? "application/zip" : "application/octet-stream"
// The installer itself (MSI/EXE), not the portable zip.
const isInstaller = (name) => /\.(msi|exe)$/i.test(name)

// x.y.z then the pre-release tag; a -dev.<stamp> build is one patch above its official release.
const parseVersion = (v) => {
  const [core, pre = ""] = v.split("-", 2)
  const n = core.split(".").map(x => parseInt(x, 10) || 0)
  return { n: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], pre }
}
const compareVersions = (a, b) => {
  const x = parseVersion(a), y = parseVersion(b)
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i]
  return x.pre.localeCompare(y.pre)
}

async function sha256(file) {
  const hash = createHash("sha256")
  await new Promise((resolve, reject) => createReadStream(file).on("data", c => hash.update(c)).on("end", resolve).on("error", reject))
  return hash.digest("hex")
}

/** The manifest the bucket holds now, so unchanged bundles need not be rebuilt. */
async function previousManifest() {
  try {
    const res = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: `${PREFIX}/manifest.json` }))
    return JSON.parse(Buffer.from(await res.Body.transformToByteArray()).toString("utf8"))
  } catch { return null }
}

/** A zip at `zipPath` holding `entries` ([{ name, path }]) uncompressed, plus SHA256SUMS.txt and a README. */
async function writeBundleZip(zipPath, entries, sums, readme) {
  const zip = new JSZip()
  for (const e of entries) zip.file(e.name, createReadStream(e.path), { compression: "STORE" })
  zip.file("SHA256SUMS.txt", sums)
  zip.file("README.txt", readme)
  await new Promise((resolve, reject) => {
    zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "STORE" })
      .pipe(createWriteStream(zipPath))
      .on("finish", resolve)
      .on("error", reject)
  })
}

/** Build (if changed) and upload the two "Download all" zips; the manifest's `bundles` entries. */
async function publishBundles(apps, previous) {
  const out = []
  const tmp = dryRun ? null : await mkdtemp(path.join(os.tmpdir(), "craft-bundles-"))
  try {
    for (const b of BUNDLES) {
      // Each app's newest version of this kind, and that version's installer.
      const picks = []
      for (const app of apps) {
        const vs = app.versions.filter(v => v.source === b.source).sort((x, y) => compareVersions(y.version, x.version))
        const file = vs[0]?.files.find(f => isInstaller(f.name))
        if (file) picks.push({ app, version: vs[0], file })
      }
      if (picks.length === 0) continue
      const fingerprint = createHash("sha256").update(picks.map(p => `${p.file.key}:${p.file.sha256}`).sort().join("\n")).digest("hex")
      const key = `${PREFIX}/bundles/${b.fileName}`
      const kept = previous?.bundles?.find(x => x.id === b.id)
      process.stdout.write(`bundle ${b.fileName}  ${picks.length} installers  `)
      if (dryRun) {
        console.log("(dry run)")
        out.push({ id: b.id, label: b.label, key, fileName: b.fileName, sizeBytes: picks.reduce((n, p) => n + p.file.sizeBytes, 0), sha256: "", fileCount: picks.length, fingerprint })
        continue
      }
      if (kept?.fingerprint === fingerprint && await existsWithSize(key, kept.sizeBytes)) {
        console.log("unchanged")
        out.push({ ...kept, label: b.label, key })
        continue
      }
      const zipPath = path.join(tmp, b.fileName)
      const sums = picks.map(p => `${p.file.sha256}  ${p.file.name}`).join("\n") + "\n"
      const readme = [
        `${b.label} — Craft App Suite installers from the Vectis Hub (IT Tools → Craft Apps)`,
        `Made ${new Date().toISOString()}`, "",
        "Run each installer; it asks for admin rights and the app appears in the Start Menu.",
        "Check a file against SHA256SUMS.txt with:  certutil -hashfile <file> SHA256", "",
        ...picks.map(p => `${p.app.name.padEnd(18)} ${p.version.version.padEnd(32)} ${p.file.name}`),
      ].join("\r\n") + "\r\n"
      process.stdout.write("zipping… ")
      await writeBundleZip(zipPath, picks.map(p => ({ name: p.file.name, path: p.file.path })), sums, readme)
      const size = (await stat(zipPath)).size
      const hash = await sha256(zipPath)
      process.stdout.write(`${fmtSize(size)} uploading… `)
      await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(zipPath), ContentType: "application/zip", ContentLength: size }))
      console.log("uploaded")
      out.push({ id: b.id, label: b.label, key, fileName: b.fileName, sizeBytes: size, sha256: hash, fileCount: picks.length, fingerprint })
    }
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
  return out
}

/** One version folder → { version, files: [{ name, path }], notes }. */
async function versionFromFolder(dir, version) {
  const names = (await readdir(dir)).filter(n => !n.startsWith(".") && n !== "SHA256SUMS.txt" && n !== "NOTES.md")
  const files = []
  for (const name of names.sort()) {
    const p = path.join(dir, name)
    if (await isFile(p) && safeName(name) && /\.(msi|exe|zip)$/i.test(name)) files.push({ name, path: p })
  }
  let notes = ""
  try { notes = (await readFile(path.join(dir, "NOTES.md"), "utf8")).trim() } catch {}
  return { version, files, notes }
}

/** Every app's versions, from the places listed at the top. */
async function collect() {
  const mirror = path.join(SUITE, "ArtCraft Suite Kit", "mirror")
  const installers = path.join(SUITE, "craft-installers")
  const out = []
  for (const app of APPS) {
    const versions = []
    const appDir = path.join(mirror, app.id)
    if (await isDir(appDir)) {
      for (const v of (await readdir(appDir)).sort()) {
        const vd = path.join(appDir, v)
        if (!(await isDir(vd)) || !(await isFile(path.join(vd, ".complete")))) continue
        versions.push(await versionFromFolder(vd, v))
      }
    }
    if (app.id === "figcraft" || app.id === "artcraft-launcher") {
      for (const name of await readdir(installers)) {
        const m = name.match(new RegExp(`^${app.id}-(.+)-windows-x64\\.msi$`))
        if (m) versions.push({ version: m[1], files: [{ name, path: path.join(installers, name) }], notes: `Official release ${m[1]} from github.com/storytold/${app.id === "artcraft-launcher" ? "craft-launcher" : app.id}.` })
      }
    }
    if (app.id === "artcraft-launcher") {
      const dist = path.join(SUITE, "craft-launcher-local", "dist")
      if (await isDir(dist)) {
        const files = []
        let version = null
        for (const name of (await readdir(dist)).sort()) {
          const m = name.match(/^artcraft-launcher-(.+?)-windows-x64(-portable\.zip|\.msi)$/)
          if (!m) continue
          version ??= `${m[1]}-vectis`
          files.push({ name, path: path.join(dist, name) })
        }
        if (version) versions.push({ version, files, notes: "Built by Vectis from source with the offline-kit feature: with a `mirror` folder beside it, it installs the apps from that folder and never contacts GitHub." })
      }
    }
    if (app.id === "artcraft") {
      const nsis = path.join(SUITE, "artcraft", "target", "release", "bundle", "nsis")
      if (await isDir(nsis)) {
        for (const name of (await readdir(nsis)).sort()) {
          const m = name.match(/^ArtCraft_(.+)_x64-setup\.exe$/)
          if (m) versions.push({ version: `${m[1]}-vectis`, files: [{ name, path: path.join(nsis, name) }], notes: "Built by Vectis from source. The sign-in screen no longer appears at start-up; Login / Sign Up in the top bar still works if you need credits." })
        }
      }
    }
    out.push({ ...app, versions })
  }
  return out
}

async function existsWithSize(key, size) {
  try {
    const head = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return head.ContentLength === size
  } catch { return false }
}

async function main() {
  const apps = await collect()
  const plan = []
  for (const app of apps) for (const v of app.versions) for (const f of v.files) plan.push({ app, v, f })
  if (plan.length === 0) { console.error(`Nothing found under ${SUITE}`); process.exit(1) }
  console.log(`${plan.length} files from ${apps.filter(a => a.versions.length).length} apps${dryRun ? " (dry run — nothing uploaded)" : ""}`)

  let uploaded = 0, skipped = 0, done = 0
  const manifest = { generatedAt: new Date().toISOString(), apps: [] }
  for (const app of apps) {
    const versions = []
    for (const v of app.versions) {
      const files = []
      for (const f of v.files) {
        const size = (await stat(f.path)).size
        if (size > MAX_FILE_BYTES) throw new Error(`${f.name} is ${fmtSize(size)}: over the ${fmtSize(MAX_FILE_BYTES)} limit`)
        const key = `${PREFIX}/${app.id}/${v.version}/${f.name}`
        process.stdout.write(`[${++done}/${plan.length}] ${key}  ${fmtSize(size)}  `)
        const hash = await sha256(f.path)
        if (dryRun) {
          console.log("(dry run)")
        } else if (await existsWithSize(key, size)) {
          console.log("already there")
          skipped++
        } else {
          await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(f.path), ContentType: contentTypeOf(f.name), ContentLength: size }))
          console.log("uploaded")
          uploaded++
        }
        files.push({ name: f.name, key, sizeBytes: size, sha256: hash, path: f.path })
      }
      versions.push({ version: v.version, source: sourceOf(v.version), notes: v.notes, files })
    }
    if (versions.length) manifest.apps.push({ id: app.id, name: app.name, icon: app.icon, group: app.group, tagline: app.tagline, like: app.like, versions })
  }

  manifest.bundles = await publishBundles(manifest.apps, await previousManifest())
  // The local paths were only for zipping; the manifest the Hub reads must not carry them.
  for (const app of manifest.apps) for (const v of app.versions) for (const f of v.files) delete f.path

  const key = `${PREFIX}/manifest.json`
  if (dryRun) {
    console.log(`\n(dry run) manifest would list ${manifest.apps.length} apps and ${manifest.bundles.length} bundles`)
  } else {
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(manifest, null, 2), ContentType: "application/json" }))
    console.log(`\nmanifest written: ${key} (${manifest.apps.length} apps)`)
  }
  console.log(`uploaded ${uploaded}, already there ${skipped}`)
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
