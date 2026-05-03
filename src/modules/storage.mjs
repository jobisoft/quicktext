/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "./quicktext.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";

// Human-readable name for the built-in OPFS storage, shown in the VFS file
// picker and the Storage list. Keep in sync across all picker call sites.
export const OPFS_STORAGE_NAME = "Quicktext Storage";

// Record a dropped FILE-based entry (import or storage location) so the
// migration wizard can inform the user. Appended to local storage, deduplicated
// by type+path. Never automatically cleared - the user dismisses via the wizard.
async function _recordDroppedFileEntry(type, path) {
  const { droppedFileEntries = [] } = await browser.storage.local.get({
    droppedFileEntries: [],
  });
  if (droppedFileEntries.some(e => e.type === type && e.path === path)) return;
  droppedFileEntries.push({ type, path });
  await browser.storage.local.set({ droppedFileEntries });
}

// Default storage configuration: a single JSON file holding both `templates`
// and `scripts` side-by-side, in the legacy file-source shape that
// parseConfigFileData() already understands. `storageRef: null` selects the
// built-in OPFS provider; for external providers it carries the VFS storageRef
// `{providerId, storageId}`. The `uuid` is assigned at first-write via
// `_makeDefaultConfig()` so fresh installs get a freshly-generated id.
function _makeDefaultConfig() {
  return {
    uuid: crypto.randomUUID(),
    name: "Default",
    type: "vfs",
    storageRef: null,
    path: "/quicktext/default.json",
    isReadOnly: false,
    enabled: true,
  };
}

// Default name for a managed-storage entry when the enterprise
// policy doesn't provide one. Resolved via i18n at call time so
// locale switches still take effect on the next migration pass.
function _defaultManagedName() {
  return browser.i18n.getMessage("quicktext.storage.managed.label") || "Managed";
}

// Build a fresh managed-storage entry for `storageLocations`. The
// `type: "managed"` field is the sole identifier: `readConfigFile`
// routes reads to `browser.storage.managed` when it sees this type,
// and the manager dialog uses the same check to gate write-only
// affordances (import, content edits). The entry is injected into
// `storageLocations` by `_migrateStorageLocationsShape()` if a policy
// is present and the user doesn't already have one. The policy may
// ship a custom `name` and `icon` URL via the `managedStorage` wrapper.
// Both are optional and fall back to sensible defaults.
function _makeManagedEntry({ name = null, icon = null } = {}) {
  return {
    uuid: crypto.randomUUID(),
    name: name || _defaultManagedName(),
    type: "managed",
    icon: icon || null,
    storageRef: null,
    path: null,
    isReadOnly: true,
    enabled: true,
  };
}

// Thin async check: is there currently any Quicktext data in the
// enterprise policy? Used by the manager to flip a runtime "has
// managed storage" flag so managed entries can be hidden when no
// policy is active (and re-appear when the admin pushes one).
export async function hasManagedPolicy() {
  return (await _readManagedCombined()) !== null;
}

// Direct reader for the policy-only `managedImport` key, with a
// backward-compatibility fallback to a legacy `defaultImport` policy.
// Read straight from `browser.storage.managed` so the values bypass
// the `defaultPrefs`/`managedPrefs` machinery - the user's local
// `defaultImport` must never be shadowed by a managed value.
// Returns `[]` when neither key is present or the API is unavailable;
// otherwise returns a normalized array in the same
// `[{name, url, icon, managed}]` shape produced for `defaultImport`,
// reusing `_normalizeDefaultImports` so legacy shapes pushed by older
// policies still parse. Internal-only: UI consumers don't read policy
// directly; instead they read the already-merged local `defaultImport`,
// which is kept in sync by `reconcileManagedImports` below.
async function _readManagedImports() {
  try {
    const { managedImport = null, defaultImport = null } =
      await browser.storage.managed.get({
        managedImport: null,
        defaultImport: null,
      });
    // Prefer the new `managedImport` key. Fall back to a legacy
    // `defaultImport` policy only when `managedImport` is absent,
    // so admins who already migrated aren't double-counted and
    // admins who haven't still get their entries surfaced.
    const raw = managedImport ?? defaultImport;
    if (raw == null) return [];
    const entries = _normalizeDefaultImports(raw);
    // The legacy `defaultImport` key's spec does not include `name`
    // or `icon` fields, so strip them here: name is re-derived from
    // the URL and icon falls back to the generic globe glyph.
    if (managedImport == null) {
      for (const e of entries) {
        e.name = _deriveName(e.url);
        e.icon = null;
      }
    }
    return entries;
  } catch {
    return [];
  }
}

