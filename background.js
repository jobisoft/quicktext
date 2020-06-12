async function main() {
  await browser.ConversionHelper.init("chrome://quicktext/content/api/ConversionHelper/ConversionHelper.jsm");

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
    
  await browser.ConversionHelper.notifyStartupCompleted();
}

main();
