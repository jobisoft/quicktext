var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");

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

// For some reason I cannot add an onload to the overlay "main.xul", so I have
// to call this manually, but only if it is called from messenger.xul
if (window.location.href == "chrome://messenger/content/messenger.xul") {
  gQuicktext.setLocales(document, ["label"]);
  gQuicktext.loadSettings(false);
}