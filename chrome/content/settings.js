var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
var { quicktextUtils } = ChromeUtils.import("chrome://quicktext/content/modules/utils.jsm");
var { OS } = ChromeUtils.import("resource://gre/modules/osfile.jsm");
var { ConversionHelper } = ChromeUtils.import("chrome://quicktext/content/modules/ConversionHelper.jsm");

var quicktext = {
  mChangesMade:         false,
  mTextChangesMade:     [],
  mScriptChangesMade:   [],
  mGeneralChangesMade:  [],
  mLoaded:              false,
  mTreeArray:           [],
  mCollapseState:       [],
  mScriptIndex:         null,
  mPickedIndex:         null,
  mOS:                  "WINNT"
,
  init: async function()
  {
    if (!this.mLoaded)
    {
      this.mLoaded = true;

      gQuicktext.loadLocales(document);
      // add OS as attribute to outer dialog
      document.getElementById('quicktextSettingsWindow').setAttribute("OS", OS.Constants.Sys.Name);
      console.log("Adding attribute 'OS' = '"+ OS.Constants.Sys.Name +"' to settings dialog element.");

      var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo).QueryInterface(Components.interfaces.nsIXULRuntime);
      this.mOS = appInfo.OS;

      gQuicktext.addObserver(this);
      var hasLoadedBefore = !(await gQuicktext.loadSettings(false));

      var states = gQuicktext.collapseState;
      if (states != "")
      {
        states = states.split(/;/);
        for (var i = 0; i < states.length; i++)
          this.mCollapseState[i] = (states[i] == "1");
      }

      var groupLength = gQuicktext.getGroupLength(true);
      if (states.length < groupLength)
      {
        for (var i = states.length; i < groupLength; i++)
          this.mCollapseState[i] = true;
      }

      if (hasLoadedBefore)
      {
        gQuicktext.startEditing();
        this.updateGUI();
      }

      // window.resizeTo(gQuicktext.getSettingsWindowSize(0), gQuicktext.getSettingsWindowSize(1));
      document.getElementById('tabbox-main').selectedIndex = 1;

      document.getElementById('text-keyword').addEventListener("keypress", function(e) { quicktext.noSpaceForKeyword(e); }, false);

      this.disableSave();
      document.documentElement.getButton("extra1").addEventListener("command", function(e) { quicktext.save(); }, false);
    }
  }
,
  unload: function()
  {
    gQuicktext.removeObserver(this);

    var states = [];
    for (var i = 0; i < this.mCollapseState.length; i++)
      states[i] = (this.mCollapseState[i]) ? "1" : "";
    gQuicktext.collapseState = states.join(";");

    document.getElementById('text-keyword').removeEventListener("keypress", function(e) { quicktext.noSpaceForKeyword(e); }, false);
  }
,
  close: function(aClose)
  {
    this.saveText();
    this.saveScript();

    if (this.mChangesMade)
    {
      promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
      if (promptService)
      {
        result = promptService.confirmEx(window,
                                         ConversionHelper.i18n.getMessage("saveMessageTitle"),
                                         ConversionHelper.i18n.getMessage("saveMessage"),
                                         (promptService.BUTTON_TITLE_SAVE * promptService.BUTTON_POS_0) +
                                         (promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1) +
                                         (promptService.BUTTON_TITLE_DONT_SAVE * promptService.BUTTON_POS_2),
                                         null, null, null,
                                         null, {value:0});
        switch (result)
        {
          // Cancel
          case 1:
            return false;
          // Save
          case 0:
            this.save();
            break;
          // Quit
          case 2:
            break;
        }
      }
    }

    if (aClose)
      window.close();

    return true;
  }
,
  save: function()
  {
    this.saveText();
    this.saveScript();

    if (document.getElementById("checkbox-viewPopup"))
      gQuicktext.viewPopup = document.getElementById("checkbox-viewPopup").checked;
    if (document.getElementById("text-defaultImport"))
      gQuicktext.defaultImport = document.getElementById("text-defaultImport").value;
    if (document.getElementById("select-shortcutModifier"))
      gQuicktext.shortcutModifier = document.getElementById("select-shortcutModifier").value;
    if (document.getElementById("checkbox-shortcutTypeAdv"))
      gQuicktext.shortcutTypeAdv = document.getElementById("checkbox-shortcutTypeAdv").checked;
    if (document.getElementById("select-keywordKey"))
      gQuicktext.keywordKey = document.getElementById("select-keywordKey").value;
    if (document.getElementById("checkbox-collapseGroup"))
      gQuicktext.collapseGroup = document.getElementById("checkbox-collapseGroup").checked;

    gQuicktext.saveSettings();

    this.mChangesMade = false;
    this.mTextChangesMade = [];
    this.mScriptChangesMade = [];
    this.mGeneralChangesMade = [];
    this.disableSave();
    this.updateGUI();    
  }
,
  shortcutTypeAdv: function()
  {
    if (this.mOS.substr(0, 3).toLowerCase() == "mac" || (this.mOS.substr(0, 3).toLowerCase() == "win" && document.getElementById('select-shortcutModifier').value == "alt"))
      return false;

    return document.getElementById('checkbox-shortcutTypeAdv').checked;
  }
