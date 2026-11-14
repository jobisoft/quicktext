/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Migration report: lists templates, scripts and configuration sources which
// still depend on features Quicktext no longer has (direct file system access,
// the Quicktext v5 script API). It only reports, nothing is changed.

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";
import { localizeDocument } from "/vendor/i18n.mjs";

const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;

// The last version which still has the migration wizard, which copies the
// referenced files and adjusts the tags automatically.
const WIZARD_VERSION = "6.9.5";
// Storage of the first listed FILE finding, opened by "Browse storage".
let browseStorageUuid = null;

const WIZARD_VERSION_URL = `https://addons.thunderbird.net/addon/quicktext/versions/#version-${WIZARD_VERSION}`;

function renderItem(container, location, lines) {
  const div = document.createElement("div");
  div.className = "migration-item";
  const loc = document.createElement("div");
  loc.className = "item-location";
  loc.textContent = location;
  div.appendChild(loc);
  for (const line of lines) {
    const el = document.createElement("div");
    el.className = line.className;
    el.textContent = line.text;
    div.appendChild(el);
  }
  container.appendChild(div);
}

function _sourceLabel(entry) {
  if (entry?.type === "managed") return i18n("migration.source.enterprisePolicy");
  if (entry?.type === "import") return i18n("migration.source.imported");
  return null;
}

function classifyFindings(results, entries, bundles) {
  const incompatibleScripts = [];
  const deprecatedFs = { templates: [], scripts: [] };

  const sourceMap = new Map();
  for (const e of entries) sourceMap.set(e.uuid, _sourceLabel(e));
  for (const b of bundles) {
    if (sourceMap.has(b.storageUuid)) continue;
    if (b.type === "import" || b.isImport) sourceMap.set(b.storageUuid, i18n("migration.source.imported"));
    else if (b.type === "managed") sourceMap.set(b.storageUuid, i18n("migration.source.enterprisePolicy"));
  }

  for (const t of results?.templates ?? []) {
    deprecatedFs.templates.push({ ...t, source: sourceMap.get(t.storageUuid) ?? null });
  }

  for (const s of results?.scripts ?? []) {
    const source = sourceMap.get(s.storageUuid) ?? null;
    const apiDetails = s.details.filter(d => d.type === "deprecated-api");
    const tagDetails = s.details.filter(d => d.type === "deprecated-tag");
    if (tagDetails.length) deprecatedFs.scripts.push({ ...s, details: tagDetails, source });
    if (apiDetails.length) incompatibleScripts.push({ ...s, details: apiDetails, source });
  }

  return { incompatibleScripts, deprecatedFs };
}

function _renderReadonlyNote(elementId, sources) {
  const importedLabel = i18n("migration.source.imported");
  const managedLabel = i18n("migration.source.enterprisePolicy");
  const hasImported = sources.some(s => s === importedLabel);
  const hasManaged = sources.some(s => s === managedLabel);
  const el = document.getElementById(elementId);
  if (!hasImported && !hasManaged) { el.hidden = true; return; }
  if (hasImported && hasManaged) {
    el.textContent = i18n("migration.readonlyNote.both");
  } else if (hasImported) {
    el.textContent = i18n("migration.readonlyNote.imported");
  } else {
    el.textContent = i18n("migration.readonlyNote.managed");
  }
  el.hidden = false;
}

function showSection(id, hasItems) {
  document.getElementById(id).hidden = !hasItems;
}

// Build a paragraph where $1 in the message is replaced by a link. Further
// substitutions are passed as $2, $3, ...
function _buildLinkedParagraph(elementId, messageKey, linkTextKey, href, subs = []) {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  const linkText = i18n(linkTextKey);
  const msg = i18n(messageKey, [linkText, ...subs]);
  const parts = msg.split(linkText);
  el.appendChild(document.createTextNode(parts[0]));
  el.appendChild(_makeLink(href, linkText));
  if (parts[1]) el.appendChild(document.createTextNode(parts[1]));
}

function _buildDroppedDescription() {
  const el = document.getElementById("dropped-description");
  el.innerHTML = "";
  const linkTexts = [
    i18n("migration.dropped.linkVfs"),
    i18n("migration.dropped.linkWebdav"),
    i18n("migration.dropped.linkHomefolder"),
  ];
  const links = [
    "https://addons.thunderbird.net/search/?q=VFS",
    "https://addons.thunderbird.net/en-US/thunderbird/addon/vfs-provider-webdav/",
    "https://addons.thunderbird.net/en-US/thunderbird/addon/vfs-home-folder-access/",
  ];
  const msg = i18n("migration.dropped.description", linkTexts);
  let remaining = msg;
  for (let idx = 0; idx < linkTexts.length; idx++) {
    const pos = remaining.indexOf(linkTexts[idx]);
    if (pos === -1) continue;
    el.appendChild(document.createTextNode(remaining.slice(0, pos)));
    el.appendChild(_makeLink(links[idx], linkTexts[idx]));
    remaining = remaining.slice(pos + linkTexts[idx].length);
  }
  if (remaining) el.appendChild(document.createTextNode(remaining));
}

