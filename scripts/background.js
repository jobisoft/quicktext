import * as utils from "/modules/utils.mjs";
import * as menus from "/modules/menus.mjs";
import * as quicktext from "/modules/quicktext.mjs";
import * as preferences from "/modules/preferences.mjs";

const HOMEPAGE = "https://github.com/jobisoft/quicktext/wiki/";

(async () => {
  // Define prefs, which can be overridden by system admins.
  const managedPrefs = [
    "defaultImport",
    "templateFolder",
  ];

  // Still allow to read overrides from LegacyPref.
  const legacyPrefBranch = "extensions.quicktext.";
  for (let managedPref of managedPrefs) {
    let override = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}${managedPref}Override`);
    if (override !== null) {
      preferences.setPref(managedPref, override);
    }
  }

  // Allow override via managed storage.
  for (let managedPref of managedPrefs) {
    try {
      let rv = await messenger.storage.managed.get({ [managedPref]: null });
      if (rv[managedPref] != null) {
        preferences.setPref([managedPref], rv[managedPref]);
      }
    } catch (ex) {
      // No managed storage manifest found, ignore.
    }
  }

  // Get some prefs which we need to during startup.
  const OPTIONS = [
    "templateFolder", "collapseGroup", "keywordKey", "viewPopup", "shortcutTypeAdv",
    "shortcutModifier", "collapseState", "defaultImport"
  ]
  let options = {}
  for (let name of OPTIONS) {
    options[name] = await preferences.getPref(name);
  }

  // Fix invalid options:
  // - reset the value of mShortcutModifier to "alt", if it has not a valid value - see issue #177
  if (!["alt", "control", "meta"].includes(options.shortcutModifier)) {
    options.shortcutModifier = "alt";
    await preferences.setPref("shortcutModifier", options.shortcutModifier)
  }

  // Allow compose script to access WebExtension modules.
  messenger.runtime.onMessage.addListener(async (info, sender, sendResponse) => {
    switch (info.command) {
      case "setPref":
        return preferences.setPref(info.pref, info.value);
      case "getPref":
        return preferences.getPref(info.pref);
      case "getKeywordsAndShortcuts": 
        return quicktext.getKeywordsAndShortcuts();
      case "insertTemplate":
        return quicktext.insertVariable(
          sender.tab.id, 
          `TEXT=${quicktext.templates.group[info.group].mName}|${quicktext.templates.texts[info.group][info.text].mName}`
        );
      }
  });

  // React to open composer tabs.
  async function prepareComposeTab(tab) {
    // BUG: Thunderbird should wait with executeScript until tab is ready.
    //      Getting the compose details works around this.
    await messenger.compose.getComposeDetails(tab.id);
    await messenger.tabs.executeScript(tab.id, {
      file: "/scripts/compose.js"
    });
  }
  messenger.tabs.onCreated.addListener(prepareComposeTab);
  let composeTabs = await messenger.tabs.query({ type: "messageCompose" });
  for (let composeTab of composeTabs) {
    await prepareComposeTab(composeTab);
  }

  // React to pref changes.
  messenger.storage.sync.onChanged.addListener(async changes => {
    if (changes.userPrefs.newValue.hasOwnProperty("popup")) {
      // Placeholder for preference changes we might need to act on, the
      // "popup" preference no longer exists.
    }
  })

  // Add entries to open settings.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.label"),
    contexts: ["tools_menu"],
    onclick: (info, tab) => messenger.Quicktext.openSettings(tab.id)
  })
  messenger.composeAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.id); });
  messenger.browserAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.id); });

  // Load templates from disc.
  await quicktext.loadTemplates(options);

  // Add Quicktext composeBody context menu.
  await menus.buildComposeBodyMenu();

  // Update the menus before showing them.
  messenger.menus.onShown.addListener(async () => {
    await menus.updateDateTimeMenus();
    await menus.updateTemplateMenus();
    messenger.menus.refresh();
  });

})();

