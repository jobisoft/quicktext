"use strict";

(function (exports) {

  function install(window) {
    console.log("install");
  }

  function uninstall(window) {
    console.log("uninstall");
  }

  class Quicktext extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      function getComposeWindow(windowId) {
        let { window } = context.extension.windowManager.get(windowId);
        return window;
      }
      
      return {
        Quicktext: {
          openSettings(windowId) {
            let window = context.extension.windowManager.get(windowId, context)
              .window;
            window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "QuicktextOptions",
              "chrome,resizable,centerscreen"
            );
          },
          load(windowId) {
            let window = getComposeWindow(windowId);
            if (!window || window.document.documentElement.getAttribute("windowtype") != "msgcompose") {
              return;
            }
            install(window);
          },
          toggleToolbar(visible) {
            console.log("toggleToolbar", visible);
          }
        }
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) return;
      for (let window of Services.wm.getEnumerator("msgcompose")) {
        uninstall(window);
      }
    }
  };

  exports.Quicktext = Quicktext;

})(this)
