const kDebug        = true;

function wzQuicktextHeader() {
  this.mType        = "";
  this.mValue     = "";
}

wzQuicktextHeader.prototype = {
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
,
  QueryInterface: function(aIID)
  {
    if (aIID.equals(Components.interfaces.wzIQuicktextHeader) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    Components.returnCode = Components.results.NS_ERROR_NO_INTERFACE;
    return null;
  }
}

var wzQuicktextHeaderModule = {
  mClassID:     Components.ID("{67805190-0eaf-11db-9cd8-0800200c9a66}"),
  mClassName:   "Quicktext Header",
  mContractID:  "@hesslow.se/quicktext/header;1"
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

      return new wzQuicktextHeader();
    },

    lockFactory: function(aLock)
    {
      // quiten warnings
    }
  }
};

function NSGetModule(aCompMgr, aFileSpec)
{
  return wzQuicktextHeaderModule;
}

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextHeader: " + m + "\n");};