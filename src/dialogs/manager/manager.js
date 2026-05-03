/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const COMMUNITY_SCRIPTS_ID = "quicktext.scripts@community.jobisoft.de";

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import * as menus from "/modules/menus.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";

import { localizeDocument } from "/vendor/i18n.mjs";
import { getTagsMenuStructure, getDateTimeMenuTitle } from "/modules/menuStructure.mjs";
import { showDialog, showAlert, showConfirm, showPrompt } from "./popover.js";
const { computePosition, flip, shift } = FloatingUIDOM;

const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;
const applyManaged = (el, isManaged) => {
  el.disabled = isManaged;
  el.title = isManaged ? i18n("quicktext.controlledViaManagedStorage.label") : "";
};

function makeUnique(name, arr) {
  const sanitized = name
    .replaceAll("|", "/")
    .replaceAll("[[", "{[")
    .replaceAll("]]", "]}");
  let unique = sanitized;
  let suffix = 1;
  while (arr.includes(unique)) unique = `${sanitized} #${++suffix}`;
  return unique;
}

// ---------- State ----------
//
// `state.storageEntries` is the manager's working copy of
// `browser.storage.local.storageLocations`. Every entry carries a
// stable persisted `uuid` (minted by the storage.mjs migration at
// install time, or by `addStorageConfig` for new entries), and
// that uuid is the single identity used everywhere - at the
// cross-module boundary (compose menus, toolbars, content scripts,
// parser, menuStructure DOM ids) and inside the manager itself
// (selection state, `findBundle` lookups, tree DOM attributes).
//
// Bundles in `state.bundles` carry both a direct `entry` backref
// (convenient for renders that also need name/isReadOnly/etc.) and
// `storageUuid` for the canonical identity match.
//
// Collapse state lives on the bundle itself (`groupExpanded[gi]`
// per template group) so that removing or disabling a bundle
// automatically discards its collapse state and re-enabling starts
// fresh.

const state = {
  bundles: [],
  prefs: {},
  managedPrefs: new Set(),
  storageEntries: [],
  selectedTemplateStorageUuid: null,
  selectedGroupIdx: -1,
  selectedTextIdx: -1,    // -1 = group row is selected (when selectedGroupIdx !== -1)
  selectedScriptStorageUuid: null,
  selectedScriptIdx: -1,
  changed: false,
  // Mirrors `storage.hasManagedPolicy()` - when false, every
  // managed entry is hidden from the Templates/Scripts/Advanced
  // tabs regardless of whether it's persisted in storageLocations.
  // Refreshed at runtime whenever managed-area content changes.
  hasManagedStorage: false,
  deprecatedUsages: null,
  providerAvailability: {},
};

function isMultiStorage() {
  return state.bundles.length > 1
    || state.bundles.some(b => b.unavailable);
}

function findBundle(uuid) {
  if (uuid == null) return null;
  return state.bundles.find(b => b.storageUuid === uuid) ?? null;
}

// ---------- Storage icons ----------
//
// Cached VFS provider connections - fetched once in `loadAll` so
// renderTemplateList / renderScriptList / renderStorageList can resolve an
// icon URL synchronously instead of paying an async round-trip per
// paint. The list rarely changes; we refresh on storage add/remove.
let _vfsProviders = [];

// Provider icons arrive as Blobs. Wrap each one in a persistent
// object URL so repeated renders reuse the same resource instead
// of leaking a new URL every time the list rebuilds.
const _providerIconUrlCache = new Map();
function _providerIconUrl(providerId, blob) {
  if (!blob) return null;
  const cached = _providerIconUrlCache.get(providerId);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  _providerIconUrlCache.set(providerId, url);
  return url;
}

// Resolve the icon URL for a storage entry:
//   - managed entries with a policy-provided `icon` URL use that,
//     otherwise fall back to the dedicated "managed" glyph,
//   - OPFS (no storageRef) gets the Quicktext add-on icon,
//   - everything else looks up its provider icon in the cache.
function _storageIconUrl(entry) {
  if (!entry) return null;
  if (entry.type === "managed") {
    return entry.icon || browser.runtime.getURL("/assets/icon-managed.svg");
  }
  if (!entry.storageRef) return browser.runtime.getURL("/assets/icon.png");
  const provider = _vfsProviders.find(p => p.providerId === entry.storageRef.providerId);
  return _providerIconUrl(entry.storageRef.providerId, provider?.icon ?? null);
}

async function _refreshVfsProviders() {
  try {
    _vfsProviders = await vfs.fetchProviderConnections();
  } catch (ex) {
    console.log(ex);
    _vfsProviders = [];
  }
}

// ---------- Load / Save ----------

async function loadAll() {
  const prefNames = [
    "popup", "menuCollapse", "shortcutModifier", "shortcutTypeAdv",
    "keywordKey", "keywordCaseinsensitive", "counter", "defaultImport",
  ];
  for (const pref of prefNames) {
    const { value, isManaged } = await storage.getPrefWithManagedInfo(pref);
    state.prefs[pref] = value;
    if (isManaged) state.managedPrefs.add(pref);
  }

  // Cache VFS provider info once so storage-icon lookups stay
  // synchronous across every tab's render path.
  await _refreshVfsProviders();

  // Seed the "has managed policy" flag from the live managed area.
  // The runtime StorageListener refreshes it when the admin adds or
  // removes policy content.
  state.hasManagedStorage = await storage.hasManagedPolicy();

  // Seed provider availability from session storage. The background
  // script updates this whenever providers or connections change.
  const { providerAvailability } = await browser.storage.session.get({
    providerAvailability: {},
  });
  state.providerAvailability = providerAvailability;

  // Working copy of the persisted storage list. Each entry carries
  // a `type` field (`"vfs"` or `"managed"`) that `readBundleForEntry`
  // uses to decide whether to read from the VFS or from
  // `browser.storage.managed`. Bundles are paired to these clones
  // by uuid, so editing them in place doesn't corrupt the persisted
  // pref until saveAll flushes.
  const effective = await storage.getAllStorageEntries();
  state.storageEntries = effective.map(e => ({ ...e }));

  // Load bundles in a single pass. Disabled entries have no bundle
  // in memory at all - toggling them on later reads a fresh copy
  // via the same helper.
  state.bundles = [];
  for (const entry of state.storageEntries) {
    if (entry.enabled === false) continue;
    if (entry.type === "managed" && !state.hasManagedStorage) continue;
    await _addBundle(entry);
  }
  // Append one read-only bundle per enabled import that has fetched
  // content. Imports are not persisted in `storageLocations` - their
  // source of truth is `defaultImport` - so they're rebuilt from
  // `state.prefs.defaultImport` here and again on every change to that
  // pref (see the local-area StorageListener callback below).
  _rebuildImportBundles();

  // Load cached deprecation results so script-list ⚠️ icons work
  // immediately without re-running detection.
  const { deprecatedUsages } = await browser.storage.local.get({ deprecatedUsages: null });
  state.deprecatedUsages = deprecatedUsages;
  _indexDeprecatedUsages();
}

function _rebuildImportBundles() {
  state.bundles = state.bundles.filter(b => !b.isImport);
  for (const entry of state.prefs.defaultImport) {
    if (entry.enabled === false) continue;
    if (!entry.data) continue;
    const groups = entry.data.templates?.groups ?? [];
    state.bundles.push({
      storageUuid: entry.uuid,
      storageName: entry.name,
      isReadOnly: true,
      isImport: true,
      iconUrl: entry.icon || browser.runtime.getURL("/assets/icon-globe.svg"),
      groups,
      texts: entry.data.templates?.texts ?? [],
      scripts: entry.data.scripts ?? [],
      groupExpanded: groups.map(() => true),
      dirty: false,
    });
  }
}

// Single re-render path for any in-memory mutation of
// `state.prefs.defaultImport`. Rebuilds the import bundles and
// updates every view that reflects them. Rescues any
// Templates/Scripts selection that pointed at an import bundle that
// no longer exists (user disabled/removed it, or the admin revoked
// a managed policy entry mid-session) and re-renders the detail
// panes when that happens.
function _refreshImportViews() {
  _rebuildImportBundles();
  const rescued = _rescueOrphanedSelections();
  renderImportList();
  renderTemplateList();
  renderScriptList();
  if (rescued) {
    renderTemplateDetail();
    renderScriptDetail();
  }
}

// Build the storage-header element for an import bundle. Shared by
// `renderTemplateList` (wraps it in a `tree-storage` div) and `renderScriptList`
// (uses it directly as a list item). Imports are always read-only, so
// the lock glyph is unconditional.
function _buildImportStorageHeader(bundle, { elementType, className, isSelected, onClick }) {
  const header = document.createElement(elementType);
  header.className = className;
  header.dataset.uuid = bundle.storageUuid;
  if (isSelected()) header.classList.add("selected");

  const icon = document.createElement("img");
  icon.className = "storage-header-icon";
  icon.src = bundle.iconUrl;
  icon.alt = "";
  header.appendChild(icon);

  const nameSpan = document.createElement("span");
  nameSpan.className = "tree-name";
  nameSpan.textContent = bundle.storageName;
  nameSpan.title = bundle.storageName;
  header.appendChild(nameSpan);

  const lockEl = document.createElement("span");
  lockEl.className = "storage-header-lock";
  lockEl.textContent = "🔒";
  lockEl.title = i18n("quicktext.storageList.readOnly.label");
  header.appendChild(lockEl);

  header.addEventListener("click", onClick);
  return header;
}

// Pre-Save in-memory fetch on add/enable so the user sees fetched
// content live in Templates/Scripts tabs before clicking Save. The
// stale-completion guard discards the patch if the entry was removed
// or had its URL changed mid-fetch.
async function _fetchAndApplyImport(entry) {
  const patch = await storage.fetchImportOnce(entry);
  const current = state.prefs.defaultImport.find(e => e.uuid === entry.uuid);
  if (!current || current.url !== entry.url) return;
  current.data = patch.data;
  current.status = patch.status;
  _refreshImportViews();
}

async function saveAll() {
  await storage.setPref("popup", state.prefs.popup);
  await storage.setPref("menuCollapse", state.prefs.menuCollapse);
  await storage.setPref("shortcutModifier", state.prefs.shortcutModifier);
  await storage.setPref("shortcutTypeAdv", state.prefs.shortcutTypeAdv);
  await storage.setPref("keywordKey", state.prefs.keywordKey);
  await storage.setPref("keywordCaseinsensitive", state.prefs.keywordCaseinsensitive);
  await storage.setPref("defaultImport", state.prefs.defaultImport);
  // The storage list (including enabled flags, type, name and
  // ordering) is part of the regular Save flow. Storage-list edits
  // in the advanced tab auto-apply to the in-memory state, but
  // persistence waits until the user hits Save. The managed entry
  // (if any) is part of this list just like a VFS entry - its
  // rename/reorder persists, only its content lives elsewhere
  // (in browser.storage.managed) and is skipped by the bundle
  // content-write loop below via the read-only guard.
  await storage.setPref("storageLocations", state.storageEntries);

  // Persist per-bundle edits only for bundles the user actually
  // touched (and that are writable). Templates and scripts share a
  // single config file, so one dirty flag covers both and the whole
  // bundle is written in one read-modify-write.
  for (const entry of state.storageEntries) {
    const bundle = findBundle(entry.uuid);
    if (!bundle || bundle.isReadOnly) continue;
    if (!bundle.dirty) continue;
    const templates = { groups: bundle.groups, texts: bundle.texts };
    await storage.setBundleForStorage(entry.uuid, { templates, scripts: bundle.scripts });
    await utils.checkBadNameEntries(templates, bundle.scripts);
    await utils.checkDuplicatedEntries(templates, bundle.scripts);
    bundle.dirty = false;
  }

  markSaved();
}

function markChanged(bundle) {
  if (bundle) bundle.dirty = true;
  state.changed = true;
  document.getElementById("btn-save").disabled = false;
}

function markSaved() {
  state.changed = false;
  document.getElementById("btn-save").disabled = true;
}

// ---------- Tab management ----------

function switchTab(tabName) {
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  }
  for (const panel of document.querySelectorAll(".tab-panel")) {
    panel.hidden = panel.id !== `panel-${tabName}`;
  }
  browser.menus.update("managerInsertTagMenu", { visible: false });
  updateScriptHelpButton();
  updateCommunityScriptsButton();
}

function updateCommunityScriptsButton() {
  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  const show = ["scripts", "templates"].includes(activeTab) && !state.communityScriptsInstalled;
  document.getElementById("btn-community-scripts").hidden = !show;
}

function updateScriptHelpButton() {
  const onScriptsTab = document.querySelector(".tab-btn.active")?.dataset.tab === "scripts";
  const bundle = findBundle(state.selectedScriptStorageUuid);
  const script = bundle && state.selectedScriptIdx !== -1
    ? bundle.scripts[state.selectedScriptIdx]
    : null;
  const dep = onScriptsTab && script
    ? _getDeprecatedScript(state.selectedScriptStorageUuid, script.name)
    : null;
  document.getElementById("btn-script-help").hidden = !dep?.issues?.includes("deprecated-api");
}

// ---------- General tab ----------

function updateCounterLegend() {
  document.getElementById("lbl-counter").textContent =
    `${i18n("quicktext.counter.label")}: ${state.prefs.counter}`;
}

