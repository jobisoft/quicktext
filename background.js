(async () => {

  // Define default prefs.
  const defaultPrefs = {
    "counter": 0,
    "templateFolder": "",
    "defaultImport": "",
    "menuCollapse": true,
    "toolbar": true,
    "popup": false,
    "keywordKey": "Tab",
    "shortcutModifier": "alt",
    "shortcutTypeAdv": false,
    "collapseState": ""
  };
  await preferences.init(defaultPrefs);

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
  // is to convert the settigns window to html and move all legacy functions from
  // the JSMs directly into the Quicktext API.
  await messenger.Quicktext.registerChromeUrl([
    ["content", "quicktext", "chrome/content/"],
    ["resource", "quicktext", "chrome/"],
  ]);

  // React to open composer windows.
  messenger.windows.onCreated.addListener(window => {
    if (window.type != "messageCompose") {
      return;
    }
    messenger.Quicktext.load(window.id);
  });
  let composeWindows = await messenger.windows.getAll({ windowTypes: ["messageCompose"] });
  for (let composeWindow of composeWindows) {
    await messenger.Quicktext.load(composeWindow.id);
  }

  // React to pref changes.
  messenger.storage.sync.onChanged.addListener(changes => {
    if (changes.userPrefs.newValue.hasOwnProperty("popup")) {
      let visible = changes.userPrefs.newValue.popup;
      messenger.menus.update("composeContextMenu", { visible })
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

  // Add Quicktext composeBody context menu.
  await messenger.menus.create({
    id: "composeContextMenu",
    title: messenger.i18n.getMessage("quicktext.label"),
    contexts: ["compose_body"],
    visible: await preferences.getPref("popup"),
    onclick: (info, tab) => console.log(info)
  })

  // Add config options to composeAction context menu.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.showToolbar.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("toolbar"),
    onclick: (info, tab) => preferences.setPref("toolbar", info.checked)
  })
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.showContextMenu.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("popup"),
    onclick: (info, tab) => preferences.setPref("popup", info.checked)
  })

})();
