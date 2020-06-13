/* eslint-disable object-shorthand */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

var ConversionHelper = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);
    this.pathToJSM = null;
    let that = this;
    
    return {
      ConversionHelper: {

        init: async function(aPath) {
          // get the final path
          that.pathToJSM = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(that.pathToJSM);
            JSM.ConversionHelper.context = context;
          } catch (e) {
            console.log("Failed to load <" + that.pathToJSM + ">");
            Components.utils.reportError(e);
          }
        },
        
        notifyStartupCompleted: async function() {
          if (!that.pathToJSM) {
            throw new Error("Path to ConversionHelper.jsm not set. Please call browser.ConversionHelper.init(aPath) first!");
          }
          let JSM = ChromeUtils.import(that.pathToJSM);
          JSM.ConversionHelper.notifyStartupComplete();          
        }
      },
    };
  }
  
  close() {
    // This function is called if the extension is disabled or removed, or Thunderbird closes.
    // We registered it with callOnClose, above.

    // Unload the JSM we imported above. This will cause Thunderbird to forget about the JSM, and
    // load it afresh next time `import` is called. (If you don't call `unload`, Thunderbird will
    // remember this version of the module and continue to use it, even if your extension receives
    // an update.) You should *always* unload JSMs provided by your extension.
    Cu.unload(this.pathToJSM);
    console.log("ConversionHelper unloaded!");    
  }  
};