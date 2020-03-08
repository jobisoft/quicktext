var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
var { ConversionHelper } = ChromeUtils.import("chrome://quicktext/content/modules/ConversionHelper.jsm");

var quicktext = {
  onloadoptions: function ()
  {
    window.close();
  }
,  
  onunloadoptions: function ()
  {
    this.openSettings();
  }
,
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}

async function main() {
  await ConversionHelper.webExtensionStartupCompleted("MAIN");
  
  gQuicktext.setLocales(document, ["label"]);
  await gQuicktext.loadSettings(false);
}

// For some reason I cannot add an onload to the overlay "main.xul", so I have
// to call this manually, but only if it is called from messenger.xul
if (window.location.href == "chrome://messenger/content/messenger.xul") {
  main();
}