function renderGeneral() {
  const managed = key => state.managedPrefs.has(key);

  const chkPopup = document.getElementById("chk-popup");
  chkPopup.checked = state.prefs.popup;
  applyManaged(chkPopup, managed("popup"));
  chkPopup.addEventListener("change", () => { state.prefs.popup = chkPopup.checked; markChanged(); });

  const chkCollapse = document.getElementById("chk-collapse");
  chkCollapse.checked = state.prefs.menuCollapse;
  applyManaged(chkCollapse, managed("menuCollapse"));
  chkCollapse.addEventListener("change", () => { state.prefs.menuCollapse = chkCollapse.checked; markChanged(); });

  const selModifier = document.getElementById("sel-modifier");
  selModifier.value = state.prefs.shortcutModifier;
  applyManaged(selModifier, managed("shortcutModifier"));
  selModifier.addEventListener("change", () => {
    state.prefs.shortcutModifier = selModifier.value;
    updateShortcutAdvAvailability();
    markChanged();
    refreshShortcutUI();
  });

  const chkShortcutAdv = document.getElementById("chk-shortcut-adv");
  chkShortcutAdv.checked = state.prefs.shortcutTypeAdv;
  chkShortcutAdv.addEventListener("change", () => { state.prefs.shortcutTypeAdv = chkShortcutAdv.checked; markChanged(); refreshShortcutUI(); });
  updateShortcutAdvAvailability();

  const selKeyword = document.getElementById("sel-keyword");
  selKeyword.value = state.prefs.keywordKey;
  applyManaged(selKeyword, managed("keywordKey"));
  selKeyword.addEventListener("change", () => { state.prefs.keywordKey = selKeyword.value; markChanged(); });

  const chkKeywordCI = document.getElementById("chk-keyword-ci");
  chkKeywordCI.checked = state.prefs.keywordCaseinsensitive;
  applyManaged(chkKeywordCI, managed("keywordCaseinsensitive"));
  chkKeywordCI.addEventListener("change", () => { state.prefs.keywordCaseinsensitive = chkKeywordCI.checked; markChanged(); });

  document.getElementById("btn-reset-counter").addEventListener("click", () => {
    state.prefs.counter = 0;
    storage.setPref("counter", 0);
    updateCounterLegend();
  });

  document.getElementById("btn-update-counter").addEventListener("click", async () => {
    const raw = await showPrompt(i18n("quicktext.updatecounter.prompt"), String(state.prefs.counter));
    if (raw === null) return;
    const value = parseInt(raw.trim(), 10);
    if (!Number.isFinite(value) || value < 0) return;
    state.prefs.counter = value;
    storage.setPref("counter", value);
    updateCounterLegend();
  });
}

function updateShortcutAdvAvailability() {
  const ua = navigator.userAgent.toLowerCase();
  const forceOff = ua.includes("mac") ||
    (ua.includes("win") && state.prefs.shortcutModifier === "alt");
  const chk = document.getElementById("chk-shortcut-adv");
  const isManaged = state.managedPrefs.has("shortcutTypeAdv");
  chk.disabled = isManaged || forceOff;
  chk.title = isManaged ? i18n("quicktext.controlledViaManagedStorage.label") : "";
}

// ---------- Import tab ----------
//
// A flat list of `{name, url}` entries the add-on will fetch on
// import (fetch/cache/integration is a follow-up pass - this tab
// only lets the user edit the pointer list). Add/rename/remove/
// drag-reorder via the same patterns as the Storage Locations tab.

function _selectedImportListEntry() {
  const sel = document.getElementById("import-list").querySelector("li.selected");
  if (!sel) return null;
  const idx = parseInt(sel.dataset.idx, 10);
  return state.prefs.defaultImport[idx] ?? null;
}

function _selectedImportListIdx() {
  const sel = document.getElementById("import-list").querySelector("li.selected");
  if (!sel) return -1;
  return parseInt(sel.dataset.idx, 10);
}

function updateImportListButtons() {
  const selected = _selectedImportListEntry();
  const selectedManaged = selected?.managed === true;
  const managedTooltip = selectedManaged
    ? i18n("quicktext.controlledViaManagedStorage.label")
    : "";
  document.getElementById("btn-add-import").disabled = false;
  const renameBtn = document.getElementById("btn-rename-import");
  const removeBtn = document.getElementById("btn-remove-import");
  renameBtn.disabled = !selected || selectedManaged;
  renameBtn.title = managedTooltip;
  removeBtn.disabled = !selected || selectedManaged;
  removeBtn.title = managedTooltip;
}

function renderImportList() {
  const list = document.getElementById("import-list");
  const previouslySelected = _selectedImportListIdx();
  list.innerHTML = "";
  _setupListDropFallback(list, {
    dragType: "quicktext.import.label",
    onDrop: () => {
      const src = dragSrc.idx;
      const lastIdx = state.prefs.defaultImport.length - 1;
      if (src === lastIdx) return;
      const [moved] = state.prefs.defaultImport.splice(src, 1);
      state.prefs.defaultImport.push(moved);
      markChanged();
      renderImportList();
    },
  });

  // Sticky header row: empty enabled column, empty icon column, empty
  // lock column, Name column, URL column, Status column. The lock cell
  // is filled per-row for entries with `managed: true`; rows with
  // `managed: false` get an empty cell that still occupies the track
  // so columns align across mixed rows. URL is `minmax(0, 1fr)` so
  // long URLs truncate with an ellipsis rather than widening the list.
  const header = document.createElement("li");
  header.className = "header";
  for (const [cls, key] of [
    ["storage-enabled", null],
    ["storage-icon", null],
    ["storage-lock", null],
    ["storage-name", "quicktext.defaultImport.columns.name"],
    ["storage-path", "quicktext.defaultImport.columns.url"],
    ["import-status", "quicktext.defaultImport.columns.status"],
  ]) {
    const cell = document.createElement("span");
    cell.className = cls;
    if (key) cell.textContent = i18n(key);
    header.appendChild(cell);
  }
  list.appendChild(header);

  const managedTooltip = i18n("quicktext.controlledViaManagedStorage.label");
  for (let i = 0; i < state.prefs.defaultImport.length; i++) {
    const entry = state.prefs.defaultImport[i];
    const li = document.createElement("li");
    li.dataset.idx = i;
    if (i === previouslySelected) li.classList.add("selected");

    // Enabled checkbox. Managed rows are forcefully enabled and
    // cannot be toggled off. Toggling a non-managed row is a cheap
    // state flip plus a full list re-render. On a false → true
    // transition, queue the URL so `saveAll` kicks off a fresh fetch.
    const enabledEl = document.createElement("span");
    enabledEl.className = "storage-enabled";
    const enabledBox = document.createElement("input");
    enabledBox.type = "checkbox";
    enabledBox.checked = entry.enabled !== false;
    enabledBox.disabled = entry.managed === true;
    enabledBox.addEventListener("click", e => {
      e.stopPropagation();
      const wasEnabled = entry.enabled !== false;
      entry.enabled = enabledBox.checked;
      markChanged();
      _refreshImportViews();
      if (!wasEnabled && entry.enabled) _fetchAndApplyImport(entry);
    });
    enabledEl.appendChild(enabledBox);

    const iconEl = document.createElement("span");
    iconEl.className = "storage-icon";
    const img = document.createElement("img");
    img.src = entry.icon || browser.runtime.getURL("/assets/icon-globe.svg");
    img.alt = "";
    iconEl.appendChild(img);

    const lockEl = document.createElement("span");
    lockEl.className = "storage-lock";
    if (entry.managed) {
      lockEl.textContent = "🔒";
      lockEl.title = managedTooltip;
    }

    const nameEl = document.createElement("span");
    nameEl.className = "storage-name";
    nameEl.textContent = entry.name || "(unnamed)";
    nameEl.title = nameEl.textContent;

    const urlEl = document.createElement("span");
    urlEl.className = "storage-path";
    urlEl.textContent = entry.url;
    urlEl.title = entry.url;

    // Fetch-status cell: ok/fail glyph + absolute timestamp. Empty
    // until the first fetch attempt lands. Tooltip carries the error
    // message on failure.
    const statusEl = document.createElement("span");
    statusEl.className = "import-status";
    if (entry.status) {
      const ok = !entry.status.error;
      const glyph = document.createElement("span");
      glyph.className = ok ? "import-status-ok" : "import-status-fail";
      glyph.textContent = ok ? "✓" : "✗";
      const time = document.createElement("span");
      time.textContent = " " + _formatAbsoluteTimestamp(entry.status.timestamp);
      statusEl.append(glyph, time);
      if (entry.status.error) statusEl.title = entry.status.error;
    }

    li.append(enabledEl, iconEl, lockEl, nameEl, urlEl, statusEl);
    li.addEventListener("click", () => {
      list.querySelectorAll("li").forEach(el => el.classList.remove("selected"));
      li.classList.add("selected");
      updateImportListButtons();
    });
    // Every row is draggable - the user can freely interleave managed
    // and user-owned entries. Reordering rewrites local `defaultImport`
    // on Save; the `managed` flag rides along so reconcile keeps the
    // row in its user-chosen slot on the next policy update.
    li.draggable = true;
    setupImportListDrag(li, i);
    list.appendChild(li);
  }
  updateImportListButtons();
}

async function addImportListEntry() {
  const result = await showDialog({
    title: i18n("quicktext.dialog.addImport.label"),
    fields: [
      { id: "name", label: i18n("quicktext.defaultImport.columns.name"), type: "text" },
      { id: "url", label: i18n("quicktext.defaultImport.columns.url"), type: "url", value: "https://", required: true },
    ],
    buttons: [
      { id: "cancel", label: i18n("quicktext.close.label") },
      { id: "ok", label: i18n("quicktext.buttons.addConfig.label"), primary: true },
    ],
    onButton: async (buttonId, values, api) => {
      if (buttonId === "cancel") return true;
      api.setError("");
      const url = values.url.trim();
      if (!url) {
        api.setError(i18n("quicktext.defaultImport.invalidUrl.label"));
        return false;
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        api.setError(i18n("quicktext.defaultImport.invalidUrl.label"));
        return false;
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        api.setError(i18n("quicktext.defaultImport.invalidUrl.label"));
        return false;
      }
      const duplicate = state.prefs.defaultImport.find(e => e.url === url);
      if (duplicate) {
        api.setError(i18n("quicktext.defaultImport.duplicate.label", [duplicate.name || duplicate.url]));
        return false;
      }
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        if (!res.ok) {
          api.setError(`Connect error: ${res.status} ${res.statusText}`);
          return false;
        }
      } catch (e) {
        api.setError(`Connect error: ${e.message}`);
        return false;
      }
      return true;
    },
  });
  if (!result || result.button !== "ok") return;
  const url = result.values.url.trim();
  const rawName = result.values.name.trim();
  const baseName = rawName || _deriveImportListEntryName(url);
  const others = state.prefs.defaultImport.map(e => e.name).filter(Boolean);
  const newEntry = {
    uuid: crypto.randomUUID(),
    name: makeUnique(baseName, others),
    url,
    icon: null,
    managed: false,
    enabled: true,
    data: null,
    status: null,
  };
  state.prefs.defaultImport.push(newEntry);
  markChanged();
  _refreshImportViews();
  const list = document.getElementById("import-list");
  const newRow = list.querySelector(`li[data-idx="${state.prefs.defaultImport.length - 1}"]`);
  if (newRow) {
    list.querySelectorAll("li").forEach(el => el.classList.remove("selected"));
    newRow.classList.add("selected");
    updateImportListButtons();
  }
  _fetchAndApplyImport(newEntry);
}

async function renameImportListEntry() {
  const idx = _selectedImportListIdx();
  const entry = state.prefs.defaultImport[idx];
  if (!entry || entry.managed) return;
  const raw = await showPrompt(i18n("quicktext.defaultImport.rename.prompt"), entry.name || "");
  if (raw == null) return;
  const others = state.prefs.defaultImport
    .filter((_, i) => i !== idx)
    .map(e => e.name)
    .filter(Boolean);
  const next = makeUnique(raw.trim() || entry.name || "", others);
  if (!next || next === entry.name) return;
  entry.name = next;
  markChanged();
  _refreshImportViews();
}

async function removeImportListEntry() {
  const idx = _selectedImportListIdx();
  const entry = state.prefs.defaultImport[idx];
  if (!entry || entry.managed) return;
  if (!await showConfirm(i18n("quicktext.defaultImport.confirmRemove.label", [entry.name || entry.url]))) return;
  state.prefs.defaultImport.splice(idx, 1);
  markChanged();
  _refreshImportViews();
}

function setupImportListDrag(el, idx) {
  const list = document.getElementById("import-list");
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "quicktext.import.label", idx };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "quicktext.import.label");
  });
  el.addEventListener("dragend", () => {
    _clearDropIndicators(list);
    dragSrc = null;
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "quicktext.import.label") return;
    e.preventDefault();
    _clearDropIndicators(list);
    _setDropIndicator(el, e.clientY);
  });
  el.addEventListener("drop", e => {
    e.preventDefault();
    if (dragSrc?.type !== "quicktext.import.label") return;
    const src = dragSrc.idx;
    const below = el.classList.contains("drop-below");
    _clearDropIndicators(list);
    dragSrc = null;
    const insertionPoint = below ? idx + 1 : idx;
    if (src === insertionPoint || src === insertionPoint - 1) return;
    const [moved] = state.prefs.defaultImport.splice(src, 1);
    const dest = src < insertionPoint ? insertionPoint - 1 : insertionPoint;
    state.prefs.defaultImport.splice(dest, 0, moved);
    markChanged();
    renderImportList();
  });
}

// Extract a sensible default display name from a URL: last
// non-empty path segment, or hostname if the path is empty. Used
// at add-time; the user can rename anytime afterward.
function _deriveImportListEntryName(url) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : u.hostname;
  } catch {
    return url;
  }
}

