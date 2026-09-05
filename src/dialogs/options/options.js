import * as utils from "/modules/utils.mjs";
import * as storage from "/modules/storage.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();
  document.getElementById("open-settings").addEventListener("click", () =>
    utils.openSettingsDialog()
  );

  const chkRemoteRequests = document.getElementById("chk-remote-requests");
  const { value, isManaged } = await storage.getPrefWithManagedInfo("allowRemoteRequests");
  chkRemoteRequests.checked = value;
  // Same affordance as the manager: a policy-controlled pref is still shown,
  // but cannot be changed here (setPref would ignore the write anyway).
  chkRemoteRequests.disabled = isManaged;
  chkRemoteRequests.title = isManaged
    ? browser.i18n.getMessage("quicktext.controlledViaManagedStorage.label")
    : "";
  chkRemoteRequests.addEventListener("change", () =>
    storage.setPref("allowRemoteRequests", chkRemoteRequests.checked)
  );

  // Developer Bridge — only meaningful where the build carries nativeMessaging
  // (beta/dev). On the ATN build the permission is absent, so the section stays
  // hidden and no bridge messages are ever sent.
  if (browser.runtime.getManifest().permissions?.includes("nativeMessaging")) {
    setupBridgeSection();
  }
});

// ── Developer Bridge (beta/dev only) ─────────────────────────────────────────

function setupBridgeSection() {
  const el = (id) => document.getElementById(id);
  el("bridge-section").hidden = false;

  const statusEl = el("bridge-status");
  const detailEl = el("bridge-link-detail");
  const toggleEl = el("bridge-toggle");
  const downloadEl = el("bridge-download");
  const uninstallEl = el("bridge-uninstall");
  const hintEl = el("bridge-download-hint");
  const messageEl = el("bridge-message");
  const staleEl = el("bridge-stale");
  const endpointEl = el("bridge-endpoint");
  const usageEl = el("bridge-usage");
  const exampleEl = el("bridge-example");
  const allowedEl = el("bridge-allowed");
  const activityEl = el("bridge-activity");

  // Resolved once for the shell example; nobody changes OS mid-session.
  let platform = "linux";
  browser.runtime.getPlatformInfo().then((i) => { platform = i.os; }).catch(() => {});

  // Mirrors what the last refresh saw, so the toggle click knows what it is
  // toggling away from without asking the background again.
  let isOn = false;

  /** The page's own view of the helper's HTTP socket — fetched from here, a
   *  genuinely external client, not relayed through the link under test.
   *  Throttled below the refresh cadence; null until the first probe. */
  let healthOk = null;
  let lastHealthProbe = 0;
  const HEALTH_PROBE_MS = 6000;

  async function probeHealth(endpoint) {
    if (!endpoint?.url) { healthOk = null; return; }
    if (Date.now() - lastHealthProbe < HEALTH_PROBE_MS) return;
    lastHealthProbe = Date.now();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const resp = await fetch(`${endpoint.url}/health`, {
        headers: { Authorization: `Bearer ${endpoint.token}` },
        signal: ctl.signal,
      });
      clearTimeout(t);
      healthOk = resp.ok;
    } catch {
      healthOk = false;
    }
  }

  function say(text, isError = false) {
    messageEl.textContent = text;
    messageEl.classList.toggle("bridge-err", isError);
    messageEl.toggleAttribute("hidden", !text);
  }

  async function offer(buttonEl, action) {
    buttonEl.disabled = true;
    say("");
    try {
      await action();
    } catch (err) {
      say(`Download failed: ${err?.message ?? err}`, true);
    } finally {
      buttonEl.disabled = false;
    }
  }

  const liEl = (text, cls) => {
    const li = document.createElement("li");
    if (cls) li.className = cls;
    li.textContent = text;
    return li;
  };

  async function refresh() {
    let s;
    try {
      s = await browser.runtime.sendMessage({ bridgeGetStatus: true });
    } catch {
      return; // background not ready
    }
    if (!s) return;
    await probeHealth(s.endpoint);

    // Headline: running only when both halves are proven — the helper said
    // hello and answers pings (link), and this page reached its HTTP socket
    // (app). The in-between states say what is actually known.
    const linkUp = s.linkState === "up";
    const appUp = healthOk === true;
    let headline, detail = "";
    if (linkUp && (appUp || healthOk === null)) {
      headline = "Bridge running";
    } else if (s.linkState === "starting") {
      headline = "Starting the helper…";
    } else if (s.linkState === "failed") {
      headline = "Bridge failed";
      detail = "The helper could not be started. Use Disable then Enable to retry, or reinstall it.";
    } else if (linkUp && healthOk === false) {
      headline = "Bridge degraded";
      detail = "The link answers but the local socket does not — the helper may be wedged.";
    } else {
      headline = "Bridge off";
    }
    statusEl.textContent = headline;
    detailEl.textContent = detail;
    detailEl.toggleAttribute("hidden", !detail);
    statusEl.classList.toggle("bridge-on", linkUp && appUp !== false);

    isOn = !!s.enabled;
    toggleEl.textContent = isOn ? "Disable" : "Enable";

    // One download offer at a time: the installer bundle while nothing is
    // running, the uninstaller once it is. A stale helper is running but wrong,
    // so it re-offers the installer and drops the install hint.
    const stale = !!s.endpoint?.stale;
    hintEl.toggleAttribute("hidden", linkUp);
    downloadEl.toggleAttribute("hidden", linkUp && !stale);
    uninstallEl.toggleAttribute("hidden", !linkUp || stale);
    staleEl.toggleAttribute("hidden", !stale);

    endpointEl.textContent = s.endpoint ? `Listening on ${s.endpoint.url}` : "";
    endpointEl.toggleAttribute("hidden", !s.endpoint);

    usageEl.toggleAttribute("hidden", !s.endpoint);
    if (s.endpoint) {
      exampleEl.textContent = exampleFor(platform, s.endpoint);
      allowedEl.textContent = `Commands: ${(s.allowed ?? []).join(", ")}`;
    }

    activityEl.replaceChildren();
    if (!s.activity?.length) {
      activityEl.append(liEl("(no activity yet)", "bridge-empty"));
    } else {
      for (const entry of [...s.activity].reverse()) {
        const time = new Date(entry.at).toLocaleTimeString();
        activityEl.append(
          liEl(`${time}  ${entry.text}`, entry.level === "error" ? "bridge-err" : ""),
        );
      }
    }
  }

  toggleEl.addEventListener("click", async () => {
    toggleEl.disabled = true;
    try {
      await browser.runtime.sendMessage({ bridgeSetEnabled: !isOn });
    } finally {
      toggleEl.disabled = false;
      refresh();
    }
  });
  downloadEl.addEventListener("click", () => offer(downloadEl, downloadInstaller));
  uninstallEl.addEventListener("click", () => offer(uninstallEl, downloadUninstaller));

  // The activity list changes on its own; poll while the page is open, as the
  // panel has no tabs to hide behind.
  refresh();
  setInterval(refresh, 2000);
}

