Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("chrome://quicktext/content/components/wzQuicktextGroup.js");
Components.utils.import("chrome://quicktext/content/components/wzQuicktextTemplate.js");
Components.utils.import("chrome://quicktext/content/components/wzQuicktextScript.js");
Components.utils.import("resource://gre/modules/Task.jsm");
Components.utils.import("resource://gre/modules/osfile.jsm");
Components.utils.importGlobalProperties(["XMLHttpRequest"]);

var EXPORTED_SYMBOLS = ["gQuicktext"];

const kDebug        = true;
const kSepChar1a    = String.fromCharCode(65533, 65533);
const kSepChar1b    = String.fromCharCode(164, 164);
const kSepChar2     = "||";
const kIllegalChars = String.fromCharCode(1) +"-"+ String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) +"-"+ String.fromCharCode(31) + String.fromCharCode(127) +"-"+ String.fromCharCode(132) + String.fromCharCode(134) +"-"+ String.fromCharCode(159);
const kFileShortcuts = ['ProfD', 'UsrDocs', 'Home', 'Desk', 'Pers'];
const kHomepage     = "https://github.com/thundernest/quicktext/wiki/";

function wzQuicktext() {}
wzQuicktext.prototype = {
  mSettingsLoaded:      false,
  mGroup:               [],
  mTexts:               [],
  mScripts:             [],
  mEditingGroup:        [],
  mEditingTexts:        [],
  mEditingScripts:      [],
  mPrefService:         null,
  mPrefBranch:          null,
  mViewPopup:           false,
  mCollapseGroup:       true,
  mDefaultImport:       "",
  mKeywordKey:          9,
  mShortcutModifier:    "alt",
  mShortcutTypeAdv:     false,
  mQuicktextDir:        null,
  mObserverList:        [],
  mOS:                  "WINNT",
  mCollapseState:       ""
,
  get viewToolbar() { return this.mViewToolbar; },
  set viewToolbar(aViewToolbar)
  {
    this.mViewToolbar = aViewToolbar;
    this.mPrefBranch.setBoolPref("toolbar", aViewToolbar);

    this.notifyObservers("updatetoolbar", "");

    return this.mViewToolbar;
  }
,
  get viewPopup() { return this.mViewPopup; },
  set viewPopup(aViewPopup)
  {
    this.mViewPopup = aViewPopup;
    this.mPrefBranch.setBoolPref("popup", aViewPopup);

    return this.mViewPopup;
  }
,
  get collapseGroup() { return this.mCollapseGroup; },
  set collapseGroup(aCollapseGroup)
  {
    this.mCollapseGroup = aCollapseGroup;
    this.mPrefBranch.setBoolPref("menuCollapse", aCollapseGroup);

    this.notifyObservers("updatesettings", "");

    return this.mCollapseGroup;
  }
,
  get defaultImport() { return this.mDefaultImport; },
  set defaultImport(aDefaultImport)
  {
    this.mDefaultImport = aDefaultImport;
    this.mPrefBranch.setCharPref("defaultImport", aDefaultImport);

    return this.mDefaultImport;
  }
,
  get keywordKey() { return this.mKeywordKey; },
  set keywordKey(aKeywordKey)
  {
    this.mKeywordKey = aKeywordKey;
    this.mPrefBranch.setIntPref("keywordKey", aKeywordKey);

    return this.mKeywordKey;
  }
,
  get shortcutModifier() { return this.mShortcutModifier; },
  set shortcutModifier(aShortcutModifier)
  {
    this.mShortcutModifier = aShortcutModifier;
    this.mPrefBranch.setCharPref("shortcutModifier", aShortcutModifier);

    return this.mShortcutModifier;
  }
,
  //obsolete but cannot remove due to IDL
  get firstTime() { return false },
  set firstTime(aFirstTime) {}
,
  get collapseState() { return this.mCollapseState; },
  set collapseState(aCollapseState)
  {
    this.mCollapseState = aCollapseState;
    this.mPrefBranch.setCharPref("collapseState", aCollapseState);

    return this.mCollapseState;
  }
,
  get shortcutTypeAdv()
  {
    if (this.mOS.substr(0, 3).toLowerCase() == "mac" || (this.mOS.substr(0, 3).toLowerCase() == "win" && this.mShortcutModifier == "alt"))
      return false;

    return this.mShortcutTypeAdv;
  }
,
  set shortcutTypeAdv(aShortcutTypeAdv)
  {
    this.mShortcutTypeAdv = aShortcutTypeAdv;
    this.mPrefBranch.setBoolPref("shortcutTypeAdv", aShortcutTypeAdv);

    return this.mShortcutTypeAdv;
  }
,
  openHomepage: function()
  {
    let ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
    let uriToOpen = ioservice.newURI(kHomepage, null, null);
    let extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].getService(Components.interfaces.nsIExternalProtocolService);
    extps.loadURI(uriToOpen, null);    
  }
