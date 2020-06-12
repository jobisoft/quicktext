/* eslint-disable object-shorthand */

// Get various parts of the WebExtension framework that we need.
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

// You probably already know what this does.
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

// BAD GLOBAL
var OM = null;
var chromeHandle = null;
var pathToOverlayJSM = null;

const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);

// This is the important part. It implements the functions and events defined in schema.json.
// The variable must have the same name you've been using so far, "overlay" in this case.
var overlay = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {   
    // To be notified of the extension going away, call callOnClose with any object that has a
    // close function, such as this one.
    context.callOnClose(this);

    return {
      overlay: {

        init: async function(aPath) {
          // get the final path
          pathToOverlayJSM = context.extension.rootURI.resolve(aPath);
          // try to load the JSM and set the extension context
          try {
            let JSM = ChromeUtils.import(pathToOverlayJSM);
            OM = new JSM.OverlayManager();
            OM.extension = context.extension;
          } catch (e) {
            console.log("Failed to load <" + pathToOverlayJSM + ">");
            Components.utils.reportError(e);
          }
        },
        
        registerChromeUrls: function(chromeData) {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          const manifestURI = Services.io.newURI(
            "manifest.json",
            null,
            context.extension.rootURI
          );
          chromeHandle = aomStartup.registerChrome(manifestURI, chromeData);          
        },
        
        setVerbosity: function(level) {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          OM.options.verbose = level;          
        },

        getVerbosity: function() {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          return OM.options.verbose;
        },

        activate: async function() {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          OM.startObserving();
        },

        deactivate: async function() {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          OM.stopObserving();
        },

        register: async function(dst, overlay) {
          if (!OM) throw new Error("Please call browser.overlay.init(aPath) first!");
          await OM.registerOverlay(dst, overlay);
        }

      },
    };
  }

  close() {
    // This function is called if the extension is disabled or removed, or Thunderbird closes.
    // We registered it with callOnClose, above.
    if (OM) OM.stopObserving();

    
    chromeHandle.destruct();
    chromeHandle = null;
    
    // Unload the JSM we imported above. This will cause Thunderbird to forget about the JSM, and
    // load it afresh next time `import` is called. (If you don't call `unload`, Thunderbird will
    // remember this version of the module and continue to use it, even if your extension receives
    // an update.) You should *always* unload JSMs provided by your extension.
    Cu.unload(pathToOverlayJSM);
    console.log("OverlayManager unloaded!");    
  }
};