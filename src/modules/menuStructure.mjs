/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";

// Abstract menu structure shared across the compose action menu,
// the manager flyout menu, and the toolbar in the message editor.
//
// Each node:
//   { type: "group",     id, localeKey?, title?, children }
//   { type: "item",      id, localeKey?, title?, value?, groupIndex?, textIndex? }
//   { type: "separator", id? }
//   { type: "dateTime",  id, value, format }
//
// Default locale key: `quicktext.${id}.label`
// Explicit localeKey overrides this for ids that contain characters not
// usable in menu ID paths (e.g. dots).
// Dynamic title overrides localeKey for user-defined names (e.g. template names).

const CONTACT_FIELDS = [
  "firstname", "lastname", "fullname", "displayname", "nickname",
  "email", "workphone", "faxnumber", "cellularnumber", "jobtitle",
  "custom1", "custom2", "custom3", "custom4",
];

function contactItems(prefix) {
  return CONTACT_FIELDS.map(field => ({ type: "item", id: field, value: `${prefix}=${field}` }));
}

// Recursively drop nodes whose `restricted` array doesn't include
// the requested origin. Nodes without a `restricted` field appear
// in every origin. An undefined `origin` filters every restricted
// item out (safe default - surfaces forgotten call-site updates as
// missing menu entries rather than silent leaks).
function _filterByOrigin(nodes, origin) {
  return nodes.flatMap(node => {
    if (node.restricted && !node.restricted.includes(origin)) return [];
    if (!node.children) return [node];
    return [{ ...node, children: _filterByOrigin(node.children, origin) }];
  });
}

// `origin` selects which menu surface the structure is being built
// for. Items carrying a `restricted: [...]` array only appear when
// the requested origin is in their list. Today: "compose" (composer
// body context menu), "toolbar" (legacy toolbar), "manager"
// (Insert Tag flyout). Composer and toolbar share insertion
// semantics today but get distinct origin labels so future
// divergence is a label change, not a structural refactor.
export function getVariablesMenuStructure({ origin } = {}) {
  const nodes = [
    { type: "group", id: "to", children: contactItems("TO") },
    { type: "group", id: "from", children: contactItems("FROM") },
    {
      type: "group", id: "attachments", children: [
        { type: "item", id: "filename", value: "ATT=name" },
        { type: "item", id: "filenameAndSize", value: "ATT=full" },
      ]
    },
    {
      type: "group", id: "dateTime", children: [
        { type: "dateTime", id: "date-short", value: "DATE", format: "date-short" },
        { type: "dateTime", id: "date-long", value: "DATE=long", format: "date-long" },
        { type: "dateTime", id: "date-monthname", value: "DATE=monthname", format: "date-monthname" },
        { type: "dateTime", id: "time-noseconds", value: "TIME", format: "time-noseconds" },
        { type: "dateTime", id: "time-seconds", value: "TIME=seconds", format: "time-seconds" },
      ]
    },
    { type: "separator" },
    {
      type: "group", id: "insertfile", children: [
        {
          type: "group", id: "as-html", localeKey: "quicktext.insertTextFromFileAsHTML.label", children: [
            { type: "item", id: "mode-file", restricted: ["compose", "toolbar"], localeKey: "quicktext.mode.file.label", value: "FILE=<path>", insertMode: "text/html" },
            { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "URL=<url>", insertMode: "text/html" },
            { type: "item", id: "mode-vfs", localeKey: "quicktext.mode.vfs.label", value: "VFSFILE=<vfs-path>", insertMode: "text/html" },
          ]
        },
        {
          type: "group", id: "as-text", localeKey: "quicktext.insertTextFromFileAsText.label", children: [
            { type: "item", id: "mode-file", restricted: ["compose", "toolbar"], localeKey: "quicktext.mode.file.label", value: "FILE=<path>", insertMode: "text/plain" },
            { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "URL=<url>", insertMode: "text/plain" },
            { type: "item", id: "mode-vfs", localeKey: "quicktext.mode.vfs.label", value: "VFSFILE=<vfs-path>", insertMode: "text/plain" },
          ]
        },
      ]
    },
    {
      type: "group", id: "image", children: [
        { type: "item", id: "mode-file", restricted: ["compose", "toolbar"], localeKey: "quicktext.mode.file.label", value: "IMAGE=FILE|<path>" },
        { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "IMAGE=URL|<url>" },
        { type: "item", id: "mode-vfs", localeKey: "quicktext.mode.vfs.label", value: "IMAGE=VFS|<vfs-path>" },
      ]
    },
    {
      type: "group", id: "attachmentFile", children: [
        { type: "item", id: "mode-file", restricted: ["compose", "toolbar"], localeKey: "quicktext.mode.file.label", value: "ATTACHMENT=FILE|<path>" },
        { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "ATTACHMENT=URL|<url>" },
        { type: "item", id: "mode-vfs", localeKey: "quicktext.mode.vfs.label", value: "ATTACHMENT=VFS|<vfs-path>" },
      ]
    },
    { type: "separator" },
    {
      type: "group", id: "other", children: [
        { type: "item", id: "clipboard", value: "CLIPBOARD" },
        { type: "item", id: "counter", value: "COUNTER" },
        { type: "item", id: "input", value: "INPUT=name|type|options", restricted: ["manager"] },
        { type: "item", id: "selection", value: "SELECTION" },
        { type: "item", id: "orgatt", value: "ORGATT=\\n" },
        { type: "item", id: "orgheader", value: "ORGHEADER=type|\\n" },
        { type: "item", id: "subject", value: "SUBJECT" },
        { type: "item", id: "version", value: "VERSION" },
      ]
    },
    { type: "separator", restricted: ["manager"] },
    { type: "item", id: "header", value: "HEADER=type|value", restricted: ["manager"] },
    { type: "item", id: "cursor", value: "CURSOR", restricted: ["manager"] },
  ];
  return _filterByOrigin(nodes, origin);
}