,
  loadSettings: function(aReload)
  {
    if (!aReload && this.mSettingsLoaded)
      return false;

    this.mSettingsLoaded = true;

    var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).QueryInterface(Components.interfaces.nsIXULRuntime);
    this.mOS = appInfo.OS;

    this.mPrefService = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService);
    this.mPrefBranch = this.mPrefService.getBranch("extensions.quicktext.");
    this.mPrefBranchOld = this.mPrefService.getBranch("quicktext.");

    this.mGroup = [];
    this.mTexts = [];

    // get profile directory
    var profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
                               .getService(Components.interfaces.nsIProperties)
                               .get("ProfD", Components.interfaces.nsIFile);

    this.mQuicktextDir = profileDir;
    this.mQuicktextDir.append("quicktext");
    if (!this.mQuicktextDir.exists())
      this.mQuicktextDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);

    if (!this.mQuicktextDir.isDirectory())
    {
      // Must warn the user that the quicktext dir don't exists and couldn't be created
    }
    else
    {
      var quicktextFile = this.mQuicktextDir.clone();
      quicktextFile.append("templates.xml");

      // Checks if the template-file exists and import that it if it exists
      if (quicktextFile.exists())
      {
        this.importFromFile(quicktextFile, 0, true, false);
      }

      // If the script-file exists import it
      var scriptFile = this.mQuicktextDir.clone();
      scriptFile.append("scripts.xml");
      if (scriptFile.exists())
        this.importFromFile(scriptFile, 0, true, false);
    }

    // Get prefs
    if (this.mPrefBranch.getPrefType("toolbar") == this.mPrefBranch.PREF_BOOL)
      this.mViewToolbar = this.mPrefBranch.getBoolPref("toolbar");

    if (this.mPrefBranch.getPrefType("menuCollapse") == this.mPrefBranch.PREF_BOOL)
      this.mCollapseGroup = this.mPrefBranch.getBoolPref("menuCollapse");

    if (this.mPrefBranch.getPrefType("keywordKey") == this.mPrefBranch.PREF_INT) {
      this.mKeywordKey = this.mPrefBranch.getIntPref("keywordKey");
      //migrate old keywordKey (and reset to default), if differs from default(9)
      if (this.mPrefBranchOld.prefHasUserValue("keywordKey") && this.mPrefBranchOld.getPrefType("keywordKey") == this.mPrefBranchOld.PREF_INT && this.mPrefBranchOld.getIntPref("keywordKey") != 9) {
        this.mKeywordKey = this.mPrefBranchOld.getIntPref("keywordKey");
        this.mPrefBranchOld.setIntPref("keywordKey", 9);
        this.mPrefBranch.setIntPref("keywordKey", this.mKeywordKey);
      }
    }

    if (this.mPrefBranch.getPrefType("popup") == this.mPrefBranch.PREF_BOOL)
      this.mViewPopup = this.mPrefBranch.getBoolPref("popup");
    
    if (this.mPrefBranch.getPrefType("shortcutTypeAdv") == this.mPrefBranch.PREF_BOOL) {
      this.mShortcutTypeAdv = this.mPrefBranch.getBoolPref("shortcutTypeAdv");
      //migrate old shortcutTypeAdv (and reset to default), if differs from default(false)
      if (this.mPrefBranchOld.prefHasUserValue("shortcutTypeAdv") && this.mPrefBranchOld.getPrefType("shortcutTypeAdv") == this.mPrefBranchOld.PREF_BOOL && this.mPrefBranchOld.getBoolPref("shortcutTypeAdv") != false) {
        this.mShortcutTypeAdv = this.mPrefBranchOld.getBoolPref("shortcutTypeAdv");
        this.mPrefBranchOld.setBoolPref("shortcutTypeAdv", false);
        this.mPrefBranch.setBoolPref("shortcutTypeAdv", this.mShortcutTypeAdv);
      }
    }

    if (this.mPrefBranch.getPrefType("shortcutModifier") == this.mPrefBranch.PREF_STRING) {
      this.mShortcutModifier = this.mPrefBranch.getCharPref("shortcutModifier");
      //migrate: Use (and clear) old data if present
      if (this.mPrefBranchOld.prefHasUserValue("shortcutModifier") && this.mPrefBranchOld.getPrefType("shortcutModifier") == this.mPrefBranchOld.PREF_STRING && this.mPrefBranchOld.getCharPref("shortcutModifier") != "") {
        this.mShortcutModifier = this.mPrefBranchOld.getCharPref("shortcutModifier");
        this.mPrefBranchOld.setCharPref("shortcutModifier", "");
        this.mPrefBranch.setCharPref("shortcutModifier", this.mShortcutModifier);
      }
    }

    if (this.mPrefBranch.getPrefType("collapseState") == this.mPrefBranch.PREF_STRING)
      this.mCollapseState = this.mPrefBranch.getCharPref("collapseState");
    
    if (this.mPrefBranch.getPrefType("defaultImport") == this.mPrefBranch.PREF_STRING)
    {
      this.mDefaultImport = this.mPrefBranch.getCharPref("defaultImport");      
      //migrate: Use (and clear) old data if present
      if (this.mPrefBranchOld.prefHasUserValue("defaultImport") && this.mPrefBranchOld.getPrefType("defaultImport") == this.mPrefBranchOld.PREF_STRING && this.mPrefBranchOld.getCharPref("defaultImport") != "") {
        this.mDefaultImport = this.mPrefBranchOld.getCharPref("defaultImport");
        this.mPrefBranchOld.setCharPref("defaultImport", "");
        this.mPrefBranch.setCharPref("defaultImport", this.mDefaultImport);
      }
      
      if (this.mDefaultImport != null)
      {
        var defaultImport = this.mDefaultImport.split(";");
        defaultImport.reverse();
  
        for (var i = 0; i < defaultImport.length; i++)
        {
          try {
            if (defaultImport[i].match(/^(http|https):\/\//))
            {
              this.importFromHTTPFile(defaultImport[i], 1, true, false); 
            }
            else
            {
              var fp = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
              fp.initWithPath(this.parseFilePath(defaultImport[i]));
              this.importFromFile(fp, 1, true, false);
            }
          } catch (e) {}
        }
      }
    }

    this.startEditing();

    // Notify that settings has been changed
    this.notifyObservers("updatesettings", "");

    return true;
  }
,
  saveSettings: function()
  {
    this.endEditing();

    // Create the templates.xml file
    var quicktextFile = this.mQuicktextDir.clone();
    quicktextFile.append("templates.xml");
    this.exportTemplatesToFile(quicktextFile);

    // Create the scripts.xml file
    var quicktextFile = this.mQuicktextDir.clone();
    quicktextFile.append("scripts.xml");
    this.exportScriptsToFile(quicktextFile);

    this.startEditing();

    this.notifyObservers("updatesettings", "");
  }
,
  specialSplitString: function(aStr, aVar)
  {
    for (var i = 0; i < aVar.length; i++)
      if (aStr.indexOf(aVar[i]) > -1)
        return aStr.split(aVar[i]);

    return [aStr];
  }
,
  addGroup: function(aName, aEditingMode)
  {
    var tmp = new wzQuicktextGroup();
    tmp.name = aName;
    tmp.type = 0;

    if (aEditingMode)
    {
      this.mEditingGroup.push(tmp);
      this.mEditingTexts.push([]);
    }
    else
    {
      this.mGroup.push(tmp);
      this.mTexts.push([]);
    }
  }
,
  removeGroup: function(aRow, aEditingMode)
  {
    if (aEditingMode)
    {
      this.mEditingGroup.splice(aRow, 1);
      this.mEditingTexts.splice(aRow, 1);
    }
    else
    {
      this.mGroup.splice(aRow, 1);
      this.mTexts.splice(aRow, 1);
    }
  }
,
  getGroup: function(aGroupIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      if (typeof this.mEditingGroup[aGroupIndex] != 'undefined')
        return this.mEditingGroup[aGroupIndex];
    }
    else
    {
      if (typeof this.mGroup[aGroupIndex] != 'undefined')
        return this.mGroup[aGroupIndex];
    }
  }
