Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug        = true;
const kSepChar1a    = String.fromCharCode(65533, 65533);
const kSepChar1b    = String.fromCharCode(164, 164);
const kSepChar2     = "||";
const kIllegalChars = String.fromCharCode(1) +"-"+ String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) +"-"+ String.fromCharCode(31) + String.fromCharCode(127) +"-"+ String.fromCharCode(132) + String.fromCharCode(134) +"-"+ String.fromCharCode(159);
const kFileShortcuts = ['ProfD', 'UsrDocs', 'Home', 'Desk', 'Pers'];
const kHomepage     = "http://extensions.hesslow.se/quicktext/";

function wzQuicktext() {}
wzQuicktext.prototype = {
  classID:              Components.ID("{cd2c2f5d-ffc5-46c7-a7d1-9db359718af2}"),
  classDescription:     "Quicktext",
  contractID:           "@hesslow.se/quicktext/main;1",
  QueryInterface:       XPCOMUtils.generateQI([Components.interfaces.wzIQuicktext, Components.interfaces.nsISupports])
,
  mSettingsLoaded:      false,
  mGroup:               [],
  mTexts:               [],
  mEditingGroup:        [],
  mEditingTexts:        [],
  mPrefService:         null,
  mPrefBranch:          null,
  mViewToolbar:         true,
  mViewPopup:           false,
  mCollapseGroup:       true,
  mDefaultImport:       "",
  mKeywordKey:          9,
  mShortcutModifier:    "alt",
  mShortcutTypeAdv:     false,
  mFirstTime:           true,
  mDefaultDir:          null,
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
    this.setUnicharPref("defaultImport", aDefaultImport);

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
  get firstTime() { return this.mFirstTime; },
  set firstTime(aFirstTime)
  {
    this.mFirstTime = aFirstTime;
    this.mPrefBranch.setBoolPref("firstTime", aFirstTime);

    return this.mFirstTime;
  }
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
    var uri = Components. classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService).newURI(kHomepage, null, null);
    var com = Components.classes["@mozilla.org/uriloader/external-helper-app-service;1"];
    var httpHandler = com.createInstance(Components.interfaces.nsIExternalProtocolService);
    httpHandler.loadUrl(uri);
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
    this.mPrefBranch = this.mPrefService.getBranch("quicktext.");

    this.mGroup = [];
    this.mTexts = [];

    // get profile directory
    var profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
                               .getService(Components.interfaces.nsIProperties)
                               .get("ProfD", Components.interfaces.nsIFile);

    this.mQuicktextDir = profileDir;
    this.mQuicktextDir.append("quicktext");
    if (!this.mQuicktextDir.exists())
      this.mQuicktextDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);

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
      else
      {
        // If we don't find the file that could mean that the user has used
        // an old version of the extension so we get that data and makes the file

        if (this.mPrefBranch.getPrefType("menu") == this.mPrefBranch.PREF_STRING)
        {
          var menuPref = this.getLocalizedUnicharPref("menu");
          if (menuPref != null)
          {
            var groupItems = this.specialSplitString(menuPref, [kSepChar1a, kSepChar1b]);

            for (var i = 0; i < groupItems.length; i++)
            {
              this.mGroup[i] = Components.classes["@hesslow.se/quicktext/group;1"].createInstance(Components.interfaces.wzIQuicktextGroup);
              this.mGroup[i].name = groupItems[i];
              this.mGroup[i].type = 0;

              this.mTexts[i] = [];
              if (this.mPrefBranch.getPrefType("texts" + (i+1)) == this.mPrefBranch.PREF_STRING)
              {
                var tmpText = this.getLocalizedUnicharPref("texts" + (i+1));
                if (tmpText != null)
                {
                  tmpText = this.specialSplitString(tmpText, [kSepChar1a, kSepChar1b]);
                  for (var j = 0; j < tmpText.length; j++)
                  {
                    tmpText[j] = this.specialSplitString(tmpText[j], [kSepChar2]);

                    this.mTexts[i][j] = Components.classes["@hesslow.se/quicktext/template;1"].createInstance(Components.interfaces.wzIQuicktextTemplate);
                    this.mTexts[i][j].name        = tmpText[j][0];
                    this.mTexts[i][j].text        = tmpText[j][1];
                    this.mTexts[i][j].shortcut    = tmpText[j][2];
                    this.mTexts[i][j].type        = tmpText[j][3];
                    this.mTexts[i][j].keyword     = tmpText[j][4];
                    this.mTexts[i][j].subject     = tmpText[j][5];

                    if (!(this.mTexts[i][j].shortcut > 0))
                      this.mTexts[i][j].shortcut = "";
                    if (this.mTexts[i][j].shortcut == 10)
                      this.mTexts[i][j].shortcut = 0;
                  }
                }
              }
            }
          }
        }

        // Create the template.xml file. So we use it in the future
        this.exportTemplatesToFile(quicktextFile);
      }
    }

    // Get prefs
    if (this.mPrefBranch.getPrefType("toolbar") == this.mPrefBranch.PREF_BOOL)
      this.mViewToolbar = this.mPrefBranch.getBoolPref("toolbar");

    if (this.mPrefBranch.getPrefType("menuCollapse") == this.mPrefBranch.PREF_BOOL)
      this.mCollapseGroup = this.mPrefBranch.getBoolPref("menuCollapse");

    if (this.mPrefBranch.getPrefType("keywordKey") == this.mPrefBranch.PREF_INT)
      this.mKeywordKey = this.mPrefBranch.getIntPref("keywordKey");

    if (this.mPrefBranch.getPrefType("firstTime") == this.mPrefBranch.PREF_BOOL)
      this.mFirstTime = this.mPrefBranch.getBoolPref("firstTime");

    if (this.mPrefBranch.getPrefType("popup") == this.mPrefBranch.PREF_BOOL)
      this.mViewPopup = this.mPrefBranch.getBoolPref("popup");

    if (this.mPrefBranch.getPrefType("shortcutTypeAdv") == this.mPrefBranch.PREF_BOOL)
      this.mShortcutTypeAdv = this.mPrefBranch.getBoolPref("shortcutTypeAdv");

    if (this.mPrefBranch.getPrefType("shortcutModifier") == this.mPrefBranch.PREF_STRING)
      this.mShortcutModifier = this.mPrefBranch.getCharPref("shortcutModifier");

    if (this.mPrefBranch.getPrefType("collapseState") == this.mPrefBranch.PREF_STRING)
      this.mCollapseState = this.mPrefBranch.getCharPref("collapseState");

    if (this.mPrefBranch.getPrefType("defaultDir") == this.mPrefBranch.PREF_STRING)
    {
      var defaultDir = this.mPrefBranch.getCharPref("defaultDir");
      this.mDefaultDir = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
      try {
        this.mDefaultDir.initWithPath(defaultDir);
      }
      catch (e)
      {
        this.mDefaultDir = null;
      }
    }
    
    if (this.mPrefBranch.getPrefType("defaultImport") == this.mPrefBranch.PREF_STRING)
    {
      this.mDefaultImport = this.getLocalizedUnicharPref("defaultImport");
      if (this.mDefaultImport != null)
      {
        try {
          var fp = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
          fp.initWithPath(this.parseFilePath(this.mDefaultImport));
          this.importFromFile(fp, 1, true, false);
        } catch (e) {}
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
    var tmp = Components.classes["@hesslow.se/quicktext/group;1"].createInstance(Components.interfaces.wzIQuicktextGroup);
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
    var tmp = Components.classes["@hesslow.se/quicktext/template;1"].createInstance(Components.interfaces.wzIQuicktextTemplate);
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
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }
,
  removeScript: function(aIndex, aEditingMode)
  {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }
,
  getScript: function(aIndex, aEditingMode)
  {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }
,
  getScriptLength: function(aEditingMode)
  {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
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
  }
,
  /*
   * FILE FUNCTIONS
   */
  parseFilePath: function (aPath)
  {
    var results = [];
    var rexp = new RegExp ("\\[("+ kFileShortcuts.join("|") +")\\]", "g");
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
    var file = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsILocalFile);
    file.initWithFile(aFile);
    if(file.exists())
    {
      var fiStream = Components.classes["@mozilla.org/network/file-input-stream;1"].createInstance(Components.interfaces.nsIFileInputStream);
      fiStream.init(file, 1, 0, false);

      var siStream = Components.classes["@mozilla.org/scriptableinputstream;1"].createInstance(Components.interfaces.nsIScriptableInputStream);
      siStream.init(fiStream);
      var bomheader = siStream.read(2);

      // unicode
      if (bomheader == "\xFF\xFE" || bomheader == "\xFE\xFF")
      {
        fiStream.close();
        fiStream.init(file, 1, 0, false);

        var biStream = Components.classes["@mozilla.org/binaryinputstream;1"].createInstance(Components.interfaces.nsIBinaryInputStream);
        biStream.setInputStream(fiStream);
        var tmp = biStream.readByteArray(biStream.available());

        var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
        converter.charset = "UTF-16";
        text = converter.convertFromByteArray(tmp, tmp.length);

        biStream.close();
      }
      else
      {
        text = bomheader + siStream.read(-1);
        siStream.close();
      }
      fiStream.close();

      // Removes \r because that makes crashes on atleast on Windows.
      text = text.replace(/\r\n/g, "\n");
    }
    return text;
  }
