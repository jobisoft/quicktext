/* eslint-disable object-shorthand */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

// You probably already know what this does.
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

const PrefTypes = {
  [Services.prefs.PREF_STRING] : "string",
  [Services.prefs.PREF_INT] : "number",
  [Services.prefs.PREF_BOOL] : "boolean",
  [Services.prefs.PREF_INVALID] : "invalid"
};
  
var legacyprefs = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    
    
    return {
      legacyprefs: {

        // get may only return something, if a value is set
        get: async function(aName, aDefault) {
          let prefType = Services.prefs.getPrefType(aName);
          if (prefType == Services.prefs.PREF_INVALID) {
            return null;
          }

          if (typeof aDefault != PrefTypes[prefType]) {
            throw new Error("PrefType of <" + aName + "> is <" + PrefTypes[prefType] + "> and does not match the type of its default value <" + aDefault + "> which is <" + typeof aDefault + ">!");
          }
          
          switch (typeof aDefault) {
            case "string":
                return Services.prefs.getCharPref(aName, aDefault);

            case "number":
                return Services.prefs.getIntPref(aName, aDefault);
            
            case "boolean":
                return Services.prefs.getBoolPref(aName, aDefault);
              
            default:
              throw new Error("Preference <" + aName + "> has an unsupported type <" + typeof aDefault + ">. Allowed are string, number and boolean.");
          }

        },

        clear: async function(aName) {
          Services.prefs.clearUserPref(aName);
        }

      },
    };
  }
};