// Absolute local-time timestamp in `YYYY-MM-DD HH:MM` for the Imports
// tab's Status column. Short enough to fit the column, sortable, and
// unambiguous (no "2h ago" staleness between renders).
function _formatAbsoluteTimestamp(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Template tree ----------

let dragSrc = null;

function renderTemplateList() {
  const container = document.getElementById("template-tree");
  const scrollTop = container.scrollTop;
  container.innerHTML = "";

  const multi = isMultiStorage();
  // Iterate storageEntries so the tree order matches the advanced
  // tab's storage list. Disabled storages have no bundle and are
  // skipped.
  for (const entry of state.storageEntries) {
    if (entry.enabled === false) continue;
    // Managed entries stay in `storageLocations` across policy
    // churn (so user reorder/rename is preserved), but they're
    // hidden from the UI whenever the live policy has no Quicktext
    // data - `state.hasManagedStorage` is refreshed by the runtime
    // StorageListener when the admin adds or removes policy keys.
    if (entry.type === "managed" && !state.hasManagedStorage) continue;
    const bundle = findBundle(entry.uuid);
    if (!bundle) continue;

    if (multi) {
      const storageEl = document.createElement("div");
      storageEl.className = "tree-storage";
      storageEl.dataset.uuid = entry.uuid;

      const storageHeader = document.createElement("div");
      storageHeader.className = "tree-storage-header";
      if (state.selectedTemplateStorageUuid === entry.uuid && state.selectedGroupIdx === -1) {
        storageHeader.classList.add("selected");
      }
      storageHeader.addEventListener("click", () => selectStorage(entry.uuid));

      const iconUrl = _storageIconUrl(entry);
      if (iconUrl) {
        const storageIcon = document.createElement("img");
        storageIcon.className = "storage-header-icon";
        storageIcon.src = iconUrl;
        storageIcon.alt = "";
        storageHeader.appendChild(storageIcon);
      }

      const storageName = document.createElement("span");
      storageName.className = "tree-name";
      storageName.textContent = bundle.storageName;
      storageName.title = bundle.storageName;

      storageHeader.appendChild(storageName);
      if (bundle.unavailable) {
        const unavailEl = document.createElement("span");
        unavailEl.className = "storage-header-unavailable";
        unavailEl.textContent = "🚫";
        unavailEl.title = i18n("quicktext.storage.providerUnavailable.label");
        storageHeader.appendChild(unavailEl);
      } else if (bundle.isReadOnly) {
        const lockEl = document.createElement("span");
        lockEl.className = "storage-header-lock";
        lockEl.textContent = "🔒";
        lockEl.title = i18n("quicktext.storageList.readOnly.label");
        storageHeader.appendChild(lockEl);
      }
      storageEl.appendChild(storageHeader);

      const storageChildren = document.createElement("div");
      storageChildren.className = "tree-storage-children";
      if (!bundle.unavailable) _renderGroupsForBundle(bundle, storageChildren);
      storageEl.appendChild(storageChildren);
      container.appendChild(storageEl);
    } else {
      // Single-storage mode: render groups directly into the container,
      // no storage wrapper. Layout is identical to the pre-refactor tree.
      _renderGroupsForBundle(bundle, container);
    }
  }

  // Import bundles always render as multi-storage (their own header),
  // since they originate outside `storageLocations` and need to be
  // visually distinct from regular storages.
  for (const bundle of state.bundles) {
    if (!bundle.isImport) continue;
    const storageEl = document.createElement("div");
    storageEl.className = "tree-storage";
    storageEl.dataset.uuid = bundle.storageUuid;

    const storageHeader = _buildImportStorageHeader(bundle, {
      elementType: "div",
      className: "tree-storage-header",
      isSelected: () => state.selectedTemplateStorageUuid === bundle.storageUuid
        && state.selectedGroupIdx === -1,
      onClick: () => selectStorage(bundle.storageUuid),
    });
    storageEl.appendChild(storageHeader);

    const storageChildren = document.createElement("div");
    storageChildren.className = "tree-storage-children";
    _renderGroupsForBundle(bundle, storageChildren);
    storageEl.appendChild(storageChildren);
    container.appendChild(storageEl);
  }

  container.scrollTop = scrollTop;
  updateTemplateButtons();
}

function _renderGroupsForBundle(bundle, container) {
  const uuid = bundle.storageUuid;
  const isReadOnly = bundle.isReadOnly;
  for (let gi = 0; gi < bundle.groups.length; gi++) {
    const group = bundle.groups[gi];
    const expanded = bundle.groupExpanded[gi] !== false;

    const groupEl = document.createElement("div");
    groupEl.className = "tree-group";
    groupEl.dataset.uuid = uuid;
    groupEl.dataset.gi = gi;

    const header = document.createElement("div");
    header.className = "tree-group-header";
    if (state.selectedTemplateStorageUuid === uuid && state.selectedGroupIdx === gi && state.selectedTextIdx === -1) {
      header.classList.add("selected");
    }
    header.draggable = !isReadOnly;

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = expanded ? "▼" : "▶";

    const nameSpan = document.createElement("span");
    nameSpan.className = "tree-name";
    nameSpan.textContent = group.name;
    nameSpan.title = group.name;

    header.appendChild(toggle);
    header.appendChild(nameSpan);
    header.addEventListener("click", () => selectItem(uuid, gi, -1));
    // Double-click anywhere on the row toggles expansion - the
    // toggle icon is a visual indicator only.
    header.addEventListener("dblclick", () => {
      bundle.groupExpanded[gi] = !expanded;
      renderTemplateList();
    });
    if (!isReadOnly) setupGroupDrag(header, bundle, gi);

    groupEl.appendChild(header);

    if (expanded) {
      const children = document.createElement("div");
      children.className = "tree-children";
      for (let ti = 0; ti < (bundle.texts[gi] || []).length; ti++) {
        const tmpl = bundle.texts[gi][ti];
        const tmplEl = document.createElement("div");
        tmplEl.className = "tree-template";
        tmplEl.dataset.uuid = uuid;
        tmplEl.dataset.gi = gi;
        tmplEl.dataset.ti = ti;
        if (state.selectedTemplateStorageUuid === uuid && state.selectedGroupIdx === gi && state.selectedTextIdx === ti) {
          tmplEl.classList.add("selected");
        }
        tmplEl.draggable = !isReadOnly;

        const nameEl = document.createElement("span");
        nameEl.className = "tree-name";
        nameEl.textContent = tmpl.name;
        nameEl.title = tmpl.name;

        const shortcutEl = document.createElement("span");
        shortcutEl.className = "tree-shortcut";
        shortcutEl.textContent = tmpl.shortcut || "";

        tmplEl.appendChild(nameEl);
        tmplEl.appendChild(shortcutEl);

        const tmplDeprecation = _getDeprecatedTemplate(uuid, group.name, tmpl.name);
        if (tmplDeprecation) {
          const warn = document.createElement("span");
          warn.className = "tree-warn-icon";
          warn.textContent = "⚠️";
          warn.title = _deprecationTooltip(tmplDeprecation);
          tmplEl.appendChild(warn);
        }
        tmplEl.addEventListener("click", () => selectItem(uuid, gi, ti));
        if (!isReadOnly) setupTemplateDrag(tmplEl, bundle, gi, ti);

        children.appendChild(tmplEl);
      }
      groupEl.appendChild(children);
    }

    container.appendChild(groupEl);
  }
}

function selectItem(uuid, gi, ti) {
  commitTemplateEdits();
  const storageChanged = state.selectedTemplateStorageUuid !== uuid;
  state.selectedTemplateStorageUuid = uuid;
  state.selectedGroupIdx = gi;
  state.selectedTextIdx = ti;
  _updateTemplateListSelection();
  updateTemplateButtons();
  renderTemplateDetail();
  // The Insert Tag flyout is scoped to the selected template's
  // storage, so rebuild it whenever the storage changes.
  if (storageChanged) buildInsertTagMenu();
}

// Storage-header click (multi-storage mode only): selects the
// storage itself with no group/template, so the user can target an
// empty storage when adding a new group. The detail pane blanks
// out since no group is selected.
function selectStorage(uuid) {
  selectItem(uuid, -1, -1);
}

function _updateTemplateListSelection() {
  const container = document.getElementById("template-tree");
  for (const el of container.querySelectorAll(".selected")) {
    el.classList.remove("selected");
  }
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (!uuid) return;
  let target;
  if (gi === -1) {
    // Storage-header selection only exists in multi-storage mode.
    // In single-storage mode the header isn't rendered, so there's
    // nothing to highlight - the detail pane being empty is the
    // only visual cue.
    target = container.querySelector(`.tree-storage[data-uuid="${uuid}"] > .tree-storage-header`);
  } else if (ti === -1) {
    target = container.querySelector(`.tree-group[data-uuid="${uuid}"][data-gi="${gi}"] > .tree-group-header`);
  } else {
    target = container.querySelector(`.tree-template[data-uuid="${uuid}"][data-gi="${gi}"][data-ti="${ti}"]`);
  }
  target?.classList.add("selected");
}

function commitTemplateEdits() {
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (!uuid || gi === -1 || ti === -1) return;
  const bundle = findBundle(uuid);
  if (!bundle || bundle.isReadOnly) return;
  const tmpl = bundle.texts[gi]?.[ti];
  if (!tmpl) return;
  tmpl.text = document.getElementById("text-body").value;
  tmpl.type = document.getElementById("sel-type").value;
  tmpl.keyword = document.getElementById("text-keyword").value.replace(/\s/g, "");
  tmpl.subject = document.getElementById("text-subject").value;
  const advMode = state.prefs.shortcutTypeAdv && !isShortcutAdvForced();
  tmpl.shortcut = advMode
    ? document.getElementById("text-shortcut-adv").value.replace(/\D/g, "")
    : document.getElementById("sel-shortcut").value;
}

function renderTemplateDetail() {
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;

  if (!uuid || gi === -1) {
    document.getElementById("detail-caption").textContent = i18n("quicktext.storageList.columns.connection");
    setTemplateFieldsVisible(false);
    setTemplateFieldsEnabled(false);
    browser.menus.update("managerInsertTagMenu", { enabled: false });
    // When a storage header is selected, show its name in the title
    // field. Editable for any writable VFS storage; `onTitleInput`
    // writes the new name into `entry.name` and patches the visible
    // headers. Imports aren't in `state.storageEntries`, so fall back
    // to the in-memory bundle for their displayed name.
    const selectedEntry = uuid ? state.storageEntries.find(e => e.uuid === uuid) : null;
    const selectedBundle = uuid ? findBundle(uuid) : null;
    const titleEl = document.getElementById("text-title");
    titleEl.value = selectedEntry?.name ?? selectedBundle?.storageName ?? "";
    titleEl.disabled = !selectedEntry || selectedEntry.type === "managed";
    document.getElementById("text-body").value = "";
    return;
  }

  const bundle = findBundle(uuid);
  const isGroup = ti === -1;
  const isReadOnly = !!bundle?.isReadOnly;

  document.getElementById("detail-caption").textContent = i18n(isGroup ? "quicktext.group.label" : "quicktext.template.label");
  setTemplateFieldsVisible(!isGroup);
  setTemplateFieldsEnabled(!isGroup && !isReadOnly);
  browser.menus.update("managerInsertTagMenu", { enabled: !isGroup && !isReadOnly });
  // When a group is selected, only the title field is relevant - enable it for renaming.
  if (isGroup) document.getElementById("text-title").disabled = isReadOnly;

  if (isGroup) {
    document.getElementById("text-title").value = bundle.groups[gi].name;
    document.getElementById("text-body").value = "";
  } else {
    const tmpl = bundle.texts[gi][ti];
    document.getElementById("text-title").value = tmpl.name;
    document.getElementById("text-body").value = tmpl.text || "";
    document.getElementById("text-keyword").value = tmpl.keyword || "";
    document.getElementById("text-subject").value = tmpl.subject || "";
    document.getElementById("sel-type").value = tmpl.type || "text/plain";
    renderShortcutUI(tmpl.shortcut || "");
  }
}

function setTemplateFieldsVisible(show) {
  for (const el of document.querySelectorAll(".template-only")) {
    el.hidden = !show;
  }
}

function setTemplateFieldsEnabled(enabled) {
  for (const id of ["text-title", "text-body", "sel-type", "sel-shortcut",
    "text-shortcut-adv", "text-keyword", "text-subject", "btn-insert-tag"]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }
}

function isShortcutAdvForced() {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes("mac") || (ua.includes("win") && state.prefs.shortcutModifier === "alt");
}

function refreshShortcutUI() {
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (uuid && gi !== -1 && ti !== -1) {
    const bundle = findBundle(uuid);
    renderShortcutUI(bundle.texts[gi][ti].shortcut || "");
  }
}

function renderShortcutUI(shortcut) {
  const advMode = state.prefs.shortcutTypeAdv && !isShortcutAdvForced();
  document.getElementById("sel-shortcut").hidden = advMode;
  document.getElementById("text-shortcut-adv").hidden = !advMode;

  const modKey = { alt: i18n("quicktext.altKey.label"), control: i18n("quicktext.controlKey.label"), meta: i18n("quicktext.metaKey.label") }[state.prefs.shortcutModifier] || "";
  document.getElementById("label-modifier").textContent = `${modKey}+`;

  if (advMode) {
    document.getElementById("text-shortcut-adv").value = shortcut;
  } else {
    const sel = document.getElementById("sel-shortcut");
    if (shortcut === "0") sel.selectedIndex = 10;
    else if (shortcut && !isNaN(parseInt(shortcut))) sel.selectedIndex = parseInt(shortcut);
    else sel.selectedIndex = 0;
    disableUsedShortcuts(shortcut);
  }
}

function disableUsedShortcuts(currentShortcut) {
  const sel = document.getElementById("sel-shortcut");
  for (const opt of sel.options) opt.disabled = false;
  // Only consider shortcuts in the same storage as the current template;
  // shortcuts collide within a storage, not across the whole install.
  const bundle = findBundle(state.selectedTemplateStorageUuid);
  if (!bundle) return;
  for (let g = 0; g < bundle.groups.length; g++) {
    for (const tmpl of (bundle.texts[g] || [])) {
      const s = tmpl.shortcut;
      if (!s || s === currentShortcut) continue;
      const idx = s === "0" ? 10 : parseInt(s);
      if (sel.options[idx]) sel.options[idx].disabled = true;
    }
  }
}

function updateTemplateButtons() {
  const bundle = findBundle(state.selectedTemplateStorageUuid);
  const canAddToStorage = bundle && !bundle.isReadOnly && !bundle.unavailable;
  const canEdit = canAddToStorage && state.selectedGroupIdx !== -1;
  // "Add group" requires a writable selected storage (so the
  // insert target is unambiguous); "Add/Remove template" also
  // requires a group to exist and be selected.
  document.getElementById("btn-add-group").disabled = !canAddToStorage;
  document.getElementById("btn-add-template").disabled = !canEdit;
  document.getElementById("btn-remove-template").disabled = !canEdit;
}

function addGroup() {
  commitTemplateEdits();
  const bundle = findBundle(state.selectedTemplateStorageUuid);
  if (!bundle || bundle.isReadOnly) return;
  const name = makeUnique(i18n("quicktext.newGroup.label"), bundle.groups.map(g => g.name));
  bundle.groups.push({ name });
  bundle.texts.push([]);
  bundle.groupExpanded.push(true);
  state.selectedGroupIdx = bundle.groups.length - 1;
  state.selectedTextIdx = -1;
  markChanged(bundle);
  renderTemplateList();
  renderTemplateDetail();
  const el = document.getElementById("text-title");
  el.focus();
  el.select();
}

function addTemplate() {
  commitTemplateEdits();
  // Require a group to be selected in a writable storage.
  const bundle = findBundle(state.selectedTemplateStorageUuid);
  if (!bundle || bundle.isReadOnly) return;
  let gi = state.selectedGroupIdx;
  if (gi === -1) { if (!bundle.groups.length) return; gi = 0; }
  const name = makeUnique(i18n("quicktext.newTemplate.label"), (bundle.texts[gi] || []).map(t => t.name));
  if (!bundle.texts[gi]) bundle.texts[gi] = [];
  bundle.texts[gi].push({ name, text: "", shortcut: "", type: "text/plain", keyword: "", subject: "" });
  bundle.groupExpanded[gi] = true;
  state.selectedGroupIdx = gi;
  state.selectedTextIdx = bundle.texts[gi].length - 1;
  markChanged(bundle);
  renderTemplateList();
  renderTemplateDetail();
  const el = document.getElementById("text-title");
  el.focus();
  el.select();
}

async function removeTemplateOrGroup() {
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  const bundle = findBundle(uuid);
  if (!bundle || bundle.isReadOnly || gi === -1) return;
  const name = ti === -1 ? bundle.groups[gi].name : bundle.texts[gi][ti].name;
  if (!await showConfirm(i18n("quicktext.confirmRemove.label", [name]))) return;
  if (ti === -1) {
    bundle.groups.splice(gi, 1);
    bundle.texts.splice(gi, 1);
    bundle.groupExpanded.splice(gi, 1);
    state.selectedGroupIdx = Math.min(gi, bundle.groups.length - 1);
    if (bundle.groups.length === 0) state.selectedGroupIdx = -1;
    state.selectedTextIdx = -1;
  } else {
    bundle.texts[gi].splice(ti, 1);
    state.selectedTextIdx = bundle.texts[gi].length > 0
      ? Math.min(ti, bundle.texts[gi].length - 1) : -1;
  }
  markChanged(bundle);
  renderTemplateList();
  renderTemplateDetail();
}

// ---------- Template drag-and-drop ----------
//
// Drag and drop is only allowed within a single bundle: reordering
// across storages would silently rewrite keywords/shortcuts that may
// collide in the destination, so we reject cross-bundle drops up
// front by comparing the bundle reference. Read-only bundles never
// attach drag handlers.

function setupGroupDrag(el, bundle, gi) {
  const tree = document.getElementById("template-tree");
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "quicktext.group.label", bundle, gi };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "quicktext.group.label");
  });
  el.addEventListener("dragend", () => {
    _clearDropIndicators(tree);
    dragSrc = null;
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "quicktext.group.label" || dragSrc.bundle !== bundle) return;
    e.preventDefault();
    _clearDropIndicators(tree);
    _setDropIndicator(el, e.clientY);
  });
  el.addEventListener("drop", e => {
    e.preventDefault();
    if (dragSrc?.type !== "quicktext.group.label" || dragSrc.bundle !== bundle) {
      dragSrc = null;
      return;
    }
    const src = dragSrc.gi;
    const below = el.classList.contains("drop-below");
    _clearDropIndicators(tree);
    dragSrc = null;
    const insertionPoint = below ? gi + 1 : gi;
    // No-op when dropping on self or on the line that represents
    // the group's own current position.
    if (src === insertionPoint || src === insertionPoint - 1) return;
    commitTemplateEdits();
    const [grp] = bundle.groups.splice(src, 1);
    const [txts] = bundle.texts.splice(src, 1);
    const [expanded] = bundle.groupExpanded.splice(src, 1);
    const dest = src < insertionPoint ? insertionPoint - 1 : insertionPoint;
    bundle.groups.splice(dest, 0, grp);
    bundle.texts.splice(dest, 0, txts);
    bundle.groupExpanded.splice(dest, 0, expanded);
    state.selectedTemplateStorageUuid = bundle.storageUuid;
    state.selectedGroupIdx = dest;
    state.selectedTextIdx = -1;
    markChanged(bundle);
    renderTemplateList();
    renderTemplateDetail();
  });
}

