Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextHeader() {
  this.mType        = "";
  this.mValue     = "";
}

wzQuicktextHeader.prototype = {
  classID:          Components.ID("{67805190-0eaf-11db-9cd8-0800200c9a66}"),
  classDescription: "Quicktext Header",
  contractID:       "@hesslow.se/quicktext/header;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextHeader, Components.interfaces.nsISupports])
,
  get type() { return this.mType; },
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }
,
  get value() { return this.mValue; },
  set value(aValue) { if (typeof aValue != 'undefined') return this.mValue = aValue; }
,
  clone: function()
  {
    var newHeader = new wzQuicktextHeader();
    newHeader.type = this.mType;
    newHeader.value = this.mValue;

    return newHeader;
  }
}

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktextHeader]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktextHeader]);

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextHeader: " + m + "\n");};