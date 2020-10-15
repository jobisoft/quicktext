## Objective

Use this API to migrate your preferences from the legacy pref branch to the local storage of your MailExtension.

## Usage

Define an object which contains the names of all the preferences you want to migrate and loop through it. To reduce redundancy, you could actually use the same object which is used to define the default values of your add-on options. 

A background script could look like the following:

```
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
  
(async function(){

  // Store the default values in local storage as well, so they
  // are accessible from everywhere. This is optional and is
  // not related to the LegacyPrefs API.
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
      // or use preference.js part of this repository:
      // https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences
      preferences.setPref(prefName, legacyValue);
      
      // Clear the legacy value.
      messenger.LegacyPrefs.clearUserPref(`${legacyPrefBranch}${prefName}`);
    }
  }

})()

```

A detailed usage description of the used `preferences.js` script can be found in [/scripts/preferences/](https://github.com/thundernest/addon-developer-support/tree/master/scripts/preferences).