/** A copy-and-run first call, in a shell the reader is likely to have.
 *  Deliberately only `/health` and `help` — the health probe separates "the
 *  bridge is up" from "Quicktext answered", and `help` lists every verb, so no
 *  specific-verb example is baked in here to fall out of date. */
function exampleFor(os, { url, token }) {
  if (os === "win") {
    return [
      `$h = @{ Authorization = "Bearer ${token}" }`,
      `Invoke-RestMethod ${url}/health -Headers $h`,
      `Invoke-RestMethod ${url}/rpc -Method Post -Headers $h \``,
      `  -ContentType 'application/json' -Body '{"cmd":"help"}'`,
    ].join("\n");
  }
  const auth = `Authorization: Bearer ${token}`;
  return [
    `curl -H "${auth}" ${url}/health`,
    `curl -H "${auth}" -d '{"cmd":"help"}' ${url}/rpc`,
  ].join("\n");
}

// The native-host files that ship in the xpi (beta/bridge/* -> bridge/*). The
// installer bundle carries all four so install.sh finds its siblings; the
// uninstaller is offered on its own once the helper is running.
const HELPER_FILES = [
  "install.sh",
  "uninstall.sh",
  "quicktext_bridge_host.py",
  "quicktext_bridge_host.json",
];

/** Read one packaged helper file out of the xpi as bytes. */
async function packaged(name) {
  const resp = await fetch(browser.runtime.getURL(`bridge/${name}`));
  if (!resp.ok) throw new Error(`bridge/${name}: ${resp.status}`);
  return new Uint8Array(await resp.arrayBuffer());
}

