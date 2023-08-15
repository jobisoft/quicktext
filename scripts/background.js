import * as menus from "/modules/menus.mjs";
import * as preferences from "/modules/preferences.mjs";

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

  // Allow legacy code to access local storage prefs.
  messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
    switch (info.command) {
      case "setPref":
        preferences.setPref(info.pref, info.value);
        break;
      case "getPref":
        return await preferences.getPref(info.pref);
        break;
    }
  });

  // As long as we have a XUL settings window, we still need this. The next step
  // is to convert the settings window to html and move all legacy functions from
  // the JSMs directly into the Quicktext API.
  await messenger.Quicktext.registerChromeUrl([
    ["content", "quicktext", "chrome/content/"],
    ["resource", "quicktext", "chrome/"],
  ]);

  // React to open composer tabs.
  async function prepareComposeTab(tab) {
    await messenger.Quicktext.load(tab.windowId, { toolbar: await preferences.getPref("toolbar")});
    // Why ???
    // await new Promise(r => window.setTimeout(r, 250));
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
        await messenger.Quicktext.toggleToolbar(composeTab.windowId, visible);
      }
    }
  })

  // Add entries to open settings.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.label"),
    contexts: ["tools_menu"],
    onclick: (info, tab) => messenger.Quicktext.openSettings(tab.windowId)
  })
  messenger.composeAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });
  messenger.browserAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });

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