function _makeLink(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.textContent = text;
  return a;
}

function renderIntro() {
  const el = document.getElementById("intro");
  el.innerHTML = "";

  const p = document.createElement("p");
  p.textContent = i18n("migrationReport.intro");
  el.appendChild(p);

  const quote = document.getElementById("author-quote");
  quote.textContent = i18n("migration.intro.quote");
  const attr = document.createElement("span");
  attr.className = "attribution";
  attr.textContent = i18n("migration.intro.quoteAttribution");
  quote.appendChild(attr);
  quote.hidden = false;
}

// The tag as it would look after copying the file into the storage location,
// as a hint for converting it by hand. Only for plain paths, not for paths
// built from other tags.
function rewriteHint(configDir, tagOrCall, path, isScript) {
  if (!path || path.includes("[[")) return null;
  const vfsPath = utils.getVfsTargetPath(configDir, tagOrCall, path);
  const rewritten = isScript
    ? utils.rewriteScriptCallPreview(tagOrCall, path, vfsPath)
    : utils.rewriteTagPreview(tagOrCall, vfsPath);
  return { className: "item-target", text: `→ ${rewritten}` };
}

async function render() {
  const { deprecatedUsages: results, droppedFileEntries } = await browser.storage.local.get({
    deprecatedUsages: null,
    droppedFileEntries: null,
  });

  const entries = await storage.getAllStorageEntries();
  const bundles = await storage.getActiveStorageEntries();
  const { incompatibleScripts, deprecatedFs } = classifyFindings(results, entries, bundles);

  // Map storageUuid → config directory (parent of the config file path).
  const configDirMap = new Map();
  for (const e of entries) {
    configDirMap.set(e.uuid, utils.getConfigDir(e.path));
  }

  renderIntro();

  // Deprecated filesystem access
  const fsCount = deprecatedFs.templates.length + deprecatedFs.scripts.length;
  browseStorageUuid = deprecatedFs.templates[0]?.storageUuid ?? deprecatedFs.scripts[0]?.storageUuid ?? null;
  showSection("manual-filesystem", fsCount > 0);
  if (fsCount > 0) {
    _buildLinkedParagraph("filesystem-description",
      "migrationReport.filesystem.description",
      "migration.filesystem.linkText",
      "https://github.com/jobisoft/quicktext/wiki/Storage-locations#adding-files-to-a-storage-location");
    _buildLinkedParagraph("filesystem-old-version",
      "migrationReport.filesystem.oldVersion",
      "migrationReport.filesystem.oldVersion.linkText",
      WIZARD_VERSION_URL,
      [WIZARD_VERSION]);
    const list = document.getElementById("manual-filesystem-list");
    list.innerHTML = "";
    for (const t of deprecatedFs.templates) {
      const typeLabel = t.source ? `${t.source} template` : "template";
      const configDir = configDirMap.get(t.storageUuid) ?? "";
      const lines = t.tags.flatMap(tag => {
        const hint = rewriteHint(configDir, tag.tag, tag.path, false);
        return hint ? [{ className: "item-tag", text: tag.tag }, hint] : [{ className: "item-tag", text: tag.tag }];
      });
      renderItem(list, `${t.storageName} › ${t.group} › ${t.template} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedFilesystem") }, ...lines]);
    }
    for (const s of deprecatedFs.scripts) {
      const typeLabel = s.source ? `${s.source} script` : "script";
      const configDir = configDirMap.get(s.storageUuid) ?? "";
      const lines = s.details.flatMap(d => {
        const hint = rewriteHint(configDir, d.call, d.path, true);
        return hint ? [{ className: "item-tag", text: d.call }, hint] : [{ className: "item-tag", text: d.call }];
      });
      renderItem(list, `${s.storageName} › ${s.script} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedFilesystem") }, ...lines]);
    }
    _renderReadonlyNote("manual-filesystem-readonly-note", [
      ...deprecatedFs.templates.map(t => t.source),
      ...deprecatedFs.scripts.map(s => s.source),
    ]);
  }

  // Incompatible scripts
  const incompatibleCount = incompatibleScripts.length;
  showSection("manual-incompatible", incompatibleCount > 0);
  if (incompatibleCount > 0) {
    _buildLinkedParagraph("incompatible-description",
      "migration.incompatible.description",
      "migration.incompatible.linkText",
      "https://github.com/jobisoft/quicktext/wiki/WebExtension-script-support");
    const list = document.getElementById("manual-incompatible-list");
    list.innerHTML = "";
    for (const s of incompatibleScripts) {
      const typeLabel = s.source ? `${s.source} script` : "script";
      const lines = s.details.map(d => ({ className: "item-tag", text: d.keyword }));
      renderItem(list, `${s.storageName} › ${s.script} (${typeLabel})`,
        [{ className: "item-reason", text: i18n("migration.reason.deprecatedApi") }, ...lines]);
    }
    _renderReadonlyNote("manual-incompatible-readonly-note", incompatibleScripts.map(s => s.source));
  }

  // Dropped FILE-based configuration sources
  const droppedCount = droppedFileEntries?.length ?? 0;
  showSection("dropped-header", droppedCount > 0);
  showSection("dropped-intro", droppedCount > 0);
  showSection("dropped-section", droppedCount > 0);
  if (droppedCount > 0) {
    _buildDroppedDescription();
    const list = document.getElementById("dropped-list");
    list.innerHTML = "";
    for (const entry of droppedFileEntries) {
      const label = entry.type === "import"
        ? i18n("migration.label.fileImport") : i18n("migration.label.fileStorage");
      const desc = entry.type === "import"
        ? i18n("migration.desc.fileImport") : i18n("migration.desc.fileStorage");
      renderItem(list, `${label}: ${entry.path}`,
        [{ className: "item-reason", text: desc }]);
    }
  }
}

// Open the storage browser (same picker as the manager's "Browse" button) in
// the folder of the config file, which is where the suggested paths point.
// Prefer the storage of the listed findings, else the first writable one.
async function browseStorage() {
  const vfsEntries = (await storage.getAllStorageEntries()).filter(e => e.type === "vfs");
  const entry = vfsEntries.find(e => e.uuid === browseStorageUuid)
    ?? vfsEntries.find(e => !e.isReadOnly)
    ?? vfsEntries[0];
  if (!entry) return;
  try {
    await vfs.showBrowseFilePicker({
      startIn: utils.getConfigDir(entry.path) || "/",
      storageRef: entry.storageRef,
      opfsStorageName: storage.OPFS_STORAGE_NAME,
    });
  } catch (ex) {
    console.log(ex);
  }
}

// Remember what was reported, so the report opens again at startup only if
// something new shows up.
async function dismissReport() {
  const { deprecatedUsages, droppedFileEntries } = await browser.storage.local.get({
    deprecatedUsages: null,
    droppedFileEntries: null,
  });
  await browser.storage.local.set({
    migrationReportDismissed: utils.getMigrationReportIds(deprecatedUsages, droppedFileEntries),
  });
  await browser.storage.local.remove("droppedFileEntries");
  const tab = await browser.tabs.getCurrent();
  if (tab) browser.tabs.remove(tab.id);
}

document.addEventListener("DOMContentLoaded", async () => {
  localizeDocument();

  const title = i18n("migrationReport.pageTitle");
  document.title = title;
  document.getElementById("page-title").textContent = title;

  // Intercept all link clicks. Add-on pages on ATN open in a Thunderbird tab,
  // so the add-on can be installed from there directly. Everything else opens
  // in the default browser.
  document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a?.href?.startsWith("http")) return;
    e.preventDefault();
    if (new URL(a.href).hostname === "addons.thunderbird.net") {
      browser.tabs.create({ url: a.href });
    } else {
      browser.windows.openDefaultBrowser(a.href);
    }
  });

  await render();

  document.getElementById("btn-open-manager").addEventListener("click", () => {
    utils.openSettingsDialog();
  });

  document.getElementById("btn-browse-storage").addEventListener("click", browseStorage);

  document.getElementById("btn-wiki-storage").addEventListener("click", () => {
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/Storage-locations");
  });

  document.getElementById("btn-wiki-journey").addEventListener("click", () => {
    browser.windows.openDefaultBrowser("https://github.com/jobisoft/quicktext/wiki/Quicktext's-journey-from-a-legacy-Add%E2%80%90on-to-a-modern-WebExtension");
  });

  document.getElementById("btn-dismiss").addEventListener("click", dismissReport);
});
