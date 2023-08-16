import * as menus from "/modules/menus.mjs";
import * as quicktext from "/modules/quicktext.mjs";
import * as preferences from "/modules/preferences.mjs";

(async () => {
  // As long as we have a XUL settings window, we still need this. The next step
  // is to convert the settings window to html and move all legacy functions from
  // the JSMs directly into the Quicktext API.
  await messenger.Quicktext.registerChromeUrl([
    ["content", "quicktext", "chrome/content/"],
    ["resource", "quicktext", "chrome/"],
  ]);

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

  // Get some prefs which need to during startup
  const OPTIONS = [
    "templateFolder", "collapseGroup", "keywordKey", "viewPopup", "shortcutTypeAdv",
    "shortcutModifier", "collapseState", "defaultImport"
  ]
  let options = {}
  for (let name of OPTIONS) {
    options[name] = await preferences.getPref(name);
  }

  // Fix invalid options
  // - reset the value of mShortcutModifier to "alt", if it has not a valid value - see issue #177
  if (!["alt", "control", "meta"].includes(options.shortcutModifier)) {
    options.shortcutModifier = "alt";
    await preferences.setPref("shortcutModifier", options.shortcutModifier)
  }

  // Load templates.
  let templates = {}
  await quicktext.loadTemplates(templates, options);
  console.log(templates);

  // Allow legacy code to access WebExtension modules.
  messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
    switch (info.command) {
      case "setPref":
        return preferences.setPref(info.pref, info.value);
      case "getPref":
        return preferences.getPref(info.pref);
      case "insertVariable":
        return quicktext.insertVariable(info.tabId, info.variable);
      case "getTemplates":
        return templates;
    }
  });

  // React to open composer tabs.
  async function prepareComposeTab(tab) {
    await messenger.Quicktext.addToolbar(tab.id, { toolbar: await preferences.getPref("toolbar")});
    await messenger.tabs.executeScript(tab.id, {
      file: "/scripts/compose.js"
    });
  }
  messenger.tabs.onCreated.addListener(prepareComposeTab);
  let composeTabs = await messenger.tabs.query({type: "messageCompose"});
  for (let composeTab of composeTabs) {
    await prepareComposeTab(composeTab);
  }

  // React to pref changes.
  messenger.storage.sync.onChanged.addListener(async changes => {
    if (changes.userPrefs.newValue.hasOwnProperty("popup")) {
      let visible = changes.userPrefs.newValue.popup;
      await messenger.menus.update("composeContextMenu", { visible })
    }
    if (changes.userPrefs.newValue.hasOwnProperty("toolbar")) {
      let visible = changes.userPrefs.newValue.toolbar;
      let composeTabs = await messenger.tabs.query({type: "messageCompose"});
      for (let composeTab of composeTabs) {
        await messenger.Quicktext.toggleToolbar(composeTab.id, visible);
      }
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

  // Add config options to composeAction context menu.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.showToolbar.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("toolbar"),
    onclick: (info, tab) => preferences.setPref("toolbar", info.checked)
  })

  // Add Quicktext composeBody context menu.
  await menus.buildComposeBodyMenu();

  // Update the menus before showing them.
  messenger.menus.onShown.addListener(async () => {
    await menus.updateDateTimeMenus();
    await menus.updateTemplateMenus();
    messenger.menus.refresh();
  });

})();

