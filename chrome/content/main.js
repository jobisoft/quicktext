var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");

var quicktext = {
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}

gQuicktext.loadSettings(false);