,
  saveText: function()
  {
    if (this.mPickedIndex != null)
    {
      if (this.mPickedIndex[1] > -1)
      {
        var title = document.getElementById('text-title').value;
        if (title.replace(/[\s]/g, '') == "")
          title = ConversionHelper.i18n.getMessage("newTemplate");

        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'name', title);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'text', document.getElementById('text').value);

        if (this.shortcutTypeAdv())
          this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'shortcut', document.getElementById('text-shortcutAdv').value);
        else
          this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'shortcut', document.getElementById('text-shortcutBasic').value);

        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'type', document.getElementById('text-type').value);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'keyword', document.getElementById('text-keyword').value.replace(/[\s]/g, ''));
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'subject', document.getElementById('text-subject').value);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'attachments', document.getElementById('text-attachments').value);
      }
      else
      {
        var title = document.getElementById('text-title').value;
        if (title.replace(/[\s]/g, '') == "")
          title = ConversionHelper.i18n.getMessage("newGroup");

        this.saveGroupCell(this.mPickedIndex[0], 'name', title);
      }
    }
  }
,
  saveTextCell: function (aGroupIndex, aTextIndex, aColumn, aValue)
  {
    var text = gQuicktext.getText(aGroupIndex, aTextIndex, true);
    if (typeof text[aColumn] != "undefined" && text[aColumn] != aValue)
    {
      text[aColumn] = aValue;

      this.changesMade();
      return true;
    }
    return false;
  }
,
  saveGroupCell: function (aGroupIndex, aColumn, aValue)
  {
    var group = gQuicktext.getGroup(aGroupIndex, true);
    if (typeof group[aColumn] != "undefined" && group[aColumn] != aValue)
    {
      group[aColumn] = aValue;

      this.changesMade();
      return true;
    }
    return false;
  }
,
  saveScript: function()
  {
    if (this.mScriptIndex != null)
    {
      var title = document.getElementById('script-title').value;
      if (title.replace(/[\s]/g, '') == "")
        title = ConversionHelper.i18n.getMessage("newScript");

      this.saveScriptCell(this.mScriptIndex, 'name', title);
      this.saveScriptCell(this.mScriptIndex, 'script', document.getElementById('script').value);
    }
  }
,
  saveScriptCell: function (aIndex, aColumn, aValue)
  {
    var script = gQuicktext.getScript(aIndex, true);
    if (typeof script[aColumn] != "undefined" && script[aColumn] != aValue)
    {
      script[aColumn] = aValue;
      

      this.changesMade();
      return true;
    }
    return false;
  }
,
  noSpaceForKeyword: function(e)
  {
    if (e.charCode == KeyEvent.DOM_VK_SPACE)
    {
      e.stopPropagation();
      e.preventDefault();
    }
  }
,
  checkForGeneralChanges: function(aIndex)
  {
    var ids =   ['checkbox-viewPopup', 'checkbox-collapseGroup', 'select-shortcutModifier', 'checkbox-shortcutTypeAdv', 'select-keywordKey', 'text-defaultImport'];
    var type =  ['checked', 'checked', 'value', 'checked', 'value', 'value'];
    var keys =  ['viewPopup', 'collapseGroup', 'shortcutModifier', 'shortcutTypeAdv', 'keywordKey', 'defaultImport'];

    if (typeof ids[aIndex] == 'undefined')
      return;

    var value = document.getElementById(ids[aIndex])[type[aIndex]];

    if (gQuicktext[keys[aIndex]] != value)
      this.generalChangeMade(aIndex);
    else
      this.noGeneralChangeMade(aIndex);
  }
,
  onResize: function()
  {
    let textElement = document.getElementById("text");
    textElement.style.height = (textElement.parentElement.clientHeight - 5) + "px";

    let scriptElement = document.getElementById("script");
    scriptElement.style.height = (scriptElement.parentElement.clientHeight - 5) + "px";
  }
,
  checkForTextChanges: function(aIndex)
  {
    if (!this.mPickedIndex)
      return;

    var ids = ['text-title', 'text', 'text-shortcutBasic', 'text-type', 'text-keyword', 'text-subject', 'text-attachments'];
    var keys = ['name', 'text', 'shortcut', 'type', 'keyword', 'subject', 'attachments'];

    if (this.shortcutTypeAdv())
      ids[2] = 'text-shortcutAdv';

    var value = document.getElementById(ids[aIndex]).value;
    switch (aIndex)
    {
      case 0:
        if (value.replace(/[\s]/g, '') == "")
          if (this.mPickedIndex[1] > -1)
            value = ConversionHelper.i18n.getMessage("newTemplate");
          else
            value = ConversionHelper.i18n.getMessage("newGroup");
        break;
      case 2:
        if (this.shortcutTypeAdv())
        {
          value = value.replace(/[^\d]/g, '');
          document.getElementById(ids[aIndex]).value = value;
        }
      case 4:
        value = value.replace(/[\s]/g, '');
        document.getElementById(ids[aIndex]).value = value;
        break;
    }

    if (this.mPickedIndex[1] > -1)
    {
      if (gQuicktext.getText(this.mPickedIndex[0], this.mPickedIndex[1], true)[keys[aIndex]] != value)
        this.textChangeMade(aIndex);
      else
        this.noTextChangeMade(aIndex);
    }
    else
    {
      if (gQuicktext.getGroup(this.mPickedIndex[0], true)[keys[aIndex]] != value)
        this.textChangeMade(aIndex);
      else
        this.noTextChangeMade(aIndex);
    }

    if (aIndex == 0 || aIndex == 2)
    {
      var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
      if (aIndex == 0)
      {
        this.mTreeArray[selectedIndex][6] = value;
      }
      else
      {
        this.mTreeArray[selectedIndex][7] = value;
      }
      document.getElementById('group-tree').invalidateRow(selectedIndex);
      this.updateVariableGUI();
    }
  }