// Read the managed policy's templates/scripts. Returns `null` when
// the API is unavailable or the policy has no Quicktext entries.
// Runs `_stripProtectedInPlace` on the way out so any leftover
// `protected: true` markers in an old policy are dropped.
//
// Two policy shapes are supported:
//
//   1. New (preferred) - a single `managedStorage` key
//      whose value is an object with `name`, `icon`, `templates`,
//      `scripts` sub-fields. Admins use this to ship a custom
//      display name and icon alongside the content.
//
//   2. Legacy - two top-level keys `templates` and `scripts`. No
//      display-name or icon customization. Only consulted when the
//      new key is absent.
//
// Return shape is always `{name, icon, templates, scripts}` so
// callers can treat both paths uniformly; `name`/`icon` are `null`
// when the policy doesn't provide them.
async function _readManagedCombined() {
  try {
    const { "managedStorage": wrapped = null } = await browser.storage.managed.get({
      "managedStorage": null,
    });
    if (wrapped && typeof wrapped === "object") {
      const templates = wrapped.templates ?? null;
      const scripts = wrapped.scripts ?? null;
      if (templates == null && scripts == null) return null;
      const combined = {
        name: typeof wrapped.name === "string" ? wrapped.name : null,
        icon: typeof wrapped.icon === "string" ? wrapped.icon : null,
        templates,
        scripts,
      };
      _stripProtectedInPlace(combined);
      return combined;
    }

    // Legacy fallback: two top-level keys.
    const { templates = null, scripts = null } = await browser.storage.managed.get({
      templates: null,
      scripts: null,
    });
    if (templates == null && scripts == null) return null;
    const combined = { name: null, icon: null, templates, scripts };
    _stripProtectedInPlace(combined);
    return combined;
  } catch {
    return null;
  }
}

// Drops any group or script carrying a truthy `protected` flag. The marker and
// formally protected (imported) entries are no longer needed.
export function _stripProtectedInPlace(combined) {
  if (!combined) return;

  const groups = combined.templates?.groups;
  const texts = combined.templates?.texts;
  if (Array.isArray(groups)) {
    const keep = [];
    for (let i = 0; i < groups.length; i++) {
      if (!groups[i]?.protected) keep.push(i);
    }
    if (keep.length !== groups.length) {
      combined.templates = {
        groups: keep.map(i => groups[i]),
        texts: keep.map(i => texts?.[i] ?? []),
      };
    }
  }

  if (Array.isArray(combined.scripts)) {
    combined.scripts = combined.scripts.filter(s => !s?.protected);
  }
}

// Read the combined `{templates, scripts}` JSON from a storage
// config. Entries with `type: "managed"` dispatch to
// `browser.storage.managed`. All other types go through the VFS.
async function readConfigFile(config) {
  if (config?.type === "managed") {
    return (await _readManagedCombined()) ?? { templates: null, scripts: null };
  }
  try {
    const file = await vfs.readFile({ path: config.path, storageRef: config.storageRef });
    const text = await file.text();
    const parsed = await quicktext.parseConfigFileData(text);
    const combined = {
      templates: parsed?.templates ?? null,
      scripts: parsed?.scripts ?? null,
    };
    _stripProtectedInPlace(combined);
    return combined;
  } catch (ex) {
    // File not found on first run, or parse failure - empty shape.
    return { templates: null, scripts: null };
  }
}

/**
 * Write the combined `{templates, scripts}` JSON to a storage config.
 * Generic over the storage backend.
 */
async function writeConfigFile(config, combined) {
  const payload = JSON.stringify({
    templates: combined.templates ?? null,
    scripts: combined.scripts ?? null,
  });
  const blob = new Blob([payload], { type: "application/json" });
  await vfs.writeFile({ path: config.path, storageRef: config.storageRef }, blob, { overwrite: true });
}

async function _migrateToConfigFile() {
  // Modern `storageLocations` is a uuid-keyed array. Legacy `{source, data}`
  // shapes and on-disk XML configs are migrated into the modern layout.
  const { storageLocations: raw } = await browser.storage.local.get({ storageLocations: null });

  // Already in the modern format - short-circuit.
  if (Array.isArray(raw) && raw.length > 0 && raw.every(e => e && typeof e.uuid === "string")) {
    return;
  }

  // Record any FILE-based storage locations before they're replaced.
  // v6.5.5 stored storageLocations as a JSON string, not a raw array.
  let parsedRaw = raw;
  if (typeof raw === "string") {
    try { parsedRaw = JSON.parse(raw); } catch { parsedRaw = null; }
  }
  if (Array.isArray(parsedRaw)) {
    for (const entry of parsedRaw) {
      if (entry?.source?.toUpperCase() === "FILE" && entry?.data) {
        await _recordDroppedFileEntry("storage", entry.data);
      }
    }
  }

  const isFreshInstall = raw == null;

  const { templates: rawT, scripts: rawS } = await browser.storage.local.get({
    templates: null,
    scripts: null,
  });
  let templates = rawT ? (typeof rawT === "string" ? JSON.parse(rawT) : rawT) : null;
  let scripts = rawS ? (typeof rawS === "string" ? JSON.parse(rawS) : rawS) : null;
  let source = templates != null || scripts != null ? "local storage" : null;

  if (isFreshInstall && templates == null) {
    try {
      templates = (await quicktext.readLegacyXmlTemplateFile())?.templates ?? null;
      if (templates != null) source = "profile folder (XML)";
    } catch { /* no XML file */ }
  }
  if (isFreshInstall && scripts == null) {
    try {
      scripts = (await quicktext.readLegacyXmlScriptFile())?.scripts ?? null;
      if (scripts != null) source = source ?? "profile folder (XML)";
    } catch { /* no XML file */ }
  }
  console.log(`Quicktext migration to VFS from: ${source ?? "none"}`);

  // Write the config file BEFORE persisting the modern storageLocations, so
  // the persisted storageLocations acts as the commit marker - a crash
  // between the two phases leaves legacy state intact and the next run
  // retries.
  const defaultEntry = _makeDefaultConfig();
  if (templates != null || scripts != null) {
    await writeConfigFile(defaultEntry, { templates, scripts });
  }

  await browser.storage.local.remove(["templates", "scripts", "activeStorageLocationIdx"]);
  await browser.storage.local.set({
    storageLocations: [defaultEntry],
  });
}

const defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": [],
  "menuCollapse": true,
  "toolbar": true,
  "popup": true,
  "keywordKey": "Tab",
  "keywordCaseinsensitive": false,
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": "",
  "storageLocations": [],
};

const managedPrefs = [
  "menuCollapse",
  "popup",
  "keywordKey",
  "keywordCaseinsensitive",
  "shortcutModifier",
  "shortcutTypeAdv",
];

// Raw reader: returns whatever `browser.storage.managed` has for
// `aName`, or `undefined` if the managed area is missing, if the
// pref isn't on the managed-override allowlist, or if the admin
// hasn't set this key.
async function _getManagedPref(aName) {
  if (!managedPrefs.includes(aName)) {
    return undefined;
  }
  try {
    const override = await browser.storage.managed.get({ [aName]: undefined });
    return override[aName];
  } catch {
    // No managed storage available.
  }
  return undefined;
}

// Raw reader: returns whatever `browser.storage.local` has for
// `aName`, falling back to `defaultPrefs[aName]` or the explicit
// `aFallback` when the key isn't set.
async function _getLocalPref(aName, aFallback = undefined) {
  const defaultPref = Object.hasOwn(defaultPrefs, aName)
    ? defaultPrefs[aName]
    : aFallback;
  const o = await browser.storage.local.get({ [aName]: defaultPref });
  return o[aName];
}

// True if the enterprise policy currently provides a value for
// `aName`. Consumers use this to gate UI affordances (e.g., the
// manager disables inputs and buttons for policy-controlled prefs)
// without duplicating the managed-area lookup themselves.
export async function hasManagedPref(aName) {
  return (await _getManagedPref(aName)) !== undefined;
}

// Any pref-shape upgrades that must apply on every read.
function migratePrefOnTheFly(value, name) {
  switch (name) {
    case "defaultImport":
      return _normalizeDefaultImports(value);
    default:
      return value;
  }
}

// The single read path. Resolves the effective value of a pref:
// managed policy wins when it provides a value, otherwise local
// storage (with fallback). The final value is run through
// `migratePrefOnTheFly`.
export async function getPrefWithManagedInfo(aName, aFallback = undefined) {
  const managedPref = await _getManagedPref(aName);
  if (managedPref !== undefined) {
    return { value: migratePrefOnTheFly(managedPref, aName), isManaged: true };
  }
  const localPref = await _getLocalPref(aName, aFallback);
  return { value: migratePrefOnTheFly(localPref, aName), isManaged: false };
}

// Convenience wrapper for consumers that don't care whether the
// value came from policy or local storage.
export async function getPref(aName, aFallback = undefined) {
  return (await getPrefWithManagedInfo(aName, aFallback)).value;
}

// Write `aValue` into local storage for `aName`, unless the
// enterprise policy currently provides a value for this pref.
export async function setPref(aName, aValue) {
  if ((await _getManagedPref(aName)) !== undefined) return;
  await browser.storage.local.set({ [aName]: aValue });
}
// Clear the value for the `aName` from local storage, unless the
// enterprise policy currently provides a value for this pref.
export async function clearPref(aName) {
  if ((await _getManagedPref(aName)) !== undefined) return;
  await browser.storage.local.remove(aName);
}

// ---- Imports ----------------------------------
//
// Callers read and write via the normal `getPref("defaultImport")` /
// `setPref("defaultImport", list)` path. `migratePrefOnTheFly` runs
// the raw value through `_normalizeDefaultImports` on every read so
// consumers always see the modern `[{name, url, icon, managed}]`
// shape. The normalizer also parses legacy semicolon-string and
// `{source, data}` shapes for backward compatibility.

function _deriveName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : u.hostname;
  } catch {
    return url;
  }
}