// Reorder storage-list entries via drag-and-drop. Operates on the
// flat `state.storageEntries` array - uuid-based selection state
// and `findBundle` lookups don't care about order, and `saveAll`
// already persists the list verbatim, so one splice + re-render
// is enough. Cross-tab (Templates tree, Scripts list, Insert Tag
// flyout) stays in sync because all three iterate the same array.
//
// Drop feedback uses a thin line rendered as a pseudo-element
// above or below the row under the pointer, depending on whether
// the pointer is in the upper or lower half. This makes the
// insertion point unambiguous: the line sits exactly where the
// dragged row will land.
// Generic line-indicator helpers shared by every drag-reorder
// helper (storage list, template tree groups, template tree
// templates, script list). `container` scopes the clear so
// concurrent-but-different drags don't step on each other.
function _clearDropIndicators(container) {
  for (const el of container.querySelectorAll(".drop-above, .drop-below")) {
    el.classList.remove("drop-above", "drop-below");
  }
}
function _setDropIndicator(el, clientY) {
  // Grid-list rows use `display: contents` so the `<li>` itself has no
  // box - `getBoundingClientRect()` returns a zero-height rect. Fall
  // back to a child cell, which sits on the same grid row track and
  // therefore has the right vertical extent.
  let rect = el.getBoundingClientRect();
  if (rect.height === 0 && el.firstElementChild) {
    rect = el.firstElementChild.getBoundingClientRect();
  }
  const upper = clientY < rect.top + rect.height / 2;
  el.classList.add(upper ? "drop-above" : "drop-below");
}

// Container-level dragover/drop that catches the "empty space
// below the last row" case. When the pointer leaves the rows and
// enters the list's padding, row-level handlers stop firing, so
// `drop` would never fire and the drag-to-bottom gesture feels
// broken. This handler routes those events to the end of the
// list. Uses bubble-phase detection: if a row handler already
// called `preventDefault`, the event is marked handled and we
// skip.
// Container-level dragover/drop that catches the "empty space
// below the last row" case for a flat list. When the pointer
// leaves the rows and enters the container's padding, row-level
// handlers stop firing, so `drop` would never fire and the
// drag-to-bottom gesture feels broken. The fallback routes those
// events to the end of the list. Uses bubble-phase detection:
// if a row handler already called `preventDefault`, the event
// is marked handled and we skip.
//
// `opts` = { dragType, onDrop(lastIdx) }.
function _setupListDropFallback(container, opts) {
  if (container.dataset.dropFallbackWired) return;
  container.dataset.dropFallbackWired = "1";
  const lastRow = () => container.querySelector("[data-idx]:last-of-type");
  container.addEventListener("dragover", e => {
    if (e.defaultPrevented) return;
    if (dragSrc?.type !== opts.dragType) return;
    e.preventDefault();
    _clearDropIndicators(container);
    lastRow()?.classList.add("drop-below");
  });
  container.addEventListener("drop", e => {
    if (e.defaultPrevented) return;
    if (dragSrc?.type !== opts.dragType) return;
    e.preventDefault();
    const last = lastRow();
    _clearDropIndicators(container);
    if (!last) { dragSrc = null; return; }
    const lastIdx = parseInt(last.dataset.idx, 10);
    opts.onDrop(lastIdx);
    dragSrc = null;
  });
}

function setupStorageDrag(el, idx) {
  const list = document.getElementById("storage-list");
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "quicktext.storage.label", idx };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "quicktext.storage.label");
  });
  el.addEventListener("dragend", () => {
    // Always clean up, regardless of whether the drop hit a valid
    // target, was aborted with Escape, or ended outside the list.
    _clearDropIndicators(list);
    dragSrc = null;
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "quicktext.storage.label") return;
    e.preventDefault();
    _clearDropIndicators(list);
    _setDropIndicator(el, e.clientY);
  });
  el.addEventListener("drop", e => {
    e.preventDefault();
    if (dragSrc?.type !== "quicktext.storage.label") return;
    const src = dragSrc.idx;
    const below = el.classList.contains("drop-below");
    _clearDropIndicators(list);
    dragSrc = null;
    // Insertion point is the index the dragged row will occupy
    // BEFORE removing the source row. `idx` for upper-half drops,
    // `idx + 1` for lower-half.
    const insertionPoint = below ? idx + 1 : idx;
    // No-op when dropping on self or on the line that represents
    // the row's own current position.
    if (src === insertionPoint || src === insertionPoint - 1) return;
    const [moved] = state.storageEntries.splice(src, 1);
    const dest = src < insertionPoint ? insertionPoint - 1 : insertionPoint;
    state.storageEntries.splice(dest, 0, moved);
    markChanged();
    renderStorageList();
    renderTemplateList();
    renderScriptList();
    buildInsertTagMenu();
  });
}

function setupScriptDrag(el, bundle, idx) {
  const list = document.getElementById("script-list");
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "quicktext.script.label", bundle, idx };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "quicktext.script.label");
  });
  el.addEventListener("dragend", () => {
    _clearDropIndicators(list);
    dragSrc = null;
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "quicktext.script.label" || dragSrc.bundle !== bundle) return;
    e.preventDefault();
    _clearDropIndicators(list);
    _setDropIndicator(el, e.clientY);
  });
  el.addEventListener("drop", e => {
    e.preventDefault();
    if (dragSrc?.type !== "quicktext.script.label" || dragSrc.bundle !== bundle) {
      dragSrc = null;
      return;
    }
    const src = dragSrc.idx;
    const below = el.classList.contains("drop-below");
    _clearDropIndicators(list);
    dragSrc = null;
    const insertionPoint = below ? idx + 1 : idx;
    if (src === insertionPoint || src === insertionPoint - 1) return;
    commitScriptEdits();
    const [script] = bundle.scripts.splice(src, 1);
    const dest = src < insertionPoint ? insertionPoint - 1 : insertionPoint;
    bundle.scripts.splice(dest, 0, script);
    state.selectedScriptStorageUuid = bundle.storageUuid;
    state.selectedScriptIdx = dest;
    markChanged(bundle);
    renderScriptList();
    renderScriptDetail();
  });
}

function setupTemplateDrag(el, bundle, gi, ti) {
  const tree = document.getElementById("template-tree");
  el.addEventListener("dragstart", e => {
    dragSrc = { type: "quicktext.template.label", bundle, gi, ti };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "quicktext.template.label");
  });
  el.addEventListener("dragend", () => {
    _clearDropIndicators(tree);
    dragSrc = null;
  });
  el.addEventListener("dragover", e => {
    if (dragSrc?.type !== "quicktext.template.label" || dragSrc.bundle !== bundle) return;
    e.preventDefault();
    _clearDropIndicators(tree);
    _setDropIndicator(el, e.clientY);
  });
  el.addEventListener("drop", e => {
    e.preventDefault();
    if (dragSrc?.type !== "quicktext.template.label" || dragSrc.bundle !== bundle) {
      dragSrc = null;
      return;
    }
    const srcGi = dragSrc.gi;
    const srcTi = dragSrc.ti;
    const below = el.classList.contains("drop-below");
    _clearDropIndicators(tree);
    dragSrc = null;
    const insertionPoint = below ? ti + 1 : ti;
    // Same-group no-op: dropping on self or on the line at the
    // source's own position leaves everything in place.
    if (srcGi === gi && (srcTi === insertionPoint || srcTi === insertionPoint - 1)) return;
    commitTemplateEdits();
    const [tmpl] = bundle.texts[srcGi].splice(srcTi, 1);
    if (!bundle.texts[gi]) bundle.texts[gi] = [];
    // Only shift dest down when moving forward within the same
    // group - cross-group drops don't need adjustment because the
    // source splice doesn't touch the target array.
    const dest = srcGi === gi && srcTi < insertionPoint ? insertionPoint - 1 : insertionPoint;
    bundle.texts[gi].splice(dest, 0, tmpl);
    state.selectedTemplateStorageUuid = bundle.storageUuid;
    state.selectedGroupIdx = gi;
    state.selectedTextIdx = dest;
    markChanged(bundle);
    renderTemplateList();
    renderTemplateDetail();
  });
}

// ---------- Title auto-save ----------

function onTitleInput() {
  const uuid = state.selectedTemplateStorageUuid;
  const gi = state.selectedGroupIdx;
  const ti = state.selectedTextIdx;
  if (!uuid) return;

  // Storage-level rename: no group selected, so we're editing the
  // storage entry's display name. Managed entries mirror the
  // enterprise policy and can't be renamed - the field is disabled
  // in renderTemplateDetail, but gate here as belt-and-braces.
  if (gi === -1) {
    _renameSelectedStorage(uuid, document.getElementById("text-title").value);
    return;
  }

  const bundle = findBundle(uuid);
  if (!bundle || bundle.isReadOnly) return;
  let value = document.getElementById("text-title").value.trim() || i18n(ti === -1 ? "quicktext.newGroup.label" : "quicktext.newTemplate.label");

  if (ti === -1) {
    const others = bundle.groups.map((g, i) => i === gi ? null : g.name).filter(Boolean);
    value = makeUnique(value, others);
    bundle.groups[gi].name = value;
    // DOM-patch the matching tree row instead of re-rendering the
    // whole tree - keystroke-frequency full re-renders flicker
    // because every row is replaced under the cursor.
    const nameEl = document.querySelector(`.tree-group[data-uuid="${uuid}"][data-gi="${gi}"] .tree-name`);
    if (nameEl) { nameEl.textContent = value; nameEl.title = value; }
  } else {
    const others = (bundle.texts[gi] || []).map((t, i) => i === ti ? null : t.name).filter(Boolean);
    value = makeUnique(value, others);
    bundle.texts[gi][ti].name = value;
    const nameEl = document.querySelector(`.tree-template[data-uuid="${uuid}"][data-gi="${gi}"][data-ti="${ti}"] .tree-name`);
    if (nameEl) { nameEl.textContent = value; nameEl.title = value; }
  }
  markChanged(bundle);
}

