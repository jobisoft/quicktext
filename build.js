const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");
const crypto = require("crypto");

// Git's blob object hash for a file's bytes: sha1("blob <len>\0" + content).
// The GitHub tree API reports this per file, so comparing it against the local
// copy tells us whether the bytes are identical without re-downloading.
function gitBlobSha(buf) {
  const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, buf])).digest("hex");
}

// Deep-merge `overlay` onto a clone of `base`: nested plain objects merge
// recursively, arrays are unioned, everything else is replaced by the overlay.
// `base` is never mutated, and its key order is preserved (overlay-only keys
// are appended), which keeps a merged manifest's diff clean.
//
// Unioning arrays is what lets `beta/manifest.json` ask for the one extra
// permission it needs (nativeMessaging) by naming only that. Replacing would
// mean restating the whole `permissions` list, and the copy would then silently
// fall behind every time src/manifest.json gained an entry.
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base, overlay) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (isPlainObject(out[k]) && isPlainObject(v)) out[k] = deepMerge(out[k], v);
    else if (Array.isArray(out[k]) && Array.isArray(v))
      out[k] = [...out[k], ...v.filter((item) => !out[k].includes(item))];
    else out[k] = v;
  }
  return out;
}

// Recursively list files under `root` as POSIX-style relative paths (empty if
// `root` is absent). Used to spot local files no longer present upstream.
function listFilesRec(root, base = root, out = []) {
  if (!fs.existsSync(base)) return out;
  for (const name of fs.readdirSync(base)) {
    const full = path.join(base, name);
    if (fs.statSync(full).isDirectory()) listFilesRec(root, full, out);
    else out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

// CRC-32 lookup table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * A file's modification time in the two 16-bit fields a zip entry carries.
 *
 * The date packs year-1980 in bits 15-9, the month in 8-5 and the day in
 * 4-0; the time packs hours in 15-11, minutes in 10-5 and two-second steps
 * in 4-0. Months and days count from one, so a zeroed field is not a date
 * that exists - readers disagree about what it means, and the ones that
 * guess print anything from 1979 to 2159.
 *
 * The range is 1980 to 2107 and nothing outside it is representable, so a
 * date below the floor is clamped to it rather than wrapped into a year the
 * format can hold but nobody meant.
 */
function dosDateTime(when) {
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  const year = d.getFullYear();
  if (year < 1980) return { date: (1 << 5) | 1, time: 0 };
  if (year > 2107) return { date: (127 << 9) | (12 << 5) | 31, time: (23 << 11) | (59 << 5) | 29 };
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

/**
 * Zip files/folders into destFile.
 * @param {string|string[]} sources - Paths to zip
 * @param {string} destFile - Output zip file
 * @param {string[]} [exclude=[]] - Optional array of folder/file paths to exclude (relative paths)
 * @param {Object<string,Buffer>} [overrides={}] - Map of POSIX rel-path to Buffer whose bytes
 *   replace the on-disk file when zipping (e.g. a per-variant manifest.json), leaving the working
 *   tree untouched.
 */
function zip(sources, destFile, exclude = [], overrides = {}) {
  const files = [];

  // Ensure parent directory exists
  const parentDir = path.dirname(destFile);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  function collect(full, rel) {
    // skip if rel matches any exclude pattern
    if (exclude.some(e => rel === e || rel.startsWith(e + "/"))) return;

    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) {
        collect(path.join(full, name), rel + "/" + name);
      }
    } else {
      files.push({ full, rel, mtime: stat.mtime });
    }
  }

  if (typeof sources === "string") {
    for (const name of fs.readdirSync(sources)) collect(path.join(sources, name), name);
  } else {
    for (const src of sources) collect(src, src);
  }

  // An override whose path was not collected has no file on disk under
  // `sources` - it is an overlay-only addition. Give it an entry of its own;
  // the read below takes its bytes from `overrides` and never touches `full`.
  for (const rel of Object.keys(overrides)) {
    if (!files.some((f) => f.rel === rel)) {
      files.push({ full: null, rel, mtime: new Date() });
    }
  }

  const parts = [];
  const centralDir = [];
  let offset = 0;

  for (const { full, rel, mtime } of files) {
    const stamp = dosDateTime(mtime);
    const data = overrides[rel] ?? fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const fileData = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const nameBytes = Buffer.from(rel, "utf8");

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(fileData.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    nameBytes.copy(local, 30);

    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(stamp.time, 12);
    cd.writeUInt16LE(stamp.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(fileData.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBytes.copy(cd, 46);

    parts.push(local, fileData);
    centralDir.push(cd);
    offset += local.length + fileData.length;
  }

  const cdBuf = Buffer.concat(centralDir);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(destFile, Buffer.concat([...parts, cdBuf, eocd]));
}

function rm(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "build-script" } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchJSON(url) {
  const buf = await get(url);
  return JSON.parse(buf.toString("utf8"));
}

// Root-level folder mirroring `src/`, applied on top of it for the beta and dev
// builds only (never the ATN build). A beta-only feature - here, the developer
// bridge - therefore lives entirely in `beta/` and cannot reach the ATN xpi.
// See collectOverlay for the merge rules.
const OVERLAY_DIR = "beta";

/**
 * Read the overlay folder into a map of `src/`-relative path -> bytes, ready to
 * hand to zip() as `overrides`.
 *
 *   *.json  - deep-merged onto its src/ counterpart when there is one, so an
 *             overlay file only has to carry what it changes: a manifest with
 *             just name + update_url + the extra permission. With no counterpart
 *             it is added whole.
 *   others  - added as-is, and only when src/ has no such file. A silent shadow
 *             is the one failure here that would be painful to track down later,
 *             so it is an error rather than a replace.
 *
 * Returns {} when the overlay folder is absent.
 */
function collectOverlay(overlayDir, srcDir) {
  const out = {};
  if (!fs.existsSync(overlayDir)) return out;

  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      // Running the Python helper from the overlay leaves one of these behind,
      // and it would then be packaged. Nothing else here is generated.
      if (name === "__pycache__") continue;
      const full = path.join(dir, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) {
        walk(full, childRel);
        continue;
      }
      const srcPath = path.join(srcDir, childRel);
      const shadows = fs.existsSync(srcPath);
      if (name.endsWith(".json")) {
        const overlay = JSON.parse(fs.readFileSync(full, "utf8"));
        const merged = shadows
          ? deepMerge(JSON.parse(fs.readFileSync(srcPath, "utf8")), overlay)
          : overlay;
        out[childRel] = Buffer.from(JSON.stringify(merged, null, 2) + "\n", "utf8");
      } else {
        if (shadows) {
          throw new Error(
            `${overlayDir}/${childRel} would replace ${srcDir}/${childRel}. ` +
            `The overlay may add files and merge JSON, but never shadow a source file.`
          );
        }
        out[childRel] = fs.readFileSync(full);
      }
    }
  }

  walk(overlayDir, "");
  return out;
}

async function main() {
  // `npm run build` emits all three XPIs into dist/:
  //   - quicktext_<v>_atn.xpi   ATN release: src/ as-is, no overlay.
  //   - quicktext_<v>_beta.xpi  GitHub beta: src/ + the beta/ overlay (adds
  //                             update_url, the "Beta" name, the bridge).
  //   - quicktext_dev.xpi       the beta build under a stable filename, its
  //                             add-on name stamped with the build time so you
  //                             can see which build actually reloaded.
  const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
  manifest.version = version;
  fs.writeFileSync("src/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Set manifest version to ${version}`);

  console.log("Cleaning output directory (dist) ...");
  rm("dist");

  console.log("Fetching latest vfs-client from GitHub ...");
  const repoPath = "modules/vfs-toolkit/vfs-client";
  const commits = await fetchJSON(
    `https://api.github.com/repos/thunderbird/webext-support/commits?path=${repoPath}&per_page=1`
  );
  const sha = commits[0].sha;
  console.log(`  Latest commit: ${sha}`);

  // Use the Git tree API to list all files in the folder at this commit
  const treeUrl = `https://api.github.com/repos/thunderbird/webext-support/git/trees/${sha}?recursive=1`;
  const tree = await fetchJSON(treeUrl);
  const prefix = repoPath + "/";
  const clientFiles = tree.tree.filter(f => f.type === "blob" && f.path.startsWith(prefix));

  console.log(`  Found ${clientFiles.length} files.`);
  const destRoot = "src/vendor/vfs-client";
  const wanted = new Set(clientFiles.map(f => f.path.slice(prefix.length)));

  // Drop local files that are no longer part of the upstream tree (upstream
  // deletions), without disturbing the files that are still current.
  for (const rel of listFilesRec(destRoot)) {
    if (!wanted.has(rel)) {
      console.log(`  Removing stale ${rel} ...`);
      fs.rmSync(path.join(destRoot, rel));
    }
  }

  // Fetch only files whose bytes differ from the local copy: git's blob hash of
  // the local file (file.sha from the tree API) is our identity check, so an
  // unchanged file is left untouched (no network, no rewrite).
  let fetched = 0;
  let unchanged = 0;
  for (const file of clientFiles) {
    const relativePath = file.path.slice(prefix.length);
    const dest = path.join(destRoot, relativePath);
    if (fs.existsSync(dest) && gitBlobSha(fs.readFileSync(dest)) === file.sha) {
      unchanged++;
      continue;
    }
    const rawUrl = `https://github.com/thunderbird/webext-support/raw/${sha}/${file.path}`;
    console.log(`  Fetching ${relativePath} ...`);
    const buf = await get(rawUrl);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    fetched++;
  }
  console.log(`  ${fetched} fetched, ${unchanged} unchanged (kept local copy).`);

  // Update VENDOR.md — replace the vfs-clientkit upstream URL with the new commit hash
  const vendorMdPath = "src/VENDOR.md";
  let vendorMd = fs.readFileSync(vendorMdPath, "utf8");
  const newTreeUrl = `https://github.com/thunderbird/webext-support/tree/${sha}/${repoPath}`;
  vendorMd = vendorMd.replace(
    /^(## vfs-client\n[\s\S]*?- \*\*Upstream\*\* : )https:\/\/github\.com\/thunderbird\/webext-support\/tree\/[0-9a-f]+\/modules\/vfs-toolkit\/vfs-client$/m,
    `$1${newTreeUrl}`
  );
  fs.writeFileSync(vendorMdPath, vendorMd);
  console.log(`  Updated VENDOR.md with commit ${sha}`);

  const overlay = collectOverlay(OVERLAY_DIR, "src");
  const overlayCount = Object.keys(overlay).length;

  const xpiVersion = version.replace(/\./g, "_");

  // ATN build: the on-disk manifest as-is (no update_url, plain name), no
  // overlay. The bridge lives entirely in beta/, so it is absent here.
  const atnName = `quicktext_${xpiVersion}_atn.xpi`;
  console.log(`Creating ATN extension file (dist/${atnName}) ...`);
  zip("src", `dist/${atnName}`);

  // GitHub build (the beta release): src/ with the beta/ overlay applied. At
  // minimum that is beta/manifest.json (update_url + the "Beta" name +
  // nativeMessaging); the rest of the overlay is the bridge, beta-only by
  // construction.
  if (!overlay["manifest.json"]) {
    throw new Error(`Missing ${OVERLAY_DIR}/manifest.json, required for the beta XPI.`);
  }
  const betaName = `quicktext_${xpiVersion}_beta.xpi`;
  console.log(
    `Creating beta (GitHub) extension file (dist/${betaName}), ` +
    `${overlayCount} overlay file(s) ...`
  );
  zip("src", `dist/${betaName}`, [], overlay);

  // The dev build: the beta overlay under a filename that never changes
  // (dist/quicktext_dev.xpi), so a reload resolves the same path across version
  // bumps - which is what a reload during development needs.
  //
  // Its add-on name keeps the beta manifest's name and appends the build time,
  // because the version alone cannot say which build is loaded: two builds
  // minutes apart share a version, and an add-on that failed to reload looks
  // exactly like one that did. The Add-ons Manager shows this name, so the
  // answer is visible without unpacking anything. Local time, not UTC: this is
  // read next to a wall clock, to answer "is the add-on running what I just
  // built?".
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const devOverlay = { ...overlay };
  const devManifest = JSON.parse(devOverlay["manifest.json"].toString("utf8"));
  devManifest.name = `${devManifest.name} (dev ${stamp})`;
  devOverlay["manifest.json"] = Buffer.from(
    JSON.stringify(devManifest, null, 2) + "\n",
    "utf8"
  );
  console.log(`Creating dev extension file (dist/quicktext_dev.xpi) — "${devManifest.name}" ...`);
  zip("src", "dist/quicktext_dev.xpi", [], devOverlay);

  console.log("Build finished. Output is in the 'dist' folder.");
  https.globalAgent.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
