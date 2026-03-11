import { getVariablesMenuStructure, getInsertFileMenuStructure, getTemplatesMenuStructure } from "./menuStructure.mjs";

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as utils from "../modules/utils.mjs";

const COMPANION_ADDON_ID = "quicktext-legacy@jobisoft.de";

// Build the full variables menu structure for the legacy toolbar.
// Resolves the abstract structure from menuStructure.mjs into a
// label-resolved tree that the companion add-on builds into XUL elements.
async function buildInsertVariableMenuStructure() {
  const i18n = (key, subs) => browser.i18n.getMessage(key, subs) || key;

  const now = new Date();
  function resolve(nodes) {
    return nodes.map(node => {
      if (node.type === "separator") return { type: "separator" };
      if (node.type === "dateTime") {
        const fieldType = node.format.split("-")[0];
        const label = i18n(`quicktext.${fieldType}.label`, [utils.getDateTimeFormat(node.format, now)]);
        return { type: "item", label, value: node.value };
      }
      const label = i18n(node.localeKey || `quicktext.${node.id}.label`);
      if (node.type === "group") return { type: "group", label, children: resolve(node.children) };
      return { type: "item", label, value: node.value };
    });
  }

  return resolve(getVariablesMenuStructure());
}


async function buildInsertFileMenuStructure() {
  const i18n = key => browser.i18n.getMessage(key) || key;
  return getInsertFileMenuStructure().map(node => ({
    type: "item",
    label: i18n(`quicktext.${node.id}.label`),
    mimeType: node.mimeType,
  }));
}

// Collect the i18n strings still needed as __MSG_*__ placeholders in the XUL template.
function getLegacyToolbarLabels() {
  return Object.fromEntries([
    "quicktext.insertVariable.label",
    "quicktext.insertStaticFile.label",
  ].map(key => [key, browser.i18n.getMessage(key)]));
}

async function injectToolbar(window = null) {
  let legacyAddon;
  try {
    legacyAddon = await browser.management.get(COMPANION_ADDON_ID);
  } catch {
    // Not installed, do nothing.
  }
  if (legacyAddon?.enabled) {
    const labels = getLegacyToolbarLabels();
    let windows = window
      ? [window]
      : await browser.windows.getAll({ windowTypes: ["messageCompose"] });

    for (let window of windows) {
      browser.runtime.sendMessage(COMPANION_ADDON_ID, {
        command: "injectLegacyToolbar",
        windowId: window.id,
        labels
      });
    }
  }
}

export async function init() {
  // Listener for the quicktext-legacy add-on (proxied toolbar commands).
  messenger.runtime.onMessageExternal.addListener((info, sender) => {
    if (sender.id !== COMPANION_ADDON_ID) return;
    switch (info.command) {
      case "getTemplatesMenuStructure":
        return getTemplatesMenuStructure();
      case "getPref":
        return storage.getPref(info.pref);
      case "getVariablesMenuStructure":
        return buildInsertVariableMenuStructure();
      case "getInsertFileMenuStructure":
        return buildInsertFileMenuStructure();
      case "getDateTimeFormat":
        return utils.getDateTimeFormat(info.data.format, info.data.timeStamp);
      case "insertVariable":
        return messenger.tabs
          .query({ windowId: info.windowId, type: "messageCompose" })
          .then(tabs => quicktext.insertVariable({ tabId: tabs[0].id, variable: info.aVar }));
      case "insertTemplate":
        return messenger.tabs
          .query({ windowId: info.windowId, type: "messageCompose" })
          .then(tabs => quicktext.insertTemplate(tabs[0].id, info.group, info.text));
      case "insertFile":
        return messenger.tabs
          .query({ windowId: info.windowId, type: "messageCompose" })
          .then(tabs => quicktext.insertFile(tabs[0].id, info.file, info.aType));
    }
  });

  // Inject toolbar into all already open compose windows.
  await injectToolbar();

  // Inject toolbar into any new compose window being opened.
  browser.windows.onCreated.addListener(window => {
    if (window.type == "messageCompose") {
      injectToolbar(window);
    }
  });

  // Update toolbar if relevant settings changed.
  new storage.StorageListener(
    {
      watchedPrefs: ["templates", "menuCollapse", "shortcutModifier"],
      listener: async (changes) => {
        let legacyAddon;
        try {
          legacyAddon = await browser.management.get(COMPANION_ADDON_ID);
        } catch {
          // Not installed, do nothing.
        }
        if (!legacyAddon || legacyAddon.enabled === false) return;

        let windows = await browser.windows.getAll({
          windowTypes: ["messageCompose"]
        });
        windows.forEach(window => browser.runtime.sendMessage(
          COMPANION_ADDON_ID, {
          command: "updateLegacyToolbar",
          windowId: window.id
        }
        ));
      }
    }
  )

  // Auto-load the legacy toolbar if the legacy companion add-on is installed or
  // enabled.
  browser.management.onEnabled.addListener(async addon => {
    if (addon.id === COMPANION_ADDON_ID) {
      injectToolbar();
    }
  });
  browser.management.onInstalled.addListener(async addon => {
    if (addon.id === COMPANION_ADDON_ID) {
      injectToolbar();
    }
  });
}