// Shared path for live storage rename from either the Templates or
// Scripts tab's title field. Updates `entry.name` + `bundle.storageName`
// so both sides of the UI agree, DOM-patches every visible header
// that displays the name (Templates tree, Scripts list, Advanced
// storage list), and marks the dialog dirty so saveAll persists
// the updated `storageLocations` pref. Managed entries are refused -
// they mirror the enterprise policy and the title field is disabled
// for them, so reaching this is defensive only.
function _renameSelectedStorage(uuid, rawValue) {
  const entry = state.storageEntries.find(e => e.uuid === uuid);
  if (!entry || entry.type === "managed") return;
  const others = state.storageEntries
    .filter(e => e !== entry)
    .map(e => e.name)
    .filter(Boolean);
  const value = makeUnique(
    rawValue.trim() || entry.name || "Storage",
    others,
  );
  if (value === entry.name) return;
  entry.name = value;
  const bundle = findBundle(uuid);
  if (bundle) bundle.storageName = value;

  // Templates tab header - the lock glyph (if any) lives in its
  // own sibling span, so we only patch the name text.
  const treeName = document.querySelector(
    `.tree-storage[data-uuid="${uuid}"] > .tree-storage-header > .tree-name`,
  );
  if (treeName) {
    treeName.textContent = value;
    treeName.title = value;
  }
  // Scripts tab header.
  const scriptHeaderName = document.querySelector(
    `.script-storage-header[data-uuid="${uuid}"] .tree-name`,
  );
  if (scriptHeaderName) {
    scriptHeaderName.textContent = value;
    scriptHeaderName.title = value;
  }
  // Advanced tab storage-list row.
  const storageListName = document.querySelector(
    `#storage-list li[data-uuid="${uuid}"] .storage-name`,
  );
  if (storageListName) {
    storageListName.textContent = value || "(unnamed)";
    storageListName.title = storageListName.textContent;
  }

  // Storage rename persists through `storageLocations`, not through
  // a per-bundle content write, so we don't pass `bundle` here -
  // only `state.changed` needs flipping.
  markChanged();
}

// ---------- Scripts ----------

function renderScriptList() {
  const list = document.getElementById("script-list");
  list.innerHTML = "";
  const multi = isMultiStorage();
  // Iterate state.storageEntries so script groups match the tree
  // ordering (by advanced-tab storage position).
  for (const entry of state.storageEntries) {
    if (entry.enabled === false) continue;
    // Managed entries are hidden whenever the live policy is
    // absent - see the matching skip in `renderTemplateList` for the
    // rationale.
    if (entry.type === "managed" && !state.hasManagedStorage) continue;
    const bundle = findBundle(entry.uuid);
    if (!bundle) continue;

    if (multi) {
      const header = document.createElement("li");
      header.className = "script-storage-header";
      header.dataset.uuid = entry.uuid;
      if (entry.uuid === state.selectedScriptStorageUuid && state.selectedScriptIdx === -1) {
        header.classList.add("selected");
      }
      const iconUrl = _storageIconUrl(entry);
      if (iconUrl) {
        const headerIcon = document.createElement("img");
        headerIcon.className = "storage-header-icon";
        headerIcon.src = iconUrl;
        headerIcon.alt = "";
        header.appendChild(headerIcon);
      }
      const nameSpan = document.createElement("span");
      nameSpan.className = "tree-name";
      nameSpan.textContent = bundle.storageName;
      nameSpan.title = bundle.storageName;
      header.appendChild(nameSpan);
      if (bundle.unavailable) {
        const unavailEl = document.createElement("span");
        unavailEl.className = "storage-header-unavailable";
        unavailEl.textContent = "🚫";
        unavailEl.title = i18n("quicktext.storage.providerUnavailable.label");
        header.appendChild(unavailEl);
      } else if (bundle.isReadOnly) {
        const lockEl = document.createElement("span");
        lockEl.className = "storage-header-lock";
        lockEl.textContent = "🔒";
        lockEl.title = i18n("quicktext.storageList.readOnly.label");
        header.appendChild(lockEl);
      }
      header.addEventListener("click", () => selectScriptStorage(entry.uuid));
      list.appendChild(header);
    }

    if (bundle.unavailable) continue;

    for (let i = 0; i < bundle.scripts.length; i++) {
      const script = bundle.scripts[i];
      const li = document.createElement("li");
      li.dataset.uuid = entry.uuid;
      li.dataset.idx = i;
      if (multi) li.classList.add("script-indent");
      if (entry.uuid === state.selectedScriptStorageUuid && i === state.selectedScriptIdx) {
        li.classList.add("selected");
      }
      const nameSpan = document.createElement("span");
      nameSpan.className = "tree-name";
      nameSpan.textContent = script.name;
      nameSpan.title = script.name;
      li.appendChild(nameSpan);
      // Warning icon sits at the right edge of the row; flex on the
      // `<li>` pushes it there automatically because `.tree-name`
      // takes `flex: 1`.
      const scriptDeprecation = _getDeprecatedScript(entry.uuid, script.name);
      if (scriptDeprecation) {
        const warn = document.createElement("span");
        warn.className = "script-warn-icon";
        warn.textContent = "⚠️";
        warn.title = _deprecationTooltip(scriptDeprecation);
        li.appendChild(warn);
      }
      li.addEventListener("click", () => selectScript(entry.uuid, i));
      if (!bundle.isReadOnly) {
        li.draggable = true;
        setupScriptDrag(li, bundle, i);
      }
      list.appendChild(li);
    }
  }

  // Import bundles render after the storage entries, always with their
  // own header (always treated as multi-storage because they come from
  // a separate source). Scripts inside imports are read-only.
  for (const bundle of state.bundles) {
    if (!bundle.isImport) continue;
    const header = _buildImportStorageHeader(bundle, {
      elementType: "li",
      className: "script-storage-header",
      isSelected: () => bundle.storageUuid === state.selectedScriptStorageUuid
        && state.selectedScriptIdx === -1,
      onClick: () => selectScriptStorage(bundle.storageUuid),
    });
    list.appendChild(header);

    for (let i = 0; i < bundle.scripts.length; i++) {
      const script = bundle.scripts[i];
      const li = document.createElement("li");
      li.dataset.uuid = bundle.storageUuid;
      li.dataset.idx = i;
      li.classList.add("script-indent");
      if (bundle.storageUuid === state.selectedScriptStorageUuid && i === state.selectedScriptIdx) {
        li.classList.add("selected");
      }
      const nameSpan2 = document.createElement("span");
      nameSpan2.className = "tree-name";
      nameSpan2.textContent = script.name;
      nameSpan2.title = script.name;
      li.appendChild(nameSpan2);
      const scriptDeprecation2 = _getDeprecatedScript(bundle.storageUuid, script.name);
      if (scriptDeprecation2) {
        const warn = document.createElement("span");
        warn.className = "script-warn-icon";
        warn.textContent = "⚠️";
        warn.title = _deprecationTooltip(scriptDeprecation2);
        li.appendChild(warn);
      }
      li.addEventListener("click", () => selectScript(bundle.storageUuid, i));
      list.appendChild(li);
    }
  }

  updateScriptButtons();
}

function _indexDeprecatedUsages() {
  state._depTemplateMap = new Map();
  for (const t of state.deprecatedUsages?.templates ?? []) {
    state._depTemplateMap.set(`${t.storageUuid}|${t.group}|${t.template}`, t);
  }
  state._depScriptMap = new Map();
  for (const s of state.deprecatedUsages?.scripts ?? []) {
    state._depScriptMap.set(`${s.storageUuid}|${s.script}`, s);
  }
}

function _getDeprecatedTemplate(storageUuid, groupName, tmplName) {
  return state._depTemplateMap?.get(`${storageUuid}|${groupName}|${tmplName}`) ?? null;
}

function _getDeprecatedScript(storageUuid, scriptName) {
  return state._depScriptMap?.get(`${storageUuid}|${scriptName}`) ?? null;
}

function _deprecationTooltip(entry) {
  if (!entry) return null;
  const lines = [];
  const migLabel = m => m === "auto" ? "auto migration possible" : "manual migration needed";
  if (entry.tags) {
    for (const t of entry.tags) lines.push(`Deprecated FILE usage: ${t.tag} (${migLabel(t.migration)})`);
  }
  if (entry.details) {
    for (const d of entry.details) {
      if (d.type === "deprecated-api") lines.push(`Incompatible API: ${d.keyword}`);
      else lines.push(`Deprecated FILE usage: ${d.call} (${migLabel(d.migration)})`);
    }
  }
  return lines.join("\n");
}

function _selectedScriptBundle() {
  return findBundle(state.selectedScriptStorageUuid);
}

function _selectedScript() {
  const bundle = _selectedScriptBundle();
  if (!bundle || state.selectedScriptIdx === -1) return null;
  return bundle.scripts[state.selectedScriptIdx] ?? null;
}

function selectScript(uuid, idx) {
  commitScriptEdits();
  state.selectedScriptStorageUuid = uuid;
  state.selectedScriptIdx = idx;
  renderScriptList();
  renderScriptDetail();
}

// Storage-header click (multi-storage mode only): selects the
// storage with no script row, so Add script has a clear target
// even for a storage that currently has no scripts.
function selectScriptStorage(uuid) {
  selectScript(uuid, -1);
}

function commitScriptEdits() {
  const bundle = _selectedScriptBundle();
  const script = _selectedScript();
  if (!bundle || bundle.isReadOnly || !script) return;
  script.script = document.getElementById("script-body").value;
}

function renderScriptDetail() {
  const bundle = _selectedScriptBundle();
  const script = _selectedScript();
  const isReadOnly = !!bundle?.isReadOnly;
  document.getElementById("script-caption").textContent = i18n(
    script ? "quicktext.script.label" : "quicktext.storageList.columns.connection",
  );
  // When a storage header is selected (no script), show its name
  // in the title field. Editable for writable VFS storages;
  // `onScriptTitleInput` handles the rename. Imports aren't in
  // `state.storageEntries`, so fall back to the in-memory bundle.
  const selectedEntry = !script && state.selectedScriptStorageUuid
    ? state.storageEntries.find(e => e.uuid === state.selectedScriptStorageUuid)
    : null;
  const selectedBundle = !script && state.selectedScriptStorageUuid
    ? findBundle(state.selectedScriptStorageUuid)
    : null;
  const titleEl = document.getElementById("script-title");
  titleEl.value = script?.name ?? selectedEntry?.name ?? selectedBundle?.storageName ?? "";
  if (script) {
    titleEl.disabled = isReadOnly;
  } else {
    titleEl.disabled = !selectedEntry || selectedEntry.type === "managed";
  }
  document.getElementById("script-body").value = script?.script ?? "";
  document.getElementById("script-body").disabled = !script || isReadOnly;
  updateScriptHelpButton();
}

function updateScriptButtons() {
  const bundle = _selectedScriptBundle();
  const script = _selectedScript();
  const canAddToStorage = bundle && !bundle.isReadOnly && !bundle.unavailable;
  document.getElementById("btn-add-script").disabled = !canAddToStorage;
  document.getElementById("btn-remove-script").disabled = !script || !canAddToStorage;
}

function onScriptTitleInput() {
  // Storage-level rename: no script row selected, so the title
  // field targets the storage entry's display name. Managed
  // entries are gated in `renderScriptDetail`, double-check here.
  if (state.selectedScriptIdx === -1 && state.selectedScriptStorageUuid) {
    _renameSelectedStorage(
      state.selectedScriptStorageUuid,
      document.getElementById("script-title").value,
    );
    return;
  }

  const bundle = _selectedScriptBundle();
  const script = _selectedScript();
  if (!bundle || bundle.isReadOnly || !script) return;
  const idx = state.selectedScriptIdx;
  let value = document.getElementById("script-title").value.trim() || i18n("quicktext.newScript.label");
  const others = bundle.scripts.map((s, i) => i === idx ? null : s.name).filter(Boolean);
  value = makeUnique(value, others);
  script.name = value;
  // DOM-patch the matching script-list row instead of rebuilding
  // the whole list on every keystroke - rebuilding flickers.
  const nameSpan = document.querySelector(
    `#script-list li[data-uuid="${bundle.storageUuid}"][data-idx="${idx}"] .tree-name`,
  );
  if (nameSpan) { nameSpan.textContent = value; nameSpan.title = value; }
  markChanged(bundle);
}

function addScript() {
  commitScriptEdits();
  const target = _selectedScriptBundle();
  if (!target || target.isReadOnly) return;
  const name = makeUnique(i18n("quicktext.newScript.label"), target.scripts.map(s => s.name));
  target.scripts.push({ name, script: "" });
  state.selectedScriptIdx = target.scripts.length - 1;
  markChanged(target);
  renderScriptList();
  renderScriptDetail();
  const el = document.getElementById("script-title");
  el.focus();
  el.select();
}

async function removeScript() {
  const bundle = _selectedScriptBundle();
  const script = _selectedScript();
  if (!bundle || bundle.isReadOnly || !script) return;
  if (!await showConfirm(i18n("quicktext.confirmRemove.label", [script.name]))) return;
  const idx = state.selectedScriptIdx;
  bundle.scripts.splice(idx, 1);
  if (bundle.scripts.length > 0) {
    state.selectedScriptIdx = Math.max(0, idx - 1);
  } else {
    state.selectedScriptStorageUuid = null;
    state.selectedScriptIdx = -1;
  }
  markChanged(bundle);
  renderScriptList();
  renderScriptDetail();
}

// ---------- Advanced tab ----------

// ---------- Storage-list helpers ----------
//
// The storage list is edited live: adding, renaming, removing, enabling
// and disabling a storage all reflect in the Templates and Scripts
// tabs immediately, but nothing is persisted until the user clicks
// Save. Bundles are lazy-loaded - disabled storages have no bundle in
// memory at all; enabling reads a fresh copy from disk.

// Ask the user to confirm discarding the bundle's in-memory working
// copy. Always prompts - disabling or removing a storage wipes any
// edits (including yet-to-be-made ones in cached state), so even a
// "clean" bundle deserves a confirmation.
function _confirmDiscardBundle(name) {
  return showConfirm(i18n("quicktext.storageList.confirmDiscard.label", [name]));
}

// Pick the uuid of the entry that the selection should jump to
// after the entry at `removedPos` disappears from
// `state.storageEntries`. Prefer the nearest previous enabled
// writable entry; otherwise the nearest next enabled writable
// entry. Read-only entries (managed, future URL imports) are
// skipped first because landing on them puts the user on a
// non-editable bundle, which is a poor UX. Falls back to any
// enabled entry only if nothing writable is available. Returns
// `null` when nothing is enabled. Expected to be called AFTER the
// splice (so `state.storageEntries[removedPos]` is already the one
// that used to be at removedPos + 1).
function _fallbackStorageUuid(removedPos) {
  const isEnabled = e => e?.enabled !== false;
  for (let i = removedPos - 1; i >= 0; i--) {
    const e = state.storageEntries[i];
    if (isEnabled(e) && !e.isReadOnly) return e.uuid;
  }
  for (let i = removedPos; i < state.storageEntries.length; i++) {
    const e = state.storageEntries[i];
    if (isEnabled(e) && !e.isReadOnly) return e.uuid;
  }
  // No writable enabled entry - accept a read-only one as a last resort.
  return state.storageEntries.find(e => isEnabled(e))?.uuid ?? null;
}

