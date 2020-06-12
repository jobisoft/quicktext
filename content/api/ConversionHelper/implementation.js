/* eslint-disable object-shorthand */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

// BAD GLOBAL
var pathToHelperJSM = null;

var ConversionHelper = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      ConversionHelper: {

        init: async function(aPath) {
          // get the final path
          pathToHelperJSM = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(pathToHelperJSM);
            JSM.ConversionHelper.context = context;
          } catch (e) {
            console.log("Failed to load <" + pathToHelperJSM + ">");
            Components.utils.reportError(e);
          }
        },
        
        notifyStartupCompleted: async function() {
          if (!pathToHelperJSM) {
            throw new Error("Path to ConversionHelper.jsm not set. Please call browser.ConversionHelper.init(aPath) first!");
          }
          let JSM = ChromeUtils.import(pathToHelperJSM);
          JSM.ConversionHelper.notifyStartupComplete();          
        }
      },
    };
  }
};