,
  getGroupLength: function(aEditingMode)
  {
    if (aEditingMode)
      return this.mEditingGroup.length;
    else
      return this.mGroup.length;
  }
,
  moveGroup: function(aFromIndex, aToIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      var tmpGroup = this.mEditingGroup.splice(aFromIndex, 1)[0];
      var tmpTexts = this.mEditingTexts.splice(aFromIndex, 1)[0];
      if (aToIndex > aFromIndex)
      {
        this.mEditingGroup.splice(aToIndex-1, 0, tmpGroup);
        this.mEditingTexts.splice(aToIndex-1, 0, tmpTexts);
      }
      else
      {
        this.mEditingGroup.splice(aToIndex, 0, tmpGroup);
        this.mEditingTexts.splice(aToIndex, 0, tmpTexts);
      }
    }
    else
    {
      var tmpGroup = this.mGroup.splice(aFromIndex, 1)[0];
      var tmpTexts = this.mTexts.splice(aFromIndex, 1)[0];
      if (aToIndex > aFromIndex)
      {
        this.mGroup.splice(aToIndex-1, 0, tmpGroup);
        this.mTexts.splice(aToIndex-1, 0, tmpTexts);
      }
      else
      {
        this.mGroup.splice(aToIndex, 0, tmpGroup);
        this.mTexts.splice(aToIndex, 0, tmpTexts);
      }
    }
  }