,
  checkForScriptChanges: function(aIndex)
  {
    if (this.mScriptIndex == null)
      return;

    var ids = ['script-title', 'script'];
    var keys = ['name', 'script'];

    var value = document.getElementById(ids[aIndex]).value;
    switch (aIndex)
    {
      case 0:
        if (value.replace(/[\s]/g, '') == "")
          value = ConversionHelper.i18n.getMessage("newScript");
        break;
    }

    if (gQuicktext.getScript(this.mScriptIndex, true)[keys[aIndex]] != value)
      this.scriptChangeMade(aIndex);
    else
      this.noScriptChangeMade(aIndex);

    if (aIndex == 0)
    {
      this.updateVariableGUI();
      var listItem = document.getElementById('script-list').getItemAtIndex(this.mScriptIndex);
      listItem.firstChild.value = value;
    }
  }
,
  changesMade: function()
  {
    this.mChangesMade = true;
    this.enableSave();
  }
,
  anyChangesMade: function()
  {
    if (this.textChangesMade() || this.scriptChangesMade() || this.generalChangesMade())
      return true;

    return false;
  }
,
  generalChangesMade: function()
  {
    for (var i = 0; i < this.mGeneralChangesMade.length; i++)
    {
      if (typeof this.mGeneralChangesMade[i] != "undefined" && this.mGeneralChangesMade[i] == true)
        return true;
    }

    return false;
  }
,
  generalChangeMade: function(aIndex)
  {
    this.enableSave();

    this.mGeneralChangesMade[aIndex] = true;
  }
,
  noGeneralChangeMade: function(aIndex)
  {
    this.mGeneralChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  }
,
  textChangesMade: function()
  {
    for (var i = 0; i < this.mTextChangesMade.length; i++)
    {
      if (typeof this.mTextChangesMade[i] != "undefined" && this.mTextChangesMade[i] == true)
        return true;
    }

    return false;
  }
,
  textChangeMade: function(aIndex)
  {
    this.enableSave();

    this.mTextChangesMade[aIndex] = true;
  }
,
  noTextChangeMade: function(aIndex)
  {
    this.mTextChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  }
,
  scriptChangesMade: function()
  {
    for (var i = 0; i < this.mScriptChangesMade.length; i++)
    {
      if (typeof this.mScriptChangesMade[i] != "undefined" && this.mScriptChangesMade[i] == true)
        return true;
    }

    return false;
  }
,
  scriptChangeMade: function(aIndex)
  {
    this.enableSave();

    this.mScriptChangesMade[aIndex] = true;
  }
,
  noScriptChangeMade: function(aIndex)
  {
    this.mScriptChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  }
,

  /*
   * GUI CHANGES
   */
  updateGUI: function()
  {

    // Set the date/time in the variablemenu
    var timeStamp = new Date();
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    for (let i=0; i < fields.length; i++) {
        let field = fields[i];
        let fieldtype = field.split("-")[0];
        if (document.getElementById(field)) {
            document.getElementById(field).setAttribute("label", ConversionHelper.i18n.getMessage(fieldtype, [quicktextUtils.dateTimeFormat(field, timeStamp)]));
        }
    }

    // Update info in the generalsettings tab
    if (document.getElementById("checkbox-viewPopup"))
      document.getElementById("checkbox-viewPopup").checked = gQuicktext.viewPopup;
    if (document.getElementById("checkbox-collapseGroup"))
      document.getElementById("checkbox-collapseGroup").checked = gQuicktext.collapseGroup;
    if (document.getElementById("select-shortcutModifier"))
      document.getElementById("select-shortcutModifier").value = gQuicktext.shortcutModifier;
    if (document.getElementById("checkbox-shortcutTypeAdv"))
    {
      var elem = document.getElementById("checkbox-shortcutTypeAdv");
      elem.checked = gQuicktext.shortcutTypeAdv;

      this.shortcutModifierChange();
    }
    if (document.getElementById("text-defaultImport"))
      document.getElementById("text-defaultImport").value = gQuicktext.defaultImport;
    if (document.getElementById("select-keywordKey"))
      document.getElementById("select-keywordKey").value = gQuicktext.keywordKey;    

    // Update the variable menu 
    this.updateVariableGUI();

    // Update Script list
    this.updateScriptGUI();

    // Update the tree
    this.buildTreeGUI();

    // Update the remove and add buttons
    this.updateButtonStates();
  }
