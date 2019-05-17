var { gQuicktext } = Components.utils.import("chrome://quicktext/content/components/wzQuicktext.js", null);

var quicktext = {
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}

gQuicktext.loadSettings(false);
