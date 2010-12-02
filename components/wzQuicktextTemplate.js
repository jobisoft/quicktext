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
,
  QueryInterface: function(aIID)
  {
    if (aIID.equals(Components.interfaces.wzIQuicktextTemplate) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    Components.returnCode = Components.results.NS_ERROR_NO_INTERFACE;
    return null;
  }
}

var wzQuicktextTemplateModule = {
  mClassID:     Components.ID("{6ff3be3e-7b38-4475-87ea-b49e7c431515}"),
  mClassName:   "Quicktext Template",
  mContractID:  "@hesslow.se/quicktext/template;1"
,
  firstTime:    true
,
  getClassObject: function(aCompMgr, aCID, aIID)
  {
    if (!aCID.equals(this.mClassID))
      throw Components.results.NS_ERROR_NO_INTERFACE;
    if (!aIID.equals(Components.interfaces.nsIFactory))
      throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    return this.mFactory;
  }
,
  registerSelf: function(aCompMgr, aFileSpec, aLocation, aType)
  {
    if (this.firstTime)
    {
      this.firstTime = false;
      throw Components.results.NS_ERROR_FACTORY_REGISTER_AGAIN;
    }

    aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    aCompMgr.registerFactoryLocation(this.mClassID, this.mClassName, this.mContractID, aFileSpec, aLocation, aType);
  }
,
  unregisterSelf: function(aCompMgr, aFileSpec, aLocation)
  {
    aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    aCompMgr.unregisterFactoryLocation(this.mClassID, aFileSpec);
  }
,
  canUnload: function(aCompMgr)
  {
    return true;
  }
,
  /* factory object */
  mFactory:
  {
    createInstance: function(aOuter, aIID)
    {
      if (aOuter != null)
        throw Components.results.NS_ERROR_NO_AGGREGATION;

      return new wzQuicktextTemplate();
    },

    lockFactory: function(aLock)
    {
      // quiten warnings
    }
  }
};

function NSGetModule(aCompMgr, aFileSpec)
{
  return wzQuicktextTemplateModule;
}

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextTemplate: " + m + "\n");};