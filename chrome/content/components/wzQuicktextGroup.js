var EXPORTED_SYMBOLS = ["wzQuicktextGroup"];

const kDebug        = true;

function wzQuicktextGroup() {
  this.mName = "";
  this.mType = "";
}

wzQuicktextGroup.prototype = {
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


var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};