function _normalizeDefaultImports(raw) {
  if (raw == null) return [];
  // Legacy stringified value - either a JSON blob or a pre-v6.4.6
  // semicolon-separated string of paths.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      const parts = raw.split(";").map(s => s.trim()).filter(Boolean);
      const result = [];
      for (const part of parts) {
        if (/^https?:\/\//.test(part)) {
          result.push({
            uuid: crypto.randomUUID(),
            name: _deriveName(part),
            url: part,
            icon: null,
            managed: false,
            enabled: true,
            data: null,
            status: null,
          });
        } else {
          // Legacy local file path - record it so the migration
          // wizard can inform the user.
          _recordDroppedFileEntry("import", part);
        }
      }
      return result;
    }
  }
  if (!Array.isArray(raw)) return [];
  const result = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    // Modern shape. The `icon` field is optional - admins can
    // push a per-entry icon URL via the managed default-import
    // pref, alongside `name` and `url`; the manager falls back to
    // a generic globe glyph when it's absent. The `managed` flag
    // distinguishes policy-pushed rows (folded into local storage
    // by `reconcileManagedImports`) from user-owned rows; on any
    // path that doesn't supply it, it defaults to false.
    if (typeof entry.url === "string" && entry.url) {
      const managed = entry.managed === true;
      result.push({
        // Stable identity used by every consumer (bundle lookups,
        // DOM data-uuid attributes, selection state). Minted lazily
        // on first normalization for pre-feature entries; reconcile
        // detects the diff and persists.
        uuid: typeof entry.uuid === "string" && entry.uuid
          ? entry.uuid
          : crypto.randomUUID(),
        name: typeof entry.name === "string" && entry.name
          ? entry.name
          : _deriveName(entry.url),
        url: entry.url,
        icon: typeof entry.icon === "string" && entry.icon ? entry.icon : null,
        managed,
        // Managed rows are forcefully enabled; user-owned rows default
        // to enabled when the field is absent (e.g. pre-upgrade data).
        enabled: managed ? true : entry.enabled !== false,
        // Fetched content and last-fetch status ride through untouched.
        // `data` is `{templates, scripts}` when any fetch has ever
        // succeeded; it's preserved even after a subsequent failed
        // fetch so consumers still see the last known good content.
        // `status` is `{timestamp, error?}` or null when never fetched.
        data: entry.data && typeof entry.data === "object" ? entry.data : null,
        status: entry.status && typeof entry.status === "object" ? entry.status : null,
      });
      continue;
    }
    // v6.4.6+ `{source, data}` shape.
    if (entry.source === "URL" && typeof entry.data === "string" && entry.data) {
      result.push({
        uuid: crypto.randomUUID(),
        name: _deriveName(entry.data),
        url: entry.data,
        icon: null,
        managed: false,
        enabled: true,
        data: null,
        status: null,
      });
      continue;
    }
    // FILE entries are no longer supported - record them so the
    // migration wizard can inform the user.
    if (entry.source?.toUpperCase() === "FILE" && entry.data) {
      _recordDroppedFileEntry("import", entry.data);
    }
  }
  return result;
}

// Merge `policy` entries into `local` in place of existing `managed: true`
// rows with the same URL, preserving user ordering and dropping stale
// managed rows whose URL no longer appears in the policy. Brand-new
// policy entries are prepended to the front of the list so the user
// notices them; user-added entries are still pushed to the end via
// `addImportListEntry`. URL acts as the match key; same-URL collisions
// between user and admin coexist as two separate rows.
function _mergeManagedIntoDefault(local, policy) {
  const byUrl = new Map();
  for (const p of policy) {
    if (!byUrl.has(p.url)) byUrl.set(p.url, []);
    byUrl.get(p.url).push(p);
  }
  const kept = [];
  for (const e of local) {
    if (!e.managed) { kept.push(e); continue; }
    const bucket = byUrl.get(e.url);
    if (!bucket || bucket.length === 0) continue;
    const p = bucket.shift();
    // Managed rows stay forcefully enabled across reconciles, even
    // if a stale `enabled: false` somehow leaked into local storage.
    kept.push({ ...e, name: p.name, icon: p.icon ?? null, enabled: true });
  }
  // Prepend policy entries that weren't consumed above, in original
  // policy order. A second walk over `policy` preserves order across
  // duplicate URLs even though `bucket.shift()` consumed entries out
  // of the map during the first pass.
  const head = [];
  const remaining = new Map();
  for (const [url, bucket] of byUrl) remaining.set(url, bucket.length);
  for (const p of policy) {
    const left = remaining.get(p.url) ?? 0;
    if (left > 0) {
      head.push({ ...p, managed: true, enabled: true });
      remaining.set(p.url, left - 1);
    }
  }
  return head.concat(kept);
}

