Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextScript() {
  this.mName        = "";
  this.mScript      = "";
  this.mType        = 0;
}

wzQuicktextScript.prototype = {
  classID:          Components.ID("{5971120e-84ce-4f2b-9418-ed924c88fe10}"),
  classDescription: "Quicktext Script",
  contractID:       "@hesslow.se/quicktext/script;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextScript, Components.interfaces.nsISupports])
,
  get name() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set name(aName) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  get script() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set script(aScript) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  get type() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set type(aType) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  clone: function()
  {
    var newScript = new wzQuicktextScript();
    newScript.name = this.mName;
    newScript.script = this.mScript;
    newScript.type = this.mType;

    return newScript;
  }
}

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktextScript]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktextScript]);

var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};
