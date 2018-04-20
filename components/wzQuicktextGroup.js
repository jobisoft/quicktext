Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextGroup() {
  this.mName = "";
  this.mType = "";
}

wzQuicktextGroup.prototype = {
  classID:          Components.ID("{e85ebe60-8df8-11da-a72b-0800200c9a66}"),
  classDescription: "Quicktext Group",
  contractID:       "@hesslow.se/quicktext/group;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextGroup, Components.interfaces.nsISupports])
,
  get name() { return this.mName; },
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }
,
  get type() { return this.mType; },
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }
,
  clone: function()
  {
    var newGroup = new wzQuicktextGroup();
    newGroup.name = this.mName;
    newGroup.type = this.mType;

    return newGroup;
  }
}

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktextGroup]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktextGroup]);

var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};
