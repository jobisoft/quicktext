"use strict";

(function (exports) {

  class Quicktext extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
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
        }
      };
    }
  };

  exports.Quicktext = Quicktext;

})(this)
