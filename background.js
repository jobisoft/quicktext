(async () => {

  // Define default prefs.
  let defaultPrefs = {
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

  try {
    // Allow to set defaultImport from managed storage.
    let { defaultImportOverride } = await browser.storage.managed.get({ "defaultImportOverride": "" });
    if (defaultImportOverride) {
      preferences.setPref("defaultImport", defaultImportOverride);
    }
  } catch (ex) {
    // No managed storage manifest found, ignore.
  }

  try {
    // Allow to override templateFolder from managed storage.
    let { templateFolderOverride } = await browser.storage.managed.get({ "templateFolderOverride": "" });
    if (templateFolderOverride) {
      preferences.setPref("templateFolder", templateFolderOverride);
    }
  } catch (ex) {
    // No managed storage manifest found, ignore.
  }

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

  // load add-on via WindowListener API
  await messenger.WindowListener.registerChromeUrl([
    ["content", "quicktext", "chrome/content/"],
    ["resource", "quicktext", "chrome/"],
  ]);

  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    "chrome://quicktext/content/scripts/messengercompose.js");
  messenger.WindowListener.startListening();

  // React to pref changes.
  messenger.storage.sync.onChanged.addListener(changes => {
    if (changes.userPrefs.newValue.hasOwnProperty("popup")) {
      let visible = changes.userPrefs.newValue.popup;
      messenger.menus.update("composeContextMenu", { visible })
    }
    if (changes.userPrefs.newValue.hasOwnProperty("toolbar")) {
      let visible = changes.userPrefs.newValue.toolbar;
      messenger.Quicktext.toggleToolbar(visible);
    }
  })

  // Add entries to open settings.
  await messenger.menus.create({
    title: browser.i18n.getMessage("quicktext.label"),
    contexts: ["tools_menu"],
    onclick: (info, tab) => messenger.Quicktext.openSettings(tab.windowId)
  })
  browser.composeAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });
  browser.browserAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });

  // Add Quicktext composeBody context menu.
  await messenger.menus.create({
    id: "composeContextMenu",
    title: browser.i18n.getMessage("quicktext.label"),
    contexts: ["compose_body"],
    onclick: (info, tab) => console.log(info)
  })

  // Add config options to composeAction context menu.
  await messenger.menus.create({
    title: browser.i18n.getMessage("quicktext.showToolbar.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("toolbar"),
    onclick: (info, tab) => preferences.setPref("toolbar", info.checked)
  })
  await messenger.menus.create({
    title: browser.i18n.getMessage("quicktext.showContextMenu.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("popup"),
    onclick: (info, tab) => preferences.setPref("popup", info.checked)
  })

})();
