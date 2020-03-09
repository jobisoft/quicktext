async function main() {
  await browser.conversionHelper.init("chrome://quicktext/content/modules/ConversionHelper.jsm");

  // can access browser.*

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
    
  await browser.conversionHelper.notifyStartupCompleted();
}

main();
