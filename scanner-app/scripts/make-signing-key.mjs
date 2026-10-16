// Makes Vectis Scanner's signing key — ONCE — and hands it to GitHub so it can sign the APKs.
//
//   cd scanner-app
//   npm install
//   node scripts/make-signing-key.mjs
//
// Every update of the app must be signed with the SAME key, or Android refuses to install it over
// the old one (you'd have to uninstall first, which throws away scans waiting to send). So:
//   * this makes an RSA-2048 PKCS12 keystore with a long random password;
//   * saves it, and a "KEEP THIS SAFE" note of its passwords, in
//       %USERPROFILE%\Documents\Vectis Scanner signing key\   (never inside the repo);
//   * then tries to store it as the four GitHub Actions secrets the build reads
//       SCANNER_KEYSTORE_BASE64, SCANNER_KEYSTORE_PASSWORD, SCANNER_KEY_ALIAS, SCANNER_KEY_PASSWORD
//     with the GitHub CLI (gh). The values go to gh on its input, never on the command line, and
//     nothing secret is ever printed here. If gh can't (not installed, not signed in, or not allowed
//     to set secrets on the repo), it says exactly what Jordan needs to do instead.
//
// It refuses to run again once a key exists — a second key would orphan every installed app.
//
// Options (rarely needed):
//   --upload-only   don't make a key: send the existing one to GitHub again (e.g. after Jordan has
//                   signed gh in on this PC as himself).
//   --repo owner/name   a different GitHub repository (default Jordan-Vectis/vectis-hub).
//   --out <folder>      save somewhere other than Documents (must be outside the repo).
//   --no-github         make and save the key only.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAMES = ["SCANNER_KEYSTORE_BASE64", "SCANNER_KEYSTORE_PASSWORD", "SCANNER_KEY_ALIAS", "SCANNER_KEY_PASSWORD"];
const KEY_ALIAS = "vectis-scanner";
const KEYSTORE_FILE = "vectis-scanner-signing-key.p12";
const BASE64_FILE = "SCANNER_KEYSTORE_BASE64.txt";
const SAFE_FILE = "KEEP THIS SAFE - Vectis Scanner signing key.txt";

// ---- arguments --------------------------------------------------------------------------------

const args = process.argv.slice(2);
function option(name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) stop(`${name} needs a value.`);
  return value;
}
const uploadOnly = args.includes("--upload-only");
const noGithub = args.includes("--no-github");
const repo = option("--repo") || "Jordan-Vectis/vectis-hub";
const outDir = resolve(option("--out") || join(homedir(), "Documents", "Vectis Scanner signing key"));

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) stop(`"${repo}" isn't a GitHub repository name (owner/name).`);

// Never inside the repository (or any git checkout), where it could be committed by accident.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = relative(repoRoot, outDir);
if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
  stop(`Refusing to save the signing key inside the repository (${outDir}). Choose a folder outside it.`);
}
for (let d = outDir; ; d = dirname(d)) {
  if (existsSync(join(d, ".git"))) stop(`Refusing to save the signing key inside a git checkout (${d}).`);
  if (dirname(d) === d) break;
}

const keystorePath = join(outDir, KEYSTORE_FILE);
const base64Path = join(outDir, BASE64_FILE);
const safePath = join(outDir, SAFE_FILE);

// ---- make the key -----------------------------------------------------------------------------