,
  addText: function(aGroupIndex, aName, aEditingMode)
  {
    var tmp = new wzQuicktextTemplate();
    tmp.name = aName;
    tmp.shortcut = "";

    if (aEditingMode)
      this.mEditingTexts[aGroupIndex].push(tmp);
    else
      this.mTexts[aGroupIndex].push(tmp);
  }
,
  removeText: function(aGroupIndex, aRow, aEditingMode)
  {
    if (aEditingMode)
      this.mEditingTexts[aGroupIndex].splice(aRow, 1);
    else
      this.mTexts[aGroupIndex].splice(aRow, 1);
  }
,
  getText: function(aGroupIndex, aTextIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      if (typeof this.mEditingTexts[aGroupIndex][aTextIndex] != 'undefined')
        return this.mEditingTexts[aGroupIndex][aTextIndex];
    }
    else
    {
      if (typeof this.mTexts[aGroupIndex][aTextIndex] != 'undefined')
        return this.mTexts[aGroupIndex][aTextIndex];
    }
  }
,
  getTextLength: function(aGroupIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      if (this.mEditingTexts[aGroupIndex])
        return this.mEditingTexts[aGroupIndex].length;
    }
    else
    {
      if (this.mTexts[aGroupIndex])
        return this.mTexts[aGroupIndex].length;
    }

    return 0;
  }
,
  doTextExists: function(aGroupIndex, aTextIndex, aEditingMode)
  {
    if (aEditingMode)
      return (typeof this.mEditingTexts[aGroupIndex][aTextIndex] != 'undefined') ? true : false;
    else
      return (typeof this.mTexts[aGroupIndex][aTextIndex] != 'undefined') ? true : false;
  }
,
  moveText: function(aFromGroupIndex, aFromTextIndex, aToGroupIndex, aToTextIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      var tmpText = this.mEditingTexts[aFromGroupIndex].splice(aFromTextIndex, 1)[0];
      if (aFromGroupIndex == aToGroupIndex && aFromTextIndex < aToTextIndex)
        this.mEditingTexts[aToGroupIndex].splice(aToTextIndex-1, 0, tmpText);
      else
        this.mEditingTexts[aToGroupIndex].splice(aToTextIndex, 0, tmpText);
    }
    else
    {
      var tmpText = this.mTexts[aFromGroupIndex].splice(aFromTextIndex, 1)[0];
      if (aFromGroupIndex == aToGroupIndex && aFromTextIndex < aToTextIndex)
        this.mTexts[aFromGroupIndex].splice(aToTextIndex-1, 0, tmpText);
      else
        this.mTexts[aFromGroupIndex].splice(aToTextIndex, 0, tmpText);
    }
  }
,
  addScript: function(aName, aEditingMode)
  {
    var tmp = new wzQuicktextScript();
    tmp.name = aName;
    tmp.type = 0;

    if (aEditingMode)
      this.mEditingScripts.push(tmp);
    else
      this.mScripts.push(tmp);
  }
,
  removeScript: function(aIndex, aEditingMode)
  {
    if (aEditingMode)
      this.mEditingScripts.splice(aIndex, 1);
    else
      this.mScripts.splice(aIndex, 1);
  }
,
  getScript: function(aIndex, aEditingMode)
  {
    if (aEditingMode)
    {
      if (typeof this.mEditingScripts[aIndex] != 'undefined')
        return this.mEditingScripts[aIndex];
    }
    else
    {
      if (typeof this.mScripts[aIndex] != 'undefined')
        return this.mScripts[aIndex];
    }
  }
,
  getScriptLength: function(aEditingMode)
  {
    if (aEditingMode)
      return this.mEditingScripts.length;
    else
      return this.mScripts.length;
  }
