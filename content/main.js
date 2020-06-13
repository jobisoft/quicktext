let { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");

let quicktext = {
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
    let settingsHandle = window.open("chrome://quicktext/content/settings.xhtml", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
}

// custom event, fired by the overlay loader after it has finished loading
document.addEventListener("DOMOverlayLoaded_{8845E3B3-E8FB-40E2-95E9-EC40294818C4}", () => { gQuicktext.loadSettings(false); }, { once: true });
