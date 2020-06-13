async function main() {
  // register chrome URLs, just like in the now obsolete chrome.manifest
  await browser.ChromeURL.register([ ["content", "quicktext", "content/"] ]);

  // init ConversionHelper
  await browser.ConversionHelper.init("chrome://quicktext/content/api/ConversionHelper/ConversionHelper.jsm");

  // define default prefs and migrate legacy settings
  let defaultPrefs = {
    "counter": 0,
    "settingsFolder": "",
    "defaultImport": "",
    "menuCollapse": true,
    "toolbar": true,
    "popup": false,
    "keywordKey": "Tab",
    "shortcutModifier": "alt",
    "shortcutTypeAdv": false,
    "collapseState": ""
  };

  await preferences.setDefaults(defaultPrefs);
  await preferences.migrateFromLegacy(defaultPrefs, "extensions.quicktext.");

  // init OverlayManager 
  await browser.OverlayManager.init("chrome://quicktext/content/api/OverlayManager/OverlayManager.jsm");
  await browser.OverlayManager.setVerbosity(9);

  // register overlays and activate the OverlayManager
  await browser.OverlayManager.register("chrome://messenger/content/messengercompose/messengercompose.xul", "chrome://quicktext/content/quicktext.xul");        
  await browser.OverlayManager.register("chrome://messenger/content/messenger.xul", "chrome://quicktext/content/main.xul");        
  await browser.OverlayManager.register("chrome://messenger/content/messengercompose/messengercompose.xhtml", "chrome://quicktext/content/quicktext.xul");        
  await browser.OverlayManager.register("chrome://messenger/content/messenger.xhtml", "chrome://quicktext/content/main.xul");        
  await browser.OverlayManager.activate();
  
  // as we have now full control over the legacy part, this is no longer needed
  //await browser.ConversionHelper.notifyStartupCompleted();
}

main();