,
  writeFile: function(aFile, aData)
  {
    var foStream = Components.classes["@mozilla.org/network/file-output-stream;1"].createInstance(Components.interfaces.nsIFileOutputStream);

    foStream.init(aFile, 0x02 | 0x08 | 0x20, 0664, 0);

    // Unicode
    if (true)
    {
      var converter = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
      converter.charset = "UTF-16";

      var chunk = converter.ConvertFromUnicode(aData);
      foStream.write(chunk, chunk.length);

      var fin = converter.Finish();
      if (fin.length > 0)
        foStream.write(fin, fin.length);
    }
    else
    {
      foStream.write(aData, aData.length);
    }

    foStream.close();
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

    if(this.mDefaultDir)
      filePicker.displayDirectory = this.mDefaultDir;

    var result = filePicker.show();
    if(result == filePicker.returnOK || result == filePicker.returnReplace)
      return filePicker.file;

    return null;
  }
,
  /*
   * IMPORT/EXPORT FUNCTIONS
   */
  exportScriptsToFile: function(aFile)
  {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
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

    data = this.readFile(aFile);
    this.parseImport(data, aType, aBefore, aEditingMode);
  }
,
  importFromHTTPFile: function(aURI, aType, aBefore, aEditingMode)
  {
    var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
    req.open('GET', aURI, true);
    req.aQuicktext = this;
    req.aType = aType;
    req.aBefore = aBefore;
    req.onload = function(event)
    {
      var self = event.target;
      if (self.status == 200)
        self.aQuicktext.parseImport(self.responseText, self.aType, self.aBefore, self.aEditingMode);
        self.aQuicktext.notifyObservers("updatesettings", "");
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

    switch (version)
    {
      case "2":
        var filetype = this.getTagValue(dom.documentElement, "filetype");
        switch (filetype)
        {
          case "":
          case "templates":
            var elems = dom.documentElement.getElementsByTagName("menu");
            for (var i = 0; i < elems.length; i++)
            {
              var tmp = Components.classes["@hesslow.se/quicktext/group;1"].createInstance(Components.interfaces.wzIQuicktextGroup);
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
                  var tmp = Components.classes["@hesslow.se/quicktext/template;1"].createInstance(Components.interfaces.wzIQuicktextTemplate);
                  tmp.name = this.getTagValue(subElems[j], "name");
                  tmp.text = this.getTagValue(subElems[j], "body");
                  tmp.shortcut = subElems[j].getAttribute("shortcut");
                  tmp.type = subElems[j].getAttribute("type");
                  tmp.keyword = this.getTagValue(subElems[j], "keyword");
                  tmp.subject = this.getTagValue(subElems[j], "subject");

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
          var tmp = Components.classes["@hesslow.se/quicktext/group;1"].createInstance(Components.interfaces.wzIQuicktextGroup);
          tmp.name = elems[i].getAttribute("title");
          tmp.type = aType;

          group.push(tmp);

          var subTexts = [];
          var subElems = elems[i].getElementsByTagName("text");
          for (var j = 0; j < subElems.length; j++)
          {
            var tmp = Components.classes["@hesslow.se/quicktext/template;1"].createInstance(Components.interfaces.wzIQuicktextTemplate);
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
  getLocalizedUnicharPref: function (aPrefName)
  {
    try {
      return this.mPrefBranch.getComplexValue(aPrefName, Components.interfaces.nsIPrefLocalizedString).data;
    }
    catch(e) {}
    return null;        // quiet warnings
  }
,
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

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktext]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktext]);

if (!kDebug)
  debug = function(m) {};
else
  debug = function(m) {dump("\t *** wzQuicktext: " + m + "\n");};

function TrimString(aStr)
{
  if (!aStr) return "";
  return aStr.replace(/(^\s+)|(\s+$)/g, '')
}