,

  // I create the temporary vars that I then make the editing in
  startEditing: function()
  {
    this.mEditingGroup = [];
    this.mEditingTexts = [];
    for (var i = 0; i < this.mGroup.length; i++)
    {
      this.mEditingGroup[i] = this.mGroup[i].clone();
      this.mEditingTexts[i] = [];
      if (this.mTexts[i])
        for (var j = 0; j < this.mTexts[i].length; j++)
          this.mEditingTexts[i][j] = this.mTexts[i][j].clone();
    }

    this.mEditingScripts = [];
    for (var i = 0; i < this.mScripts.length; i++)
    {
      this.mEditingScripts[i] = this.mScripts[i].clone();
    }
  }
,

  // When the editing ended move the values back to the original vars
  endEditing: function()
  {
    this.mGroup = [];
    this.mTexts = [];
    for (var i = 0; i < this.mEditingGroup.length; i++)
    {
      this.mGroup[i] = this.mEditingGroup[i].clone();
      this.mTexts[i] = [];
      if (this.mEditingTexts[i])
        for (var j = 0; j < this.mEditingTexts[i].length; j++)
          this.mTexts[i][j] = this.mEditingTexts[i][j].clone();
    }

    this.mScripts = [];
    for (var i = 0; i < this.mEditingScripts.length; i++)
    {
      this.mScripts[i] = this.mEditingScripts[i].clone();
    }
  }
,
  /*
   * FILE FUNCTIONS
   */
  parseFilePath: function (aPath)
  {
    var results = [];
    var rexp = new RegExp ("\\[("+ kFileShortcuts.join("|") +")\\]", "g");

    let result = null;
    while (result = rexp.exec(aPath))
      results.push(result);

    if (results.length > 0)
    {
      var dirSer = Components.classes["@mozilla.org/file/directory_service;1"].getService(Components.interfaces.nsIProperties);
      for (var i = 0; i < results.length; i++)
      {
        try {
          var file = dirSer.get(results[i][1], Components.interfaces.nsIFile);
          rexp = new RegExp ("\\["+ results[i][1] +"\\]", "g");
          aPath = aPath.replace(rexp, file.path);
        } catch(e) {}
      }
    }

    return aPath;
  }
,
  readFile: function(aFile)
  {
    var text = "";

    var file = Components.classes["@mozilla.org/file/local;1"]
                .createInstance(Components.interfaces.nsIFile);
    file.initWithFile(aFile);
    if(file.exists())
    {
      var fiStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                      .createInstance(Components.interfaces.nsIFileInputStream);

      var siStream = Components.classes["@mozilla.org/scriptableinputstream;1"]
                      .createInstance(Components.interfaces.nsIScriptableInputStream);
      
      var biStream = Components.classes["@mozilla.org/binaryinputstream;1"]
                      .createInstance(Components.interfaces.nsIBinaryInputStream);

      var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
                      .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);

      
      fiStream.init(file, 1, 0, false);
      siStream.init(fiStream);
      //Get the first two bytes to decide, whether this file is an old UTF-16
      //quicktext XML config file or not. Also get the rest of the file, which
      //is later used as a fallback, if the file cannot be read as UTF.
      //Note: nsIScriptableInputStream::read assumes ISO-Latin-1 encoding. 
      //https://developer.mozilla.org/en-US/docs/Mozilla/Tech/XPCOM/Reference/
      //Interface/nsIScriptableInputStream#read()
      var fileHeader = siStream.read(2);
      var fileBody = siStream.read(-1);
      siStream.close();
      fiStream.close();

      //Original test by Emil to test for the old UTF-16 quicktext XML config
      //file format. The old PRO version of quicktext actually stored a byte
      //order mark (BOM), but not the standard version. There the length == 1
      //test is used, which however is not a general test for UTF-16. It works,
      //if the file starts with <? xml .. ?>: In UTF-16 the first 2 bytes
      //store just the "<" char, in UTF-8 the first 2 bytes store "<?", because
      //both these chars are "simple" and only need 8bit.
      //If this is not an old UTF-16 XML config file, the file is assumed to be
      //UTF-8 encoded.
      if (fileHeader == "\xFF\xFE" || fileHeader == "\xFE\xFF" || fileHeader.length == 1) {
        converter.charset = "UTF-16";
      } else {
        converter.charset = "UTF-8";
      }

      //Try to interpret the file as UTF and convert it to a Javascript string.
      //If that failes, the file is probably not UTF and the ISO-Latin-1
      //fallback is used instead.
      try {
        //Get file as raw byte array
        fiStream.init(file, 1, 0, false);
        biStream.setInputStream(fiStream);
        let raw = biStream.readByteArray(biStream.available());
        biStream.close();
        fiStream.close();

        text = converter.convertFromByteArray(raw, raw.length);
      } catch (e) {
        //ISO-Latin-1 fallback obtained via nsIScriptableInputStream::read
        text = fileHeader + fileBody;
      }

      // Removes \r because that makes crashes on atleast on Windows.
      text = text.replace(/\r\n/g, "\n");
    }
    return text;
  }
