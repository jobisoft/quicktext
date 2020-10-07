var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
var { wzQuicktextVar } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktextVar.jsm");
var gQuicktextVar = new wzQuicktextVar();

var { quicktextUtils } = ChromeUtils.import("chrome://quicktext/content/modules/utils.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

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
  mLoaded:                      false,
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
            document.getElementById(field).setAttribute("label", gQuicktext.mStringBundle.formatStringFromName(fieldtype, [quicktextUtils.dateTimeFormat(field, timeStamp)], 1));
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
      var length = toolbar.children.length;
      for(var i = length-1; i >= 0; i--)
      {
        var element = toolbar.children[i];
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
          var toolbarbuttonGroup;
          let t = document.createXULElement("button");
          if (textLength == 1 && gQuicktext.collapseGroup)
          {
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", gQuicktext.getText(i, 0, false).name);
            toolbarbuttonGroup.setAttribute("i", i);
            toolbarbuttonGroup.setAttribute("j", 0);
            toolbarbuttonGroup.setAttribute("class", "customEventListenerForDynamicMenu");
          }
          else
          {
            t.setAttribute("type", "menu");
            toolbarbuttonGroup = toolbar.appendChild(t);
            toolbarbuttonGroup.setAttribute("label", gQuicktext.getGroup(i, false).name);
            var menupopup = toolbarbuttonGroup.appendChild(document.createXULElement("menupopup"));

            //add second level elements: all found texts of this group
            for (var j = 0; j < textLength; j++)
            {
              var text = gQuicktext.getText(i, j, false);

              var toolbarbutton = document.createXULElement("menuitem");
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
      var spacer = document.createXULElement("spacer");
      spacer.setAttribute("flex", "1");
      toolbar.appendChild(spacer);
      toolbar.appendChild(toolbarbuttonVar);
      toolbar.appendChild(toolbarbuttonOther);

            
      // Update the toolbar inside the toolbarpalette and the drop-down menu - if used
      let optionalUI = ["button-quicktext", "quicktext-popup"];
      for (let a=0; a < optionalUI.length; a++) { 
        if (document.getElementById(optionalUI[a] + "-menupopup")) {
          let rootElement = document.getElementById(optionalUI[a] + "-menupopup");
          
          //clear
          let length = rootElement.children.length;
          for (let i = length-1; i >= 0; i--)
            rootElement.removeChild(rootElement.children[i]);

          //rebuild via copy from the quicktext toolbar - loop over toolbarbuttons inside toolbar
          for (let i = 0; i < toolbar.children.length; i++)
          {
            let menu = null;
            let node = toolbar.children[i];
            switch (node.nodeName)
            {
              case "toolbarbutton":
                // Check if the group is collapse or not
                if (node.getAttribute("type") == "menu")
                {
                  menu = document.createXULElement("menu");
                  menu.setAttribute("label", node.getAttribute("label"));
                  
                  let childs = node.querySelectorAll(":not(menu) > menupopup");                
                  for (let child of childs) {
                    menu.appendChild(child.cloneNode(true));
                  }
                }
                else
                {
                  menu = document.createXULElement("menuitem");
                  menu.setAttribute("label", node.getAttribute("label"));
                  menu.setAttribute("i", node.getAttribute("i"));
                  menu.setAttribute("j", node.getAttribute("j"));
                  menu.setAttribute("class", "customEventListenerForDynamicMenu");
                }
                rootElement.appendChild(menu);
                break;
              case "spacer":
                rootElement.appendChild(document.createXULElement("menuseparator"));
                break;
            }
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
    var settingsHandle = window.open("chrome://quicktext/content/settings.xhtml", "quicktextConfig", "chrome,resizable,centerscreen");
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
  insertVariable: async function(aVar)
  {
    gQuicktextVar.cleanTagData();
    await this.insertBody("[["+ aVar +"]] ", 0, true);
  }
,
  insertTemplate: async function(aGroupIndex, aTextIndex, aHandleTransaction = true)
  {
    //store selected content
    var editor = GetCurrentEditor();
    var selection = editor.selection;
    if (selection.rangeCount > 0) {
      // store the selected content as plain text
      gQuicktext.mSelectionContent = selection.toString();
      // store the selected content as html text
      gQuicktext.mSelectionContentHtml = editor.outputToString('text/html', 1);
    }
    
    if (gQuicktext.doTextExists(aGroupIndex, aTextIndex, false))
    {
      this.mLastFocusedElement = document.activeElement;
      gQuicktextVar.cleanTagData();

      var text = gQuicktext.getText(aGroupIndex, aTextIndex, false);
      text.removeHeaders();
      gQuicktext.mCurrentTemplate = text;

      // this parsing of the header informations isn't able to parse something like: [[HEADER=to|[[SCRIPT=getReciepients]]]]

      // // Parse text for HEADER tags and move them to the header object
      // let headers = text.text.match(/\[\[header=[^\]]*\]\]/ig);
      // if (headers && Array.isArray(headers)) {
      //   for (let header of headers) {
      //     let parts = header.split(/=|\]\]|\|/);
      //     if (parts.length==4) {
      //       text.addHeader(parts[1], parts[2]);
      //     }
      //   }
      // }
      
      this.insertSubject(text.subject);
      this.insertAttachments(text.attachments);

      if (text.text != "" && text.text.indexOf('[[CURSOR]]') > -1)
      {
        // only if we really have text to insert with a [[CURSOR]] tag,
        // focus the message body first
        this.focusMessageBody();
      }

      await this.insertBody(text.text, text.type, aHandleTransaction);

      // has to be inserted below "insertBody" as "insertBody" gathers the header data from the header tags
      this.insertHeaders(text);

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

      // Go through all recipientHeaders to remove duplicates
      var tmpRecipientHeaders = [];
      count = 0;
      for (var header in recipientHeaders)
      {
        if (recipientHeaders[header].length == 0)
          continue;

        tmpRecipientHeaders[header] = [];
        
        // Create an array of emailaddresses for this header that allready added
        let tmpEmailAddresses = MailServices.headerParser.parseEncodedHeader(gMsgCompose.compFields[convertHeaderToParse[header]]);
        let emailAddresses = [];
        for (let i = 0; i < tmpEmailAddresses.length; i++)
          emailAddresses.push(tmpEmailAddresses[i].email);

        // Go through all recipient of this header that I want to add
        for (var i = 0; i < recipientHeaders[header].length; i++)
        {
          // Get the mailaddresses of all the addresses
          let insertedAddresses = MailServices.headerParser.parseEncodedHeader(recipientHeaders[header][i]);
          for (var j = 0; j < insertedAddresses.length; j++)
          {
            if (insertedAddresses[j].email && !emailAddresses.includes(insertedAddresses[j].email))
            {
              tmpRecipientHeaders[header].push(insertedAddresses[j].toString());
              emailAddresses.push(insertedAddresses[j].email);
              count++;
            }
          }
        }
      }

      if (count > 0)
      {
        for (var header in tmpRecipientHeaders)
          for (var i = 0; i < tmpRecipientHeaders[header].length; i++)
            awAddRecipientsArray("addr_"+ convertHeaderToType[header], [tmpRecipientHeaders[header][i]], false);
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
    let editor = GetCurrentEditorElement();//document.getElementsByTagName("editor");
    if (editor) {
      editor.focus();
      this.mLastFocusedElement = editor;
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
  insertBody: async function(aStr, aType, aHandleTransaction)
  {
    if (aStr != "")
    {
      aStr = gQuicktextVar.parse(aStr, aType);

      if (aStr != "")
      {
        // Inserts the text
        if (aStr != "" && !aStr.match(/^\s+$/))
        {
          var editor = GetCurrentEditor();
          if (aHandleTransaction)
            editor.beginTransaction();
  
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
  
          try {
            if (aStr.indexOf('[[CURSOR]]') > -1)
            {
              // Take care of the CURSOR-tag
              await this.parseCursorTag(editor);
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
  parseCursorTag: async function(aEditor)
  {
    //Based on https://searchfox.org/comm-central/source/editor/ui/dialogs/content/EdReplace.js#255
    var searchRange = aEditor.document.createRange();
    var rootNode = aEditor.rootElement;
    searchRange.selectNodeContents(rootNode);    

    var startRange = aEditor.document.createRange();
    startRange.setStart(searchRange.startContainer, searchRange.startOffset);
    startRange.setEnd(searchRange.startContainer, searchRange.startOffset);
    var endRange = aEditor.document.createRange();
    endRange.setStart(searchRange.endContainer, searchRange.endOffset);
    endRange.setEnd(searchRange.endContainer, searchRange.endOffset);

    var finder = Components.classes["@mozilla.org/embedcomp/rangefind;1"].createInstance().QueryInterface(Components.interfaces.nsIFind);
    finder.caseSensitive = true;
    finder.findBackwards = false;

    let found = false;
    let failedSearchAttempts = 0;
    let foundRange = null;

    // Loop until all tags have been replaced, but limit the loop to 10 failed attempts.
    while (failedSearchAttempts < 30)
    {
      // Process the last found tag and update the search region.
      if (foundRange) {
        found = true;
        aEditor.selection.removeAllRanges();
        aEditor.selection.addRange(foundRange);
        aEditor.selection.deleteFromDocument();
        startRange.setEnd(foundRange.endContainer, foundRange.endOffset);
        startRange.setStart(foundRange.endContainer, foundRange.endOffset);
      }
      
      // Search.
      foundRange = finder.Find("[[CURSOR]]", searchRange, startRange, endRange);
      
      // If we have found at least one tag, but the last search failed, we are done.
      if (found && !foundRange) {
        break;
      }
      
      // If we have never found one, we might run into the "searched too early bug" and need to delay and try again
      if (!found && !foundRange) {
        await new Promise(resolve => setTimeout(resolve, 2));
        failedSearchAttempts++;
      }
    }

    if (!found)
    {
      console.log("CURSOR LOG Failed to find CURSOR tag!");
      aEditor.selection.removeAllRanges();
      aEditor.selection.addRange(endRange);
    } else {
      console.log("CURSOR LOG failedSearchAttempts : " + failedSearchAttempts);
    }
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
  insertContentFromFile: async function(aType)
  {
    if ((file = await gQuicktext.pickFile(window, aType, 0, gQuicktext.mStringBundle.GetStringFromName("insertFile"))) != null)
      await this.insertBody(gQuicktext.readFile(file), aType, true);
  }
,

  /*
   * KEYPRESS
   */
  windowKeyPress: async function(e)
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
        await this.insertTemplate(this.mShortcuts[shortcut][0], this.mShortcuts[shortcut][1]);

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
  windowKeyUp: async function(e)
  {
    var modifier = gQuicktext.shortcutModifier;
    if (gQuicktext.shortcutTypeAdv && (
        e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
        e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
        e.keyCode == e.DOM_VK_META && modifier == "meta"))
    {
      if (this.mShortcutString != "" && typeof this.mShortcuts[this.mShortcutString] != "undefined")
      {
        await this.insertTemplate(this.mShortcuts[this.mShortcutString][0], this.mShortcuts[this.mShortcutString][1]);

        e.stopPropagation();
        e.preventDefault();
      }

      this.mShortcutModifierDown = false;
      this.mShortcutString = "";
    }
  }
,
  editorKeyPress: async function(e)
  {
    if (e.code == gQuicktext.keywordKey)
    {
      var editor = GetCurrentEditor();
      var selection = editor.selection;

      if (!(selection.rangeCount > 0))
        return;

      // All operations between beginTransaction and endTransaction
      // are done "at once" as a single atomic action.
      editor.beginTransaction();
      
      // This gives us a range object of the currently selected text
      // and as the user usually does not have any text selected when
      // triggering keywords, it is a collapsed range at the current
      // cursor position.
      var initialSelectionRange = selection.getRangeAt(0).cloneRange();
      
      // Ugly solution to just search to the beginning of the line.
      // I set the selection to the beginning of the line save the
      // range and then sets the selection back to was before.
      // Changing the selections was not visible to me. Most likly is
      // that is not even rendered.
      var tmpRange = initialSelectionRange.cloneRange();
      tmpRange.collapse(false);
      editor.selection.removeAllRanges();
      editor.selection.addRange(tmpRange);

      editor.selectionController.intraLineMove(false, true);
      if (!(selection.rangeCount > 0))
      {
        editor.endTransaction();
        return;
      }

      // intraLineMove() extended the selection from the cursor to the
      // beginning of the line. We can get the last word by simply
      // chopping up its content.
      let lastWord = selection.toString().split(" ").pop();
      let lastWordIsKeyword = this.mKeywords.hasOwnProperty(lastWord.toLowerCase());

      // We now need to get a range, which covers the keyword,
      // as we want to replace it. So we clone the current selection
      // into a wholeRange and use nsIFind to find lastWord.
      var wholeRange = selection.getRangeAt(0).cloneRange();

      // Restore to the initialSelectionRange.
      editor.selection.removeAllRanges();
      editor.selection.addRange(initialSelectionRange);

      // If the last word is not a keyword, abort.
      if (!lastWordIsKeyword || !lastWord) {
        editor.endTransaction();
        return;
      }

      // Prepare a range for backward search.
      var startRange = editor.document.createRange();
      startRange.setStart(wholeRange.endContainer, wholeRange.endOffset);
      startRange.setEnd(wholeRange.endContainer, wholeRange.endOffset);
      var endRange = editor.document.createRange();
      endRange.setStart(wholeRange.startContainer, wholeRange.startOffset);
      endRange.setEnd(wholeRange.startContainer, wholeRange.startOffset);

      var finder = Components.classes["@mozilla.org/embedcomp/rangefind;1"].createInstance().QueryInterface(Components.interfaces.nsIFind);
      finder.findBackwards = true;
      var lastWordRange = finder.Find(lastWord, wholeRange, startRange, endRange);
      if (!lastWordRange) {
        // That should actually never happen, as we know the word is there.
        editor.endTransaction();
        return;
      }        
      
      // Replace the keyword.
      editor.selection.removeAllRanges();
      editor.selection.addRange(lastWordRange);
      var text = this.mKeywords[lastWord.toLowerCase()];
      editor.endTransaction();
      e.stopPropagation();
      e.preventDefault();

      await this.insertTemplate(text[0], text[1]);      
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
