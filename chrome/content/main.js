var gQuicktext = Components.classes["@hesslow.se/quicktext/main;1"].getService(Components.interfaces.wzIQuicktext);

var quicktext = {
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
,
  firstTimeLoad: function()
  {
    removeEventListener("load", quicktext.firstTimeLoad, false);
    gQuicktext.firstTime = false;
    setTimeout("quicktext.displayMessage();", 1);
  }
,
  displayMessage: function()
  {
    var handle = window.open("chrome://quicktext/content/about.xul", "quicktextAbout", "chrome,centerscreen,modal");
    handle.focus();
  }
}

gQuicktext.loadSettings(false);
if (gQuicktext.firstTime)
  addEventListener("load", quicktext.firstTimeLoad, false);