,
  writeFile: function(aFile, aData)
  {
    //this will execute async/parallel to the main thread, which is not waiting
    //for this task to finish 
    Task.spawn(function* () {
        //MDN states, instead of checking if dir exists, just create it and
        //catch error on exist (but it does not even throw)
        yield OS.File.makeDir(aFile.parent.path);
        yield OS.File.writeAtomic(aFile.path, aData, {tmpPath: aFile.path + ".tmp"});
    }).catch(Components.utils.reportError);
  }
,
  pickFile: function(aWindow, aType, aMode, aTitle)
  {
    var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);

    switch(aMode)
    {
      case 1:
        filePicker.init(aWindow, aTitle, filePicker.modeSave);
        break;
      default:
        filePicker.init(aWindow, aTitle, filePicker.modeOpen);
        break;
    }

    switch(aType)
    {
      case 0:
        filePicker.appendFilters(filePicker.filterText);
        filePicker.defaultExtension = "txt";
        break;
      case 1:
        filePicker.appendFilters(filePicker.filterHTML);
        filePicker.defaultExtension = "html";
        break;
      case 2:
        filePicker.appendFilters(filePicker.filterXML);
        filePicker.defaultExtension = "xml";
        break;
    }

    filePicker.appendFilters(filePicker.filterAll);

    //Lazy async-to-sync implementation with ACK from Philipp Kewisch
    //http://lists.thunderbird.net/pipermail/maildev_lists.thunderbird.net/2018-June/001205.html
    let inspector = Components.classes["@mozilla.org/jsinspector;1"].createInstance(Components.interfaces.nsIJSInspector);
    let rv, result;
    filePicker.open(result => {
      rv = result;
      inspector.exitNestedEventLoop();
    });
    inspector.enterNestedEventLoop(0); /* wait for async process to terminate */

    if(rv == filePicker.returnOK || rv == filePicker.returnReplace) return filePicker.file;
    return null;
  }
,
  /*
   * IMPORT/EXPORT FUNCTIONS
   */
  exportScriptsToFile: function(aFile)
  {
    var buffer = "<?xml version=\"1.0\"?>\n<quicktext version=\"2\">\n\t<filetype>scripts</filetype>\n";
    for (var i = 0; i < this.mScripts.length; i++)
    {
      buffer += "\t<script>\n\t\t<name><![CDATA["+ this.removeIllegalChars(this.mScripts[i].name) +"]]></name>\n\t\t<body><![CDATA["+ this.removeIllegalChars(this.mScripts[i].script) +"]]></body>\n\t</script>\n";
    }
    buffer += "</quicktext>";
    this.writeFile(aFile, buffer);
  }
,
  exportTemplatesToFile: function(aFile)
  {
    var buffer = "<?xml version=\"1.0\"?>\n<quicktext version=\"2\">\n\t<filetype>templates</filetype>\n";
    for (var i = 0; i < this.mGroup.length; i++)
    {
      if (this.mGroup[i].type == 0)
      {
        if (this.mTexts[i])
        {
          buffer += "\t<menu>\n\t\t<title><![CDATA["+ this.mGroup[i].name +"]]></title>\n\t\t<texts>\n";
          for (var j = 0; j < this.mTexts[i].length; j++)
          {
            var text = this.mTexts[i][j];
            buffer += "\t\t\t<text shortcut=\""+ this.removeIllegalChars(text.shortcut) +"\" type=\""+ this.removeIllegalChars(text.type) +"\">\n\t\t\t\t<name><![CDATA["+ this.removeIllegalChars(text.name) +"]]></name>\n";
            if (text.keyword != "")
              buffer += "\t\t\t\t<keyword><![CDATA["+ this.removeIllegalChars(text.keyword) +"]]></keyword>\n";
            if (text.subject != "")
              buffer += "\t\t\t\t<subject><![CDATA["+ this.removeIllegalChars(text.subject) +"]]></subject>\n";
            if (text.text != "")
              buffer += "\t\t\t\t<body><![CDATA["+ this.removeIllegalChars(text.text) +"]]></body>\n";
            if (text.attachments != "")
              buffer += "\t\t\t\t<attachments><![CDATA["+ this.removeIllegalChars(text.attachments) +"]]></attachments>\n";
            
            var headerLength = 0;
            if (headerLength = text.getHeaderLength() > 0)
            {
              buffer += "\t\t\t\t<headers>\n";
              for (var k = 0; k < headerLength; k++)
              {
                var header = text.getHeader(k);
                buffer += "\t\t\t\t\t<header>\n\t\t\t\t\t\t<type><![CDATA["+ header.type +"]]></type>\n\t\t\t\t\t\t<value><![CDATA["+ header.value +"]]></value>\n\t\t\t\t\t</header>\n";
              }
              buffer += "\t\t\t\t</headers>\n";
            }
            buffer += "\t\t\t</text>\n";
          }
          buffer += "\t\t</texts>\n\t</menu>\n";
        }
      }
    }
    buffer += "</quicktext>";
    this.writeFile(aFile, buffer);
  }
