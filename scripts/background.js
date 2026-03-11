/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "../modules/quicktext.mjs";
import * as storage from "../modules/storage.mjs";
import * as utils from "../modules/utils.mjs";
import * as toolbar from "../modules/toolbar.mjs";
import * as compose from "../modules/compose.mjs";
import * as menus from "../modules/menus.mjs";
import * as manager from "../modules/manager.mjs";
import * as escripts from "../modules/escripts.mjs";

browser.runtime.onInstalled.addListener(details => {
  let manifest = browser.runtime.getManifest();
  if (!manifest.browser_specific_settings.gecko.update_url) {
    return
  };

  if (details.reason == "update") {
    browser.notifications.create("qt-update", {
      type: "basic",
      title: "Quicktext v6",
      message: `Quicktext GitHub Edition was updated to v${manifest.version}. Click for details.`,
    });
  }
});

browser.notifications.onClicked.addListener(notificationId => {
  switch (notificationId) {
    case "qt-deprecate-default-file-import":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/wiki/Centrally-manage-configurations-and-templates`,
      });
      break;
    case "qt-update":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/releases/tag/v${browser.runtime.getManifest().version}`,
      });
      break;
    case "qt-bad-entries":
      utils.openSettingsDialog();
      break;
    case "qt-incompatible-scripts":
      browser.tabs.create({
        url: `https://github.com/jobisoft/quicktext/issues/451`,
      });
      break;
  }
})

// Over the years, the storage concept has changed.
await storage.migrate();

// Fix invalid options:
// - reset the value of shortcutModifier to "alt", if it has not a valid value - see issue #177
const shortcutModifier = await storage.getPref("shortcutModifier");
if (!["alt", "control", "meta"].includes(shortcutModifier)) {
  await storage.setPref("shortcutModifier", "alt");
}

// Legacy: The XML files will be kept for backup, but are read only if they have
//         not already been migrated to local storage. Uninstalling Quicktext (which
//         clears the storage) and installing it again, will re-import the XML files.
//         For the future, users have to be reminded to backup their templates.
let templates = await storage.getTemplates();
if (!templates) {
  try {
    templates = await quicktext.readLegacyXmlTemplateFile().then(e => e.templates);
    console.log("Migrating XML template file to JSON stored in local storage.");
    await storage.setTemplates(templates);
  } catch { }
}
if (!templates) {
  templates = { groups: [], texts: [] };
  await storage.setTemplates(templates);
}

let scripts = await storage.getScripts();
if (!scripts) {
  try {
    scripts = await quicktext.readXmlScriptFile().then(e => e.scripts);
    console.log("Migrating XML script file to JSON stored in local storage.")
    await storage.setScripts(scripts);
  } catch { }
}
if (!scripts) {
  scripts = [];
  await storage.setScripts(scripts);
}

// Remove managed templates.
let cleanedTemplates = await utils.removeProtectedTemplates(templates);
if (templates != cleanedTemplates) {
  templates = cleanedTemplates;
  await storage.setTemplates(templates);
}

// Remove managed scripts.
let cleanedScripts = await utils.removeProtectedScripts(scripts);
if (scripts != cleanedScripts) {
  scripts = cleanedScripts;
  await storage.setScripts(scripts);
}

// Startup import.
let defaultImports = JSON.parse(await storage.getPref("defaultImport"));;
if (Array.isArray(defaultImports) && defaultImports.length > 0) {
  for (let defaultImportEntry of defaultImports) {
    let data;
    switch (defaultImportEntry.source.toLowerCase()) {
      case "file":
        try {
          // Import XML or JSON config data from the local file system.
          data = await browser.FileSystemAccess.readTextFile(defaultImportEntry.data);
        } catch (ex) {
          console.error("Failed to read file", ex);
        }
        break;
      case "url":
        try {
          // Import XML or JSON config data from remote server.
          data = await utils.fetchFileAsText(defaultImportEntry.data);
        } catch (ex) {
          console.error("Failed to read url", ex);
        }
        break;
    }
    if (data) {
      try {
        const imports = await quicktext.parseConfigFileData(data);
        if (imports.templates) {
          quicktext.mergeTemplates(templates, imports.templates, true);
        }
        if (imports.scripts) {
          quicktext.mergeScripts(scripts, imports.scripts, true);
        }
      } catch (ex) {
        console.error("Failed to parse data", ex);
      }
    }
  }
  await storage.setTemplates(templates);
  await storage.setScripts(scripts);
}

// Startup import via managed storage.
try {
  let { templates: managedTemplates } = await browser.storage.managed.get({ templates: null });
  if (managedTemplates) {
    quicktext.mergeTemplates(templates, managedTemplates, true);
  }
  let { scripts: managedScripts } = await browser.storage.managed.get({ scripts: null });
  if (managedScripts) {
    quicktext.mergeScripts(scripts, managedScripts, true);
  }
  await storage.setTemplates(templates);
  await storage.setScripts(scripts);
} catch {
  // No managed storage.
}

// Add menu entry to tools menu.
browser.menus.create({
  contexts: ["tools_menu"],
  onclick: () => utils.openSettingsDialog(),
  title: browser.i18n.getMessage("quicktext.label"),
})

// Add listeners to open template manager.
browser.composeAction.onClicked.addListener(tab => { utils.openSettingsDialog() });
browser.browserAction.onClicked.addListener(tab => { utils.openSettingsDialog() });

await compose.init();
await toolbar.init();
await manager.init();
await escripts.init();

// Update the date/time menus before showing them.
messenger.menus.onShown.addListener(async (info) => {
  if (info.menuIds.includes("insertVariable")) {
    await menus.updateDateTimeWebExtMenus("insertVariable.dateTime");
    messenger.menus.refresh();
  }
});

// Check if templates or scripts are invalid.
await utils.checkBadNameEntries(templates, scripts);
await utils.checkDuplicatedEntries(templates, scripts);
await utils.checkForIncompatibleScripts(scripts);
await utils.checkForDeprecatedAttachmentUsage(templates);
