var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
var { wzQuicktextVar } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktextVar.jsm");
var gQuicktextVar = new wzQuicktextVar();

var { quicktextUtils } = ChromeUtils.import("chrome://quicktext/content/modules/utils.jsm");

var quicktextStateListener = {
  NotifyComposeBodyReady: function()
  {
  	quicktext.insertDefaultTemplate();
  },

  NotifyComposeFieldsReady: function() {},
  ComposeProcessDone: function(aResult) {},
  SaveInFolderDone: function(folderURI) {}
}

var quicktext = {
  mStringBundle:                null,
  mLoaded:                      false,
  mSelectionContent:            null,
  mLastFocusedElement:          null,
  mShortcuts:                   {},
  mShortcutString:              "",
  mShortcutModifierDown:        false,
  mKeywords:                    {}
,
  load: function()
  {
    if (!this.mLoaded)
    {
      this.mLoaded = true;

      this.mStringBundle = document.getElementById("quicktextStringBundle");

      gQuicktext.addObserver(this);
      if (!gQuicktext.loadSettings(false))
        this.updateGUI();

      gQuicktextVar.init(window);

      // Add an eventlistener for keypress in the window
      window.addEventListener("keypress", function(e) { quicktext.windowKeyPress(e); }, true);
      window.addEventListener("keydown", function(e) { quicktext.windowKeyDown(e); }, true);
      window.addEventListener("keyup", function(e) { quicktext.windowKeyUp(e); }, true);

      // Add an eventlistener for keypress in the editor
      var contentFrame = GetCurrentEditorElement();
      contentFrame.addEventListener("keypress", function(e) { quicktext.editorKeyPress(e); }, false);

      // Add an eventlistener for the popup-menu.
      var menu = document.getElementById("msgComposeContext");
      menu.addEventListener("popupshowing", function(e) { quicktext.popupshowing(e); }, false);

      // Need to update GUI when the Quicktext-button is added to the toolbar (updating on ANY change to the toolbar is much more simple, and it does not hurt) 
      window.addEventListener("aftercustomization", function() { quicktext.updateGUI(); } , false);

    }
  }
,
  reload: function()
  {
    gQuicktextVar.init(window);
  }
,
  unload: function()
  {
    // Remove the observer
    gQuicktext.removeObserver(this);

    window.removeEventListener("keypress", function(e) { quicktext.windowKeyPress(e); }, true);
    window.removeEventListener("keydown", function(e) { quicktext.windowKeyDown(e); }, true);
    window.removeEventListener("keyup", function(e) { quicktext.windowKeyUp(e); }, true);

    // Remove the eventlistener from the editor
    var contentFrame = GetCurrentEditorElement();
    contentFrame.removeEventListener("keypress", function(e) { quicktext.editorKeyPress(e); }, false);

    // Remove the eventlistener for the popup-menu.
    var menu = document.getElementById("msgComposeContext");
    menu.removeEventListener("popupshowing", function(e) { quicktext.popupshowing(e); }, false);

    window.removeEventListener("aftercustomization", function() { quicktext.updateGUI(); } , false);
  }
,

  /**
   * This is called when the var gMsgCompose is init. We now take
   * the extraArguments value and listen for state changes so
   * we know when the editor is finished.
   */
  windowInit: function()
  {
  	gMsgCompose.RegisterStateListener(quicktextStateListener);
  }
,
  /*
   * This is called when the body of the mail is set up.
   * So now it is time to insert the default template if
   * there exists one.
   */
	insertDefaultTemplate: function()
	{
	  dump("insertDefaultTemplate\n");
	}
,
  updateGUI: function()
  {
    // Set the date/time in the variablemenu
    var timeStamp = new Date();
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    for (let i=0; i < fields.length; i++) {
        let field = fields[i];
        let fieldtype = field.split("-")[0];
        if (document.getElementById(field)) {
            document.getElementById(field).setAttribute("label", this.mStringBundle.getFormattedString(fieldtype, [quicktextUtils.dateTimeFormat(field, timeStamp)]));
        }
    }

    // Empty all shortcuts and keywords
    this.mShortcuts = {};
    this.mKeywords = {};

    // Update the toolbar
    var toolbar = document.getElementById("quicktext-toolbar");
    if (toolbar != null)
    {

      //clear toolbar and store current "variables" and "other" menus (the two rightmost ones)
      var toolbarbuttonVar = null;
      var toolbarbuttonOther = null;
      var length = toolbar.childNodes.length;
      for(var i = length-1; i >= 0; i--)
      {
        var element = toolbar.childNodes[i];
        switch(element.getAttribute("id"))
        {
          case 'quicktext-variables':
            toolbarbuttonVar = element.cloneNode(true);
            break;
          case 'quicktext-other':
            toolbarbuttonOther = element.cloneNode(true);
            break;
        }
        toolbar.removeChild(element);
      }

      //rebuild template groups (the leftmost entries)
      var groupLength = gQuicktext.getGroupLength(false);
      for (var i = 0; i < groupLength; i++)
      {
        var textLength = gQuicktext.getTextLength(i, false);
        if (textLength)
        {
          //Add first level element, this will be either a menu or a button (if only one text in this group)
          var toolbarbuttonGroup = toolbar.appendChild(document.createElement("toolbarbutton"));

          if (textLength == 1 && gQuicktext.collapseGroup)
          {
            toolbarbuttonGroup.setAttribute("label", gQuicktext.getText(i, 0, false).name);
            toolbarbuttonGroup.setAttribute("i", i);
            toolbarbuttonGroup.setAttribute("j", 0);
            toolbarbuttonGroup.setAttribute("class", "customEventListenerForDynamicMenu");
          }
          else
          {
            toolbarbuttonGroup.setAttribute("type", "menu");
            toolbarbuttonGroup.setAttribute("label", gQuicktext.getGroup(i, false).name);
            var menupopup = toolbarbuttonGroup.appendChild(document.createElement("menupopup"));

            //add second level elements: all found texts of this group
            for (var j = 0; j < textLength; j++)
            {
              var text = gQuicktext.getText(i, j, false);

              var toolbarbutton = document.createElement("menuitem");
              toolbarbutton.setAttribute("label", text.name);
              toolbarbutton.setAttribute("i", i);
              toolbarbutton.setAttribute("j", j);
              toolbarbutton.setAttribute("class", "customEventListenerForDynamicMenu");

              var shortcut = text.shortcut;
              if (shortcut > 0)
              {
                if (shortcut == 10) shortcut = 0;
                toolbarbutton.setAttribute("acceltext", "Alt+" + shortcut);
              }

              menupopup.appendChild(toolbarbutton);
            }
          }
          toolbarbuttonGroup = null;

          // Update the keyshortcuts
          for (var j = 0; j < textLength; j++)
          {
            var text = gQuicktext.getText(i, j, false);
            var shortcut = text.shortcut;
            if (shortcut != "" && typeof this.mShortcuts[shortcut] == "undefined")
              this.mShortcuts[shortcut] = [i, j];

            var keyword = text.keyword;
            if (keyword != "" && typeof this.mKeywords[keyword.toLowerCase()] == "undefined")
              this.mKeywords[keyword.toLowerCase()] = [i, j];
          }
        }
      }

      //add a flex spacer to push the VAR and OTHER elements to the right 
      var spacer = document.createElement("spacer");
      spacer.setAttribute("flex", "1");
      toolbar.appendChild(spacer);
      toolbar.appendChild(toolbarbuttonVar);
      toolbar.appendChild(toolbarbuttonOther);

            
      // Update the toolbar inside the toolbarpalette and the drop-down menu - if used
      let optionalUI = ["button-quicktext", "quicktext-popup"];
      for (let a=0; a < optionalUI.length; a++) { 
        if (document.getElementById(optionalUI[a]) != null && document.getElementById(optionalUI[a]).childNodes[0] != null) {
          let rootElement = document.getElementById(optionalUI[a]).childNodes[0]; //get the menupop
          
          //clear
          let length = rootElement.childNodes.length;
          for (let i = length-1; i >= 0; i--)
            rootElement.removeChild(rootElement.childNodes[i]);

          //rebuild via copy from the quicktext toolbar - loop over toolbarbuttons inside toolbar
          for (let i = 0; i < toolbar.childNodes.length; i++)
          {
            let menu;
            let node = toolbar.childNodes[i];
            switch (node.nodeName)
            {
              case "toolbarbutton":
                // Check if the group is collapse or not
                if (node.getAttribute("type") == "menu")
                {
                  menu = document.createElement("menu");
                  menu.setAttribute("label", node.getAttribute("label"));
    
                  for (let j = 0; j < node.childNodes.length; j++) {
                    menu.appendChild(node.childNodes[j].cloneNode(true));
                  }
                }
                else
                {
                  menu = document.createElement("menuitem");
                  menu.setAttribute("label", node.getAttribute("label"));
                  menu.setAttribute("i", node.getAttribute("i"));
                  menu.setAttribute("j", node.getAttribute("j"));
                  menu.setAttribute("class", "customEventListenerForDynamicMenu");
                }
                rootElement.appendChild(menu);
                break;
              case "spacer":
                rootElement.appendChild(document.createElement("menuseparator"));
                break;
            }
            menu = null;
          }
          
        }
      }
      
    }

    //add event listeners
    let items = document.getElementsByClassName("customEventListenerForDynamicMenu");
    for (let i=0; i < items.length; i++)
    {
      items[i].addEventListener("command", function() { quicktext.insertTemplate(this.getAttribute("i"), this.getAttribute("j")); }, true);
    }

    
    this.visibleToolbar();
  }
,
  popupshowing: function(aEvent)
  {
    var hidden = !gQuicktext.viewPopup;
    document.getElementById("quicktext-popup").hidden = hidden;
    document.getElementById("quicktext-popupsep").hidden = hidden;
  }
,
  openSettings: function()
  {
    var settingsHandle = window.open("chrome://quicktext/content/settings.xul", "quicktextConfig", "chrome,resizable,centerscreen");
    settingsHandle.focus();
  }
,
  toogleToolbar: function()
  {
    gQuicktext.viewToolbar = !gQuicktext.viewToolbar;
  }
,
  visibleToolbar: function()
  {
    // Set the view of the toolbar to what it should be
    if (gQuicktext.viewToolbar)
    {
      document.getElementById("quicktext-view").setAttribute("checked", true);
      document.getElementById("quicktext-toolbar").removeAttribute("collapsed");
    }
    else
    {
      document.getElementById("quicktext-view").removeAttribute("checked");
      document.getElementById("quicktext-toolbar").setAttribute("collapsed", true);
    }    
  }
,

  /*
   * INSERTING TEXT
   */
  insertVariable: function(aVar)
  {
    gQuicktextVar.cleanTagData();
    this.insertBody("[["+ aVar +"]] ", 0, true);
  }
,
  insertTemplate: function(aGroupIndex, aTextIndex, aHandleTransaction)
  {
    if (typeof aHandleTransaction == "undefined")
      aHandleTransaction = true;

    if (gQuicktext.doTextExists(aGroupIndex, aTextIndex, false))
    {
      this.mLastFocusedElement = (document.commandDispatcher.focusedWindow != window) ? document.commandDispatcher.focusedWindow : document.commandDispatcher.focusedElement;

      gQuicktextVar.cleanTagData();

      var text = gQuicktext.getText(aGroupIndex, aTextIndex, false);
      this.insertHeaders(text);
      this.insertSubject(text.subject);
      this.insertAttachments(text.attachments);

      if (text.text != "" && text.text.indexOf('[[CURSOR]]') > -1)
      {
        // only if we really have text to insert with a [[CURSOR]] tag,
        // focus the message body first
        this.focusMessageBody();
      }

      this.insertBody(text.text, text.type, aHandleTransaction);

      // If we insert any headers we maybe needs to return the placement of the focus
      setTimeout(function () {quicktext.moveFocus();}, 1);
    }
  }
,
  insertAttachments: function(aStr)
  {
    if (aStr != "")
    {
      aStr = gQuicktextVar.parse(aStr);
      var files = aStr.split(";");

      for (var i = 0; i < files.length; i++)
      {
        var currentFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
        currentFile.initWithPath(files[i]);
        if (!currentFile.exists())
          continue;

        var attachment = FileToAttachment(currentFile);
        if (!DuplicateFileAlreadyAttached(attachment.url))
        {
          AddAttachments([attachment]);
        }

      }
    }
  }
,
  insertHeaders: function(aText)
  {
    var headerLength = aText.getHeaderLength();
    if (headerLength == 0)
      return;

    var convertHeaderToType           = [];
    convertHeaderToType["to"]         = "to";
    convertHeaderToType["cc"]         = "cc";
    convertHeaderToType["bcc"]        = "bcc";
    convertHeaderToType["reply-to"]   = "reply";

    var convertHeaderToParse          = [];
    convertHeaderToParse["to"]        = "to";
    convertHeaderToParse["cc"]        = "cc";
    convertHeaderToParse["bcc"]       = "bcc";
    convertHeaderToParse["reply-to"]  = "replyTo";

    var recipientHeaders              = [];
    recipientHeaders["to"]            = [];
    recipientHeaders["cc"]            = [];
    recipientHeaders["bcc"]           = [];
    recipientHeaders["reply-to"]      = [];

    // Add all recipient headers to an array
    var count = 0;
    for (var i = 0; i < headerLength; i++)
    {
      var header = aText.getHeader(i);
      var type = header.type.toLowerCase();
      if (typeof recipientHeaders[type] != "undefined")
      {
        recipientHeaders[type].push(gQuicktextVar.parse(header.value));
        count++;
      }
    }

    if (count > 0)
    {
      Recipients2CompFields(gMsgCompose.compFields);
      var parser = Components.classes["@mozilla.org/messenger/headerparser;1"].getService(Components.interfaces.nsIMsgHeaderParser);

      // Go through all recipientHeaders to remove duplicates
      var tmpRecipientHeaders = [];
      count = 0;
      for (var header in recipientHeaders)
      {
        if (recipientHeaders[header].length == 0)
          continue;

        tmpRecipientHeaders[header] = [];
        
        // Create an array of emailaddresses for this header that allready added
        var tmpEmailAddresses = {};
        var numOfAddresses = parser.parseHeadersWithArray(gMsgCompose.compFields[convertHeaderToParse[header]], tmpEmailAddresses, {}, {});
        var emailAddresses = [];
        for (var i = 0; i < numOfAddresses; i++)
          emailAddresses.push(tmpEmailAddresses.value[i]);

        // Go through all recipient of this header that I want to add
        for (var i = 0; i < recipientHeaders[header].length; i++)
        {
          // Get the mailaddresses of all the addresses
          var insertedEmailAddresses = {};
          var insertedFullAddresses = {};
          var insertedNumOfAddresses = parser.parseHeadersWithArray(recipientHeaders[header][i], insertedEmailAddresses, {}, insertedFullAddresses);

          for (var j = 0; j < insertedNumOfAddresses; j++)
          {
            if (emailAddresses.indexOf(insertedEmailAddresses.value[j]) < 0)
            {
              tmpRecipientHeaders[header].push(insertedFullAddresses.value[j]);
              emailAddresses.push(insertedEmailAddresses.value[j]);
              count++;
            }
          }
        }
      }

      if (count > 0)
      {
        var addressingWidgetFocus = false;
        var focusedElement = this.mLastFocusedElement;
        var addressingWidget = document.getElementById("addressingWidget");
        if (focusedElement == addressingWidget || focusedElement.compareDocumentPosition && focusedElement.compareDocumentPosition(addressingWidget) & Node.DOCUMENT_POSITION_CONTAINS)
          addressingWidgetFocus = true;

        for (var header in tmpRecipientHeaders)
          for (var i = 0; i < tmpRecipientHeaders[header].length; i++)
            AddRecipient("addr_"+ convertHeaderToType[header], tmpRecipientHeaders[header][i]);

        // AddRecipient takes focus so if I don't have focus in the addressingWidget
        // I want to move it back.
        if (addressingWidgetFocus)
          this.mLastFocusedElement = null;
      }
    }
  }
,
  moveFocus: function()
  {
    if (this.mLastFocusedElement)
    {
      this.mLastFocusedElement.focus();
      this.mLastFocusedElement = null;
    }
  }
,
  focusMessageBody: function()
  {
    // advance focus until we are at the message body
    var maxsteps = 50;
    for (var i = 0; this.mLastFocusedElement.name != "browser.message.body" && i < maxsteps; i++)
    {
      document.commandDispatcher.advanceFocus();
      this.mLastFocusedElement = (document.commandDispatcher.focusedWindow != window) ? document.commandDispatcher.focusedWindow : document.commandDispatcher.focusedElement;
    }
  }
,
  insertSubject: function(aStr)
  {
    if (aStr != "")
    {
      aStr = gQuicktextVar.parse(aStr);

      if (aStr != "" && !aStr.match(/^\s+$/) && document.getElementById('msgSubject'))
        document.getElementById('msgSubject').value = aStr;
    }
  }
,
  insertBody: function(aStr, aType, aHandleTransaction)
  {
    if (aStr != "")
    {
      aStr = gQuicktextVar.parse(aStr);

      if (aStr != "")
      {
        // Inserts the text
        if (aStr != "" && !aStr.match(/^\s+$/))
        {
          var editor = GetCurrentEditor();
          if (aHandleTransaction)
            editor.beginTransaction();
  
          if (editor.selection.rangeCount > 0)
          {
            var startRange = editor.selection.getRangeAt(0).cloneRange();
            var specialRange = [startRange.startContainer.parentNode, this.getChildNodeIndex(startRange.startContainer.parentNode, startRange.startContainer), startRange.startOffset];
          }

          try {
            if (gMsgCompose.composeHTML && aType > 0)
            {
              // It the text is inserted as HTML we need to remove bad stuff
              // before we insert it.

              aStr = gQuicktextVar.removeBadHTML(aStr);

              editor.insertHTML(aStr);
            }
            else
              editor.insertText(aStr);
          }
          catch(e) { Components.utils.reportError(e); }
  
          if (editor.selection.rangeCount > 0)
            var endRange = editor.selection.getRangeAt(0).cloneRange();
  
          try {
            if (specialRange && endRange)
            {
              var newRange = editor.document.createRange();
              newRange.setStart(specialRange[0].childNodes[specialRange[1]], specialRange[2]);
              newRange.setEnd(endRange.endContainer, endRange.endOffset);
  
              // Take care of the CURSOR-tag
              this.parseCursorTag(editor, newRange);
            }
          }
          catch(e) { Components.utils.reportError(e); }
  
          if (aHandleTransaction)
            editor.endTransaction();
        }
      }
    }
  }
,
  parseCursorTag: function(aEditor, aSearchRange)
  {
    var startRange = aEditor.document.createRange();
    startRange.setStart(aSearchRange.startContainer, aSearchRange.startOffset);
    startRange.setEnd(aSearchRange.startContainer, aSearchRange.startOffset);
    var endRange = aEditor.document.createRange();
    endRange.setStart(aSearchRange.endContainer, aSearchRange.endOffset);
    endRange.setEnd(aSearchRange.endContainer, aSearchRange.endOffset);

    var finder = Components.classes["@mozilla.org/embedcomp/rangefind;1"].createInstance().QueryInterface(Components.interfaces.nsIFind);
    finder.caseSensitive = true;
    finder.findBackwards = false;

    setTimeout(function() {
      var found = false;
      while ((foundRange = finder.Find("[[CURSOR]]", aSearchRange, startRange, endRange)) != null)
      {
        found = true;
        aEditor.selection.removeAllRanges();
        aEditor.selection.addRange(foundRange);
        aEditor.selection.deleteFromDocument();
        startRange.setEnd(foundRange.endContainer, foundRange.endOffset);
        startRange.setStart(foundRange.endContainer, foundRange.endOffset);
      }

      if (!found)
      {
        aEditor.selection.removeAllRanges();
        aEditor.selection.addRange(endRange);
      }
    });
  }
,
  dumpTree: function(aNode, aLevel)
  {
    for (var i = 0; i < aLevel*2; i++)
      dump(" ");
    dump(aNode.nodeName +": "+ aNode.nodeValue +"\n");
    for (var i = 0; i < aNode.childNodes.length; i++)
    {
      this.dumpTree(aNode.childNodes[i], aLevel+1);
    }
  }
,
  getChildNodeIndex: function(aParentNode, aChildNode)
  {
    for(var i = 0; i < aParentNode.childNodes.length; i++)
    {
      if (aParentNode.childNodes[i] == aChildNode)
        return i;
    }

    return null;
  }
,
  insertContentFromFile: function(aType)
  {
    if ((file = gQuicktext.pickFile(window, aType, 0, this.mStringBundle.getString("insertFile"))) != null)
      this.insertBody(gQuicktext.readFile(file), aType, true);
  }
,

  /*
   * KEYPRESS
   */
  windowKeyPress: function(e)
  {
    if (gQuicktext.shortcutTypeAdv)
    {
      var shortcut = e.charCode-48;
      if (shortcut >= 0 && shortcut < 10 && this.mShortcutModifierDown)
      {
        this.mShortcutString += String.fromCharCode(e.charCode);

        e.stopPropagation();
        e.preventDefault();
      }
    }
    else
    {
      var modifier = gQuicktext.shortcutModifier;
      var shortcut = e.charCode-48;
      if (shortcut >= 0 && shortcut < 10 && typeof this.mShortcuts[shortcut] != "undefined" && (
          e.altKey && modifier == "alt" ||
          e.ctrlKey && modifier == "control" ||
          e.metaKey && modifier == "meta"))
      {
        this.insertTemplate(this.mShortcuts[shortcut][0], this.mShortcuts[shortcut][1]);

        e.stopPropagation();
        e.preventDefault();
      }
    }
  }
,
  windowKeyDown: function(e)
  {
    var modifier = gQuicktext.shortcutModifier;
    if (!this.mShortcutModifierDown && gQuicktext.shortcutTypeAdv && (
        e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
        e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
        e.keyCode == e.DOM_VK_META && modifier == "meta"))
      this.mShortcutModifierDown = true;
  }
,
  windowKeyUp: function(e)
  {
    var modifier = gQuicktext.shortcutModifier;
    if (gQuicktext.shortcutTypeAdv && (
        e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
        e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
        e.keyCode == e.DOM_VK_META && modifier == "meta"))
    {
      if (this.mShortcutString != "" && typeof this.mShortcuts[this.mShortcutString] != "undefined")
      {
        this.insertTemplate(this.mShortcuts[this.mShortcutString][0], this.mShortcuts[this.mShortcutString][1]);

        e.stopPropagation();
        e.preventDefault();
      }

      this.mShortcutModifierDown = false;
      this.mShortcutString = "";
    }
  }
,
  editorKeyPress: function(e)
  {
    var key = (e.keyCode > 0) ? e.keyCode : e.charCode;

    if (key == gQuicktext.keywordKey)
    {
      var editor = GetCurrentEditor();
      var selection = editor.selection;

      if (!(selection.rangeCount > 0))
        return;

      editor.beginTransaction();
      var selecRange = selection.getRangeAt(0).cloneRange();


      // Ugly solution to just search to the beginning of the line.
      // I set the selection to the beginning of the line save the
      // range and then sets the selection back to was before.
      // Changing the selections was not visible to me. Most likly is
      // that is not even rendered

      var tmpRange = selecRange.cloneRange();
      tmpRange.collapse(false);
      editor.selection.removeAllRanges();
      editor.selection.addRange(tmpRange);

      editor.selectionController.intraLineMove(false, true);
      if (!(selection.rangeCount > 0))
      {
        editor.endTransaction();
        return;
      }

      var wholeRange = selection.getRangeAt(0).cloneRange();
      editor.selection.removeAllRanges();
      editor.selection.addRange(selecRange);

      var startRange = editor.document.createRange();
      startRange.setStart(wholeRange.endContainer, wholeRange.endOffset);
      startRange.setEnd(wholeRange.endContainer, wholeRange.endOffset);
      var endRange = editor.document.createRange();
      endRange.setStart(wholeRange.startContainer, wholeRange.startOffset);
      endRange.setEnd(wholeRange.startContainer, wholeRange.startOffset);

      var lastwordRange = editor.document.createRange();
      var found = false;
      var str = wholeRange.toString();
      if (str == "")
      {
        editor.endTransaction();
        return;
      }

      var foundRange;
      var finder = Components.classes["@mozilla.org/embedcomp/rangefind;1"].createInstance().QueryInterface(Components.interfaces.nsIFind);
      finder.findBackwards = true;
      if ((foundRange = finder.Find(" ", wholeRange, startRange, endRange)) != null)
      {
        found = true;
        if (foundRange.endContainer == selecRange.startContainer && foundRange.endOffset == selecRange.startOffset)
        {
          editor.endTransaction();
          return;
        }

        lastwordRange.setStart(foundRange.endContainer, foundRange.endOffset);
        lastwordRange.setEnd(selecRange.endContainer, selecRange.endOffset);
      }
      else
      {
        lastwordRange.setStart(wholeRange.startContainer, wholeRange.startOffset);
        lastwordRange.setEnd(selecRange.endContainer, selecRange.endOffset);
      }

      var lastword = lastwordRange.toString();
      var groupLength = gQuicktext.getGroupLength(false);

      var found = false;
      if (this.mKeywords.hasOwnProperty(lastword.toLowerCase()))
      {
        editor.selection.removeAllRanges();
        editor.selection.addRange(lastwordRange);

        var text = this.mKeywords[lastword.toLowerCase()];
        this.insertTemplate(text[0], text[1], false);

        found = true;
      }

      editor.endTransaction();
      if (found)
      {
        e.stopPropagation();
        e.preventDefault();
      }
    }
  },

  /*
   * OBSERVERS
   */
  observe: function(aSubject, aTopic, aData)
  {
    switch(aTopic)
    {
      case "updatesettings":
        this.updateGUI();
        break;
      case "updatetoolbar":
        this.visibleToolbar();
        break;
    }
  }
}