async function makeKey() {
  if (existsSync(keystorePath)) {
    stop(
      [
        `A Vectis Scanner signing key already exists:`,
        `  ${keystorePath}`,
        ``,
        `It is only ever made once — making another would stop updates installing over the app`,
        `already on the scanners. To send the existing key to GitHub again, run:`,
        `  node scripts/make-signing-key.mjs --upload-only`,
      ].join("\n"),
    );
  }

  let forge;
  try {
    forge = (await import("node-forge")).default;
  } catch {
    stop("node-forge isn't installed. Run `npm install` in the scanner-app folder first.");
  }

  console.log("Making the signing key (RSA-2048)…");
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + randomBytes(15).toString("hex"); // positive, random
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime());
  cert.validity.notAfter.setFullYear(now.getFullYear() + 30); // Android wants it valid for the app's lifetime
  const name = [
    { name: "commonName", value: "Vectis Scanner" },
    { name: "organizationName", value: "Vectis Auctions" },
    { name: "countryName", value: "GB" },
  ];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([{ name: "subjectKeyIdentifier" }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // PKCS12 has one password for the store and the key, so both secrets get the same value.
  const password = randomBytes(24).toString("base64url"); // 32 characters, letters/digits/-/_
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: "3des", // read by every Java / Android build tool version
    friendlyName: KEY_ALIAS, // the alias Java sees
    generateLocalKeyId: true,
    count: 10000,
  });
  const der = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");

  // Read it back before trusting it.
  const check = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der.toString("binary")), password);
  const keyBags = check.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const certBags = check.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (keyBags.length !== 1 || certBags.length !== 1 || !keyBags[0].key) {
    stop("The keystore didn't read back correctly — nothing was saved. Please try again.");
  }

  const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");
  const fingerprint = createHash("sha256")
    .update(certDer)
    .digest("hex")
    .toUpperCase()
    .match(/../g)
    .join(":");

  mkdirSync(outDir, { recursive: true });
  writeFileSync(keystorePath, der, { flag: "wx" });
  writeFileSync(base64Path, der.toString("base64") + "\n", { flag: "wx" });
  writeFileSync(
    safePath,
    [
      "VECTIS SCANNER SIGNING KEY — KEEP THIS SAFE",
      "============================================",
      "",
      "This folder holds the key that signs the Vectis Scanner Android app. Every update must be",
      "signed with this same key, or the scanners refuse to install it over the app they have.",
      "",
      "  * Keep a copy somewhere safe and private (e.g. the IT password manager). Don't email it,",
      "    don't put it in Teams/Slack, and never put it in the code repository.",
      "  * If it is lost, a new key can be made, but every scanner must then have the app",
      "    uninstalled and installed again (scans waiting to send on a scanner would be lost).",
      "",
      `Made: ${now.toISOString()}`,
      `Keystore file: ${KEYSTORE_FILE} (PKCS12)`,
      `Certificate SHA-256 fingerprint: ${fingerprint}`,
      "",
      "GitHub Actions secrets (repository Settings > Secrets and variables > Actions):",
      `  SCANNER_KEYSTORE_BASE64 = the whole contents of ${BASE64_FILE}`,
      `SCANNER_KEYSTORE_PASSWORD = ${password}`,
      `SCANNER_KEY_ALIAS = ${KEY_ALIAS}`,
      `SCANNER_KEY_PASSWORD = ${password}`,
      "",
    ].join("\r\n"),
    { flag: "wx" },
  );

  console.log(`Saved in ${outDir}`);
  console.log(`  ${KEYSTORE_FILE}`);
  console.log(`  ${BASE64_FILE}`);
  console.log(`  ${SAFE_FILE}`);
  console.log(`Certificate fingerprint (SHA-256): ${fingerprint}`);
  return { base64: der.toString("base64"), password, alias: KEY_ALIAS };
}

function readExisting() {
  if (!existsSync(keystorePath) || !existsSync(safePath)) {
    stop(`No signing key found in ${outDir}. Run this without --upload-only to make one.`);
  }
  const note = readFileSync(safePath, "utf8");
  const value = (name) => {
    const m = note.match(new RegExp(`^${name} = (.+)$`, "m"));
    return m ? m[1].trim() : "";
  };
  const password = value("SCANNER_KEYSTORE_PASSWORD");
  const keyPassword = value("SCANNER_KEY_PASSWORD");
  const alias = value("SCANNER_KEY_ALIAS");
  if (!password || !keyPassword || !alias) stop(`Couldn't read the passwords from "${SAFE_FILE}".`);
  return { base64: readFileSync(keystorePath).toString("base64"), password, keyPassword, alias };
}

