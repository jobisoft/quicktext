var EXPORTED_SYMBOLS = ["wzQuicktextHeader"];

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
}


var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};
