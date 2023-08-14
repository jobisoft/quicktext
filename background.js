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

  browser.composeAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });
  browser.browserAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });

  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    "chrome://quicktext/content/scripts/messengercompose.js");

  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messenger.xhtml",
    "chrome://quicktext/content/scripts/messenger.js");


  messenger.WindowListener.startListening();
})();
