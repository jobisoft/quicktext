/* eslint-disable object-shorthand */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

// ChromeUtils.import() works in experiments for core resource urls as it did
// in legacy add-ons. However, chrome:// urls that point to add-on resources no
// longer work, as the "chrome.manifest" file is no longer supported, which
// defined the root path for each add-on. The need to get the URL as follows
//
// let jsmUrl = context.extension.rootURI.resolve("path/to/module.jsm");
//
// The context object is passed to getAPI() of the WebExtension experiment
// implementation.
//
// rootURI.resolve() returns the same URL as the legacy AddOn.getResourceURI()

// This is the important part. It implements the functions and events defined in schema.json.
// The variable must have the same name you've been using so far, "OverlayManager" in this case.
var OverlayManager = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {   
    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);
    this.pathToJSM = null;
    this.OM = null;
    let that = this;
    
    return {
      OverlayManager: {

        init: async function(aPath) {
          // get the final path
          that.pathToJSM = aPath.startsWith("chrome://") 
            ? aPath
            : context.extension.rootURI.resolve(aPath);
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(that.pathToJSM);
            that.OM = new JSM.OverlayManager();
            that.OM.extension = context.extension;
          } catch (e) {
            console.log("Failed to load <" + that.pathToJSM + ">");
            Components.utils.reportError(e);
          }
        },
              
        setVerbosity: function(level) {
          if (!that.OM) throw new Error("Please call browser.OverlayManager.init(aPath) first!");
          that.OM.options.verbose = level;          
        },

        getVerbosity: function() {
          if (!that.OM) throw new Error("Please call browser.OverlayManager.init(aPath) first!");
          return that.OM.options.verbose;
        },

        activate: async function() {
          if (!that.OM) throw new Error("Please call browser.OverlayManager.init(aPath) first!");
          that.OM.startObserving();
        },

        deactivate: async function() {
          if (!that.OM) throw new Error("Please call browser.OverlayManager.init(aPath) first!");
          that.OM.stopObserving();
        },

        register: async function(dst, overlay) {
          if (!that.OM) throw new Error("Please call browser.OverlayManager.init(aPath) first!");
          await that.OM.registerOverlay(dst, overlay);
        }

      },
    };
  }

  close() {
    // This function is called if the extension is disabled or removed, or Thunderbird closes.
    // We registered it with callOnClose, above.
    if (this.OM) this.OM.stopObserving();
    this.OM = null;

    // Unload the JSM we imported above. This will cause Thunderbird to forget about the JSM, and
    // load it afresh next time `import` is called. (If you don't call `unload`, Thunderbird will
    // remember this version of the module and continue to use it, even if your extension receives
    // an update.) You should *always* unload JSMs provided by your extension.
    Cu.unload(this.pathToJSM);
    console.log("OverlayManager unloaded!");    
  }
};