// ---- send it to GitHub ------------------------------------------------------------------------

function gh(argv, input) {
  return spawnSync("gh", argv, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function jordanSteps(reason) {
  console.log(
    [
      "",
      "----------------------------------------------------------------------------------------",
      `The key is saved, but it isn't on GitHub yet: ${reason}`,
      "",
      "Until it is, the GitHub build still makes APKs, but signs them with a throwaway key, so",
      "each new build can't be installed over the last one.",
      "",
      `What Jordan needs to do (only the owner/an admin of ${repo} can set its secrets):`,
      "",
      "  Either, on this PC:",
      "    1. In a terminal:  gh auth login        (sign in as Jordan)",
      "    2. Then, in the scanner-app folder:  node scripts/make-signing-key.mjs --upload-only",
      "",
      "  Or, on github.com:",
      `    1. Open https://github.com/${repo}/settings/secrets/actions`,
      "    2. Press \"New repository secret\" four times, adding:",
      `         SCANNER_KEYSTORE_BASE64    — paste the whole of ${BASE64_FILE}`,
      `         SCANNER_KEYSTORE_PASSWORD  — from "${SAFE_FILE}"`,
      `         SCANNER_KEY_ALIAS          — from "${SAFE_FILE}"`,
      `         SCANNER_KEY_PASSWORD       — from "${SAFE_FILE}"`,
      `       (both files are in ${outDir} — hand them over in person or through the password`,
      "       manager, never by email or chat).",
      "",
      "Then build again on GitHub to get signed APKs: Actions tab -> \"Scanner app\" -> Run workflow",
      "(that button appears once the workflow is on main; until then open the latest run and press",
      "\"Re-run all jobs\", or push a change under scanner-app/ to staging).",
      "----------------------------------------------------------------------------------------",
    ].join("\n"),
  );
}

function sendToGithub(values) {
  const version = gh(["--version"]);
  if (version.error || version.status !== 0) {
    jordanSteps("the GitHub CLI (gh) isn't installed on this PC.");
    return false;
  }
  const status = gh(["auth", "status"]);
  if (status.status !== 0) {
    jordanSteps("the GitHub CLI isn't signed in on this PC (`gh auth login`).");
    return false;
  }

  const secrets = {
    SCANNER_KEYSTORE_BASE64: values.base64,
    SCANNER_KEYSTORE_PASSWORD: values.password,
    SCANNER_KEY_ALIAS: values.alias,
    SCANNER_KEY_PASSWORD: values.keyPassword || values.password,
  };
  console.log(`\nStoring the key as GitHub Actions secrets on ${repo}…`);
  for (const name of SECRET_NAMES) {
    // No --body: gh reads the value from its input, so it never appears in a command line or log.
    const r = gh(["secret", "set", name, "--repo", repo], secrets[name]);
    if (r.error || r.status !== 0) {
      const said = String(r.stderr || (r.error && r.error.message) || "").trim().split(/\r?\n/)[0] || "no reason given";
      console.log(`  ${name}: not stored (${said})`);
      jordanSteps(`GitHub refused to store ${name} for this gh sign-in — most likely it doesn't have admin rights on ${repo}.`);
      return false;
    }
    console.log(`  ${name}: stored`);
  }
  console.log("\nDone. The next \"Scanner app\" build on GitHub will sign the APKs with this key.");
  return true;
}

// ---- run --------------------------------------------------------------------------------------

const values = uploadOnly ? readExisting() : await makeKey();
if (noGithub) {
  console.log("\nNot sent to GitHub (--no-github).");
} else {
  sendToGithub(values);
}
console.log(`\nKeep "${outDir}" safe — see "${SAFE_FILE}".`);
