(async () => { 
  
  // Define default prefs.
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
  await preferences.init(defaultPrefs);
  
  // load add-on via WindowListener API
  messenger.WindowListener.registerChromeUrl([ 
    ["content",   "quicktext",           "chrome/content/"],
    ["resource",  "quicktext",           "chrome/"],
    ["locale",    "quicktext", "de",     "chrome/locale/de/"],
    ["locale",    "quicktext", "pt-BR",  "chrome/locale/pt_BR/"],
    ["locale",    "quicktext", "en-US",  "chrome/locale/en-US/"],
    ["locale",    "quicktext", "es",     "chrome/locale/es/"],
    ["locale",    "quicktext", "fr",     "chrome/locale/fr/"],
    ["locale",    "quicktext", "hu",     "chrome/locale/hu/"],
    ["locale",    "quicktext", "ja",     "chrome/locale/ja/"],
    ["locale",    "quicktext", "ru",     "chrome/locale/ru/"],
    ["locale",    "quicktext", "sv-SE",  "chrome/locale/sv-SE/"],
  ]);

  messenger.WindowListener.registerOptionsPage("chrome://quicktext/content/addonoptions.xhtml")
    
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    "chrome://quicktext/content/scripts/messengercompose.js");
      
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messenger.xhtml",
    "chrome://quicktext/content/scripts/messenger.js");
    
  messenger.WindowListener.startListening();
})();
