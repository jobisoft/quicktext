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

  // Allow to set defaultImport from managed storage.
  let { defaultImportOverride } = await browser.storage.managed.get({ "defaultImportOverride": "" });
  if (defaultImportOverride) {
    preferences.setPref("defaultImport", defaultImportOverride);
  }
  
  // Allow to override templateFolder from managed storage.
  let { templateFolderOverride } = await browser.storage.managed.get({ "templateFolderOverride": "" });
  if (templateFolderOverride) {
    preferences.setPref("templateFolder", templateFolderOverride);
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
  messenger.WindowListener.registerChromeUrl([ 
    ["content",   "quicktext",           "chrome/content/"],
    ["resource",  "quicktext",           "chrome/"],
  ]);

  messenger.WindowListener.registerOptionsPage("chrome://quicktext/content/addonoptions.xhtml")
  
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    "chrome://quicktext/content/scripts/messengercompose.js");
      
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messenger.xhtml",
    "chrome://quicktext/content/scripts/messenger.js");

  browser.composeAction.onClicked.addListener(tab => { messenger.WindowListener.openOptionsDialog(tab.windowId); });
  browser.browserAction.onClicked.addListener(tab => { messenger.WindowListener.openOptionsDialog(tab.windowId); });

  messenger.WindowListener.startListening();
})();
