// Import any needed modules.
var Services = globalThis.Services || ChromeUtils.import(
  "resource://gre/modules/Services.jsm"
).Services;
var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");

// Load an additional JavaScript file.
Services.scriptloader.loadSubScript("chrome://quicktext/content/main.js", window, "UTF-8");

function onLoad(activatedWhileWindowOpen) {
  
  WL.injectCSS("resource://quicktext/skin/quicktext.css");
  WL.injectElements(`
    <menupopup id="taskPopup">
      <menuitem id="quicktext-settings" label="&quicktext.label;" oncommand="quicktext.openSettings();" insertbefore="prefSep" class="menu-iconic quicktext-icon menuitem-iconic" />
    </menupopup>`,
  ["chrome://quicktext/locale/quicktext.dtd"]);
  
  gQuicktext.loadSettings(false);
}

function onUnload(deactivatedWhileWindowOpen) {
}