,
  importFromFile: function(aFile, aType, aBefore, aEditingMode)
  {
    var start = this.mGroup.length;

    var data = this.readFile(aFile);
    this.parseImport(data, aType, aBefore, aEditingMode);
  }
,
  importFromHTTPFile: function(aURI, aType, aBefore, aEditingMode)
  {
    var req = new XMLHttpRequest();
    req.open('GET', aURI, true);
    req.mQuicktext = this;
    req.mType = aType;
    req.mBefore = aBefore;
    req.mEditingMode = aEditingMode
    req.onload = function(event)
    {
      var self = event.target;
      if (self.status == 200)
      {
        if (typeof self.mQuicktext != 'undefined')
        {
          self.mQuicktext.parseImport(self.responseText, self.mType, self.mBefore, self.mEditingMode);
          self.mQuicktext.notifyObservers("updatesettings", "");
        }
        else
          debug('Something strange has happen!');
      }
    }
    req.send(null);
  }
,
  parseImport: function(aData, aType, aBefore, aEditingMode)
  {
    var parser = Components.classes["@mozilla.org/xmlextras/domparser;1"].createInstance(Components.interfaces.nsIDOMParser);
    var dom = parser.parseFromString(aData, "text/xml");

    var version = dom.documentElement.getAttribute("version");

    var group = [];
    var texts = [];
    var scripts = [];

    switch (version)
    {
      case "2":
        var filetype = this.getTagValue(dom.documentElement, "filetype");
        switch (filetype)
        {
          case "scripts":
            var elems = dom.documentElement.getElementsByTagName("script");
            for (var i = 0; i < elems.length; i++)
            {
              var tmp = new wzQuicktextScript();
              tmp.name = this.getTagValue(elems[i], "name");
              tmp.script = this.getTagValue(elems[i], "body");
              tmp.type = aType;

              scripts.push(tmp);
            }
            break;
          case "":
          case "templates":
            var elems = dom.documentElement.getElementsByTagName("menu");
            for (var i = 0; i < elems.length; i++)
            {
              var tmp = new wzQuicktextGroup();
              tmp.name = this.getTagValue(elems[i], "title");
              tmp.type = aType;
    
              group.push(tmp);
              var subTexts = [];
              var textsNodes = elems[i].getElementsByTagName("texts");
              if (textsNodes.length > 0)
              {
                var subElems = textsNodes[0].getElementsByTagName("text");
                for (var j = 0; j < subElems.length; j++)
                {
                  var tmp = new wzQuicktextTemplate();
                  tmp.name = this.getTagValue(subElems[j], "name");
                  tmp.text = this.getTagValue(subElems[j], "body");
                  tmp.shortcut = subElems[j].getAttribute("shortcut");
                  tmp.type = subElems[j].getAttribute("type");
                  tmp.keyword = this.getTagValue(subElems[j], "keyword");
                  tmp.subject = this.getTagValue(subElems[j], "subject");
                  tmp.attachments = this.getTagValue(subElems[j], "attachments");

                  var headersTag = subElems[j].getElementsByTagName("headers");
                  if (headersTag.length > 0)
                  {
                    var headers = headersTag[0].getElementsByTagName("header");
                    for (var k = 0; k < headers.length; k++)
                      tmp.addHeader(this.getTagValue(headers[k], "type"), this.getTagValue(headers[k], "value"));
                  }

                  subTexts.push(tmp);
                }
              }
              texts.push(subTexts);
            }            
            break;
          default:
            // Alert the user that the importer don't understand the filetype
            break;
        }
        
        break;
      case null:
        // When the version-number not is set it is version 1.

        var elems = dom.documentElement.getElementsByTagName("menu");
        for (var i = 0; i < elems.length; i++)
        {
          var tmp = new wzQuicktextGroup();
          tmp.name = elems[i].getAttribute("title");
          tmp.type = aType;

          group.push(tmp);

          var subTexts = [];
          var subElems = elems[i].getElementsByTagName("text");
          for (var j = 0; j < subElems.length; j++)
          {
            var tmp = new wzQuicktextTemplate();
            tmp.name = subElems[j].getAttribute("title");
            tmp.text = subElems[j].firstChild.nodeValue;
            tmp.shortcut = subElems[j].getAttribute("shortcut");
            tmp.type = subElems[j].getAttribute("type");
            tmp.keyword = subElems[j].getAttribute("keyword");
            tmp.subject = subElems[j].getAttribute("subject");

            subTexts.push(tmp);
          }
          texts.push(subTexts);
        }
        break;
      default:
        // Alert the user that there version of Quicktext can't import the file, need to upgrade
        return;
    }

    if (scripts.length > 0)
    {
      if (aBefore)
      {
        scripts.reverse();
        if (!aEditingMode)
          for (var i = 0; i < scripts.length; i++)
            this.mScripts.unshift(scripts[i]);

        for (var i = 0; i < scripts.length; i++)
          this.mEditingScripts.unshift(scripts[i]);
      }
      else
      {
        if (!aEditingMode)
          for (var i = 0; i < scripts.length; i++)
            this.mScripts.push(scripts[i]);

        for (var i = 0; i < scripts.length; i++)
          this.mEditingScripts.push(scripts[i]);
      }
    }

    if (group.length > 0 && texts.length > 0)
    {
      if (aBefore)
      {
        group.reverse();
        texts.reverse();
        if (!aEditingMode)
        {
          for (var i = 0; i < group.length; i++)
            this.mGroup.unshift(group[i]);
          for (var i = 0; i < texts.length; i++)
            this.mTexts.unshift(texts[i]);
        }
        for (var i = 0; i < group.length; i++)
          this.mEditingGroup.unshift(group[i]);
        for (var i = 0; i < texts.length; i++)
          this.mEditingTexts.unshift(texts[i]);
      }
      else
      {
        if (!aEditingMode)
        {
          for (var i = 0; i < group.length; i++)
            this.mGroup.push(group[i]);
          for (var i = 0; i < texts.length; i++)
            this.mTexts.push(texts[i]);
        }
        for (var i = 0; i < group.length; i++)
          this.mEditingGroup.push(group[i]);
        for (var i = 0; i < texts.length; i++)
          this.mEditingTexts.push(texts[i]);
      }
    }
  }
