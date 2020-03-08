/* eslint-disable object-shorthand */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var pathToJSM = null;

var conversionHelper = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      conversionHelper: {

        init: async function(aPath) {
          // get the final path
          pathToJSM = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.getURL(aPath);
          
          // try to load the JSM and set the extension context
          try {
            var { ConversionHelper } = ChromeUtils.import(pathToJSM);
            ConversionHelper.context = context;
          } catch (e) {
            console.log("Failed to load <" + pathToJSM + ">");
            Components.utils.reportError(e);
          }
        },
        
        notifyStartupCompleted: async function() {
          if (!pathToJSM) {
            throw new Error("Path to ConversionHelper.jsm not set. Please call browser.conversionHelper.init(aPath) first!");
          }          
          var { ConversionHelper } = ChromeUtils.import(pathToJSM);
          ConversionHelper.notifyStartupComplete();          
        }
      },
    };
  }
};
