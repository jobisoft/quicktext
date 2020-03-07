async function main() {
  await preferences.setDefaults({
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
    });  
  console.log("keywordKey: " + await preferences.getPref("keywordKey")); 
}

main();
