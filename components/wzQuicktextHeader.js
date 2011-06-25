Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextHeader() {
}

wzQuicktextHeader.prototype = {
  classID:          Components.ID("{881334e8-1913-4769-9bca-89ebe05ab7f4}"),
  classDescription: "Quicktext Header",
  contractID:       "@hesslow.se/quicktext/header;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextHeader, Components.interfaces.nsISupports])
,
  get type() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set type(aType) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  get value() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set value(aValue) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  clone: function() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
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