export function getDateTimeMenuTitle(field, timeStamp) {
  const fieldType = field.split("-")[0];
  return browser.i18n.getMessage(`quicktext.${fieldType}.label`, utils.getDateTimeFormat(field, timeStamp));
}

// Object URLs for provider icon Blobs, one per provider, kept alive
// for the background page lifetime so that menus.create can reference
// them. The vfs-toolkit picker uses the same approach
// (picker.mjs: `URL.createObjectURL(p.icon)`).
const _providerIconUrlCache = new Map();

function _providerIconUrl(providerId, blob) {
  if (!blob) return null;
  const cached = _providerIconUrlCache.get(providerId);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  _providerIconUrlCache.set(providerId, url);
  return url;
}

// Icon fallbacks for storages that lack a VFS provider icon.
// - Managed entries get a dedicated shield glyph so the enterprise
//   policy is visually distinct from the user's own storages.
// - The built-in OPFS storage reuses the Quicktext add-on icon.
const MANAGED_STORAGE_ICON_URL = browser.runtime.getURL("/assets/icon-managed.svg");
const INTERNAL_STORAGE_ICON_URL = browser.runtime.getURL("/assets/icon.png");

// Resolve provider icons for every enabled storage, keyed by
// storageUuid. Managed entries prefer the policy-provided `icon`
// URL (from `managedStorage`) and fall back to the
// dedicated shield glyph; OPFS (no storageRef) uses the Quicktext
// add-on icon; external storages use their provider icon; unknown
// providers return `null`.
async function getStorageIconUrls(bundles) {
  let providers = [];
  try {
    providers = await vfs.fetchProviderConnections();
  } catch (ex) {
    console.log(ex);
  }
  const effective = await storage.getAllStorageEntries();
  const result = {};
  for (const bundle of bundles) {
    // Import bundles arrive with their icon preresolved (globe fallback
    // or admin-provided URL); use it directly without consulting the
    // storage-locations list, which doesn't contain imports.
    if (bundle.iconUrl) {
      result[bundle.storageUuid] = bundle.iconUrl;
      continue;
    }
    const entry = effective.find(e => e.uuid === bundle.storageUuid);
    if (!entry) {
      result[bundle.storageUuid] = INTERNAL_STORAGE_ICON_URL;
      continue;
    }
    if (entry.type === "managed") {
      result[bundle.storageUuid] = entry.icon || MANAGED_STORAGE_ICON_URL;
      continue;
    }
    if (!entry.storageRef) {
      result[bundle.storageUuid] = INTERNAL_STORAGE_ICON_URL;
      continue;
    }
    const provider = providers.find(p => p.providerId === entry.storageRef.providerId);
    result[bundle.storageUuid] = _providerIconUrl(entry.storageRef.providerId, provider?.icon ?? null);
  }
  return result;
}

