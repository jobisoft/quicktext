var Services = globalThis.Services || ChromeUtils.import(
  "resource://gre/modules/Services.jsm"
).Services;

var EXPORTED_SYMBOLS = ["gQuicktext"];

const kDebug        = true;
const kSepChar1a    = String.fromCharCode(65533, 65533);
const kSepChar1b    = String.fromCharCode(164, 164);
const kSepChar2     = "||";
const kIllegalChars = String.fromCharCode(1) +"-"+ String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) + String.fromCharCode(14) +"-"+ String.fromCharCode(31) + String.fromCharCode(127) +"-"+ String.fromCharCode(132) + String.fromCharCode(134) +"-"+ String.fromCharCode(159);
const kFileShortcuts = ['ProfD', 'UsrDocs', 'Home', 'Desk', 'Pers'];
const kHomepage     = "https://github.com/jobisoft/quicktext/wiki/";

var gQuicktext = {
  mSettingsLoaded:       false,
  mGroup:                [],
  mTexts:                [],
  mScripts:              [],
  mEditingGroup:         [],
  mEditingTexts:         [],
  mEditingScripts:       [],
  mViewPopup:            false,
  mCollapseGroup:        true,
  mDefaultImport:        "",
  mKeywordKey:           "Tab",
  mShortcutModifier:     "alt",
  mShortcutTypeAdv:      false,
  mQuicktextDir:         null,
  mObserverList:         [],
  mOS:                   "WINNT",
  mCollapseState:        "",
  mSelectionContent:     "",
  mSelectionContentHtml: "",
  mCurrentTemplate:      "",
  mStringBundle: Services.strings.createBundle("chrome://quicktext/locale/quicktext.properties")	
,
  get viewPopup() { return this.mViewPopup; },
  set viewPopup(aViewPopup)
  {
    this.mViewPopup = aViewPopup;
    this.notifyTools.notifyBackground({command:"setPref", pref: "popup", value: aViewPopup});

    return this.mViewPopup;
  }
,
  get collapseGroup() { return this.mCollapseGroup; },
  set collapseGroup(aCollapseGroup)
  {
    this.mCollapseGroup = aCollapseGroup;
    this.notifyTools.notifyBackground({command:"setPref", pref: "menuCollapse", value: aCollapseGroup});

    this.notifyObservers("updatesettings", "");

    return this.mCollapseGroup;
  }
,
  get defaultImport() { return this.mDefaultImport; },
  set defaultImport(aDefaultImport)
  {
    this.mDefaultImport = aDefaultImport;
    this.notifyTools.notifyBackground({command:"setPref", pref: "defaultImport", value: aDefaultImport});

    return this.mDefaultImport;
  }
,
  get keywordKey() { return this.mKeywordKey; },
  set keywordKey(aKeywordKey)
  {
    this.mKeywordKey = aKeywordKey;
    this.notifyTools.notifyBackground({command:"setPref", pref: "keywordKey", value: aKeywordKey});

    return this.mKeywordKey;
  }
,
  get shortcutModifier() { return this.mShortcutModifier; },
  set shortcutModifier(aShortcutModifier)
  {
    this.mShortcutModifier = aShortcutModifier;
    this.notifyTools.notifyBackground({command:"setPref", pref: "shortcutModifier", value: aShortcutModifier});

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
    this.notifyTools.notifyBackground({command:"setPref", pref: "collapseState", value: aCollapseState});

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
    this.notifyTools.notifyBackground({command:"setPref", pref: "shortcutTypeAdv", value: aShortcutTypeAdv});

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
  loadSettings: async function(aReload)
  {
    if (!aReload && this.mSettingsLoaded) {
      return false;
    }

    this.mSettingsLoaded = true;

    this.mOS = Services.appinfo.OS;

    this.mGroup = [];
    this.mTexts = [];

    // get profile directory
    var profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
                               .getService(Components.interfaces.nsIProperties)
                               .get("ProfD", Components.interfaces.nsIFile);

    // check if an alternative path has been given for the config folder
    let templateFolder = await this.notifyTools.notifyBackground({command:"getPref", pref: "templateFolder"});
    if (templateFolder)
    {
      profileDir = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      profileDir.initWithPath(templateFolder);
    }
  
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
    this.mCollapseGroup = await this.notifyTools.notifyBackground({command:"getPref", pref: "menuCollapse"});
    this.mKeywordKey = await this.notifyTools.notifyBackground({command:"getPref", pref: "keywordKey"});
    this.mViewPopup = await this.notifyTools.notifyBackground({command:"getPref", pref: "popup"});
    this.mShortcutTypeAdv = await this.notifyTools.notifyBackground({command:"getPref", pref: "shortcutTypeAdv"});
    this.mShortcutModifier = await this.notifyTools.notifyBackground({command:"getPref", pref: "shortcutModifier"});
    this.mCollapseState = await this.notifyTools.notifyBackground({command:"getPref", pref: "collapseState"});
    this.mDefaultImport = await this.notifyTools.notifyBackground({command:"getPref", pref: "defaultImport"});      

    // reset the value of mShortcutModifier to "alt", if it has not a valid value - see issue #177
    if (this.mShortcutModifier != "alt" && this.mShortcutModifier != "control" && this.mShortcutModifier != "meta") 
    {
      this.mShortcutModifier = "alt";
    }

    if (this.mDefaultImport)
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
        } catch (e) { console.error(e); }
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
        } catch(e) { console.error(e); }
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
      let charset = 'utf-8';
      if (fileHeader == "\xFF\xFE" || fileHeader == "\xFE\xFF" || fileHeader.length == 1) {
        charset = "utf-16";
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
        let decoder = new TextDecoder(charset); // charset can be omitted, default is utf-8
        text = decoder.decode(new Uint8Array(raw));
      } catch (e) {
        //ISO-Latin-1 fallback obtained via nsIScriptableInputStream::read
        text = fileHeader + fileBody;
        console.error(e);		  
      }

      // Removes \r because that makes crashes on atleast on Windows.
      text = text.replace(/\r\n/g, "\n");
    }
    return text;
  }