// Detect Templates/Scripts selections that point at a uuid which no
// longer has a bundle in `state.bundles` and shift them to a fallback
// writable storage. Covers both deliberate drops (storage disable/
// remove) and indirect ones (import disappeared via reconcile or
// in-memory mutation). `removedPos` seeds the fallback search at a
// known neighbour position when the caller has one - imports aren't
// in `state.storageEntries` so the orphan-detection path defaults to
// 0 (walk forward from the start of the list). Returns true when at
// least one selection was moved, so the caller can conditionally
// re-render the detail panes.
function _rescueOrphanedSelections(removedPos = 0) {
  let rescued = false;
  if (state.selectedTemplateStorageUuid &&
      !findBundle(state.selectedTemplateStorageUuid)) {
    state.selectedTemplateStorageUuid = _fallbackStorageUuid(removedPos);
    const fallback = findBundle(state.selectedTemplateStorageUuid);
    state.selectedGroupIdx = fallback?.groups.length ? 0 : -1;
    state.selectedTextIdx = -1;
    rescued = true;
  }
  if (state.selectedScriptStorageUuid &&
      !findBundle(state.selectedScriptStorageUuid)) {
    state.selectedScriptStorageUuid = _fallbackStorageUuid(removedPos);
    const fallback = findBundle(state.selectedScriptStorageUuid);
    state.selectedScriptIdx = fallback?.scripts.length ? 0 : -1;
    rescued = true;
  }
  return rescued;
}

// Discard the in-memory bundle for a storage (disable and remove).
// Collapse state lives on the bundle itself, so dropping the bundle
// takes its collapse state with it - no sidecar cleanup needed.
function _dropBundle(entry) {
  const pos = state.bundles.findIndex(b => b.entry === entry);
  if (pos !== -1) state.bundles.splice(pos, 1);
}

// Read a fresh bundle for the given entry and push it onto
// `state.bundles`. Also used by `loadAll` for the initial pass.
// Order inside state.bundles is irrelevant because renderers
// iterate state.storageEntries and look up by entry ref.
async function _addBundle(entry) {
  if (!entry) return null;
  const loaded = await storage.readBundleForEntry(entry);
  const groups = loaded.templates?.groups ?? [];
  const avail = state.providerAvailability[entry.uuid];
  const bundle = {
    storageUuid: entry.uuid,
    entry,
    storageName: loaded.storageName,
    isReadOnly: loaded.isReadOnly,
    unavailable: avail && !avail.available,
    unavailableReason: avail?.reason,
    groups,
    texts: loaded.templates?.texts ?? [],
    scripts: loaded.scripts ?? [],
    dirty: false,
    groupExpanded: groups.map(() => true),
  };
  state.bundles.push(bundle);
  return bundle;
}

function renderAdvanced() {
  renderStorageList();
  document.getElementById("btn-add-storage-config").addEventListener("click", addStorageConfig);
  document.getElementById("btn-browse-storage").addEventListener("click", browseStorage);
  document.getElementById("btn-rename-storage").addEventListener("click", renameStorage);
  document.getElementById("btn-remove-storage").addEventListener("click", removeStorage);
  document.getElementById("btn-import-storage").addEventListener("click", importStorage);
  document.getElementById("btn-export-storage").addEventListener("click", exportStorage);
  document.getElementById("btn-search-vfs-providers").addEventListener("click", () =>
    messenger.tabs.create({ url: "https://addons.thunderbird.net/search/?q=VFS" }));
}

// Re-evaluate the `disabled` state of every enable checkbox in the
// storage list without rebuilding the list. Used after a toggle so
// the "at least one writable storage must remain enabled" guard
// sees the freshly-updated count and flips the last remaining
// writable checkbox to read-only. Managed entries are fully
// locked - the checkbox stays disabled regardless of count.
function _refreshEnabledCheckboxes() {
  const enabledWritableCount = state.storageEntries.filter(
    e => e.type !== "managed" && !e.isReadOnly && e.enabled !== false,
  ).length;
  const list = document.getElementById("storage-list");
  for (const li of list.querySelectorAll("li[data-idx]")) {
    const idx = parseInt(li.dataset.idx, 10);
    const entry = state.storageEntries[idx];
    if (!entry) continue;
    const box = li.querySelector(".storage-enabled input[type=checkbox]");
    if (!box) continue;
    const isEnabled = entry.enabled !== false;
    box.checked = isEnabled;
    box.disabled = entry.type === "managed"
      || (isEnabled && !entry.isReadOnly && enabledWritableCount === 1);
  }
}

async function renderStorageList() {
  const list = document.getElementById("storage-list");
  list.innerHTML = "";
  _setupListDropFallback(list, {
    dragType: "quicktext.storage.label",
    onDrop: (lastIdx) => {
      const src = dragSrc.idx;
      if (src === lastIdx) return;
      const [moved] = state.storageEntries.splice(src, 1);
      state.storageEntries.push(moved);
      markChanged();
      renderStorageList();
      renderTemplateList();
      renderScriptList();
      buildInsertTagMenu();
    },
  });

  // Reuse the cached provider list populated by `loadAll` /
  // `addStorageConfig` so re-renders don't pay an async round-trip.
  const lookup = (storageRef) => {
    if (!storageRef) return null;
    const provider = _vfsProviders.find(p => p.providerId === storageRef.providerId);
    const connection = provider?.connections.find(c =>
      c.storageRef?.storageId === storageRef.storageId
    );
    return { provider, connection };
  };

  const makeFiller = () => {
    const filler = document.createElement("span");
    filler.className = "storage-filler";
    return filler;
  };

  const header = document.createElement("li");
  header.className = "header";
  for (const [cls, key] of [
    ["storage-enabled", null],
    ["storage-icon", null],
    ["storage-lock", null],
    ["storage-name", "quicktext.storageList.columns.name"],
    ["storage-conn", "quicktext.storageList.columns.connection"],
    ["storage-path", "quicktext.storageList.columns.path"],
  ]) {
    const cell = document.createElement("span");
    cell.className = cls;
    if (key) cell.textContent = i18n(key);
    header.appendChild(cell);
  }
  header.appendChild(makeFiller());
  list.appendChild(header);

  const enabledWritableCount = state.storageEntries.filter(
    e => e.type !== "managed" && !e.isReadOnly && e.enabled !== false,
  ).length;

  for (let i = 0; i < state.storageEntries.length; i++) {
    const entry = state.storageEntries[i];
    // Managed entries are hidden from the list whenever the live
    // policy is absent - mirrors the skip in `renderTemplateList` and
    // `renderScriptList` so the three tabs stay in sync.
    if (entry.type === "managed" && !state.hasManagedStorage) continue;
    const li = document.createElement("li");
    li.dataset.idx = i;
    li.dataset.uuid = entry.uuid;
    li.dataset.type = entry.type ?? "vfs";

    const info = lookup(entry.storageRef);

    const enabledEl = document.createElement("span");
    enabledEl.className = "storage-enabled";
    const enabledBox = document.createElement("input");
    enabledBox.type = "checkbox";
    const isEnabled = entry.enabled !== false;
    enabledBox.checked = isEnabled;
    // Managed entries are fully locked: the user can neither disable, rename,
    // nor remove them - they mirror the enterprise policy and auto-re-inject
    // when re-scanning managed entries. Non-managed writable entries are gated
    // by the "at least one enabled writable bundle must remain" rule so the
    // user always has somewhere to add new content.
    enabledBox.disabled = entry.type === "managed"
      || (isEnabled && !entry.isReadOnly && enabledWritableCount === 1);
    enabledBox.addEventListener("click", async e => {
      e.stopPropagation();
      const wantEnabled = enabledBox.checked;
      if (!wantEnabled) {
        enabledBox.checked = true;
        if (!await _confirmDiscardBundle(entry.name)) return;
        enabledBox.checked = false;
      }
      entry.enabled = wantEnabled;
      (async () => {
        if (wantEnabled) {
          await _addBundle(entry);
        } else {
          _dropBundle(entry);
          _rescueOrphanedSelections(i);
        }
        markChanged();
        // In-place refresh of the sibling checkboxes so the
        // "last enabled" guard recomputes - otherwise previously-
        // editable checkboxes stay editable and the user can
        // disable every entry in sequence.
        _refreshEnabledCheckboxes();
        updateStorageButtons();
        renderTemplateList();
        renderScriptList();
        renderTemplateDetail();
        renderScriptDetail();
        buildInsertTagMenu();
      })();
    });
    enabledEl.appendChild(enabledBox);

    const avail = state.providerAvailability[entry.uuid];
    const isUnavailable = avail && !avail.available;
    if (isUnavailable) li.classList.add("storage-unavailable");

    const iconEl = document.createElement("span");
    iconEl.className = "storage-icon";
    const resolvedIconUrl = _storageIconUrl(entry);
    if (isUnavailable) {
      iconEl.textContent = "🚫";
    } else if (resolvedIconUrl) {
      const img = document.createElement("img");
      img.src = resolvedIconUrl;
      img.alt = "";
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = "⚠️";
    }

    const lockEl = document.createElement("span");
    lockEl.className = "storage-lock";
    if (entry.isReadOnly) {
      lockEl.textContent = "🔒";
      lockEl.title = i18n("quicktext.storageList.readOnly.label");
    }

    const nameEl = document.createElement("span");
    nameEl.className = "storage-name";
    nameEl.textContent = entry.name || "(unnamed)";
    nameEl.title = nameEl.textContent;

    const connEl = document.createElement("span");
    connEl.className = "storage-conn";
    if (isUnavailable) {
      connEl.textContent = avail.reason === "connection_missing"
        ? i18n("quicktext.storage.connectionUnavailable.label")
        : i18n("quicktext.storage.providerUnavailable.label");
    } else if (entry.type === "managed") {
      connEl.textContent = i18n("quicktext.storage.managed.location");
    } else if (!entry.storageRef) {
      connEl.textContent = `${storage.OPFS_STORAGE_NAME} (internal)`;
    } else if (info?.provider && info?.connection) {
      connEl.textContent = `${info.provider.name} : ${info.connection.name}`;
    } else {
      connEl.textContent = "-";
    }
    connEl.title = connEl.textContent;

    const pathEl = document.createElement("span");
    pathEl.className = "storage-path";
    pathEl.textContent = entry.path || "";
    pathEl.title = pathEl.textContent;

    li.append(enabledEl, iconEl, lockEl, nameEl, connEl, pathEl, makeFiller());
    li.addEventListener("click", () => {
      list.querySelectorAll("li").forEach(el => el.classList.remove("selected"));
      li.classList.add("selected");
      updateStorageButtons();
    });
    li.draggable = true;
    setupStorageDrag(li, i);
    list.appendChild(li);
  }
  updateStorageButtons();
}

function updateStorageButtons() {
  const selectedEntry = _selectedStorageListEntry();
  const selectedBundle = findBundle(selectedEntry?.uuid);
  const isManaged = selectedEntry?.type === "managed";
  document.getElementById("btn-add-storage-config").disabled = false;
  // Managed entries are fully locked: no browse/rename/remove/disable, and no
  // import/export either. They mirror the enterprise policy and auto-re-inject
  // when re-scanning managed entries, so every user-facing mutation is a no-op.
  const availStatus = selectedEntry && state.providerAvailability[selectedEntry.uuid];
  const isUnavailable = selectedBundle?.unavailable
    || (availStatus && !availStatus.available);
  document.getElementById("btn-browse-storage").disabled = !selectedEntry || isManaged || isUnavailable;
  document.getElementById("btn-rename-storage").disabled = !selectedEntry || isManaged;
  // Refuse to remove the last enabled non-managed entry - there must
  // always be at least one enabled storage (ignoring managed).
  const isLastEnabled = selectedEntry
    && selectedEntry.enabled !== false
    && state.storageEntries.filter(
      e => e.type !== "managed" && e.enabled !== false,
    ).length <= 1;
  // Refuse to remove the last OPFS entry (enabled or disabled) - it
  // serves as a fallback if external providers become unavailable.
  const isLastOpfs = selectedEntry
    && !selectedEntry.storageRef
    && state.storageEntries.filter(
      e => e.type !== "managed" && !e.storageRef,
    ).length <= 1;
  const canRemove = !!selectedEntry && !isManaged && !isLastEnabled && !isLastOpfs;
  document.getElementById("btn-remove-storage").disabled = !canRemove;
  // Export and import require a reachable provider.
  document.getElementById("btn-export-storage").disabled = !selectedEntry || isManaged || isUnavailable;
  document.getElementById("btn-import-storage").disabled =
    !selectedBundle || selectedBundle.isReadOnly || isManaged || isUnavailable;
}

async function addStorageConfig() {
  // The user may have installed a new VFS provider between dialog
  // load and this click, so refresh the cache before computing the
  // icon for the newly-added entry.
  await _refreshVfsProviders();
  let entries;
  try {
    entries = await vfs.showSelectFilePicker({
      multiple: false,
      id: "Quicktext",
      opfsStorageName: storage.OPFS_STORAGE_NAME,
      types: [
        {
          description: "Quicktext config",
          accept: { "application/json": [".json"] },
        },
      ],
    });
  } catch (ex) {
    console.log(ex);
    return;
  }
  if (!entries || entries.length === 0) return;
  const picked = entries[0];

  const sameRef = (a, b) =>
    (a?.providerId ?? null) === (b?.providerId ?? null) &&
    (a?.storageId ?? null) === (b?.storageId ?? null);
  const duplicate = state.storageEntries.find(
    e => e.path === picked.path && sameRef(e.storageRef, picked.storageRef),
  );
  if (duplicate) {
    await showAlert(i18n("quicktext.storageList.duplicate.label", [duplicate.name]));
    return;
  }

  // Auto-name from the connection (OPFS for the built-in store, otherwise
  // the provider's connection name). On collision, suffix with " (N)". If
  // no connection name is available, fall back to "StorageNN" (two-digit,
  // one above the current max).
  // At the same time, capture an isReadOnly snapshot from the provider's
  // capabilities - set once when the storage is added, not refreshed later.
  let base = storage.OPFS_STORAGE_NAME;
  let isReadOnly = false;
  if (picked.storageRef) {
    try {
      const providers = await vfs.fetchProviderConnections();
      const provider = providers.find(p => p.providerId === picked.storageRef.providerId);
      const connection = provider?.connections.find(
        c => c.storageRef?.storageId === picked.storageRef.storageId,
      );
      if (connection?.name) base = connection.name;
      isReadOnly = !connection?.capabilities?.file?.modify;
    } catch (ex) {
      console.log(ex);
    }
  }
  base = base.replace(/\|+|\[\[|\]\]/g, "").trim();
  const taken = new Set(state.storageEntries.map(e => (e.name || "").toLowerCase()));

  let name;
  if (base) {
    name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  } else {
    const nums = state.storageEntries
      .map(e => /^Storage(\d+)$/i.exec(e.name || ""))
      .filter(Boolean)
      .map(m => parseInt(m[1]));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    name = `Storage${String(next).padStart(2, "0")}`;
  }

  const entry = {
    uuid: crypto.randomUUID(),
    name,
    type: "vfs",
    storageRef: picked.storageRef,
    path: picked.path,
    isReadOnly,
    enabled: true,
  };
  state.storageEntries.push(entry);
  // Lazy-load the config file so any existing on-disk templates and
  // scripts appear live in the Templates/Scripts tabs. A brand-new
  // storage with no file yields an empty bundle.
  await _addBundle(entry);
  // Refresh the provider cache again - the user may have created a new
  // connection inside the file picker, so the pre-picker cache is stale.
  await _refreshVfsProviders();
  markChanged();
  renderStorageList();
  renderTemplateList();
  renderScriptList();
  renderTemplateDetail();
  renderScriptDetail();
  buildInsertTagMenu();
}