// Build the group → texts structure for a single bundle. Each leaf
// carries the full `[storageUuid, groupIndex, textIndex]` address
// that the compose/manager menu builders need for insertion.
function _templateNodesForBundle(bundle) {
  const { templates, storageUuid } = bundle;
  const nodes = [];
  for (let i = 0; i < templates.groups.length; i++) {
    const children = [];
    for (let j = 0; j < templates.texts[i].length; j++) {
      children.push({
        type: "item",
        id: `storage-${storageUuid}-group-${i}-text-${j}`,
        title: templates.texts[i][j].name,
        storageUuid,
        groupIndex: i,
        textIndex: j,
        shortcut: templates.texts[i][j].shortcut,
        keyword: templates.texts[i][j].keyword,
      });
    }
    if (children.length === 0) continue;
    nodes.push({
      type: "group",
      id: `storage-${storageUuid}-group-${i}`,
      title: templates.groups[i].name,
      children,
    });
  }
  return nodes;
}

export async function getTemplatesMenuStructure({ storageUuid, bundles } = {}) {
  bundles = bundles ?? await storage.getActiveStorageEntries();
  if (bundles.length === 0) return [];

  // Filtered path: return only the named storage's templates in the
  // single-storage shape (no storage wrapper). Used by the manager's
  // Insert Tag flyout to scope tag pickers to the current template's
  // storage, since `TEXT=group|text` tags are storage-local at
  // runtime. A missing/unknown storageUuid yields an empty section.
  if (storageUuid != null) {
    const bundle = bundles.find(b => b.storageUuid === storageUuid);
    return bundle ? _templateNodesForBundle(bundle) : [];
  }

  // Single-storage path: return exactly the shape legacy callers expect
  // - one level of groups at the top. Consumers don't need to know about
  // the storage hierarchy at all.
  if (bundles.length === 1) {
    if (bundles[0].unavailable) {
      return [{
        type: "item",
        id: `storage-${bundles[0].storageUuid}-unavailable`,
        title: `${bundles[0].storageName} 🚫`,
        disabled: true,
      }];
    }
    return _templateNodesForBundle(bundles[0]);
  }

  // Multi-storage path: wrap each bundle's groups in a top-level storage
  // node whose icon comes from the VFS provider. Unavailable bundles get
  // a single disabled placeholder node instead of their children.
  const icons = await getStorageIconUrls(bundles);
  const result = [];
  for (const bundle of bundles) {
    if (bundle.unavailable) {
      result.push({
        type: "group",
        id: `storage-${bundle.storageUuid}`,
        title: `${bundle.storageName} 🚫`,
        iconUrl: icons[bundle.storageUuid],
        disabled: true,
        children: [],
      });
      continue;
    }
    const children = _templateNodesForBundle(bundle);
    if (children.length === 0) continue;
    result.push({
      type: "group",
      id: `storage-${bundle.storageUuid}`,
      title: bundle.storageName,
      iconUrl: icons[bundle.storageUuid],
      children,
    });
  }
  return result;
}

export async function getScriptsMenuStructure({ storageUuid, bundles } = {}) {
  bundles = bundles ?? await storage.getActiveStorageEntries();
  if (bundles.length === 0) return [];

  const makeItems = (bundle) => bundle.scripts.map((script, i) => ({
    type: "item",
    id: `storage-${bundle.storageUuid}-script-${i}`,
    title: script.name,
    storageUuid: bundle.storageUuid,
    scriptIdx: i,
  }));

  // Filtered path: only the named storage's scripts, in flat shape.
  if (storageUuid != null) {
    const bundle = bundles.find(b => b.storageUuid === storageUuid);
    return bundle ? makeItems(bundle) : [];
  }

  if (bundles.length === 1) {
    if (bundles[0].unavailable) {
      return [{
        type: "item",
        id: `storage-${bundles[0].storageUuid}-scripts-unavailable`,
        title: `${bundles[0].storageName} 🚫`,
        disabled: true,
      }];
    }
    return makeItems(bundles[0]);
  }

  const icons = await getStorageIconUrls(bundles);
  const result = [];
  for (const bundle of bundles) {
    if (bundle.unavailable) {
      result.push({
        type: "group",
        id: `storage-${bundle.storageUuid}-scripts`,
        title: `${bundle.storageName} 🚫`,
        iconUrl: icons[bundle.storageUuid],
        disabled: true,
        children: [],
      });
      continue;
    }
    const children = makeItems(bundle);
    if (children.length === 0) continue;
    result.push({
      type: "group",
      id: `storage-${bundle.storageUuid}-scripts`,
      title: bundle.storageName,
      iconUrl: icons[bundle.storageUuid],
      children,
    });
  }
  return result;
}

