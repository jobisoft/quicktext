/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Version 1.10
 * - adjusted to Thunderbird Supernova (Services is now in globalThis)
 *
 * Version 1.9
 * - fixed fallback issue reported by Axel Grude
 *
 * Version 1.8
 * - reworked onChanged event to allow registering multiple branches
 *
 * Version 1.7
 * - add onChanged event
 *
 * Version 1.6
 * - add setDefaultPref()
 *
 * Version 1.5
 * - replace set/getCharPref by set/getStringPref to fix encoding issue
 *
 * Version 1.4
 * - setPref() function returns true if the value could be set, otherwise false
 *
 * Version 1.3
 * - add setPref() function
 *
 * Version 1.2
 * - add getPref() function
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

var { ExtensionCommon } = ChromeUtils.import(
  "resource://gre/modules/ExtensionCommon.jsm"
);
var { ExtensionUtils } = ChromeUtils.import(
  "resource://gre/modules/ExtensionUtils.jsm"
);
var { ExtensionError } = ExtensionUtils;

var Services = globalThis.Services || 
  ChromeUtils.import("resource://gre/modules/Services.jsm").Services;


var LegacyPrefs = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {

    class LegacyPrefsManager {
      constructor() {
        this.observedBranches = new Map();
        this.QueryInterface = ChromeUtils.generateQI([
          "nsIObserver",
          "nsISupportsWeakReference",
        ])
      }

      addObservedBranch(branch, fire) {
        return this.observedBranches.set(branch, fire);
      }

      hasObservedBranch(branch) {
        return this.observedBranches.has(branch);
      }

      removeObservedBranch(branch) {
        return this.observedBranches.delete(branch);
      }

      async observe(aSubject, aTopic, aData) {
        if (aTopic == "nsPref:changed") {
          let branch = [...this.observedBranches.keys()]
            .reduce(
              (p, c) => aData.startsWith(c) && (!p || c.length > p.length) ? c : p,
              null
            );
          if (branch) {
            let name = aData.substr(branch.length);
            let value = await this.getLegacyPref(aData);
            let fire = this.observedBranches.get(branch);
            fire(name, value);
          }
        }
      }

      async getLegacyPref(
        aName,
        aFallback = null,
        userPrefOnly = true
      ) {
        let prefType = Services.prefs.getPrefType(aName);
        if (prefType == Services.prefs.PREF_INVALID) {
          return aFallback;
        }

        let value = aFallback;
        if (!userPrefOnly || Services.prefs.prefHasUserValue(aName)) {
          switch (prefType) {
            case Services.prefs.PREF_STRING:
              value = Services.prefs.getStringPref(aName, aFallback);
              break;

            case Services.prefs.PREF_INT:
              value = Services.prefs.getIntPref(aName, aFallback);
              break;

            case Services.prefs.PREF_BOOL:
              value = Services.prefs.getBoolPref(aName, aFallback);
              break;

            default:
              console.error(
                `Legacy preference <${aName}> has an unknown type of <${prefType}>.`
              );
          }
        }
        return value;
      }
    }

    let legacyPrefsManager = new LegacyPrefsManager();

    return {
      LegacyPrefs: {
        onChanged: new ExtensionCommon.EventManager({
          context,
          name: "LegacyPrefs.onChanged",
          register: (fire, branch) => {
            if (legacyPrefsManager.hasObservedBranch(branch)) {
              throw new ExtensionError(`Cannot add more than one listener for branch "${branch}".`)
            }
            legacyPrefsManager.addObservedBranch(branch, fire.sync);
            Services.prefs
              .getBranch(null)
              .addObserver(branch, legacyPrefsManager);
            return () => {
              Services.prefs
                .getBranch(null)
                .removeObserver(branch, legacyPrefsManager);
              legacyPrefsManager.removeObservedBranch(branch);
            };
          },
        }).api(),

        // only returns something, if a user pref value is set
        getUserPref: async function (aName) {
          return await legacyPrefsManager.getLegacyPref(aName);
        },

        // returns the default value, if no user defined value exists,
        // and returns the fallback value, if the preference does not exist
        getPref: async function (aName, aFallback = null) {
          return await legacyPrefsManager.getLegacyPref(aName, aFallback, false);
        },

        clearUserPref: function (aName) {
          Services.prefs.clearUserPref(aName);
        },

        // sets a pref
        setPref: async function (aName, aValue) {
          let prefType = Services.prefs.getPrefType(aName);
          if (prefType == Services.prefs.PREF_INVALID) {
            console.error(
              `Unknown legacy preference <${aName}>, forgot to declare a default?.`
            );
            return false;
          }

          switch (prefType) {
            case Services.prefs.PREF_STRING:
              Services.prefs.setStringPref(aName, aValue);
              return true;
              break;

            case Services.prefs.PREF_INT:
              Services.prefs.setIntPref(aName, aValue);
              return true;
              break;

            case Services.prefs.PREF_BOOL:
              Services.prefs.setBoolPref(aName, aValue);
              return true;
              break;

            default:
              console.error(
                `Legacy preference <${aName}> has an unknown type of <${prefType}>.`
              );
          }
          return false;
        },

        setDefaultPref: async function (aName, aValue) {
          let defaults = Services.prefs.getDefaultBranch("");
          switch (typeof aValue) {
            case "string":
              return defaults.setStringPref(aName, aValue);
            case "number":
              return defaults.setIntPref(aName, aValue);
            case "boolean":
              return defaults.setBoolPref(aName, aValue);
          }
        },
      },
    };
  }
};
