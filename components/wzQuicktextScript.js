Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextScript() {
  this.mName        = "";
  this.mScript      = "";
  this.mType        = 0;
}

wzQuicktextScript.prototype = {
  classID:          Components.ID("{1d3a4cc6-c543-4800-b9ec-48ec5fa810fb}"),
  classDescription: "Quicktext Script",
  contractID:       "@hesslow.se/quicktext/script;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextScript, Components.interfaces.nsISupports])
,
  get name() { return this.mName; },
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }
,
  get script() { return this.mScript; },
  set script(aScript) { if (typeof aScript != 'undefined') return this.mScript = aScript; }
,
  get type() { return this.mType; },
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }
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

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextScript: " + m + "\n");};