// Walk the templates and scripts menu structure and decorate every leaf
// with a `value` that the manager-side tag flyout inserts into the text
// being edited. The storage hierarchy (when present) is purely
// organisational - tags are always storage-local, so the inserted
// `TEXT=group|text` / `SCRIPT=name` syntax carries no storage prefix.
// A name ending in "]" would close the tag early ("[[TEXT=group|[Title]]]"),
// an empty options field after it prevents that (#652).
function _textTagValue(group, name) {
  return `TEXT=${group}|${name}|`;
}

function _decorateTemplatesWithValues(templateNodes, isMulti) {
  if (!isMulti) {
    // Single-storage shape is `[{group, children: [{text}]}]`.
    return templateNodes.map(node => ({
      ...node,
      children: node.children.map(child => ({
        ...child,
        value: _textTagValue(node.title, child.title),
      })),
    }));
  }
  // Multi-storage shape is `[{storage, children: [{group, children: [{text}]}]}]`.
  return templateNodes.map(storageNode => ({
    ...storageNode,
    children: storageNode.children.map(groupNode => ({
      ...groupNode,
      children: groupNode.children.map(child => ({
        ...child,
        value: _textTagValue(groupNode.title, child.title),
      })),
    })),
  }));
}

function _decorateScriptsWithValues(scriptNodes, isMulti) {
  if (!isMulti) {
    return scriptNodes.map(node => ({ ...node, value: `SCRIPT=${node.title}` }));
  }
  return scriptNodes.map(storageNode => ({
    ...storageNode,
    children: storageNode.children.map(child => ({
      ...child,
      value: `SCRIPT=${child.title}`,
    })),
  }));
}

export async function getTagsMenuStructure({ storageUuid, bundles, origin } = {}) {
  bundles = bundles ?? await storage.getActiveStorageEntries();
  // When filtered to a single storage, the result is always in the
  // single-storage shape regardless of how many storages exist, so
  // `isMulti` must be false even if bundles.length > 1.
  const isMulti = storageUuid == null && bundles.length > 1;

  const templateNodes = await getTemplatesMenuStructure({ storageUuid, bundles });
  const templateChildren = _decorateTemplatesWithValues(templateNodes, isMulti);

  const scriptNodes = await getScriptsMenuStructure({ storageUuid, bundles });
  const scriptChildren = _decorateScriptsWithValues(scriptNodes, isMulti);

  const nodes = [
    { type: "group", id: "variables", localeKey: "quicktext.variablesGroup.label", children: getVariablesMenuStructure({ origin }) },
  ];
  if (templateChildren.length > 0 || scriptChildren.length > 0) {
    nodes.push({
      type: "separator"
    });
    
    if (templateChildren.length > 0) {
      nodes.push({
        type: "group",
        id: "templates",
        localeKey: "quicktext.templates.label",
        children: templateChildren
      });
    }
    
    if (scriptChildren.length > 0) {
      nodes.push({
        type: "group",
        id: "scripts",
        localeKey: "quicktext.scripts.label",
        children: scriptChildren
      });
    }
  }
  
  const { externalScripts } = await browser.storage.session.get("externalScripts") ?? {};
  if (externalScripts?.length) {
    nodes.push({ type: "separator" });
    for (const provider of externalScripts) {
      nodes.push({
        type: "group",
        id: `external-${provider.id}`,
        title: provider.name,
        children: Object.entries(provider.scripts).map(([scriptName, scriptInfo], i) => ({
          type: "item",
          id: `external-${provider.id}-script-${i}`,
          description: scriptInfo.description,
          title: scriptName,
          value: provider.id === "quicktext.scripts@community.jobisoft.de"
            ? `CSCRIPT=${scriptInfo.usage}`
            : `ESCRIPT=${provider.id}|${scriptInfo.usage}`,
          providerId: provider.id,
        })),
      });
    }
  }

  return nodes;
}
