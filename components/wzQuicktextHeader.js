const kDebug        = true;

function wzQuicktextHeader() {
}

wzQuicktextHeader.prototype = {
  get type() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set type(aType) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  get value() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; },
  set value(aValue) { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
,
  clone: function() { throw Components.results.NS_ERROR_NOT_IMPLEMENTED; }
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
  mClassID:     Components.ID("{881334e8-1913-4769-9bca-89ebe05ab7f4}"),
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