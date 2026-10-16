// Builds www/ (the app's own tiny web folder) from web/, filling in which Hub this build talks to.
//
// Runs by itself before every `cap copy` / `cap sync` (the "capacitor:copy:before" script in
// package.json), so the offline page always matches the HUB_URL the sync was run with. www/ is
// generated — don't edit it, edit web/.
//
// The Hub's address comes from the config the Capacitor CLI has just loaded (it passes it to the
// hook as CAPACITOR_CONFIG), so it is exactly the server.url the app will open.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "web");
const out = join(root, "www");

function fail(message) {
  console.error(`\n[build-web] ${message}\n`);
  process.exit(1);
}

const hubs = JSON.parse(readFileSync(join(root, "hubs.json"), "utf8"));

let url = "";
try {
  const cfg = JSON.parse(process.env.CAPACITOR_CONFIG || "{}");
  url = (cfg && cfg.server && typeof cfg.server.url === "string" && cfg.server.url) || "";
} catch {
  url = "";
}
if (!url) url = (process.env.HUB_URL || "").trim() || hubs.production.url;

let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(`"${url}" isn't a web address.`);
}
if (parsed.protocol !== "https:") fail(`The Hub address must be https:// (got "${url}").`);
const origin = parsed.origin;

const known = Object.entries(hubs).find(([, h]) => new URL(h.url).origin === origin);
const hub = known
  ? { url: origin, label: known[0], name: known[1].appName }
  : { url: origin, label: "custom", name: `Vectis Scanner (${parsed.host})` };

// JSON inside a <script>: escape "<" so nothing in it can close the script tag.
const hubJson = JSON.stringify(hub).replace(/</g, "\\u003c");

if (!existsSync(src)) fail(`Missing ${src}.`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function build(from, to) {
  for (const name of readdirSync(from)) {
    const a = join(from, name);
    const b = join(to, name);
    if (statSync(a).isDirectory()) {
      mkdirSync(b, { recursive: true });
      build(a, b);
    } else if (extname(name).toLowerCase() === ".html") {
      const text = readFileSync(a, "utf8").split("__HUB__").join(hubJson);
      if (text.includes("__HUB__")) fail(`${name}: placeholder left after filling it in.`);
      writeFileSync(b, text, "utf8");
    } else {
      cpSync(a, b);
    }
  }
}
build(src, out);

if (!existsSync(join(out, "offline.html"))) fail("www/offline.html wasn't made — the app needs it.");
console.log(`[build-web] www/ built for ${hub.name} → ${hub.url}`);
