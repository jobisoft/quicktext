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
  this.mHeaders     = [];
}

wzQuicktextTemplate.prototype = {
  classID:          Components.ID("{5f9705d0-8d1a-11da-a72b-0800200c9a66}"),
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
  get attachments() { return this.mAttachments; },
  set attachments(aAttachments) { if (typeof aAttachments != 'undefined') return this.mAttachments = aAttachments; }
,
  getHeader: function (aIndex)
  {
    return this.mHeaders[aIndex];
  }
,
  addHeader: function (aType, aValue)
  {
    var tmp = Components.classes["@hesslow.se/quicktext/header;1"].createInstance(Components.interfaces.wzIQuicktextHeader);
    tmp.type = aType;
    tmp.value = aValue;
    this.mHeaders.push(tmp);
  }
,
  removeHeader: function (aIndex)
  {
    this.mHeaders.splice(aIndex, 0);
  }
,
  getHeaderLength: function()
  {
    return this.mHeaders.length;
  }
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
    newTemplate.attachments = this.mAttachments;

    for (var i = 0; i < this.mHeaders.length; i++)
      newTemplate.addHeader(this.mHeaders[i].type, this.mHeaders[i].value);

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

var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};