async function browseStorage() {
  const entry = _selectedStorageListEntry();
  if (!entry) return;

  const parent = (entry.path || "").replace(/\/[^/]*$/, "") || "/";
  try {
    await vfs.showBrowseFilePicker({
      startIn: parent,
      storageRef: entry.storageRef,
      opfsStorageName: storage.OPFS_STORAGE_NAME,
    });
  } catch (ex) {
    console.log(ex);
  }
}

async function renameStorage() {
  const entry = _selectedStorageListEntry();
  if (!entry || entry.type === "managed") return;

  const current = entry.name || "";
  const input = await showPrompt(i18n("quicktext.storageList.rename.prompt"), current);
  if (input == null) return;
  const next = input.trim();
  if (!next || next === current) return;

  if (["|", "[[", "]]"].some(s => next.includes(s))) {
    await showAlert(i18n("quicktext.storageList.rename.badChars"));
    return;
  }
  const clash = state.storageEntries.find(
    e => e !== entry && (e.name || "").toLowerCase() === next.toLowerCase(),
  );
  if (clash) {
    await showAlert(i18n("quicktext.storageList.rename.duplicate", [clash.name]));
    return;
  }

  entry.name = next;
  // Mirror the new name onto the live bundle so the Templates tree and
  // Scripts list headers update without a reload.
  const bundle = findBundle(entry.uuid);
  if (bundle) bundle.storageName = next;
  markChanged();
  renderStorageList();
  renderTemplateList();
  renderScriptList();
}

async function removeStorage() {
  const entry = _selectedStorageListEntry();
  if (!entry || entry.type === "managed") return;
  // Refuse to remove the last writable storage - at least one
  // editable bundle must always remain. Managed entries are
  // read-only and don't count toward that quota.
  const writableCount = state.storageEntries.filter(e => !e.isReadOnly).length;
  if (writableCount <= 1) return;

  if (entry.enabled === false) {
    if (!await showConfirm(i18n("quicktext.confirmRemove.label", [entry.name]))) return;
  } else {
    if (!await _confirmDiscardBundle(entry.name)) return;
  }

  const idx = state.storageEntries.indexOf(entry);
  state.storageEntries.splice(idx, 1);
  _dropBundle(entry);

  // If removing this entry would leave every writable storage
  // disabled, flip the first writable one back on and lazy-load it
  // so the Templates/Scripts tabs have an editable surface.
  if (!state.storageEntries.some(e => !e.isReadOnly && e.enabled !== false)) {
    const firstWritable = state.storageEntries.find(e => !e.isReadOnly);
    if (firstWritable) {
      firstWritable.enabled = true;
      if (!findBundle(firstWritable.uuid)) {
        await _addBundle(firstWritable);
      }
    }
  }

  // Selection fixup uses the post-splice position so the fallback
  // search walks the correct neighbours.
  _rescueOrphanedSelections(idx);

  markChanged();
  renderStorageList();
  renderTemplateList();
  renderScriptList();
  renderTemplateDetail();
  renderScriptDetail();
  buildInsertTagMenu();
}

const MANAGER_URL = browser.runtime.getURL("/dialogs/manager/manager.html");

// Build an `getActiveStorageEntries`-shaped snapshot of the manager's
// in-memory bundles, filtered to enabled entries and ordered to match
// state.storageEntries. This lets the Insert Tag menu reflect live,
// unsaved edits (new templates/scripts, renames, etc.) instead of the
// on-disk view.
function _liveActiveBundles() {
  const result = [];
  for (const entry of state.storageEntries) {
    if (entry.enabled === false) continue;
    const bundle = findBundle(entry.uuid);
    if (!bundle) continue;
    result.push({
      storageUuid: bundle.storageUuid,
      storageName: bundle.storageName,
      isReadOnly: bundle.isReadOnly,
      templates: { groups: bundle.groups, texts: bundle.texts },
      scripts: bundle.scripts,
    });
  }
  return result;
}

// Shape `getTagsMenuStructure` nodes into the entry list consumed by
// `menus.processMenuData` for the WebExtension context menu. Unlike
// the compose/toolbar menus (which dispatch clicks to whichever
// compose tab the user right-clicked in), every click here inserts
// directly into the manager dialog's own template editor via the
// local `insertVariable` helper - there's no cross-tab messaging.
function _buildManagerMenuData(nodes, now) {
  return nodes.flatMap(node => {
    if (node.type === "separator") return [{ type: "separator" }];

    const entry = { id: node.id };
    if (node.title) entry.title = node.title;
    else if (node.localeKey) entry.title = i18n(node.localeKey);
    else if (node.type === "dateTime") entry.title = getDateTimeMenuTitle(node.format, now);

    if (node.value?.includes("<url>")) {
      entry.onclick = async () => {
        const url = await showPrompt(i18n("quicktext.prompt.addUrl.label"), "https://");
        if (url) insertVariable(node.value.replace("<url>", url));
      };
    } else if (node.value) {
      entry.onclick = () => insertVariable(node.value);
    }

    if (node.children) entry.children = _buildManagerMenuData(node.children, now);
    return [entry];
  });
}

async function rebuildManagerContextMenu() {
  // Removing the root cascades to all children, so one call cleans
  // up everything - both in-session state and orphans left over from
  // a previous dialog instance that closed without tearing down.
  try { await browser.menus.remove("managerInsertTagMenu"); } catch { /* not there */ }

  const bundles = _liveActiveBundles();
  const nodes = await getTagsMenuStructure({
    storageUuid: state.selectedTemplateStorageUuid ?? undefined,
    bundles,
    origin: "manager",
  });
  const menuCollapse = await storage.getPref("menuCollapse");
  if (menuCollapse) {
    const templatesSection = nodes.find(n => n.id === "templates");
    if (templatesSection) {
      const collapseGroups = (grps) => grps.flatMap(grp =>
        grp.type === "group" && grp.children.length === 1 ? grp.children : [grp]
      );
      const isMulti = templatesSection.children.some(c => c.children?.some(g => g.children));
      if (isMulti) {
        for (const storageNode of templatesSection.children) {
          storageNode.children = collapseGroups(storageNode.children);
        }
      } else {
        templatesSection.children = collapseGroups(templatesSection.children);
      }
    }
  }

  const root = {
    id: "managerInsertTagMenu",
    title: i18n("quicktext.insertTag.label"),
    contexts: ["editable"],
    documentUrlPatterns: [MANAGER_URL],
    children: _buildManagerMenuData(nodes, Date.now()),
  };
  await menus.processMenuData([], [root], null);
}

async function buildInsertTagMenu() {
  const menuCollapse = await storage.getPref("menuCollapse");
  const menu = document.getElementById("insert-tag-menu");
  menu.innerHTML = "";

  const makeItem = (label, val) => {
    const btn = document.createElement("button");
    btn.className = "var-item";
    btn.textContent = label;
    btn.title = label;
    btn.dataset.val = val;
    return btn;
  };

  const makeSeparator = () => {
    const sep = document.createElement("div");
    sep.className = "var-separator";
    return sep;
  };

  const makeGrp = (label, children) => {
    const grp = document.createElement("div");
    grp.className = "var-group";
    const lbl = document.createElement("span");
    lbl.className = "var-group-label";
    lbl.textContent = label;
    lbl.title = label;
    grp.appendChild(lbl);
    const sub = document.createElement("div");
    sub.className = "var-submenu";
    for (const child of children) sub.appendChild(child);
    grp.appendChild(sub);
    return grp;
  };

  const now = Date.now();
  const nodeToElement = node => {
    if (node.type === "separator") return makeSeparator();
    const label = node.type === "dateTime"
      ? getDateTimeMenuTitle(node.format, now)
      : node.title ?? i18n(node.localeKey || `quicktext.${node.id}.label`);
    if (node.type === "group") return makeGrp(label, node.children.map(nodeToElement));
    const el = makeItem(label, node.value);
    if (node.description) el.title = node.description;
    if (node.type === "dateTime") el.dataset.format = node.format;
    return el;
  };

  // Scope the flyout to the currently-selected template's storage -
  // `TEXT=group|text` and `SCRIPT=name` tags only resolve within the
  // caller's storage at runtime, so offering entries from other
  // storages would silently fail when the template runs. We feed
  // `getTagsMenuStructure` live in-memory bundles so unsaved edits
  // (new templates, renames, newly-added storages) show up in the
  // flyout without requiring a save round-trip.
  const bundles = _liveActiveBundles();
  const structure = await getTagsMenuStructure({
    storageUuid: state.selectedTemplateStorageUuid ?? undefined,
    bundles,
    origin: "manager",
  });
  if (menuCollapse) {
    const templatesSection = structure.find(n => n.id === "templates");
    if (templatesSection) {
      // Collapse only applies within a storage layer - walk one level
      // deeper when the section is wrapped by storage nodes.
      const collapseGroups = (grps) => grps.flatMap(grp =>
        grp.type === "group" && grp.children.length === 1 ? grp.children : [grp]
      );
      const multi = templatesSection.children.some(c => c.children?.some(g => g.children));
      if (multi) {
        for (const storageNode of templatesSection.children) {
          storageNode.children = collapseGroups(storageNode.children);
        }
      } else {
        templatesSection.children = collapseGroups(templatesSection.children);
      }
    }
  }
  for (const node of structure) menu.appendChild(nodeToElement(node));
}

function updateDateTimeFlyOutMenus() {
  const menu = document.getElementById("insert-tag-menu");
  const now = Date.now();
  for (const el of menu.querySelectorAll(".var-item[data-format]")) {
    const title = getDateTimeMenuTitle(el.dataset.format, now);
    el.textContent = title;
    el.title = title;
  }
}

function insertVariable(varStr) {
  const subjectEl = document.getElementById("text-subject");
  const bodyEl = document.getElementById("text-body");
  const target = document.activeElement === subjectEl ? subjectEl : bodyEl;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  target.value = target.value.slice(0, start) + `[[${varStr}]]` + target.value.slice(end);
  const pos = start + varStr.length + 4;
  target.setSelectionRange(pos, pos);
  target.focus();
  markChanged(findBundle(state.selectedTemplateStorageUuid));
}

// ---------- Import / Export ----------
//
// Export and import work per storage, from the storage-list selection
// in the Advanced tab. The export file format matches the on-disk
// combined config shape (`{templates, scripts}`) so a round-trip via
// Export → Import is lossless.
//
// Import merges into the target bundle:
//   - Groups merge. An imported group is matched to an existing group
//     by name; if both exist, their texts are merged (text-level
//     overwrite by name). New groups are appended.
//   - Scripts merge at the script level: a script whose name already
//     exists is replaced, otherwise appended.

function _selectedStorageListEntry() {
  const sel = document.getElementById("storage-list").querySelector("li.selected");
  if (!sel) return null;
  const idx = parseInt(sel.dataset.idx);
  return state.storageEntries[idx] ?? null;
}

function _selectedStorageListBundle() {
  return findBundle(_selectedStorageListEntry()?.uuid);
}

async function exportStorage() {
  const entry = _selectedStorageListEntry();
  if (!entry || entry.type === "managed") return;

  // Always export the on-disk file, never the in-memory working
  // copy. Unsaved edits in the manager are intentionally left out -
  // users who want those edits in the export must Save first.
  // `readBundleForEntry` already runs the protected-entry filter.
  const source = await storage.readBundleForEntry(entry);

  const payload = {
    templates: source.templates,
    scripts: source.scripts,
  };
  const safeName = (entry.name || "quicktext").replace(/[^\w\-]+/g, "_");
  await utils.writeFileToDisc(JSON.stringify(payload, null, 2), `${safeName}.json`);
  window.focus();
}

