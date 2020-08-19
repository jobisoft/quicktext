/* eslint-disable object-shorthand */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
  
var LegacyPrefs = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {    
    
    const PrefTypes = {
      [Services.prefs.PREF_STRING] : "string",
      [Services.prefs.PREF_INT] : "number",
      [Services.prefs.PREF_BOOL] : "boolean",
      [Services.prefs.PREF_INVALID] : "invalid"
    };

    return {
      LegacyPrefs: {

        // get may only return something, if a value is set
        getUserPref: async function(aName) {         
          let prefType = Services.prefs.getPrefType(aName);
          if (prefType == Services.prefs.PREF_INVALID) {
            return null;
          }
          
          let value = null;
          if (Services.prefs.prefHasUserValue(aName)) {
            switch (PrefTypes[prefType]) {
              case "string":
                  value = Services.prefs.getCharPref(aName, null);
                  break;

              case "number":
                  value = Services.prefs.getIntPref(aName, null);
                  break;
              
              case "boolean":
                  value = Services.prefs.getBoolPref(aName, null);
                  break;
                
              default:
                console.error("Legacy preference <" + aName + "> has an unknown type of <" +prefType + ">.  Migration skipped.");
            }
          }          
          return value;
        },

        clearUserPref: function(aName) {
          Services.prefs.clearUserPref(aName);
        }

      }
    };
  }
};
