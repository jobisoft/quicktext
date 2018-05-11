var gQuicktext = Components.classes["@hesslow.se/quicktext/main;1"].getService(Components.interfaces.wzIQuicktext);

var quicktext = {
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}

gQuicktext.loadSettings(false);