async function importStorage() {
  const entry = _selectedStorageListEntry();
  if (!entry || entry.type === "managed") return;
  const bundle = _selectedStorageListBundle();
  if (!bundle || bundle.isReadOnly) return;

  const file = await pickFile([".json"]);
  if (!file) return;
  const content = await readFileText(file);
  let result;
  try {
    result = JSON.parse(content);
  } catch (ex) {
    console.error("Failed to parse import file as JSON", ex);
    return;
  }
  if (!result) return;
  // Pre-refactor files may still carry `protected: true` entries.
  // Quietly strip them so they never enter the working copy.
  storage._stripProtectedInPlace(result);

  let changedTemplates = false;
  let changedScripts = false;

  // Merge templates. For each imported group:
  //   - If the bundle has a group with the same name, merge the
  //     imported texts into it: existing texts with a colliding name
  //     are replaced, others stay, and brand-new texts are appended.
  //   - Otherwise append the imported group wholesale.
  if (result.templates?.groups?.length) {
    for (let gi = 0; gi < result.templates.groups.length; gi++) {
      const importedGroup = result.templates.groups[gi];
      const importedTexts = result.templates.texts?.[gi] ?? [];
      const existingPos = bundle.groups.findIndex(g => g.name === importedGroup.name);

      if (existingPos === -1) {
        bundle.groups.push(importedGroup);
        bundle.texts.push(importedTexts);
        bundle.groupExpanded.push(true);
      } else {
        const targetTexts = bundle.texts[existingPos] ?? [];
        for (const importedText of importedTexts) {
          const clashPos = targetTexts.findIndex(t => t.name === importedText.name);
          if (clashPos !== -1) targetTexts.splice(clashPos, 1);
          targetTexts.push(importedText);
        }
        bundle.texts[existingPos] = targetTexts;
      }
      changedTemplates = true;
    }
  }

  // Merge scripts: same logic at script-name level.
  if (result.scripts?.length) {
    for (const importedScript of result.scripts) {
      const existingPos = bundle.scripts.findIndex(s => s.name === importedScript.name);
      if (existingPos !== -1) bundle.scripts.splice(existingPos, 1);
      bundle.scripts.push(importedScript);
      changedScripts = true;
    }
  }

  if (!changedTemplates && !changedScripts) return;
  markChanged(bundle);
  if (changedTemplates) renderTemplateList();
  if (changedScripts) renderScriptList();
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener("change", () => resolve(input.files[0] || null));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = e => { if (e.target.readyState === FileReader.DONE) resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ---------- Save / Close ----------

async function doSave() {
  commitTemplateEdits();
  commitScriptEdits();
  await saveAll();
  // Re-run deprecation detection so ⚠️ markers update after the user
  // fixes incompatible scripts or removes deprecated tags.
  const bundles = await storage.getActiveStorageEntries();
  state.deprecatedUsages = await utils.detectDeprecatedUsages(bundles);
  _indexDeprecatedUsages();
  renderTemplateList();
  renderScriptList();
  renderScriptDetail();
}

function onClose() {
  commitTemplateEdits();
  commitScriptEdits();
  window.close();
}

window.addEventListener("beforeunload", e => {
  if (!state.changed) return;
  e.preventDefault();
  e.returnValue = "";
});

// ---------- Init ----------

async function init() {
  localizeDocument();

  const { migrationRunning } = await browser.storage.session.get({ migrationRunning: false });
  if (migrationRunning) {
    await showAlert("A FILE migration is currently in progress. Please close this window and try again after the migration completes.");
    window.close();
    return;
  }

  await loadAll();

  // Tab buttons
  for (const btn of document.querySelectorAll(".tab-btn")) {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  }

  // General tab
  renderGeneral();
  updateCounterLegend();

  new storage.StorageListener({
    area: "auto",
    watchedPrefs: ["counter"],
    listener: events => {
      for (const { changes } of events) {
        if (changes.counter) {
          state.prefs.counter = changes.counter.newValue;
          updateCounterLegend();
        }
      }
    },
  });

  // Local-area post-write rebuild hook to update the insert-tag menu. This also
  // monitors defaultImport, which can get updated by the background if the managed
  // entries changed (unsaved user edits are discarded).
  new storage.StorageListener({
    area: "local",
    watchedPrefs: ["templates", "scripts", "popup", "menuCollapse", "defaultImport"],
    listener: async (events) => {
      // `area: "local"` means a single chunk per emission.
      const changes = events[0]?.changes ?? {};
      if (changes.defaultImport) {
        // External write (background fetcher, reconcile, etc.):
        // blanket-replace our working copy and re-render. Any
        // unsaved user edits to defaultImport are dropped by design.
        state.prefs.defaultImport = await storage.getPref("defaultImport");
        _refreshImportViews();
      }
      buildInsertTagMenu();
    }
  });

  // Managed-area policy updates, supporting the modern `managedStorage` wrapper
  // key or on the legacy top-level `templates` and `scripts` keys. Either triggers
  // a re-sync of the managed-policy flag plus a refresh of the in-memory managed
  // bundle from `browser.storage.managed`.
  new storage.StorageListener({
    area: "managed",
    watchedPrefs: ["templates", "scripts", "managedStorage"],
    listener: async () => {
      state.hasManagedStorage = await storage.hasManagedPolicy();
      const managedEntry = state.storageEntries.find(e => e.type === "managed");
      if (managedEntry) {
        const fresh = await storage.readBundleForEntry(managedEntry);
        const bundle = findBundle(managedEntry.uuid);
        if (bundle) {
          bundle.groups = fresh.templates.groups;
          bundle.texts = fresh.templates.texts;
          bundle.scripts = fresh.scripts;
          bundle.groupExpanded = bundle.groups.map(() => true);
        }
      }
      renderTemplateList();
      renderScriptList();
      renderStorageList();
      renderTemplateDetail();
      renderScriptDetail();
      buildInsertTagMenu();
    }
  });

  // Re-render the storage list when VFS provider connections change
  // (renamed, added, or removed) so the connection column stays current.
  vfs.onConnectionsChanged.addListener(async () => {
    await _refreshVfsProviders();
    renderStorageList();
  });

  // Rebuild when external script add-ons register/unregister or
  // provider availability changes.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "session" && "externalScripts" in changes) {
      buildInsertTagMenu();
    }
    if (areaName === "session" && "providerAvailability" in changes) {
      state.providerAvailability = changes.providerAvailability.newValue ?? {};
      for (const bundle of state.bundles) {
        const avail = state.providerAvailability[bundle.storageUuid];
        const wasUnavailable = bundle.unavailable;
        bundle.unavailable = avail && !avail.available;
        bundle.unavailableReason = avail?.reason;
        if (bundle.unavailable && !wasUnavailable) {
          bundle.groups = [];
          bundle.texts = [];
          bundle.scripts = [];
        }
      }
      renderStorageList();
      renderTemplateList();
      renderScriptList();
      updateTemplateButtons();
      updateScriptButtons();
    }
  });


  // Template tab buttons
  document.getElementById("btn-add-group").addEventListener("click", addGroup);
  document.getElementById("btn-add-template").addEventListener("click", addTemplate);
  document.getElementById("btn-remove-template").addEventListener("click", removeTemplateOrGroup);

  // Bundle-affecting detail-field listeners. Templates and scripts
  // live in the same config file and share one `bundle.dirty` flag,
  // so the wrapper picks whichever bundle is currently selected on
  // the active tab.
  const markSelectedBundleChanged = () => {
    const onScriptsTab = document.querySelector(".tab-btn.active")?.dataset.tab === "scripts";
    const uuid = onScriptsTab ? state.selectedScriptStorageUuid : state.selectedTemplateStorageUuid;
    markChanged(findBundle(uuid));
  };

  // Template detail fields
  document.getElementById("text-title").addEventListener("input", onTitleInput);
  document.getElementById("text-body").addEventListener("input", markSelectedBundleChanged);
  document.getElementById("sel-type").addEventListener("change", markSelectedBundleChanged);
  document.getElementById("sel-shortcut").addEventListener("change", markSelectedBundleChanged);
  document.getElementById("text-shortcut-adv").addEventListener("input", markSelectedBundleChanged);
  document.getElementById("text-keyword").addEventListener("input", e => {
    e.target.value = e.target.value.replace(/\s/g, "");
    markSelectedBundleChanged();
  });
  document.getElementById("text-subject").addEventListener("input", markSelectedBundleChanged);

  document.getElementById("btn-insert-tag").addEventListener("click", async e => {
    const menu = document.getElementById("insert-tag-menu");
    e.stopPropagation();
    if (!menu.hidden) {
      menu.hidden = true;
      return;
    }
    // Rebuild from live bundles every time the flyout opens, so
    // unsaved template/script renames and additions are reflected.
    await buildInsertTagMenu();
    updateDateTimeFlyOutMenus();
    menu.hidden = false;
  });

  document.getElementById("insert-tag-menu").addEventListener("mouseover", e => {
    const grp = e.target.closest(".var-group");
    const lbl = grp?.querySelector(":scope > .var-group-label");
    const sub = grp?.querySelector(":scope > .var-submenu");
    if (!lbl || !sub) return;
    computePosition(lbl, sub, {
      placement: "left-start",
      middleware: [flip(), shift({ padding: 4 })],
    }).then(({ x, y }) => {
      sub.style.left = `${x}px`;
      sub.style.top = `${y}px`;
    });
  });

  document.getElementById("insert-tag-menu").addEventListener("click", async e => {
    const btn = e.target.closest(".var-item");
    if (!btn) return;
    document.getElementById("insert-tag-menu").hidden = true;
    const val = btn.dataset.val;

    if (val.includes("<vfs-path>")) {
      // The flyout is disabled for read-only templates, so the
      // selected storage is always a writable VFS entry here.
      const entry = state.storageEntries.find(
        e => e.uuid === state.selectedTemplateStorageUuid);
      if (!entry || entry.type !== "vfs") return;
      const types = val.startsWith("IMAGE=")
        ? [{ description: i18n("quicktext.insertImage.label"),
             accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"] } }]
        : null;
      const [picked] = await vfs.showSelectFilePicker({
        storageRef: entry.storageRef ?? null,
        lockStorage: "soft",
        opfsStorageName: storage.OPFS_STORAGE_NAME,
        types,
      });
      if (picked) insertVariable(val.replace("<vfs-path>", picked.path));
    } else if (val.includes("<url>")) {
      const url = await showPrompt(i18n("quicktext.prompt.addUrl.label"), "https://");
      if (url) insertVariable(val.replace("<url>", url));
    } else {
      insertVariable(val);
    }
  });

  document.addEventListener("click", () => {
    document.getElementById("insert-tag-menu").hidden = true;
  });

  // Show/Hide the "Insert Tag" menu when right-clicking in the template detail
  // textarea. Rebuild from live bundles so unsaved template/script
  // edits (new items, renames) show up in the context menu.
  messenger.menus.onShown.addListener(async (info) => {
    const element = info.targetElementId ? browser.menus.getTargetElement(info.targetElementId) : null;
    if (
      element?.id === "text-body" &&
      document.querySelector(".tab-btn.active")?.dataset.tab === "templates" &&
      state.selectedTextIdx !== -1
    ) {
      await rebuildManagerContextMenu();
      browser.menus.update("managerInsertTagMenu", { visible: true });
      messenger.menus.refresh();
    }
  });
  messenger.menus.onHidden.addListener(() => {
    browser.menus.update("managerInsertTagMenu", { visible: false });
  });

  // Script tab
  document.getElementById("btn-add-script").addEventListener("click", addScript);
  document.getElementById("btn-remove-script").addEventListener("click", removeScript);
  document.getElementById("btn-community-scripts").addEventListener("click", () =>
    messenger.tabs.create({ url: "https://addons.thunderbird.net/addon/quicktext-community-scripts/" }));
  document.getElementById("script-title").addEventListener("input", onScriptTitleInput);
  document.getElementById("script-body").addEventListener("input", markSelectedBundleChanged);

  // Bottom buttons
  document.getElementById("btn-save").addEventListener("click", doSave);
  document.getElementById("btn-close").addEventListener("click", onClose);
  document.getElementById("btn-help").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/"));
  document.getElementById("btn-script-help").addEventListener("click", () =>
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/issues/451"));

  // Keyboard
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); doSave(); }
    if (e.key === "Escape") {
      const menu = document.getElementById("insert-tag-menu");
      if (!menu.hidden) { menu.hidden = true; return; }
      onClose();
    }
  });

  // Check if community scripts add-on is already installed
  state.communityScriptsInstalled = await messenger.management.get(COMMUNITY_SCRIPTS_ID)
    .then(() => true, () => false);
  messenger.management.onInstalled.addListener(addon => {
    if (addon.id === COMMUNITY_SCRIPTS_ID) {
      state.communityScriptsInstalled = true;
      updateCommunityScriptsButton();
    }
  });
  messenger.management.onUninstalled.addListener(addon => {
    if (addon.id === COMMUNITY_SCRIPTS_ID) {
      state.communityScriptsInstalled = false;
      updateCommunityScriptsButton();
    }
  });

  // Pre-select the first group / script of the first enabled
  // writable bundle that has one. Walk state.storageEntries to
  // respect user-facing ordering. Read-only bundles (managed,
  // future URL imports) are skipped so the user lands on an
  // editable row by default. If no writable bundle has any content
  // yet, still point the selection at the first writable bundle
  // so Add group/template/script always has a target storage
  // without requiring the user to click a header first.
  const firstWritableEntry = state.storageEntries.find(e => {
    if (e.enabled === false || e.isReadOnly) return false;
    const b = findBundle(e.uuid);
    return b && !b.unavailable;
  });
  for (const entry of state.storageEntries) {
    if (entry.enabled === false || entry.isReadOnly) continue;
    const bundle = findBundle(entry.uuid);
    if (bundle?.unavailable) continue;
    if (bundle?.groups.length) {
      state.selectedTemplateStorageUuid = entry.uuid;
      state.selectedGroupIdx = 0;
      break;
    }
  }
  if (!state.selectedTemplateStorageUuid && firstWritableEntry) {
    state.selectedTemplateStorageUuid = firstWritableEntry.uuid;
  }
  for (const entry of state.storageEntries) {
    if (entry.enabled === false || entry.isReadOnly) continue;
    const bundle = findBundle(entry.uuid);
    if (bundle?.unavailable) continue;
    if (bundle?.scripts.length) {
      state.selectedScriptStorageUuid = entry.uuid;
      state.selectedScriptIdx = 0;
      break;
    }
  }
  if (!state.selectedScriptStorageUuid && firstWritableEntry) {
    state.selectedScriptStorageUuid = firstWritableEntry.uuid;
  }

  document.getElementById("btn-add-import").addEventListener("click", addImportListEntry);
  document.getElementById("btn-rename-import").addEventListener("click", renameImportListEntry);
  document.getElementById("btn-remove-import").addEventListener("click", removeImportListEntry);

  // Initial render
  renderTemplateList();
  renderTemplateDetail();
  renderScriptList();
  renderScriptDetail();
  renderAdvanced();
  renderImportList();

  // Register the WebExtension context menu now that the initial
  // selection exists, so `getTagsMenuStructure` can scope its
  // templates/scripts to the right storage. The menu is recreated
  // from live bundles inside `messenger.menus.onShown`, so this
  // initial build only needs to exist so the various
  // `browser.menus.update("managerInsertTagMenu", ...)` calls in
  // switchTab / renderTemplateDetail / selectItem find a target.
  await rebuildManagerContextMenu();

  switchTab("templates");
}

document.addEventListener("DOMContentLoaded", init);
