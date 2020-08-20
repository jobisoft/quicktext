/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * This file is intended to be used in the WebExtension background page,
 * in popup pages, option pages, content pages as well as in legacy chrome
 * windows.
 * The preferences will be loaded asynchronously from the WebExtension
 * storage and stored in a local pref obj, so all further access can be done
 * synchronously.
 * If preferences are changed elsewhere, the local pref obj will be updated.
 * 
 * Version: 1.0
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Define a prefix for the userPref and defaultPref "branch" in the
// WebExtension storage. The defaults are also stored there, so all
// instances of this script have access to the defaults. 
// A call to preferences.init(defaults) will either set the defaults,
// or load the defaults from the storage, if no defaults obj is given.
const userPrefPrefix = "pref.value.";
const defaultPrefPrefix = "pref.defaults.";

// Set the storage area of userPrefs either to "local" or "sync". Setting it to
// "sync" is a hack to keep preferences stored even after the add-on has been
// removed and installed again (storage.local is cleared upon add-on removal).
// Even though Thunderbird does not actually have a sync backend, storage.sync
// is not cleared on add-on removal to mimic syncing stored values.
// Hint: Reloading/Updating an add-on does not clear storage.local.
const userPrefStorageArea = "sync";

var preferences = {
  
  _prefs: {},  
   
  // Get pref value from local pref obj.
  getPref: function(aName, aFallback = null) {
    if (this._prefs.hasOwnProperty(userPrefPrefix + aName)) {
      return this._prefs[userPrefPrefix + aName];
    }
    return this._prefs.hasOwnProperty(defaultPrefPrefix + aName)
      ? this._prefs[defaultPrefPrefix + aName]
      : aFallback;
  },

  // Set pref value by updating local pref obj and updating storage.
  setPref: function(aName, aValue) {
    this._prefs[userPrefPrefix + aName] = aValue;
    messenger.storage[userPrefStorageArea].set({ [userPrefPrefix + aName] : aValue });
  },

  // Remove a preference (calls to getPref will return default value)
  clearPref: function(aName, aValue) {
    delete this._prefs[userPrefPrefix + aName];
    messenger.storage[userPrefStorageArea].remove(userPrefPrefix + aName);    
  },
  
  // Listener for storage changes.
  storageChanged: function (changes, area) {
    let changedItems = Object.keys(changes);
    for (let item of changedItems) {
      if ((area == userPrefStorageArea && item.startsWith(userPrefPrefix)) || (area == "local" && item.startsWith(defaultPrefPrefix))) {
        if (typeof changes[item].newValue === 'undefined') {
          if (preferences._prefs.hasOwnProperty(item)) {
            delete preferences._prefs[item];
          }
        } else {
          preferences._prefs[item] = changes[item].newValue;
        }
      }
    }
  },

  // Initialize the local pref obj by loading userPrefs and defaultPrefs from
  // WebExtension storage. If a defaults obj is given, the defaults in storage
  // are updated/set.
  init: async function(defaults = null) {
    this._prefs = {};
    
    // Run through storage and put all userPrefs into the local prefs obj.
    let userPrefStorage = await messenger.storage[userPrefStorageArea].get();
    for (let key of Object.keys(userPrefStorage)) {
      if (key.startsWith(userPrefPrefix)) {
        this._prefs[key] = userPrefStorage[key];
      }
    }

    // Add storage change listener.
    await messenger.storage.onChanged.addListener(this.storageChanged);
    
    // If defaults are given, push them into storage.local, if not, get them
    // from storage.local.
    if (defaults) {
      // Remove all defaults from storage.local for which we do not have an
      // entry in the provided defaults obj.
      let defaultPrefStorage = await messenger.storage.local.get();
      for (let key of Object.keys(defaultPrefStorage)) {
        if (key.startsWith(defaultPrefPrefix)) {
          let prefName = key.split(defaultPrefPrefix).slice(1).join(defaultPrefPrefix);
          if (!defaults.hasOwnProperty(prefName)) {
            await messenger.storage.local.remove(key);
          }
        }
      }      
      // Push new defaults into storage.local.
      for (let key of Object.keys(defaults)) {
        browser.storage.local.set({ [defaultPrefPrefix + key] : defaults[key] });
        this._prefs[ defaultPrefPrefix + key] = defaults[key];
      }
      
    } else {
      // As no defaults are given, load them from storage.local.
      let defaultPrefStorage = await messenger.storage.local.get();
      for (let key of Object.keys(defaultPrefStorage)) {
        if (key.startsWith(defaultPrefPrefix)) {
          this._prefs[key] = defaultPrefStorage[key];
        }
      }
    }    
  },

}
