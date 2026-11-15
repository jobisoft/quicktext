import { getTemplatesMenuStructure } from "./menuStructure.mjs";

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as composeToolbar from "../modules/composeToolbar.mjs";

const COMPANION_ADDON_ID = "quicktext-legacy@jobisoft.de";

// Bundle all data the companion's update() needs into a single response, avoiding
// multiple round-trips. Templates use the existing getTemplatesMenuStructure()
// output (flat in single-storage, nested with storage wrappers in multi-storage).
async function buildToolbarData() {
  return {
    templates: await getTemplatesMenuStructure(),
    shortcutModifier: await storage.getPref("shortcutModifier"),
    menuCollapse: await storage.getPref("menuCollapse"),
  };
}

// ---- Toolbar inside the message editor (replaces the companion's toolbar)

// Turn the templates menu structure into the model of composeToolbar.mjs,
// following the same rules as the companion's toolbar: one button per group,
// a single-template group collapses into a plain button if menuCollapse is
// set, and multi-storage setups get one labelled section per storage.
async function buildEditorToolbarModel() {
  const { templates, shortcutModifier, menuCollapse } = await buildToolbarData();
  const modifier = messenger.i18n.getMessage(`quicktext.${shortcutModifier}Key.label`) || shortcutModifier;

  const toItem = t => ({
    label: t.title,
    hint: t.shortcut ? `${modifier} + ${t.shortcut == 10 ? 0 : t.shortcut}` : "",
    action: { command: "insertTemplate", storageUuid: t.storageUuid, group: t.groupIndex, text: t.textIndex },
  });
  const toEntry = node => {
    if (node.disabled) return { label: node.title, disabled: true };
    if (node.children.length === 1 && menuCollapse) return toItem(node.children[0]);
    return { label: node.title, children: node.children.map(toItem) };
  };

  const isMulti = templates.some(n => n.children?.some(c => c.children));
  const sections = isMulti && templates.length > 1
    ? templates.map(s => ({
      label: s.title,
      disabled: !!s.disabled,
      entries: s.disabled ? [] : s.children.map(toEntry),
    }))
    : [{ entries: (isMulti ? templates[0].children : templates).map(toEntry) }];

  return { sections };
}

async function updateEditorToolbar(tabId) {
  try {
    if (await storage.getPref("toolbar")) {
      await composeToolbar.show(tabId, await buildEditorToolbarModel());
    } else {
      await composeToolbar.hide(tabId);
    }
  } catch (ex) {
    console.error("[Quicktext] Could not update the compose toolbar", ex);
  }
}

async function updateAllEditorToolbars() {
  const tabs = await messenger.tabs.query({ type: "messageCompose" });
  await Promise.all(tabs.map(tab => updateEditorToolbar(tab.id)));
}

async function initEditorToolbar() {
  composeToolbar.init({
    onAction: (tabId, action) => {
      switch (action?.command) {
        case "insertTemplate":
          return quicktext.insertTemplate(tabId, action.storageUuid, action.group, action.text);
      }
    },
  });

  messenger.tabs.onCreated.addListener(async tab => {
    if (tab.type != "messageCompose") return;
    // Same workaround as in compose.mjs: wait until the editor is ready.
    await messenger.compose.getComposeDetails(tab.id);
    await updateEditorToolbar(tab.id);
  });

  // The host is part of the editor document, which is sent as a whole. Remove
  // it before sending, unless compose.mjs is going to cancel the send because
  // an INPUT popup is still open.
  browser.compose.onBeforeSend.addListener(async tab => {
    const inputPopupOpen = await messenger.tabs.sendMessage(tab.id, { isInputPopupOpen: true }).catch(() => false);
    if (!inputPopupOpen) {
      await composeToolbar.hide(tab.id);
    }
  });
  // Sending failed, the compose window stays open: bring the toolbar back.
  browser.compose.onAfterSend.addListener((tab, sendInfo) => {
    if (sendInfo?.error) updateEditorToolbar(tab.id);
  });

  new storage.StorageListener({
    area: "auto",
    watchedPrefs: ["toolbar", "templates", "managedStorage", "menuCollapse", "shortcutModifier", "storageLocations", "defaultImport", "providerAvailability"],
    listener: () => updateAllEditorToolbars(),
  });

  await updateAllEditorToolbars();
}

// ---- Toolbar of the legacy companion add-on

function getLegacyToolbarLabels() {
  return {};
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
  await initEditorToolbar();

  // Listener for the quicktext-legacy add-on (proxied toolbar commands).
  messenger.runtime.onMessageExternal.addListener((info, sender) => {
    if (sender.id !== COMPANION_ADDON_ID) return false;

    switch (info.command) {
      case "getToolbarData":
        return buildToolbarData();
      case "getPref":
        return storage.getPref(info.pref);
      case "insertTemplate":
        return messenger.tabs
          .query({ windowId: info.windowId, type: "messageCompose" })
          .then(tabs => quicktext.insertTemplate(tabs[0].id, info.storageUuid, info.group, info.text));
    }
    
    return false;
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
  new storage.StorageListener({
    area: "auto",
    watchedPrefs: ["templates", "managedStorage", "menuCollapse", "shortcutModifier", "storageLocations", "defaultImport", "providerAvailability"],
    listener: async (_events) => {
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
  })

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