,
  getTagValue: function(aElem, aTag)
  {
    var tagElem = aElem.getElementsByTagName(aTag);
    if (tagElem.length > 0)
      return tagElem[0].firstChild.nodeValue;

    return "";
  }
,
  removeIllegalChars: function(aStr)
  {
    return aStr.replace(new RegExp("["+ kIllegalChars +"]", 'g'), '');
  }
,

  /*
   * PREF FUNCTIONS
   */
  //unused, only used to store filenames/webaddr, no need for fancy stuff - use getCharPref now
  getLocalizedUnicharPref: function (aPrefName)
  {
    try {
      return this.mPrefBranch.getComplexValue(aPrefName, Components.interfaces.nsIPrefLocalizedString).data;
    }
    catch(e) {}
    return null;        // quiet warnings
  }
,
  //unused, only used to store filenames/webaddr, no need for fancy stuff - use setCharPref now
  setUnicharPref: function (aPrefName, aPrefValue)
  {
    try {
      var str = Components.classes["@mozilla.org/supports-string;1"]
                          .createInstance(Components.interfaces.nsISupportsString);
      str.data = aPrefValue;
      this.mPrefBranch.setComplexValue(aPrefName, Components.interfaces.nsISupportsString, str);
    }
    catch(e) {}
  }
,
  /*
   * OBSERVERS
   */
  addObserver: function(aObserver)
  {
    this.mObserverList.push(aObserver);
  }
,
  removeObserver: function(aObserver)
  {
    for (var i = 0; i < this.mObserverList.length; i++)
    {
      if (this.mObserverList[i] == aObserver)
        this.mObserverList.splice(i, 1);
    }
  }
,
  notifyObservers: function(aTopic, aData)
  {
    for (var i = 0; i < this.mObserverList.length; i++)
      this.mObserverList[i].observe(this, aTopic, aData);
  }
}


var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};




function TrimString(aStr)
{
  if (!aStr) return "";
  return aStr.replace(/(^\s+)|(\s+$)/g, '')
}

var gQuicktext = new wzQuicktext();
