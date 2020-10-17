async function waitForLoad() {
	let windows = await browser.windows.getAll({windowTypes:["normal"]});
	if (windows.length > 0) {
		return false;
	}
	
	return new Promise(function(resolve, reject) {
		function listener() {
			browser.windows.onCreated.removeListener(listener);
			resolve(true);
		}
		browser.windows.onCreated.addListener(listener);
	});
}


(async () => { 
  await waitForLoad();
  await messenger.WindowListener.waitForMasterPassword();

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
  
  // Migrate legacy prefs using the LegacyPrefs API.
  const legacyPrefBranch = "extensions.quicktext.";
  const prefNames = Object.keys(defaultPrefs);

  for (let prefName of prefNames) {
    let legacyValue = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}${prefName}`);    
    if (legacyValue !== null) {
      console.log(`Migrating legacy preference <${legacyPrefBranch}${prefName}> = <${legacyValue}>.`);
      
      // Store the migrated value in local storage.
      // Check out the MDN documentation at
      // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage
      // or use preference.js bundled with this API
      preferences.setPref(prefName, legacyValue);
      
      // Clear the legacy value.
      messenger.LegacyPrefs.clearUserPref(`${legacyPrefBranch}${prefName}`);
    }
  }
  
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
  messenger.WindowListener.registerStartupScript("chrome://quicktext/content/scripts/startup.js");
  
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messengercompose/messengercompose.xhtml",
    "chrome://quicktext/content/scripts/messengercompose.js");
      
  messenger.WindowListener.registerWindow(
    "chrome://messenger/content/messenger.xhtml",
    "chrome://quicktext/content/scripts/messenger.js");
    
  messenger.WindowListener.startListening();
})();
