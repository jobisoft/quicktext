const kDebug        = true;

function wzQuicktextScript() {
  this.mName        = "";
  this.mScript      = "";
  this.mType        = 0;
}

wzQuicktextScript.prototype = {
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
,
  QueryInterface: function(aIID)
  {
    if (aIID.equals(Components.interfaces.wzIQuicktextScript) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    Components.returnCode = Components.results.NS_ERROR_NO_INTERFACE;
    return null;
  }
}

var wzQuicktextScriptModule = {
  mClassID:     Components.ID("{1d3a4cc6-c543-4800-b9ec-48ec5fa810fb}"),
  mClassName:   "Quicktext Script",
  mContractID:  "@hesslow.se/quicktext/script;1"
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

      return new wzQuicktextScript();
    },

    lockFactory: function(aLock)
    {
      // quiten warnings
    }
  }
};

function NSGetModule(aCompMgr, aFileSpec)
{
  return wzQuicktextScriptModule;
}

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktextScript: " + m + "\n");};