,
  readBinaryFile: function(aFile)
  {


    var data = "";

    var file = Components.classes["@mozilla.org/file/local;1"]
                .createInstance(Components.interfaces.nsIFile);
    file.initWithFile(aFile);
    if(file.exists())
    {
      var fiStream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                      .createInstance(Components.interfaces.nsIFileInputStream);

      var biStream = Components.classes["@mozilla.org/binaryinputstream;1"]
                      .createInstance(Components.interfaces.nsIBinaryInputStream);
      
      //Get file as raw byte array
      fiStream.init(file, 1, 0, false);
      biStream.setInputStream(fiStream);
      var len = biStream.available();
      data = biStream.readBytes(len);
      biStream.close();
      fiStream.close();

    }

    return data;

  }
,
  writeFile: async function(aFile, aData)
  {
    //MDN states, instead of checking if dir exists, just create it and
    //catch error on exist (but it does not even throw)
    await IOUtils.writeUTF8(aFile.path, aData);
  }
,
  pickFile: async function(aWindow, aType, aMode, aTitle)
  {
    var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    let checkFileEncoding = true;
    
    switch(aMode)
    {
      case 1:
        filePicker.init(aWindow, aTitle, filePicker.modeSave);
        checkFileEncoding = false;
        break;
      default:
        filePicker.init(aWindow, aTitle, filePicker.modeOpen);
        break;
    }

    switch(aType)
    {
      case 0: // insert TXT file
        filePicker.appendFilters(filePicker.filterText);
        filePicker.defaultExtension = "txt";
        break;
      case 1: // insert HTML file
        filePicker.appendFilters(filePicker.filterHTML);
        filePicker.defaultExtension = "html";
        break;
      case 2: // insert file
        break;

      case 3: // Quicktext XML file
        filePicker.appendFilters(filePicker.filterXML);
        filePicker.defaultExtension = "xml";
        break;

      case 4: // images
        filePicker.appendFilters(filePicker.filterImages);
      default: // attachments
        checkFileEncoding = false;
        break;
    }

    filePicker.appendFilters(filePicker.filterAll);

    let rv = await new Promise(function(resolve, reject) {
      filePicker.open(result => {
        resolve(result);
      });
    });
    
    if(rv == filePicker.returnOK || rv == filePicker.returnReplace) {
      if (checkFileEncoding) {
        let content = this.readFile(filePicker.file);
        if (content.includes(String.fromCharCode(0xFFFD))) {
          aWindow.alert(gQuicktext.mStringBundle.GetStringFromName("fileNotUTF8"));
          return null;
        }
      }
      return filePicker.file;
    } else {
      return null;
    }
  }