,
  updateVariableGUI: function()
  {
    // Set all other text in the variablemenu
    var topParent = document.getElementById('quicktext-other-texts');
    for (var i = topParent.childNodes.length-1; i >= 0 ; i--)
      topParent.removeChild(topParent.childNodes[i]);

    var groupLength = gQuicktext.getGroupLength(true);
    if (groupLength > 0)
    {
      topParent.removeAttribute('hidden');
      parent = document.createElement("menupopup");
      parent = topParent.appendChild(parent);
      for(var i = 0; i < groupLength; i++)
      {
        var textLength = gQuicktext.getTextLength(i, true);
        if (textLength > 0)
        {
          var group = gQuicktext.getGroup(i, true);
          var groupElem = document.createElement("menu");
          groupElem.setAttribute('label', group.name);
          groupElem = parent.appendChild(groupElem);
  
          groupParent = document.createElement("menupopup");
          groupParent = groupElem.appendChild(groupParent);
          for (var j = 0; j < textLength; j++)
          {
            var textElem = document.createElement("menuitem");
            var text = gQuicktext.getText(i, j, true);
            textElem.setAttribute('label', text.name);
            textElem.setAttribute('group', group.name);
            textElem.addEventListener("command", function() { quicktext.insertVariable("TEXT="+ this.getAttribute("group") +"|"+ this.getAttribute("label")); });
            textElem = groupParent.appendChild(textElem);
          }
        }
      }
    }
    else
      topParent.setAttribute('hidden', true);

    var topParent = document.getElementById('variables-scripts');
    for (var i = topParent.childNodes.length-1; i >= 0 ; i--)
      topParent.removeChild(topParent.childNodes[i]);

    var scriptLength = gQuicktext.getScriptLength(true);
    if (scriptLength > 0)
    {
      topParent.removeAttribute('hidden');
      parent = document.createElement("menupopup");
      parent = topParent.appendChild(parent);

      for (var i = 0; i < scriptLength; i++)
      {
        var script = gQuicktext.getScript(i, true);
        var textElem = document.createElement("menuitem");
        textElem.setAttribute('label', script.name);
        textElem.addEventListener("command", function() { quicktext.insertVariable("SCRIPT="+ this.getAttribute("label")); });
        textElem = parent.appendChild(textElem);
      }
    }
    else
      topParent.setAttribute('hidden', true);
  }
,
  disableShortcuts: function(aShortcut)
  {
    var grouplist = document.getElementById('popup-shortcutBasic');
    for (var i = 0; i <= 10; i++)
      grouplist.childNodes[i].removeAttribute("disabled");

    var groupLength = gQuicktext.getGroupLength(true);
    for (var i = 0; i < groupLength; i++)
    {
      var textLength = gQuicktext.getTextLength(i, true);
      for (var j = 0; j < textLength; j++)
      {
        var shortcut = gQuicktext.getText(i, j, true).shortcut;
        var selectedIndex = (shortcut == "0") ? 10 : shortcut;
        if (shortcut != "" && shortcut != aShortcut && grouplist.childNodes[selectedIndex])
          grouplist.childNodes[selectedIndex].setAttribute("disabled", true);
      }
    }
  }
,

  disableSave: function()
  {
    document.documentElement.getButton("extra1").setAttribute("disabled", true);
    document.getElementById("toolbar-save").setAttribute("disabled", true);
  }
,

  enableSave: function()
  {
    document.documentElement.getButton("extra1").removeAttribute("disabled");
    document.getElementById("toolbar-save").removeAttribute("disabled");
  }
,
  /*
   * INSERT VARIABLES
   */
  insertVariable: function(aStr)
  {
    var textbox = document.getElementById("text-subject");
    if (!textbox.getAttribute("focused"))
      var textbox = document.getElementById("text");

    var selStart = textbox.selectionStart;
    var selEnd = textbox.selectionEnd;
    var selLength = textbox.textLength;

    var s1 = (textbox.value).substring(0,selStart);
    var s2 = (textbox.value).substring(selEnd, selLength)
    textbox.value = s1 + "[[" + aStr + "]]" + s2;

    var selNewStart = selStart + 4 + aStr.length;
    textbox.setSelectionRange(selNewStart, selNewStart);
    this.enableSave();    
  }
,
  insertFileVariable: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 2, 0, ConversionHelper.i18n.getMessage("insertFile"))) != null)
      this.insertVariable('FILE=' + file.path);
      this.enableSave();
  }
,
  insertImageVariable: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 4, 0, ConversionHelper.i18n.getMessage("insertImage"))) != null)
      this.insertVariable('IMAGE=' + file.path);
      this.enableSave();
  }
,

  /*
   * IMPORT/EXPORT FUNCTIONS
   */
  exportTemplatesToFile: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 3, 1, ConversionHelper.i18n.getMessage("exportFile"))) != null)
      gQuicktext.exportTemplatesToFile(file);
  }
,
  importTemplatesFromFile: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 3, 0, ConversionHelper.i18n.getMessage("importFile"))) != null)
    {
      this.saveText();
      this.saveScript();

      var length = this.mTreeArray.length;
      gQuicktext.importFromFile(file, 0, false, true);

      this.changesMade();
      this.makeTreeArray();
      document.getElementById('group-tree').rowCountChanged(length-1, this.mTreeArray.length-length);
      this.updateButtonStates();
    }
  }
,
  exportScriptsToFile: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 3, 1, ConversionHelper.i18n.getMessage("exportFile"))) != null)
      gQuicktext.exportScriptsToFile(file);
  }
,
  importScriptsFromFile: async function()
  {
    if ((file = await gQuicktext.pickFile(window, 3, 0, ConversionHelper.i18n.getMessage("importFile"))) != null)
    {
      this.saveText();
      this.saveScript();

      gQuicktext.importFromFile(file, 0, false, true);

      this.changesMade();
      this.updateScriptGUI();
      this.updateButtonStates();
    }
  }
,
  browseAttachment: async function()
  {
    if ((file = await gQuicktext.pickFile(window, -1, 0, ConversionHelper.i18n.getMessage("attachmentFile"))) != null)
    {
      var filePath = file.path;
      var attachments = document.getElementById('text-attachments').value;
      if (attachments != "")
        document.getElementById('text-attachments').value = attachments +";"+ filePath;
      else
        document.getElementById('text-attachments').value = filePath;
      this.checkForTextChanges(6);
    }
  }