/** Offer the whole helper as a single zip, so install.sh arrives with the
 *  host files and uninstaller beside it — the uninstaller is needed most when
 *  this add-on is being removed, exactly when it would no longer download.
 *  Throws on failure (offer() reports it); returns null if the dialog was
 *  dismissed, which says nothing. */
async function downloadInstaller() {
  const entries = [];
  for (const name of HELPER_FILES) {
    entries.push({ name, data: await packaged(name) });
  }
  return save(buildZip(entries), "quicktext-bridge-helper.zip");
}

async function downloadUninstaller() {
  return save(
    new Blob([await packaged("uninstall.sh")], { type: "text/x-shellscript" }),
    "uninstall.sh",
  );
}

/** Put `blob` through a save dialog. Returns the filename, or null if the
 *  dialog was dismissed; throws with a readable message on real failure. */
async function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  let id;
  try {
    id = await browser.downloads.download({ url, filename, saveAs: true });
  } catch (err) {
    URL.revokeObjectURL(url);
    if (/cancel/i.test(err?.message ?? "")) return null;
    throw new Error(err?.message ?? String(err));
  }
  const state = await settled(id);
  URL.revokeObjectURL(url);
  if (state !== "complete") throw new Error(`download ${state}`);
  return filename;
}

/** Resolve once download `id` is no longer in progress. */
function settled(id) {
  return new Promise((resolve) => {
    const done = (state) => {
      browser.downloads.onChanged.removeListener(onChanged);
      resolve(state);
    };
    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current !== "in_progress") done(delta.state.current);
    }
    browser.downloads.onChanged.addListener(onChanged);
    browser.downloads
      .search({ id })
      .then(([item]) => {
        if (item && item.state !== "in_progress") done(item.state);
      })
      .catch(() => done("interrupted"));
  });
}

// ── Minimal ZIP builder (STORE / no compression) ─────────────────────────────
// A handful of small text files; a deflate implementation would be larger than
// what it saves.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const b of data) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** @param {Array<{name: string, data: Uint8Array}>} entries */
/**
 * A moment in the two 16-bit fields a zip entry carries for it.
 *
 * The date packs year-1980 in bits 15-9, the month in 8-5 and the day in
 * 4-0; the time packs hours in 15-11, minutes in 10-5 and two-second steps
 * in 4-0. Months and days count from one, so a zeroed field is not a date
 * that exists, and readers left to guess print anything from 1979 to 2159.
 *
 * The entries here are assembled in memory rather than read off disk, so
 * the moment the archive is built is the only honest answer for them.
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

function buildZip(entries) {
  const enc = new TextEncoder();
  const u16 = (v, dv, o) => dv.setUint16(o, v, true);
  const u32 = (v, dv, o) => dv.setUint32(o, v, true);

  const localParts = [];
  const centralParts = [];
  let dataOffset = 0;

  const stamp = dosDateTime(new Date());

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(0x04034b50, lv, 0);
    u16(stamp.time, lv, 10); // mod time
    u16(stamp.date, lv, 12); // mod date
    u16(20, lv, 4);
    u16(0, lv, 8); // STORE
    u32(crc, lv, 14);
    u32(data.length, lv, 18);
    u32(data.length, lv, 22);
    u16(nameBytes.length, lv, 26);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(0x02014b50, cv, 0);
    u16(20, cv, 4);
    u16(20, cv, 6);
    u16(0, cv, 10); // STORE
    u16(stamp.time, cv, 12); // mod time
    u16(stamp.date, cv, 14); // mod date
    u32(crc, cv, 16);
    u32(data.length, cv, 20);
    u32(data.length, cv, 24);
    u16(nameBytes.length, cv, 28);
    u32(dataOffset, cv, 42);
    cd.set(nameBytes, 46);
    centralParts.push(cd);

    dataOffset += local.length + data.length;
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32(0x06054b50, ev, 0);
  u16(entries.length, ev, 8);
  u16(entries.length, ev, 10);
  u32(cdSize, ev, 12);
  u32(dataOffset, ev, 16);

  return new Blob([...localParts, ...centralParts, eocd], { type: "application/zip" });
}