// Pull the live policy-side `managedImport` list, merge it with the
// persisted local `defaultImport`, and write the result back so that
// every downstream consumer (compose menu, manager, context menus) can
// read one already-reconciled list. Skips the write when nothing moved.
// Called once at background startup and whenever the managed-area
// `managedImport` key changes (via `installManagedImportSync`).
export async function reconcileManagedImports() {
  const rawLocal = await _getLocalPref("defaultImport", []);
  const local = _normalizeDefaultImports(rawLocal);
  const policy = await _readManagedImports();
  const merged = _mergeManagedIntoDefault(local, policy);
  if (JSON.stringify(merged) !== JSON.stringify(local)) {
    await browser.storage.local.set({ defaultImport: merged });
  }
}

// Register a managed-area watcher that keeps local `defaultImport` in
// sync with policy-side `managedImport`. The background page installs
// this once at startup. The listener persists for the lifetime of the
// page.
export function installManagedImportSync() {
  new StorageListener({
    area: "managed",
    // `defaultImport` is watched for backward compatibility: some
    // admins still push the legacy key instead of `managedImport`,
    // and we want their mid-session policy edits to reconcile too.
    // The fallback inside `_readManagedImports` prefers `managedImport`
    // when both are present, so the extra watch never double-counts.
    watchedPrefs: ["managedImport", "defaultImport"],
    listener: () => reconcileManagedImports(),
  });
}