,
  pickScript: function()
  {
    var index = document.getElementById('script-list').value;

    if (index == null)
    {
      document.getElementById('script-title').value = "";
      document.getElementById('script').value = "";
      this.mScriptIndex = null;
      document.getElementById('script-title').disabled = true;
      document.getElementById('script').hidden = true;
      return;
    }
    document.getElementById('script').hidden = false;


    if (this.mScriptIndex != index)
    {
      if (this.scriptChangesMade())
      {
        this.changesMade();
        this.mScriptChangesMade = [];
      }
      this.saveScript();
    }

    this.mScriptIndex = index;

    var script = gQuicktext.getScript(index, true);
    let disabled = (script.type == 1);
    
    document.getElementById('script-title').value = script.name;
    document.getElementById('script').value = script.script;

    document.getElementById('script-title').disabled = disabled;
    document.getElementById('script').disabled = disabled;
    
    if (disabled)
      document.getElementById('script-button-remove').setAttribute("disabled", true);    
    else
      document.getElementById('script-button-remove').removeAttribute("disabled");
  }
,
  pickText: function()
  {
    var index = document.getElementById('group-tree').view.selection.currentIndex;

    if (!this.mTreeArray[index])
    {
      document.getElementById('text-caption').textContent = ConversionHelper.i18n.getMessage("group");
      document.getElementById('text-title').value = "";
      this.showElement("group", true);
      this.mPickedIndex = null;
      return;
    }

    groupIndex = this.mTreeArray[index][0];
    textIndex = this.mTreeArray[index][1];

    if (this.mPickedIndex && this.textChangesMade())
    {
      this.changesMade();
      this.mTextChangesMade = [];
      this.saveText();
    }

    this.mPickedIndex = [groupIndex, textIndex];

    if (textIndex > -1)
    {
      var text = gQuicktext.getText(groupIndex, textIndex, true);
      document.getElementById('text-caption').textContent = ConversionHelper.i18n.getMessage("template");

      document.getElementById('text-title').value = text.name;
      document.getElementById('text').value = text.text;
      document.getElementById('text-keyword').value = text.keyword;
      document.getElementById('text-subject').value = text.subject;
      document.getElementById('text-attachments').value = text.attachments;

      document.getElementById('label-shortcutModifier').value = ConversionHelper.i18n.getMessage(document.getElementById('select-shortcutModifier').value +"Key") +"+";


      if (this.shortcutTypeAdv())
      {
        var elem = document.getElementById('text-shortcutAdv');
        elem.value = text.shortcut;

        elem.hidden = false;
        document.getElementById('text-shortcutBasic').hidden = true;
      }
      else
      {
        var shortcut = text.shortcut;
        var elem = document.getElementById('text-shortcutBasic');

        if (shortcut < 10)
          elem.selectedIndex = (shortcut == "0") ? 10 : shortcut;
        else
          elem.selectedIndex = 0;

        elem.hidden = false;
        document.getElementById('text-shortcutAdv').hidden = true;

        this.disableShortcuts(shortcut);
      }

      var type = text.type;
      if (!(type > 0)) type = 0;
      document.getElementById('text-type').selectedIndex = type;
    }
    else
    {
      document.getElementById('text-caption').textContent = ConversionHelper.i18n.getMessage("group");

      document.getElementById("text-title").value = gQuicktext.getGroup(groupIndex, true).name;
      document.getElementById("text").value = "";
      document.getElementById("text-keyword").value = "";
      document.getElementById("text-subject").value = "";
      document.getElementById("text-attachments").value = "";
    }

    var disabled = false;
    if (gQuicktext.getGroup(groupIndex, true).type > 0)
    {
      document.getElementById("group-button-remove").setAttribute("disabled", true);
      document.getElementById("group-button-add-text").setAttribute("disabled", true);
      disabled = true;
    }
    else
    {
      document.getElementById("group-button-remove").removeAttribute("disabled");
      document.getElementById("group-button-add-text").removeAttribute("disabled");
    }

    if (textIndex < 0)
      this.showElement("group", disabled);
    else
      this.showElement("text", disabled);
  }
,
  showElement: function(aType, aDisabled)
  {
    var elements = document.getElementsByAttribute("candisable", "true");
    for (var i = 0; i < elements.length; i++)
    {
      if (aDisabled)
        elements[i].setAttribute("disabled", true);
      else
        elements[i].removeAttribute("disabled");
    }

    var elements = document.getElementsByAttribute("showfor", "*");
    for (var i = 0; i < elements.length; i++)
    {
      var types = elements[i].getAttribute("showfor").split(",");
      var found = false;
      for (var type = 0; type < types.length; type++)
      {
        if (types[type] == aType)
          found = true;
      }

      if (found)
        elements[i].hidden = false;
      else
        elements[i].hidden = true;
    }
    this.onResize();    
  }
