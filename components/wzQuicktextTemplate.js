Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;

function wzQuicktextTemplate() {
  this.mName        = "";
  this.mText        = "";
  this.mShortcut    = "";
  this.mType        = "";
  this.mKeyword     = "";
  this.mSubject     = "";
  this.mAttachments = "";
}

wzQuicktextTemplate.prototype = {
  classID:          Components.ID("{6ff3be3e-7b38-4475-87ea-b49e7c431515}"),
  classDescription: "Quicktext Template",
  contractID:       "@hesslow.se/quicktext/template;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextTemplate, Components.interfaces.nsISupports])
,
  get name() { return this.mName; },
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }
,
  get text() { return this.mText; },
  set text(aText) { if (typeof aText != 'undefined') return this.mText = aText; }
,
  get shortcut() { return this.mShortcut; },
  set shortcut(aShortcut) { if (typeof aShortcut != 'undefined') return this.mShortcut = aShortcut; }
,
  get type() { return this.mType; },
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }
,
  get keyword() { return this.mKeyword; },
  set keyword(aKeyword) { if (typeof aKeyword != 'undefined') return this.mKeyword = aKeyword; }
,
  get subject() { return this.mSubject; },
  set subject(aSubject) { if (typeof aSubject != 'undefined') return this.mSubject = aSubject; }
,
  get attachments() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set attachments(aAttachments) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  getHeader: function (aIndex) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  addHeader: function (aType, aValue) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  removeHeader: function (aIndex) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  getHeaderLength: function() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  clone: function()
  {
    var newTemplate = new wzQuicktextTemplate();
    newTemplate.name = this.mName;
    newTemplate.text = this.mText;
    newTemplate.shortcut = this.mShortcut;
    newTemplate.type = this.mType;
    newTemplate.keyword = this.mKeyword;
    newTemplate.subject = this.mSubject;

    return newTemplate;
  }
}

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktextTemplate]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktextTemplate]);

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextTemplate: " + m + "\n");};