import { getTemplatesMenuStructure } from "./menuStructure.mjs";

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as composeToolbar from "../modules/composeToolbar.mjs";
import * as composeToast from "../modules/composeToast.mjs";
import { formatShortcut } from "../modules/shortcuts.mjs";

// Templates use getTemplatesMenuStructure() output (flat in single-storage,
// nested with storage wrappers in multi-storage).
async function buildToolbarData() {
  return {
    templates: await getTemplatesMenuStructure(),
    shortcutModifier: await storage.getPref("shortcutModifier"),
    menuCollapse: await storage.getPref("menuCollapse"),
  };
}

// ---- Toolbar inside the message editor

// Turn the templates menu structure into the model of composeToolbar.mjs,
// following the same rules as the old companion toolbar: one button per group,
// a single-template group collapses into a plain button if menuCollapse is
// set, and multi-storage setups get one labelled section per storage.
async function buildEditorToolbarModel() {
  const { templates, shortcutModifier, menuCollapse } = await buildToolbarData();

  const toItem = t => ({
    label: t.title,
    hint: t.shortcut ? formatShortcut(shortcutModifier, t.shortcut == 10 ? 0 : t.shortcut) : "",
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
    await showCompanionToast(tab.id);
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

// ---- Legacy companion add-on
//
// The companion drew the old toolbar above the editor. It is replaced by the
// toolbar inside the editor and no longer receives any commands, so remind
// its users to remove it.

const COMPANION_ADDON_ID = "quicktext-legacy@jobisoft.de";

async function isCompanionActive() {
  try {
    return (await browser.management.get(COMPANION_ADDON_ID)).enabled;
  } catch {
    return false; // Not installed.
  }
}

async function showCompanionToast(tabId) {
  if (!await isCompanionActive()) return;
  const i18n = key => messenger.i18n.getMessage(key);
  try {
    await composeToast.show(tabId, {
      title: "Quicktext",
      tone: "success",
      summary: i18n("composeToast.companion.summary"),
      details: [
        i18n("composeToast.companion.details1"),
        i18n("composeToast.companion.details2"),
      ],
      labels: {
        expand: i18n("composeToast.expand"),
        collapse: i18n("composeToast.collapse"),
        close: i18n("composeToast.close"),
      },
    });
  } catch (ex) {
    console.error("[Quicktext] Could not show the companion toast", ex);
  }
}

export async function init() {
  await initEditorToolbar();
}