,

  /*
   * Add/Remove groups/templates
   */
  addGroup: function()
  {
    var title = ConversionHelper.i18n.getMessage("newGroup");
    this.saveText();

    gQuicktext.addGroup(title, true);
    this.mCollapseState.push(true);

    this.makeTreeArray();
    var treeObject = document.getElementById('group-tree');
    treeObject.rowCountChanged(this.mTreeArray.length-1, 1);
    treeObject.invalidateRow(this.mTreeArray.length-1);

    selectedIndex = this.mTreeArray.length - 1;
    this.selectTreeRow(selectedIndex);

    this.updateButtonStates();
    this.changesMade();

    var titleElem = document.getElementById('text-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  }
,
  addText: function()
  {
    var title = ConversionHelper.i18n.getMessage("newTemplate");
    this.saveText();

    var groupIndex = -1;
    if (this.mPickedIndex)
      groupIndex = this.mPickedIndex[0];

    var groupLength = gQuicktext.getGroupLength(true);
    if (groupIndex == -1)
    {
      if (groupLength == 0)
        return;
      else
        groupIndex = 0;
    }

    gQuicktext.addText(groupIndex, title, true);

    this.makeTreeArray();
    var selectedIndex = -1;
    for (var i = 0; i <= groupIndex; i++)
    {
      selectedIndex++;
      if (this.mCollapseState[i])
        selectedIndex += gQuicktext.getTextLength(i, true);
    }

    var treeObject = document.getElementById('group-tree');
    treeObject.rowCountChanged(selectedIndex-1, 1);
    treeObject.invalidateRow(selectedIndex);
    this.selectTreeRow(selectedIndex);

    this.updateButtonStates();
    this.changesMade();

    var titleElem = document.getElementById('text-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  }
,
  removeText: function()
  {
    this.saveText();

    if (this.mPickedIndex)
    {
      var groupIndex = this.mPickedIndex[0];
      var textIndex = this.mPickedIndex[1];

      var title = gQuicktext.getGroup(groupIndex, true).name;
      if (textIndex > -1)
        title = gQuicktext.getText(groupIndex, textIndex, true).name;

      if (confirm (ConversionHelper.i18n.getMessage("remove", [title])))
      {
        this.mPickedIndex = null;

        var textLength = gQuicktext.getTextLength(groupIndex, true);

        var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
        var moveSelectionUp = false;
        if (this.mTreeArray[selectedIndex+1] && this.mTreeArray[selectedIndex+1][2] < this.mTreeArray[selectedIndex][2])
          moveSelectionUp = true;

        var treeObject = document.getElementById('group-tree');
        if (textIndex == -1)
        {
          gQuicktext.removeGroup(groupIndex, true);

          if (this.mCollapseState[groupIndex])
            treeObject.rowCountChanged(selectedIndex, -(textLength+1));
          else
            treeObject.rowCountChanged(selectedIndex, -1);

          this.makeTreeArray();
          treeObject.invalidate();
        }
        else
        {
          gQuicktext.removeText(groupIndex, textIndex, true);

          treeObject.rowCountChanged(selectedIndex, -1);
          this.makeTreeArray();
          treeObject.invalidate();
        }

        this.updateVariableGUI();
        this.updateButtonStates();
        this.changesMade();

        var selectedRow = false;
        if (moveSelectionUp)
        {
          selectedRow = true;
          this.selectTreeRow(selectedIndex-1);
        }

        var rowCount = this.mTreeArray.length -1;
        if (selectedIndex > rowCount || selectedIndex == -1)
        {
          selectedRow = true;
          this.selectTreeRow(rowCount);
        }

        if (!selectedRow)
          this.selectTreeRow(selectedIndex);
      }
    }
  }
,
  getCommunityScripts: function()
  {
    let ioservice = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
    let uriToOpen = ioservice.newURI("https://github.com/thundernest/quicktext/wiki/Community-scripts", null, null);
    let extps = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].getService(Components.interfaces.nsIExternalProtocolService);
    extps.loadURI(uriToOpen, null);   
  }
,
  addScript: function()
  {
    this.saveScript();

    var title = ConversionHelper.i18n.getMessage("newScript");
    gQuicktext.addScript(title, true);

    this.updateScriptGUI();
    this.updateButtonStates();

    var listElem = document.getElementById('script-list');
    selectedIndex = listElem.getRowCount()-1;
    listElem.selectedIndex = selectedIndex;

    this.changesMade();

    var titleElem = document.getElementById('script-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  }
,
  removeScript: function()
  {
    this.saveScript();

    var scriptIndex = document.getElementById('script-list').value;
    if (scriptIndex != null)
    {
      var title = gQuicktext.getScript(scriptIndex, true).name;
      if (confirm (ConversionHelper.i18n.getMessage("remove", [title])))
      {
        gQuicktext.removeScript(scriptIndex, true);
        this.changesMade();

        if (gQuicktext.getScriptLength(true) > 0)
        {
          var selectedIndex = document.getElementById('script-list').selectedIndex -1;
          if (selectedIndex < 0)
            selectedIndex = 0;
          this.mScriptIndex = selectedIndex;
        }
        else
        {
          this.mScriptIndex = null;
          selectedIndex = -1;
        }

        document.getElementById('script-list').selectedIndex = selectedIndex;

        this.updateScriptGUI();
        this.updateVariableGUI();
        this.updateButtonStates();
      }
    }
  }
,

  updateScriptGUI: function()
  {
    // Update the listmenu in the scripttab and the variable-menu
    var scriptLength = gQuicktext.getScriptLength(true);

    listElem = document.getElementById('script-list');
    var selectedIndex = listElem.selectedIndex;
    var oldLength = listElem.getRowCount();

    if (scriptLength > 0)
    {
      for (var i = 0; i < scriptLength; i++)
      {
        var script = gQuicktext.getScript(i, true);
        if (i < oldLength)
        {
          var listItem = listElem.getItemAtIndex(i);
          listItem.firstChild.value = script.name;
          listItem.value = i;
        }
        else
        {
          let newItem = document.createElement("richlistitem");
          newItem.value = i;
          let newItemLabel = document.createElement("label");
          newItemLabel.value = script.name;
          newItem.appendChild(newItemLabel);
          listElem.appendChild(newItem);
        }
      }
    }

    if (oldLength > scriptLength)
    {
      for (var i = scriptLength; i < oldLength; i++)
        listElem.getItemAtIndex(scriptLength).remove();
    }

    if (selectedIndex >= 0)
      listElem.selectedIndex = selectedIndex;
    else if (scriptLength > 0)
      listElem.selectedIndex = 0;
    else
      listElem.selectedIndex = -1;

    this.pickScript();
  }
,
  /*
   * Update the treeview
   */
  makeTreeArray: function()
  {
    this.mTreeArray = [];
    var k = 0;

    var groupLength = gQuicktext.getGroupLength(true);

    if (this.mCollapseState.length < groupLength)
    {
      for (var i = this.mCollapseState.length; i < groupLength; i++)
        this.mCollapseState[i] = true;
    }
    else if (this.mCollapseState.length > groupLength)
      this.mCollapseState.splice(groupLength, this.mCollapseState.length - groupLength);

    for (var i = 0; i < groupLength; i++)
    {
      var groupIndex = k;
      var textLength = gQuicktext.getTextLength(i, true);

      this.mTreeArray[k] = [i, -1, 0, -1, true, textLength, gQuicktext.getGroup(i, true).name, ''];
      k++;

      if (!this.mCollapseState[i])
        continue;

      for (var j = 0; j < textLength; j++)
      {
        var text = gQuicktext.getText(i, j, true);
        var shortcut = text.shortcut;
        this.mTreeArray[k] = [i, j, 1, groupIndex, false, 0, text.name, shortcut];
        k++;
      }
    }
  }
,
  updateTreeGUI: function()
  {
    // maybe
  }
,
  buildTreeGUI: function()
  {
    this.makeTreeArray();

    var treeview = {
      rowCount: this.mTreeArray.length,
      lastIndex: null,

      isContainer: function(aRow)
      {
        return (quicktext.mTreeArray[aRow][1] == -1);
      },
      isContainerOpen: function(aRow)
      {
        return quicktext.mCollapseState[quicktext.mTreeArray[aRow][0]];
      },
      isContainerEmpty: function(aRow)
      {
        return (quicktext.mTreeArray[aRow][5] == 0);
      },
      isSeparator: function(aRow)
      {
        return false;
      },
      isSorted: function(aRow)
      {
        return false;
      },
      isEditable: function(aRow)
      {
        return false;
      },
      hasNextSibling: function(aRow, aAfter)
      {
        return (quicktext.mTreeArray[aAfter+1]
                && quicktext.mTreeArray[aRow][2] == quicktext.mTreeArray[aAfter+1][2]
                && quicktext.mTreeArray[aRow][3] == quicktext.mTreeArray[aAfter+1][3]);
      },
      getLevel: function(aRow)
      {
        return quicktext.mTreeArray[aRow][2];
      },
      getImageSrc: function(aRow, aCol) { return null; },
      getParentIndex: function(aRow)
      {
        return quicktext.mTreeArray[aRow][3];
      },
      getRowProperties: function(aRow, aProps) { },
      getCellProperties: function(aRow, aCol, aProps) { },
      getColumnProperties: function(aColid, aCol, aProps) { },
      getProgressMode: function(aRow, aCol) { },
      getCellValue: function(aRow, aCol) { return null; },
      canDropBeforeAfter: function(aRow, aBefore)
      {
        if (aBefore)
          return this.canDrop(aRow, -1);

        return this.canDrop(aRow, 1);
      },
      canDropOn: function(aRow)
      {
        return this.canDrop(aRow, 0);
      },
      canDrop: function(aRow, aOrient)
      {
        var index = document.getElementById('group-tree').view.selection.currentIndex;
        if (index == aRow)
          return false;

        // Can only drop templates on groups
        if (aOrient == 0)
        {
          if (quicktext.mTreeArray[index][2] > 0 && quicktext.mTreeArray[aRow][2] == 0)
            return true;
          else
            return false;
        }

        // Take care if we drag a group
        if (quicktext.mTreeArray[index][2] == 0)
        {
          if (aOrient < 0 && quicktext.mTreeArray[aRow][2] == 0)
            return true;
          if (aOrient > 0 && quicktext.mTreeArray.length-1 == aRow)
            return true;
        }
        // Take care if we drag a template
        else
        {
          if (quicktext.mTreeArray[aRow][2] > 0)
            return true;
        }

        return false;
      },
      drop: function(aRow, aOrient)
      {
        quicktext.saveText();
        quicktext.mPickedIndex = null;
        var selectIndex = -1;
        var index = document.getElementById('group-tree').view.selection.currentIndex;

        // Droping a group
        if (quicktext.mTreeArray[index][2] == 0)
        {
          var textLength = gQuicktext.getTextLength(quicktext.mTreeArray[index][0], true);
          if (!quicktext.mCollapseState[quicktext.mTreeArray[index][0]])
            textLength = 0;

          if (aOrient > 0)
          {
            gQuicktext.moveGroup(quicktext.mTreeArray[index][0], gQuicktext.getGroupLength(true), true);

            var state = quicktext.mCollapseState.splice(quicktext.mTreeArray[index][0], 1);
            state = (state == "false") ? false : true;
            quicktext.mCollapseState.push(state);

            selectIndex = quicktext.mTreeArray.length - textLength - 1;
          }
          else
          {
            gQuicktext.moveGroup(quicktext.mTreeArray[index][0], quicktext.mTreeArray[aRow][0], true);

            var state = quicktext.mCollapseState.splice(quicktext.mTreeArray[index][0], 1);
            state = (state == "false") ? false : true;
            quicktext.mCollapseState.splice(quicktext.mTreeArray[aRow][0], 0, state);

            selectIndex = (aRow > index) ? aRow - textLength - 1 : aRow;
          }
        }
        // Droping a template
        else
        {
          switch (aOrient)
          {
            case 0:
              var textLength = gQuicktext.getTextLength(quicktext.mTreeArray[aRow][0], true);
              gQuicktext.moveText(quicktext.mTreeArray[index][0], quicktext.mTreeArray[index][1], quicktext.mTreeArray[aRow][0], textLength, true);
              selectIndex = (quicktext.mTreeArray[index][0] == quicktext.mTreeArray[aRow][0] || aRow > index) ? aRow + textLength : aRow + textLength + 1;
              break;
            case 1:
              gQuicktext.moveText(quicktext.mTreeArray[index][0], quicktext.mTreeArray[index][1], quicktext.mTreeArray[aRow][0], quicktext.mTreeArray[aRow][1]+1, true);
              selectIndex = (aRow > index) ? aRow : aRow + 1;
              break;
            default:
              gQuicktext.moveText(quicktext.mTreeArray[index][0], quicktext.mTreeArray[index][1], quicktext.mTreeArray[aRow][0], quicktext.mTreeArray[aRow][1], true);
              selectIndex = (aRow > index) ? aRow - 1 : aRow;
              break;
          }
        }

        quicktext.makeTreeArray();
        document.getElementById('group-tree').invalidate();
        document.getElementById('group-tree').view.selection.select(selectIndex);
        quicktext.changesMade();
      },
      getCellText: function(aRow, aCol)
      {
        colName = (aCol.id) ? aCol.id : aCol;
        if (colName == "group")
        {
          return quicktext.mTreeArray[aRow][6];
        }
        else if (colName == "shortcut" && quicktext.mTreeArray[aRow][1] > -1)
        {
          return quicktext.mTreeArray[aRow][7];
        }

        return "";
      },
      toggleOpenState: function(aRow)
      {
        var state = quicktext.mCollapseState[quicktext.mTreeArray[aRow][0]];
        quicktext.mCollapseState[quicktext.mTreeArray[aRow][0]] = !state;

        quicktext.makeTreeArray();

        var treeObject = document.getElementById('group-tree');

        if (state)
          treeObject.rowCountChanged(aRow, -quicktext.mTreeArray[aRow][5]);
        else
          treeObject.rowCountChanged(aRow, quicktext.mTreeArray[aRow][5]);

        treeObject.invalidate();
        document.getElementById('group-tree').view.selection.select(aRow);
      },
      setTree: function(aTreebox)
      {
        this.treebox=aTreebox;
      }
    }

    var firstVisibleRow = document.getElementById('group-tree').getFirstVisibleRow();
    var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
    if (selectedIndex == -1 && this.mTreeArray.length)
      selectedIndex = 0;

    document.getElementById('group-tree').view = treeview;
    document.getElementById('group-tree').scrollToRow(firstVisibleRow);
    this.selectTreeRow(selectedIndex);

    this.pickText();
  }
,
  selectTreeRow: function(aRow)
  {
    document.getElementById('group-tree').view.selection.select(aRow);
    document.getElementById('group-tree').ensureRowIsVisible(aRow);
  }
,
  updateButtonStates: function()
  {
    // Update the add-buttons
    if (this.mTreeArray.length)
    {
      var index = document.getElementById('group-tree').view.selection.currentIndex;
      if (this.mTreeArray[index] && gQuicktext.getGroup(this.mTreeArray[index][0], true).type > 0)
      {
        document.getElementById("group-button-remove").setAttribute("disabled", true);
        document.getElementById("group-button-add-text").setAttribute("disabled", true);
      }
      else
      {
        document.getElementById("group-button-remove").removeAttribute("disabled");
        document.getElementById("group-button-add-text").removeAttribute("disabled");
      }
    }
    else
    {
      document.getElementById('group-button-add-text').setAttribute("disabled", true);
      document.getElementById('group-button-remove').setAttribute("disabled", true);
    }

    let scriptIndex = document.getElementById('script-list').value;
    let script = gQuicktext.getScript(scriptIndex, true);
    if (gQuicktext.getScriptLength(true) && script.type == 0)
      document.getElementById('script-button-remove').removeAttribute("disabled");
    else
      document.getElementById('script-button-remove').setAttribute("disabled", true);
  }
,
  openHomepage: function()
  {
    gQuicktext.openHomepage();
  }
,
  shortcutModifierChange: function()
  {
    var state = (this.mOS.substr(0, 3).toLowerCase() == "mac" || (this.mOS.substr(0, 3).toLowerCase() == "win" && document.getElementById('select-shortcutModifier').value == "alt"));
    document.getElementById('checkbox-shortcutTypeAdv').disabled = state;
  }
,

  /*
   * OBSERVERS
   */
  observe: function(aSubject, aTopic, aData)
  {
    if (aTopic == "updatesettings")
    {
      // this.updateGUI();
    }
  }
}
