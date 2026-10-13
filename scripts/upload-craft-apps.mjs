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
//   craft-apps/manifest.json               what the Hub page lists: apps, versions, files, sizes, SHA-256
//
// Safe to run again: a file already in the bucket with the same size is skipped; the manifest is always
// rewritten from what is on disk, so a rebuilt app shows up after the next run. Every file is hashed
// here (SHA-256) and the hash is shown on the page so a download can be checked.
// Progress is one line per file with its size (design rule 7b); Ctrl+C stops it between files.

import "dotenv/config"
import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const PREFIX = "craft-apps"
const MAX_FILE_BYTES = 1_000_000_000

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

async function sha256(file) {
  const hash = createHash("sha256")
  hash.update(await readFile(file))
  return hash.digest("hex")
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
        files.push({ name: f.name, key, sizeBytes: size, sha256: hash })
      }
      versions.push({ version: v.version, source: sourceOf(v.version), notes: v.notes, files })
    }
    if (versions.length) manifest.apps.push({ id: app.id, name: app.name, icon: app.icon, group: app.group, tagline: app.tagline, like: app.like, versions })
  }

  const key = `${PREFIX}/manifest.json`
  if (dryRun) {
    console.log(`\n(dry run) manifest would list ${manifest.apps.length} apps`)
  } else {
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(manifest, null, 2), ContentType: "application/json" }))
    console.log(`\nmanifest written: ${key} (${manifest.apps.length} apps)`)
  }
  console.log(`uploaded ${uploaded}, already there ${skipped}`)
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