// One fetch attempt against an import entry's URL. Returns a
// `{data, status}` patch to merge onto the entry. `cache: "no-store"`
// forces a live fetch every call so users always get the latest
// content rather than a stale HTTP-cache entry. On failure, the
// entry's last successful `data` is preserved - only `status` updates.
// Exported for the manager's pre-Save in-memory fetch on add/enable.
export async function fetchImportOnce(entry) {
  const timestamp = Date.now();
  try {
    const res = await fetch(entry.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const parsed = await quicktext.parseConfigFileData(text);
    if (!parsed) throw new Error("Unparseable content");
    return {
      data: {
        templates: parsed.templates ?? null,
        scripts: parsed.scripts ?? null,
      },
      status: { timestamp },
    };
  } catch (ex) {
    return {
      data: entry.data ?? null,
      status: { timestamp, error: String(ex?.message || ex) },
    };
  }
}

// Serialises all refreshes. Concurrent triggers (startup, 6h timer,
// manager-driven) can't trample each other's read-modify-write because
// each call chains onto the previous one's completion.
let _refreshQueue = Promise.resolve();
function _refreshMatching(predicate) {
  _refreshQueue = _refreshQueue.then(async () => {
    const list = _normalizeDefaultImports(await _getLocalPref("defaultImport", []));
    let mutated = false;
    for (let i = 0; i < list.length; i++) {
      if (!predicate(list[i])) continue;
      const update = await fetchImportOnce(list[i]);
      list[i] = { ...list[i], ...update };
      mutated = true;
    }
    if (mutated) await browser.storage.local.set({ defaultImport: list });
  }).catch(ex => console.warn("Quicktext import refresh failed:", ex));
  return _refreshQueue;
}

// Refresh every enabled import. Fired at background startup and
// every 6 hours by the interval installed below.
export function refreshAllImports() {
  return _refreshMatching(e => e.enabled !== false);
}

// Refresh entries matching `url`. A URL may appear on both a managed
// and a user-owned row; both fetch. Called by the manager after Save
// for rows that were just added or just re-enabled.
export function refreshImport(url) {
  return _refreshMatching(e => e.url === url && e.enabled !== false);
}

// Background-only: install the 6h periodic refresh. MV2 module
// background pages stay alive, so plain `setInterval` suffices.
export function installImportAutoRefresh() {
  setInterval(() => refreshAllImports(), 6 * 60 * 60 * 1000);
}

// Background-only: install a local-area listener that auto-fetches
// any new-or-newly-enabled `defaultImport` entry whose `data` is
// still null. Covers every write path in one place - reconcile,
// manager Save, anything else that writes `defaultImport`.
//
// Loop-safe: when `refreshImport` writes `status` back, the listener
// fires again, but the entry is already in the previous snapshot's
// `oldValue` with the same `enabled` flag - not "new" or "newly
// enabled" - so the fetcher skips.
export function installDefaultImportFetcher() {
  new StorageListener({
    area: "local",
    watchedPrefs: ["defaultImport"],
    listener: events => {
      for (const { changes } of events) {
        const change = changes.defaultImport;
        if (!change) continue;
        const oldList = Array.isArray(change.oldValue) ? change.oldValue : [];
        const newList = Array.isArray(change.newValue) ? change.newValue : [];
        const prevByUuid = new Map();
        for (const e of oldList) {
          if (e && typeof e === "object") {
            prevByUuid.set(e.uuid, e.enabled !== false);
          }
        }
        for (const entry of newList) {
          if (entry.enabled === false) continue;
          if (entry.data) continue;
          const wasEnabled = prevByUuid.get(entry.uuid);
          const isNew = wasEnabled === undefined;
          const isNewlyEnabled = wasEnabled === false;
          if (isNew || isNewlyEnabled) refreshImport(entry.url);
        }
      }
    },
  });
}

/**
 * Return the full list of storage entries from the persisted
 * `storageLocations` pref, in their saved order. Each entry carries
 * a `type` field (`"vfs"` for VFS-backed storages, `"managed"` for
 * the enterprise-policy-backed one). The managed entry is a normal
 * persisted entry just like any other - it's injected into
 * `storageLocations` at startup by `_migrateStorageLocationsShape()`
 * when a policy is first seen, and remains after that even if the
 * policy later disappears so any user rename/reorder sticks.
 *
 * Callers clone as needed; a fresh top-level array is returned on
 * each call (the entries themselves are the persisted objects).
 */
export async function getAllStorageEntries() {
  return await getPref("storageLocations");
}

// Synthesize a read-only bundle from an enabled+fetched import entry.
// Matches the shape `readBundleForEntry` produces for storage entries,
// plus `isImport: true` and a preresolved `iconUrl` so consumers don't
// have to look up `storageLocations` for imports. `type: "import"` and
// `storageRef: null` mark the bundle as having no VFS backing - the
// parser uses these to skip VFS-tag resolution for import bundles.
function _bundleFromImport(entry) {
  const templates = entry.data?.templates ?? {};
  return {
    storageUuid: entry.uuid,
    storageName: entry.name,
    isReadOnly: true,
    isImport: true,
    type: "import",
    storageRef: null,
    iconUrl: entry.icon || browser.runtime.getURL("/assets/icon-globe.svg"),
    templates: {
      groups: Array.isArray(templates.groups) ? templates.groups : [],
      texts:  Array.isArray(templates.texts)  ? templates.texts  : [],
    },
    scripts: Array.isArray(entry.data?.scripts) ? entry.data.scripts : [],
  };
}

/**
 * Read templates and scripts from every enabled storage location in the
 * persisted order, then append one read-only bundle per enabled import
 * that has fetched content. Empty shells are returned for storages with
 * no data yet so the shape is always consistent for consumers.
 *
 * @returns {Promise<Array<{
 *   storageUuid: string,
 *   storageName: string,
 *   isReadOnly: boolean,
 *   templates: { groups: Array, texts: Array },
 *   scripts: Array,
 *   isImport?: boolean,
 *   iconUrl?: string,
 * }>>}
 */
export async function getActiveStorageEntries() {
  const allEntries = await getAllStorageEntries();
  const hasManaged = await hasManagedPolicy();
  const { providerAvailability } = await browser.storage.session.get({
    providerAvailability: {},
  });
  const bundles = [];
  for (const entry of allEntries) {
    if (entry.enabled === false) continue;
    if (entry.type === "managed" && !hasManaged) continue;
    const bundle = await readBundleForEntry(entry);
    const status = providerAvailability[entry.uuid];
    if (status && !status.available) {
      bundle.unavailable = true;
      bundle.unavailableReason = status.reason;
    }
    bundles.push(bundle);
  }
  const defaultImport = await getPref("defaultImport");
  for (const entry of defaultImport) {
    if (entry.enabled === false) continue;
    if (!entry.data) continue;
    bundles.push(_bundleFromImport(entry));
  }
  return bundles;
}

/**
 * Compare persisted storage locations against live VFS provider connections
 * and write an availability map to session storage. Entries with a missing
 * provider or connection are marked as unavailable. OPFS and managed entries
 * are always available.
 */
export async function checkProviderAvailability() {
  const entries = await getAllStorageEntries();
  let providers;
  try {
    providers = await vfs.fetchProviderConnections();
  } catch {
    providers = [];
  }

  const availability = {};
  for (const entry of entries) {
    if (!entry.storageRef || entry.type === "managed") {
      availability[entry.uuid] = { available: true };
      continue;
    }
    const provider = providers.find(
      p => p.providerId === entry.storageRef.providerId,
    );
    if (!provider) {
      availability[entry.uuid] = {
        available: false,
        reason: "provider_missing",
      };
      continue;
    }
    const connection = provider.connections.find(
      c => c.storageRef?.storageId === entry.storageRef.storageId,
    );
    if (!connection) {
      availability[entry.uuid] = {
        available: false,
        reason: "connection_missing",
      };
      continue;
    }
    availability[entry.uuid] = { available: true };
  }

  await browser.storage.session.set({ providerAvailability: availability });
}

/**
 * Read one bundle from a given storage-location entry. Exported so the
 * manager dialog can lazy-load a bundle when the user enables or adds a
 * storage in the advanced tab, without round-tripping through
 * `storageLocations` prefs.
 *
 * @param {object} entry - A storageLocations entry carrying at least
 *   `{uuid, name, isReadOnly, storageRef, path}`.
 */
// Migrate legacy `attachments` fields (semicolon-separated paths) into
// `[[ATTACHMENT=FILE|<path>]]` tags prepended to the template body. Returns
// true if any template was migrated so the caller can persist the change.
function _migrateAttachmentsToTags(combined) {
  if (!combined?.templates?.texts) return false;
  let migrated = false;
  for (const group of combined.templates.texts) {
    if (!Array.isArray(group)) continue;
    for (const tmpl of group) {
      if (!tmpl.attachments) continue;
      const paths = tmpl.attachments.split(";").map(s => s.trim()).filter(Boolean);
      if (paths.length === 0) continue;
      const tags = paths.map(p => `[[ATTACHMENT=FILE|${p}]]`).join("");
      tmpl.text = tags + (tmpl.text || "");
      tmpl.attachments = "";
      migrated = true;
    }
  }
  return migrated;
}

export async function readBundleForEntry(entry) {
  let combined = { templates: null, scripts: null };
  try {
    combined = await readConfigFile(entry);
  } catch (ex) {
    console.log(ex);
  }
  // One-shot migration: convert legacy attachment fields into inline tags.
  // Only for writable VFS-backed storages (managed/import are read-only).
  if (entry.type === "vfs" && !entry.isReadOnly && _migrateAttachmentsToTags(combined)) {
    try { await writeConfigFile(entry, combined); } catch { /* best-effort */ }
  }
  // Normalize templates into a `{groups:[], texts:[]}` shape even when
  // the on-disk file carries a truthy-but-malformed `templates` object
  // (e.g. legacy exports, hand-edited files, or a managed policy that
  // sets only one sub-key). Downstream consumers like
  // `_templateNodesForBundle` index into `groups`/`texts` without
  // further guarding.
  const templates = combined.templates ?? {};
  return {
    storageUuid: entry.uuid,
    storageName: entry.name,
    isReadOnly: !!entry.isReadOnly,
    // `type` and `storageRef` ride through so the parser can decide
    // whether a VFS tag inside a template from this bundle should
    // resolve (`type === "vfs"`) and which VFS storage to read from
    // (`storageRef`, null for OPFS).
    type: entry.type,
    storageRef: entry.storageRef ?? null,
    templates: {
      groups: Array.isArray(templates.groups) ? templates.groups : [],
      texts: Array.isArray(templates.texts) ? templates.texts : [],
    },
    scripts: Array.isArray(combined.scripts) ? combined.scripts : [],
  };
}

// Bump counters persisted in browser.storage.local so that
// StorageListener-based observers (compose menu, manager, toolbar) can
// notice template/script writes. The actual content lives in the VFS
// config files, which storage.onChanged does not observe.
async function _bumpChangeCounter(key) {
  const { [key]: cur = 0 } = await browser.storage.local.get({ [key]: 0 });
  await browser.storage.local.set({ [key]: cur + 1 });
}

/**
 * Write templates and scripts into the storage entry whose `uuid`
 * matches. Templates and scripts share a single config file, so a
 * bundle save is a single read-modify-write. Refuses to write into a
 * read-only storage - the manager UI already blocks edits, so hitting
 * this branch indicates a programming error.
 */
export async function setBundleForStorage(storageUuid, { templates, scripts }) {
  const storageLocations = await getPref("storageLocations");
  const entry = storageLocations.find(e => e.uuid === storageUuid);
  if (!entry) throw new Error(`Unknown storage uuid ${storageUuid}`);
  if (entry.isReadOnly) throw new Error(`Refusing to write read-only storage "${entry.name}"`);
  const combined = await readConfigFile(entry);
  combined.templates = templates;
  combined.scripts = scripts;
  await writeConfigFile(entry, combined);
  await _bumpChangeCounter("templates");
  await _bumpChangeCounter("scripts");
}

export async function migrate() {
  // Migrate options from sync to local storage, as sync storage can only hold
  // 100 KB which will not be enough for templates.
  const { userPrefs: syncUserPrefs } = await browser.storage.sync.get({ userPrefs: undefined });
  if (syncUserPrefs) {
    await browser.storage.local.set({ userPrefs: syncUserPrefs });
    await browser.storage.sync.remove("userPrefs");
  }

  // Migrate from userPrefs/defaultPrefs objects to *.value and *.default.
  const { userPrefs: v1UserPrefs } = await browser.storage.local.get({ userPrefs: undefined });
  if (v1UserPrefs) {
    for (let [key, value] of Object.entries(v1UserPrefs)) {
      await browser.storage.local.set({ [`${key}.value`]: value });
    }
    await browser.storage.local.remove("userPrefs");
  }
  const { defaultPrefs: v1DefaultPrefs } = await browser.storage.local.get({ defaultPrefs: undefined });
  if (v1DefaultPrefs) {
    await browser.storage.local.remove("defaultPrefs");
  }

  // Migrate from *.value and *.default to simple values.
  for (let aName of Object.keys(defaultPrefs)) {
    const aValue = await browser.storage.local
      .get({ [`${aName}.value`]: undefined })
      .then(o => o[`${aName}.value`]);
    if (aValue !== undefined) {
      await browser.storage.local.remove(`${aName}.value`);
      await browser.storage.local.set({ [aName]: aValue });
    }
    await browser.storage.local.remove(`${aName}.default`);
    await browser.storage.local.remove(`${aName}.managed.value`);
  }

  // Migrate legacy local storage (browser.storage.local.templates + .scripts)
  // or legacy XML files on disk into the combined quicktext.json on OPFS, and
  // upgrade storageLocations to the new VFS config shape. Requires vfs.init()
  // to have run.
  await _migrateToConfigFile();

  // Backfill the `type` field on every storageLocations entry and
  // inject a persisted managed entry when a policy is present.
  await _migrateStorageLocationsShape();
}

// Backfill the `type` field on every storage entry, inject the
// managed-policy entry when a policy is active, and refresh its
// admin-provided `name` / `icon` from the live policy. Once injected
// the managed entry is kept across policy churn so user reorders
// survive.
async function _migrateStorageLocationsShape() {
  const storageLocations = await getPref("storageLocations");
  if (!Array.isArray(storageLocations)) return;

  let mutated = false;
  for (const entry of storageLocations) {
    if (entry && typeof entry.type !== "string") {
      entry.type = "vfs";
      mutated = true;
    }
  }

  const managedCombined = await _readManagedCombined();
  const managedEntry = storageLocations.find(e => e?.type === "managed");
  if (!managedEntry && managedCombined) {
    storageLocations.unshift(_makeManagedEntry({
      name: managedCombined.name,
      icon: managedCombined.icon,
    }));
    mutated = true;
  } else if (managedEntry && managedCombined) {
    // Refresh the persisted name/icon so policy updates take effect
    // on the next startup. Falls back to the i18n default when the
    // new policy shape omits a name.
    const desiredName = managedCombined.name || _defaultManagedName();
    const desiredIcon = managedCombined.icon || null;
    if (managedEntry.name !== desiredName) {
      managedEntry.name = desiredName;
      mutated = true;
    }
    if ((managedEntry.icon ?? null) !== desiredIcon) {
      managedEntry.icon = desiredIcon;
      mutated = true;
    }
  }

  if (mutated) {
    await setPref("storageLocations", storageLocations);
  }
}

// Debounced observer over `browser.storage.onChanged`. Collapses
// bursts within a 500ms window into a single delivery; the delivered
// payload is an array of `{area, changes}` chunks, one per area that
// had at least one watched-pref change. `oldValue` on each change is
// preserved from the first event of the burst so consumers see the
// genuine before/after across the debounce window, not the last
// intermediate write.
export class StorageListener {
  #watchedPrefs = [];
  #listener = null;
  // Which storage area this listener subscribes to. `"auto"` (the
  // default) handles all areas reported by the storage event.
  // A specific string (`"local"`, `"managed"`, `"session"`, ...)
  // scopes the listener to that area only.
  #area = "auto";
  // Per-area pending changes, created on-demand for whichever areas
  // the storage event actually delivers. Single debounce timer
  // shared across areas so one burst = one emission.
  #byArea = new Map();
  #timeoutId;

  #emit() {
    this.#timeoutId = null;
    const events = [];
    for (const [area, bucket] of this.#byArea) {
      if (Object.keys(bucket.changes).length === 0) continue;
      events.push({ area, changes: bucket.changes });
    }
    this.#byArea.clear();
    if (events.length > 0) this.#listener(events);
  }

  #record(area, key, value) {
    let bucket = this.#byArea.get(area);
    if (!bucket) {
      bucket = { changes: {} };
      this.#byArea.set(area, bucket);
    }
    const existing = bucket.changes[key];
    bucket.changes[key] = existing
      ? { oldValue: existing.oldValue, newValue: value.newValue }
      : value;
  }

  #eventCollapse = async (changes, area) => {
    if (this.#area !== "auto" && this.#area !== area) return;

    if (area === "local") {
      for (const [key, value] of Object.entries(changes)) {
        if (!this.#watchedPrefs.includes(key)) continue;
        // Skip prefs currently overridden by managed storage - the
        // effective value hasn't changed, so consumers shouldn't wake.
        if ((await _getManagedPref(key)) !== undefined) continue;
        if (value.oldValue !== value.newValue) this.#record(area, key, value);
      }
    } else {
      // Non-local areas (managed, session, ...) forward raw changes
      // for every watched pref.
      for (const [key, value] of Object.entries(changes)) {
        if (this.#watchedPrefs.includes(key)) this.#record(area, key, value);
      }
    }

    let pending = false;
    for (const bucket of this.#byArea.values()) {
      if (Object.keys(bucket.changes).length > 0) { pending = true; break; }
    }
    if (pending) {
      clearTimeout(this.#timeoutId);
      this.#timeoutId = setTimeout(() => this.#emit(), 500);
    }
  }

  constructor(options = {}) {
    this.#watchedPrefs = options.watchedPrefs || [];
    this.#listener = options.listener;
    this.#area = options.area ?? "auto";
    browser.storage.onChanged.addListener(this.#eventCollapse);
  }
}