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
    var settingsHandle = window.open("chrome://quicktext/content/settings.xhtml", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}