,
  getTypeFromExtension(aFile)
  {

    var ext = aFile.leafName.substring(aFile.leafName.lastIndexOf('.'));

    // Extracted from https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#Image_types
    switch(ext)
    {
      case ".apng":
        return "image/apng";
      case ".bmp":
        return "image/bmp";
      case ".gif":
        return "image/gif";
      case ".ico", ".cur":
        return "image/x-icon";
      case ".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp":
        return "image/jpeg";
      case ".png":
        return "image/png";
      case ".svg":
        return "image/svg+xml";
      case ".tif", ".tiff":
        return "image/tiff";
      case ".webp":
        return "image/webp";
      default:
        return "application/octet-stream";
    }

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
      // Only export scripts which have not been auto imported.
      if (this.mScripts[i].type == 0) {
        buffer += "\t<script>\n\t\t<name><![CDATA["+ this.removeIllegalCharsCDATA(this.mScripts[i].name) +"]]></name>\n\t\t<body><![CDATA["+ this.removeIllegalCharsCDATA(this.mScripts[i].script) +"]]></body>\n\t</script>\n";
      }
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
      // Only export templates which have not been auto imported.
      if (this.mGroup[i].type == 0)
      {
        if (this.mTexts[i])
        {
          buffer += "\t<menu>\n\t\t<title><![CDATA["+ this.mGroup[i].name +"]]></title>\n\t\t<texts>\n";
          for (var j = 0; j < this.mTexts[i].length; j++)
          {
            var text = this.mTexts[i][j];
            buffer += "\t\t\t<text shortcut=\""+ this.removeIllegalChars(text.shortcut) +"\" type=\""+ this.removeIllegalChars(text.type) +"\">\n\t\t\t\t<name><![CDATA["+ this.removeIllegalCharsCDATA(text.name) +"]]></name>\n";
            if (text.keyword != "")
              buffer += "\t\t\t\t<keyword><![CDATA["+ this.removeIllegalCharsCDATA(text.keyword) +"]]></keyword>\n";
            if (text.subject != "")
              buffer += "\t\t\t\t<subject><![CDATA["+ this.removeIllegalCharsCDATA(text.subject) +"]]></subject>\n";
            if (text.text != "")
              buffer += "\t\t\t\t<body><![CDATA["+ this.removeIllegalCharsCDATA(text.text) +"]]></body>\n";
            if (text.attachments != "")
              buffer += "\t\t\t\t<attachments><![CDATA["+ this.removeIllegalCharsCDATA(text.attachments) +"]]></attachments>\n";
            
            // There seems to be no use to write dynamically gathered header informations from the last use of a template to the file
            
            // var headerLength = 0;
            // if (headerLength = text.getHeaderLength() > 0)
            // {
            //   buffer += "\t\t\t\t<headers>\n";
            //   for (var k = 0; k < headerLength; k++)
            //   {
            //     var header = text.getHeader(k);
            //     buffer += "\t\t\t\t\t<header>\n\t\t\t\t\t\t<type><![CDATA["+ header.type +"]]></type>\n\t\t\t\t\t\t<value><![CDATA["+ header.value +"]]></value>\n\t\t\t\t\t</header>\n";
            //   }
            //   buffer += "\t\t\t\t</headers>\n";
            // }
            
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
  removeIllegalChars: function(aStr)
  {
    return aStr.replace(new RegExp("["+ kIllegalChars +"]", 'g'), '');
  }
,
  removeIllegalCharsCDATA: function(aStr)
  {
    // https://stackoverflow.com/questions/223652/is-there-a-way-to-escape-a-cdata-end-token-in-xml
    // replace ']]>' by ']]]]><![CDATA[>', need a regex replace to replace every occurence
    return aStr.replace(new RegExp("["+ kIllegalChars +"]", 'g'), '').replace(/\]\]>/g, ']]]]><![CDATA[>');
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
