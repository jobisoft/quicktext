var EXPORTED_SYMBOLS = ["wzQuicktextVar"];

let { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
let { quicktextUtils } = ChromeUtils.import("chrome://quicktext/content/modules/utils.jsm");
let { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
let { ConversionHelper } = ChromeUtils.import("chrome://quicktext/content/api/ConversionHelper/ConversionHelper.jsm");
let { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

const kDebug          = true;
const persistentTags  = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];
const allowedTags     = ['ATT', 'CLIPBOARD', 'COUNTER', 'DATE', 'FILE', 'IMAGE', 'FROM', 'INPUT', 'ORGATT', 'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION', 'SELECTION', 'HEADER'];

function streamListener(aInspector)
{
  var newStreamListener = {
    mAttachments: [],
    mHeaders: [],

    onStartRequest : function (aRequest, aContext)
    {
      this.mAttachments = [];
      this.mHeaders = [];

      var channel = aRequest.QueryInterface(Components.interfaces.nsIChannel);
      channel.URI.QueryInterface(Components.interfaces.nsIMsgMailNewsUrl);
      channel.URI.msgHeaderSink = this;  // adds this header sink interface to the channel
    },
    onStopRequest : function (aRequest, aContext, aStatusCode)
    {
      aInspector.exitNestedEventLoop();
    },
    onDataAvailable : function (aRequest, aContext, aInputStream, aOffset, aCount) {},
    onStartHeaders: function() {},
    onEndHeaders: function() {},
    processHeaders: function(aHeaderNameEnumerator, aHeaderValueEnumerator, aDontCollectAddress)
    {
      while (aHeaderNameEnumerator.hasMore())
        this.mHeaders.push({name:aHeaderNameEnumerator.getNext().toLowerCase(), value:aHeaderValueEnumerator.getNext()});
    },
    handleAttachment: function(aContentType, aUrl, aDisplayName, aUri, aIsExternalAttachment)
    {
      if (aContentType == "text/html") return;
      this.mAttachments.push({contentType:aContentType, url:aUrl, displayName:aDisplayName, uri:aUri, isExternal:aIsExternalAttachment});
    },
    onEndAllAttachments: function() {},
    onEndMsgDownload: function(aUrl) {},
    onEndMsgHeaders: function(aUrl) {},
    onMsgHasRemoteContent: function(aMsgHdr) {},
    getSecurityInfo: function() {},
    setSecurityInfo: function(aSecurityInfo) {},
    getDummyMsgHeader: function() {},

    QueryInterface : function(aIID)
    {
      if (aIID.equals(Components.interfaces.nsIStreamListener) ||
          aIID.equals(Components.interfaces.nsIMsgHeaderSink) ||
          aIID.equals(Components.interfaces.nsISupports))
        return this;

      throw Components.results.NS_NOINTERFACE;
      return 0;
    }
  };

  return newStreamListener;
}

function wzQuicktextVar()
{
  this.mData        = {};
  this.mWindow      = null;

  // Need the Main Quicktext component
  this.mQuicktext = gQuicktext;
}

wzQuicktextVar.prototype = {
  init: function(aWindow)
  {
    // Save the window we are in
    this.mWindow = aWindow;

    // New mail so we need to destroy all tag-data
    this.mData = {};
  }
,
  cleanTagData: function()
  {
    // Just save some of the tag-data.
    var tmpData = {};
    for (var i in this.mData)
    {
      if (persistentTags.indexOf(i) > -1)
        tmpData[i] = this.mData[i];
    }
    this.mData = tmpData;
  }
,
  parse: function(aStr, aType)
  {
    // Reparse the text until there is no difference in the text
    // or that we parse 100 times (so we don't make an infinitive loop)
    var oldStr;
    var count = 0;

    do {
      count++;
      oldStr = aStr;
      aStr = this.parseText(aStr, aType);
    } while (aStr != oldStr && count < 20);

    return aStr;
  }
,
  parseText: function(aStr, aType)
  {
    var tags = this.getTags(aStr);

    // If we don't find any tags there will be no changes to the string so return.
    if (tags.length == 0)
      return aStr;

    // Replace all tags with there right contents
    for (var i = 0; i < tags.length; i++)
    {
      var value = "";
      var variable_limit = -1;
      switch (tags[i].tagName.toLowerCase())
      {
        case 'att':
        case 'clipboard':
        case 'selection':
        case 'counter':
        case 'date':
        case 'subject':
        case 'time':
        case 'version':
        case 'orgatt':
          variable_limit = 0;
          break;
        case 'file':
        case 'image':
        case 'from':
        case 'input':
        case 'orgheader':
        case 'script':
        case 'to':
        case 'url':
          variable_limit = 1;
          break;
        case 'text':
        case 'header':
          variable_limit = 2;
          break;
      }

      if (tags[i].tagName.toLowerCase() == "image" && aType != 1) {
        // image tag may only be added in html mode
        value = "";
      } else if (typeof this["get_"+ tags[i].tagName.toLowerCase()] == "function" && variable_limit >= 0 && tags[i].variables.length >= variable_limit) {
        // if the method "get_[tagname]" exists and there is enough arguments we call it
        value = this["get_"+ tags[i].tagName.toLowerCase()](tags[i].variables);
      }
      
      aStr = this.replaceText(tags[i].tag, value, aStr);
    }

    return aStr;
  }
,
  getTags: function(aStr)
  {
    // We only get the beginning of the tag.
    // This is because we want to handle recursive use of tags.
    var rexp = new RegExp("\\[\\[(("+ allowedTags.join("|") +")(\\_[a-z]+)?)", "ig");
    var results = [];
    var result = null;
    while ((result = rexp.exec(aStr)))
      results.push(result);

    // If we don't found any tags we return
    if (results.length == 0)
      return [];

    // Take care of the tags starting with the last one
    var hits = [];
    results.reverse();
    var strLen = aStr.length;
    for (var i = 0; i < results.length; i++)
    {
      var tmpHit = {};
      tmpHit.tag = results[i][0];
      tmpHit.variables = [];

      // if the tagname contains a "_"-char that means
      // that is an old tag and we need to translate it
      // to a tagname and a variable
      var pos = results[i][1].indexOf("_");
      if (pos > 0)
      {
        tmpHit.variables.push(results[i][1].substr(pos+1).toLowerCase());
        tmpHit.tagName = results[i][1].substring(0,pos);
      }
      else
        tmpHit.tagName = results[i][1];

      // Get the end of the starttag
      pos = results[i].index + results[i][1].length + 2;

      // If the tag ended here we're done
      if (aStr.substr(pos, 2) == "]]")
      {
        tmpHit.tag += "]]";
        hits = this.addTag(hits, tmpHit);
      }
      // If there is arguments we get them
      else if (aStr[pos] == "=")
      {
        // We go through until we find ]] but we must have went
        // through the same amount of [ and ] before. So if there
        // is an tag in the middle we just jump over it.
        pos++;
        var bracketCount = 0;
        var ready = false;
        var vars = "";
        while (!ready && pos < strLen)
        {
          if (aStr[pos] == "[")
            bracketCount++;
          if (aStr[pos] == "]")
          {
            bracketCount--;
            if (bracketCount == -1 && aStr[pos+1] == "]")
            {
              ready = true;
              break;
            }
          }
          vars += aStr[pos];
          pos++;
        }

        // If we found the end we parses the arguments
        if (ready)
        {
          tmpHit.tag += "="+ vars +"]]";
          vars = vars.split("|");
          for (var j = 0; j < vars.length; j++)
            tmpHit.variables.push(vars[j]);

          // Adds the tag
          hits = this.addTag(hits, tmpHit);
        }
      }

      // We don't want to go over this tag again
      strLen = results[i].index;
    }

    hits.reverse();
    return hits;
  }
,
  // Checks if the tag isn't added before.
  // We just want to handle all unique tags once
  addTag: function(aTags, aNewTag)
  {
    for (var i = 0; i < aTags.length; i++)
      if (aTags[i].tag == aNewTag.tag)
        return aTags;

    aTags.push(aNewTag);
    return aTags;
  }
,

  // The get-functions takes the data from the process-functions and
  // returns string depending of what aVariables is

  get_file: function(aVariables)
  {
    return this.process_file(aVariables);
  }
,
  get_image: function(aVariables)
  {
    return this.process_image_content(aVariables);
  }
,
  get_text: function(aVariables)
  {
    return this.process_text(aVariables);
  }
,
  get_script: function(aVariables)
  {
    return this.process_script(aVariables);
  }
,
  get_att: function(aVariables)
  {
    var data = this.process_att(aVariables);

    if (data.length > 0)
    {
      var value = [];
      for (var i in data)
      {
        if (aVariables[0] == "full")
          value.push(data[i][0] +" ("+ this.niceFileSize(data[i][1]) +")");
        else
          value.push(data[i][0]);
      }

      if (aVariables.length < 2)
        aVariables[1] = ", ";

      return TrimString(value.join(aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t")));
    }

    return "";
  }
,
  get_input: function(aVariables)
  {
    var data = this.process_input(aVariables);

    if (typeof data[aVariables[0]] != "undefined")
      return data[aVariables[0]];

    return "";
  }
,
  get_header: function(aVariables)
  {
    // We do not do anything here but to return an empty string, 
    // to remove the header tags from the body.
    return "";
  }
,
  get_clipboard: function(aVariables)
  {
    return TrimString(this.process_clipboard(aVariables));
  }
,  
  get_selection: function(aVariables)
  {
    return TrimString(this.process_selection(aVariables));
  }
,
  get_from: function(aVariables)
  {
   var data = this.process_from(aVariables);

    if (typeof data[aVariables[0]] != 'undefined')
      return TrimString(data[aVariables[0]]);

    return "";
  }
,
  get_to: function(aVariables)
  {
    var data = this.process_to(aVariables);

    if (typeof data[aVariables[0]] != 'undefined')
    {
      // use ", " as default seperator
      let mainSep = (aVariables.length > 1) ? aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : ", ";
      let lastSep = (aVariables.length > 2) ? aVariables[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : mainSep;
      
      // clone the data, so we can work on it without mod the source object
      let entries = data[aVariables[0]].slice(0);
      let last = entries.pop();
      
      // build the final string
      let all = [];
      if (entries.length > 0) all.push(entries.join(mainSep));
      all.push(last);      
      return all.join(lastSep);
    }
    else
      return "";
  }
,
  get_url: function(aVariables)
  {
    return this.process_url(aVariables);
  }
,
  get_version: function(aVariables)
  {
    var data = this.process_version(aVariables);

    if (aVariables.length < 1)
      aVariables[0] = "full";
    if (typeof data[aVariables[0]] != 'undefined')
      return data[aVariables[0]];

    return "";
  }
,
  get_counter: function(aVariables)
  {
    return this.process_counter(aVariables);
  }
,
  get_subject: function(aVariables)
  {
    return this.process_subject(aVariables);
  }
,
  get_date: function(aVariables)
  {
    var data = this.process_date(aVariables);

    if (aVariables.length < 1)
      aVariables[0] = "short";
    if (typeof data[aVariables[0]] != 'undefined')
      return data[aVariables[0]];

    return "";
  }
,
  get_time: function(aVariables)
  {
    var data = this.process_time(aVariables);
    if (aVariables.length < 1)
      aVariables[0] = "noseconds";
    if (typeof data[aVariables[0]] != 'undefined')
      return data[aVariables[0]];

    return "";
  }
,
  get_orgheader: function(aVariables)
  {
    var data = this.process_orgheader(aVariables);

    aVariables[0] = aVariables[0].toLowerCase();
    if (typeof data[aVariables[0]] != 'undefined')
    {
      if (aVariables.length < 2)
        aVariables[1] = ", ";

      return data[aVariables[0]].join(aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
    }
    else
      return "";
  }
,
  get_orgatt: function(aVariables)
  {
    var data = this.process_orgatt(aVariables);

    if (typeof data != 'undefined')
    {
      if (aVariables.length == 0)
        aVariables[0] = ", ";
      return data['displayName'].join(aVariables[0].replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
    }

    return "";
  }
,
  // These process functions get the data and mostly saves it
  // in this.mData so if the data is requested again it is quick

  process_file: function(aVariables)
  {
    if (aVariables.length == 1 && aVariables[0] != "")
    {
      // Tries to open the file and returning the content
      var fp = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      try {
        aVariables[0] = this.mQuicktext.parseFilePath(aVariables[0]);
        fp.initWithPath(aVariables[0]);
        return this.mQuicktext.readFile(fp);
      } catch(e) { Components.utils.reportError(e); }
    }

    return "";
  }
,
  process_image_content: function(aVariables)
  {
    let rv = "";
    
    if (aVariables.length > 0 && aVariables[0] != "")
    {
      let mode = (aVariables.length > 1 && "src" == aVariables[1].toString().toLowerCase()) ? "src" : "tag";
      
      // Tries to open the file and returning the content
      try {
        let fp = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
        fp.initWithPath(this.mQuicktext.parseFilePath(aVariables[0]));
        let rawContent = this.mQuicktext.readBinaryFile(fp);
        let decoder = new TextDecoder('utf-8');
        let content = this.mWindow.btoa(rawContent);
        let type = this.mQuicktext.getTypeFromExtension(fp);
        let src = "data:" + type + ";filename=" + fp.leafName + ";base64," + content;
        rv = (mode == "tag") 
                ? "<img src='"+src+"'>"
                : src;
      } catch(e) { 
        Components.utils.reportError(e); 
      }
    }

    return rv;
  }
,
  process_text: function(aVariables)
  {
    if (aVariables.length != 2)
      return "";

    // Looks after the group and text-name and returns
    // the text from it
    var groupLength = this.mQuicktext.getGroupLength(false);
    for (var j = 0; j < groupLength; j++)
    {
      if (aVariables[0] == this.mQuicktext.getGroup(j, true).name)
      {
        var textLength = this.mQuicktext.getTextLength(j, false);
        for (var k = 0; k < textLength; k++)
        {
          var text = this.mQuicktext.getText(j, k, false);
          if (aVariables[1] == text.name)
          {
            return text.text;
          }
        }
      }
    }

    return "";
  }
,
  process_script: function(aVariables)
  {
    if (aVariables.length == 0)
      return "";
    
    var scriptName = aVariables.shift();

    // Looks through all scripts and tries to find the 
    // one we look for
    var scriptLength = this.mQuicktext.getScriptLength(false);
    for (var i = 0; i < scriptLength; i++)
    {
      var script = this.mQuicktext.getScript(i, false);
      if (script.name == scriptName)
      {
        let returnValue = "";
        
        var referenceLineNumber = 0
        try {
          var error = variableNotAvailable; // provoke an error to create a reference for the other linenumber
        } catch (eReference) {
          referenceLineNumber = eReference.lineNumber;
        }
        
        try {
          var s = Components.utils.Sandbox(this.mWindow);
          s.mQuicktext = this;
          s.mVariables = aVariables;
          s.mWindow = this.mWindow;
          returnValue = Components.utils.evalInSandbox("scriptObject = {}; scriptObject.mQuicktext = mQuicktext; scriptObject.mVariables = mVariables; scriptObject.mWindow = mWindow; scriptObject.run = function() {\n" + script.script +"\nreturn ''; }; scriptObject.run();", s);
        } catch (e) {
          if (this.mWindow)
          {
            var lines = script.script.split("\n");
            
            // Takes the linenumber where the error where and remove
            // the line that it was run on so we get the line in the script
            // calculate it by using a reference error linenumber and an offset
            // offset: 10 lines between "variableNotAvailable" and "evalInSandbox"
            var lineNumber = e.lineNumber - referenceLineNumber - 10;
            this.mWindow.alert(ConversionHelper.i18n.getMessage("scriptError") + " " + script.name + "\n" + e.name + ": "+ e.message + "\n" + ConversionHelper.i18n.getMessage("scriptLine") + " " + lineNumber + ": " + lines[lineNumber-1]);
          }
        }

        return returnValue;
      }
    }

    //if we reach this point, the user requested an non-existing script
    this.mWindow.alert(ConversionHelper.i18n.getMessage("scriptNotFound", [scriptName]))
    return "";
  }
,
  process_att: function(aVariables)
  {
    if (this.mData['ATT'] && this.mData['ATT'].checked)
      return this.mData['ATT'].data;

    this.mData['ATT'] = {};
    this.mData['ATT'].checked = true;
    this.mData['ATT'].data = [];

    // To get the attachments we look in the attachment-field
    // in compose-window.

    var bucket = this.mWindow.document.getElementById("attachmentBucket");
    for (var index = 0; index < bucket.getRowCount(); index++)
    {
      var item = bucket.getItemAtIndex(index);
      var attachment = item.attachment;
      if (attachment)
      {
        var ios = Components.classes["@mozilla.org/network/io-service;1"].getService(Components.interfaces.nsIIOService);
        var fileHandler = ios.getProtocolHandler("file").QueryInterface(Components.interfaces.nsIFileProtocolHandler);
        try {
          var file = fileHandler.getFileFromURLSpec(attachment.url);
          if (file.exists())
            this.mData['ATT'].data.push([attachment.name, file.fileSize]);
        }
        catch(e)
        {
          this.mData['ATT'].data.push([attachment.name]);
        }
      }
    }

    return this.mData['ATT'].data;
  }
,
  process_input: function(aVariables)
  {
    if (typeof this.mData['INPUT'] == 'undefined')
      this.mData['INPUT'] = {};
    if (typeof this.mData['INPUT'].data == 'undefined')
      this.mData['INPUT'].data = {};

    if (typeof this.mData['INPUT'].data[aVariables[0]] != 'undefined')
      return this.mData['INPUT'].data;

    // There are two types of input select and text.
    var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"].getService(Components.interfaces.nsIPromptService);
    if (aVariables[1] == 'select')
    {
      var checkValue = {};
      var value = {};
      if (typeof aVariables[2] != 'undefined')
         value.value = aVariables[2].split(";");
      if (promptService.select(this.mWindow, ConversionHelper.i18n.getMessage("inputTitle"), ConversionHelper.i18n.getMessage("inputText", [aVariables[0]]), value.value.length, value.value, checkValue))
        this.mData['INPUT'].data[aVariables[0]] = value.value[checkValue.value];
      else
        this.mData['INPUT'].data[aVariables[0]] = "";
    }
    else
    {
      var checkValue = {};      
      var value = {};
      if (typeof aVariables[2] != 'undefined')
        value.value = aVariables[2];
      if (promptService.prompt(this.mWindow, ConversionHelper.i18n.getMessage("inputTitle"), ConversionHelper.i18n.getMessage("inputText", [aVariables[0]]), value, null, checkValue))
        this.mData['INPUT'].data[aVariables[0]] = value.value;
      else
        this.mData['INPUT'].data[aVariables[0]] = "";
    }

    return this.mData['INPUT'].data;
  }
,
  process_selection: function(aVariables)
  {
    return this.mQuicktext.mSelectionContent;
  }
,
  process_clipboard: function(aVariables)
  {
    if (this.mData['CLIPBOARD'] && this.mData['CLIPBOARD'].checked)
      return this.mData['CLIPBOARD'].data;

    this.mData['CLIPBOARD'] = {};
    this.mData['CLIPBOARD'].checked = true;
    this.mData['CLIPBOARD'].data = "";

    // Gets the data from the clipboard
    var clip = Components.classes["@mozilla.org/widget/clipboard;1"].createInstance(Components.interfaces.nsIClipboard);
    if (clip)
    {
      var trans = Components.classes["@mozilla.org/widget/transferable;1"].createInstance(Components.interfaces.nsITransferable);
      if (trans)
      {
        trans.addDataFlavor("text/unicode");
        clip.getData(trans,clip.kGlobalClipboard);

        var clipboard = {};
        try {
          trans.getTransferData("text/unicode", clipboard);
          if (clipboard)
          {
            clipboard = clipboard.value.QueryInterface(Components.interfaces.nsISupportsString);
            if (clipboard)
              this.mData['CLIPBOARD'].data = clipboard.data;
          }
        }
        catch (e) { Components.utils.reportError(e); }
      }
    }

    return this.mData['CLIPBOARD'].data;
  }
,
  process_from: function(aVariables)
  {
    if (this.mData['FROM'] && this.mData['FROM'].checked)
      return this.mData['FROM'].data;

    const identity = this.mWindow.getCurrentIdentity();

    this.mData['FROM'] = {};
    this.mData['FROM'].checked = true;
    this.mData['FROM'].data = {
      'email': identity.email,
      'displayname': identity.fullName,
      'firstname': '',
      'lastname': ''
    };

    let card = this.getCardForEmail(identity.email.toLowerCase());
    if (card == null && identity.escapedVCard != null)
    {
      const manager = Components.classes["@mozilla.org/abmanager;1"]
        .getService(Components.interfaces.nsIAbManager);
      card = manager.escapedVCardToAbCard(identity.escapedVCard);
    }
    if (card != null)
    {
      var props = this.getPropertiesFromCard(card);
      for (var p in props)
        this.mData['FROM'].data[p] = props[p];

      this.mData['FROM'].data['fullname'] = TrimString(this.mData['FROM'].data['firstname'] +" "+ this.mData['FROM'].data['lastname']);
    }

    return this.mData['FROM'].data;
  }
,
  process_to: function(aVariables)
  {
    if (this.mData['TO'] && this.mData['TO'].checked)
      return this.mData['TO'].data;

    this.mData['TO'] = {};
    this.mData['TO'].checked = true;
    this.mData['TO'].data = {
      'email': [],
      'firstname': [],
      'lastname': [],
      'fullname': []
    };

    this.mWindow.Recipients2CompFields(this.mWindow.gMsgCompose.compFields);
    var emailAddresses = {};
    var names = {};
    var fullAddresses = {};

    var numOfAddresses = MailServices.headerParser.parseHeadersWithArray(this.mWindow.gMsgCompose.compFields.to, emailAddresses, names, fullAddresses);

    if (numOfAddresses > 0)
    {
      for (var i = 0; i < numOfAddresses; i++)
      {
        // TODO: Add code for getting info about all people in a mailing list

        var k = this.mData['TO'].data['email'].length;
        this.mData['TO'].data['email'][k] = emailAddresses.value[i].toLowerCase();
        this.mData['TO'].data['fullname'][k] = TrimString(names.value[i]);
        this.mData['TO'].data['firstname'][k] = "";
        this.mData['TO'].data['lastname'][k] = "";

        // take card value, if it exists
        var card = this.getCardForEmail(this.mData['TO'].data['email'][k]);
        if (card != null)
        {
          var props = this.getPropertiesFromCard(card);
          for (var p in props)
          {
            if (typeof this.mData['TO'].data[p] == 'undefined')
              this.mData['TO'].data[p] = []
            if (props[p] != "" || typeof this.mData['TO'].data[p][k] == 'undefined' || this.mData['TO'].data[p][k] == "")
              this.mData['TO'].data[p][k] = TrimString(props[p]);
          }
        }
    
        let validParts = [this.mData['TO'].data['firstname'][k], this.mData['TO'].data['lastname'][k]].filter(e => e.trim() != "");
        if (validParts.length == 0) {
          // if no first and last name, generate them from fullname
          let parts =  this.mData['TO'].data['fullname'][k].replace(/,/g, ", ").split(" ").filter(e => e.trim() != "");
          this.mData['TO'].data['firstname'][k] = parts.length > 1 ? TrimString(parts.splice(0, 1)) : "";
          this.mData['TO'].data['lastname'][k] = TrimString(parts.join(" "));
        } else {
          // if we have a first and/or last name (which can only happen if read from card), generate fullname from it
          this.mData['TO'].data['fullname'][k] = validParts.join(" ");          
        }
        
        // swap names if wrong
        if (this.mData['TO'].data['firstname'][k].endsWith(","))
        {
          let temp_firstname = this.mData['TO'].data['firstname'][k].replace(/,/g, "");			  
          let temp_lastname = this.mData['TO'].data['lastname'][k];			  
          this.mData['TO'].data['firstname'][k] = temp_lastname;
          this.mData['TO'].data['lastname'][k] = temp_firstname;
          // rebuild fullname
          this.mData['TO'].data['fullname'][k] = [this.mData['TO'].data['firstname'][k], this.mData['TO'].data['lastname'][k]].join(" ");
        }
      }
    }

    return this.mData['TO'].data;
  }
,
  process_url: function(aVariables)
  {
    if (aVariables.length == 0)
      return "";

    var url = aVariables.shift();

    if (url != "")
    {
      var debug = false;
      var method = "post";
      var post = [];
      
      if (aVariables.length > 0)
      {
        var variables = aVariables.shift().split(";");
        for (var k = 0; k < variables.length; k++)
        {
          var tag = variables[k].toLowerCase();
          var data = null;

          switch (tag)
          {
            case 'to':
            case 'att':
            case 'orgheader':
            case 'orgatt':
              data = this["process_"+ tag]();
              if (typeof data != 'undefined')
              {
                for (var i in data)
                  for (var j in data[i])
                    post.push(tag +'['+ i +']['+ j +']='+ data[i][j]);
              }
              break;
            case 'from':
            case 'version':
            case 'date':
            case 'time':
              data = this["process_"+ tag]();
              if (typeof data != 'undefined')
              {
                for (var i in data)
                  post.push(tag +'['+ i +']='+ data[i]);
              }
              break;
            case 'subject':
            case 'clipboard':
            case 'selection':
            case 'counter':
              data = this["process_"+ tag]();
              if (typeof data != 'undefined')
                post.push(tag +'='+ data);
              break;

            case 'post':
            case 'get':
            case 'options':
              method = tag;
              break;

            case 'debug':
              debug = true;
              break;
          }
        }
      }

      var req = new XMLHttpRequest();
      req.open(method, url, true);
      if (method == "post") req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
      let response = "";

      //Lazy async-to-sync implementation with ACK from Philipp Kewisch
      //http://lists.thunderbird.net/pipermail/maildev_lists.thunderbird.net/2018-June/001205.html
      let inspector = Components.classes["@mozilla.org/jsinspector;1"].createInstance(Components.interfaces.nsIJSInspector);
      
      req.ontimeout = function () {
        if (debug) response = "Quicktext timeout";
        inspector.exitNestedEventLoop();
      };

      req.onerror = function () {
        if (debug) response = "error (" + req.status + ")";
        inspector.exitNestedEventLoop();
      };

      req.onload = function() {
        if (req.status == 200) response = req.responseText;
        else 	if (debug) response = "error (" + req.status + ")";
        inspector.exitNestedEventLoop();
      };

      if (method == "post") req.send(post.join("&"));
      else req.send();

      inspector.enterNestedEventLoop(0); /* wait for async process to terminate */
      return response;
    }

    return "";
  }
,
  process_version: function(aVariables)
  {
    if (this.mData['VERSION'] && this.mData['VERSION'].checked)
      return this.mData['VERSION'].data;

    this.mData['VERSION'] = {};
    this.mData['VERSION'].checked = true;
    this.mData['VERSION'].data = {};
	  this.mData['VERSION'].data['number'] = Services.appinfo.version;
	  this.mData['VERSION'].data['full'] = Services.appinfo.name + ' ' + Services.appinfo.version;

    return this.mData['VERSION'].data;
  }
,
  process_counter: function(aVariables)
  {
    if (this.mData['COUNTER'] && this.mData['COUNTER'].checked)
      return this.mData['COUNTER'].data;

    this.mData['COUNTER'] = {};
    this.mData['COUNTER'].checked = true;
    this.mData['COUNTER'].data = 0;

    gQuicktext.mCounter++;
    this.mData['COUNTER'].data = gQuicktext.mCounter;
    // async fire-and-forget
    ConversionHelper.setPref("counter", gQuicktext.mCounter);

    return this.mData['COUNTER'].data;
  }
,
  process_subject: function(aVariables)
  {
    if (this.mData['SUBJECT'] && this.mData['SUBJECT'].checked)
      return this.mData['SUBJECT'].data;

    this.mData['SUBJECT'] = {};
    this.mData['SUBJECT'].checked = true;
    this.mData['SUBJECT'].data = "";

    if (this.mWindow.document.getElementById('msgSubject'))
      this.mData['SUBJECT'].data = this.mWindow.document.getElementById('msgSubject').value;

    return this.mData['SUBJECT'].data;
  }
,
  process_date: function(aVariables)
  {
    if (this.mData['DATE'] && this.mData['DATE'].checked)
      return this.mData['DATE'].data;

    this.preprocess_datetime();
    return this.mData['DATE'].data;
  }
,
  process_time: function(aVariables)
  {
    if (this.mData['TIME'] && this.mData['TIME'].checked)
      return this.mData['TIME'].data;

    this.preprocess_datetime();
    return this.mData['TIME'].data;
  }
,
  process_orgheader: function(aVariables)
  {
    if (this.mData['ORGHEADER'] && this.mData['ORGHEADER'].checked)
      return this.mData['ORGHEADER'].data;

    this.preprocess_org();
    return this.mData['ORGHEADER'].data;
  }
,
  process_orgatt: function(aVariables)
  {
    if (this.mData['ORGATT'] && this.mData['ORGATT'].checked)
      return this.mData['ORGATT'].data;

    this.preprocess_org();
    return this.mData['ORGATT'].data;
  }
,
  preprocess_datetime: function()
  {
    this.mData['DATE'] = {};
    this.mData['DATE'].checked = true;
    this.mData['DATE'].data = {};
    this.mData['TIME'] = {};
    this.mData['TIME'].checked = true;
    this.mData['TIME'].data = {};

    var timeStamp = new Date();
    let fields = ["DATE-long", "DATE-short", "DATE-monthname", "TIME-seconds", "TIME-noseconds"];
    for (let i=0; i < fields.length; i++) {
        let field = fields[i];
        let fieldinfo = field.split("-");
        this.mData[fieldinfo[0]].data[fieldinfo[1]] = TrimString(quicktextUtils.dateTimeFormat(field, timeStamp));
    }
 }
,
  preprocess_org: function()
  {
    this.mData['ORGHEADER'] = {};
    this.mData['ORGHEADER'].checked = true;
    this.mData['ORGHEADER'].data = {};

    this.mData['ORGATT'] = {};
    this.mData['ORGATT'].checked = true;
    this.mData['ORGATT'].data = {contentType:[], url:[], displayName:[], uri:[], isExternal:[]};

    var msgURI = this.mWindow.gMsgCompose.originalMsgURI;
    if (!msgURI || msgURI == "")
      return;

    var messenger = Components.classes["@mozilla.org/messenger;1"].createInstance(Components.interfaces.nsIMessenger);
    var mms = messenger.messageServiceFromURI(msgURI).QueryInterface(Components.interfaces.nsIMsgMessageService);

    //Lazy async-to-sync implementation with ACK from Philipp Kewisch
    //http://lists.thunderbird.net/pipermail/maildev_lists.thunderbird.net/2018-June/001205.html
    let inspector = Components.classes["@mozilla.org/jsinspector;1"].createInstance(Components.interfaces.nsIJSInspector);
    let listener = streamListener(inspector);
    mms.streamMessage(msgURI, listener, null, null, true, "filter");

    //lazy async, wait for listener
    inspector.enterNestedEventLoop(0); /* wait for async process to terminate */

    // Store all headers in the mData-variable
    for (var i = 0; i < listener.mHeaders.length; i++)
    {
      var name = listener.mHeaders[i].name;
      if (typeof this.mData['ORGHEADER'].data[name] == 'undefined')
        this.mData['ORGHEADER'].data[name] = [];
      this.mData['ORGHEADER'].data[name].push(listener.mHeaders[i].value);
    }

    // Store all attachments in the mData-variable
    for (var i = 0; i < listener.mAttachments.length; i++)
    {
      var attachment = listener.mAttachments[i];
      for (var fields in attachment)
        this.mData['ORGATT'].data[fields][i] = attachment[fields];
    }
  }
,
  escapeRegExp: function(aStr)
  {
    return aStr.replace(/([\^\$\_\.\\\[\]\(\)\|\+\?])/g, "\\$1");
  }
,
  replaceText: function(tag, value, text)
  {
    var replaceRegExp;
    if (value != "")
      replaceRegExp = new RegExp(this.escapeRegExp(tag), 'g');
    else
      replaceRegExp = new RegExp("( )?"+ this.escapeRegExp(tag), 'g');
    return text.replace(replaceRegExp, value);
  }
,
  niceFileSize: function(size)
  {
    var unit = ["B", "kB", "MB", "GB", "TB"];
    var i = 0;
    while (size > 1024)
    {
      i++;
      size = size / 1024;
    }
    return (Math.round(size * 100) / 100) + " " + unit[i];
  }
,
  getCardForEmail: function(aAddress) {
    // The Thunderbird way
    if ("@mozilla.org/abmanager;1" in Components.classes)
    {
      let enumerator = Components.classes["@mozilla.org/abmanager;1"]
        .getService(Components.interfaces.nsIAbManager)
        .directories;

      let cardForEmailAddress;
      let addrbook;
      while (!cardForEmailAddress && enumerator.hasMoreElements())
      {
        addrbook = enumerator.getNext().QueryInterface(Components.interfaces.nsIAbDirectory);
        try
        {
          card = addrbook.cardForEmailAddress(aAddress);
          if (card)
            return card;
        } catch (ex) {}
      }

      return null;
    }

    // Fallback to old way for Postbox. This does actually not work. databases will be empty but there is no errors
    var databases = [];
    var directories = [];
    var rdfService = Components.classes["@mozilla.org/rdf/rdf-service;1"].getService(Components.interfaces.nsIRDFService);
    var directory = rdfService.GetResource("moz-abdirectory://").QueryInterface(Components.interfaces.nsIAbDirectory);
    var addressBook = Components.classes["@mozilla.org/addressbook;1"].getService(Components.interfaces.nsIAddressBook);

    var cn = directory.childNodes;
    while (cn.hasMoreElements())
    {
      var abook = cn.getNext();
      if (abook instanceof Components.interfaces.nsIAbDirectory)
      {
        // abook.URI only exists in 3.0 so fallback so it works on other versions also
        var uri = (abook.URI) ? abook.URI : abook.directoryProperties.URI;

        try {
          databases.push(addressBook.getAbDatabaseFromURI(uri));
          directories.push(abook);
        } catch(e) { Components.utils.reportError(e); }
      }
    }

    Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService).logStringMessage("DATABASES: "+ databases.length);

    for (var databaseIndex = 0; databaseIndex < databases.length; databaseIndex++)
    {
      var card = databases[databaseIndex].getCardFromAttribute(directories[databaseIndex], "LowercasePrimaryEmail", aAddress, true);
      Components.classes["@mozilla.org/consoleservice;1"].getService(Components.interfaces.nsIConsoleService).logStringMessage("card: "+ card);
      if (card)
        return card;
    }

    return null;
  }
,
  getPropertiesFromCard: function(card)
  {
    var retval = {}
    // New stuff in Thunderbird 3.0
    if (card.properties) {
      var props = card.properties;
      while (props.hasMoreElements())
      {
        var prop = props.getNext().QueryInterface(Components.interfaces.nsIProperty);
        retval[prop.name.toLowerCase()] = prop.value;
      }
    } else {
      for (var name in card) {
        if (typeof card[name] != 'function')
          retval[name.toLowerCase()] = card[name];
      }
    }
    return retval;
  }
,
  removeBadHTML: function (aStr)
  {
    // Remove the head-tag
    aStr = aStr.replace(/<head(| [^>]*)>.*<\/head>/gim, '');

    // Remove html and body tags
    aStr = aStr.replace(/<(|\/)(head|body)(| [^>]*)>/gim, '');

    return aStr;
  }
}


var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};


function TrimString(aStr)
{
  if (!aStr) return "";
  return aStr.toString().replace(/(^\s+)|(\s+$)/g, '')
}
