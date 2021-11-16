var EXPORTED_SYMBOLS = ["wzQuicktextVar"];

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { quicktextUtils } = ChromeUtils.import("chrome://quicktext/content/modules/utils.jsm");
var { gQuicktext } = ChromeUtils.import("chrome://quicktext/content/modules/wzQuicktext.jsm");
var { MailServices } = ChromeUtils.import("resource:///modules/MailServices.jsm");

try {
  var { cardbookRepository } = ChromeUtils.import("chrome://cardbook/content/cardbookRepository.js");
} catch(e) {}

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
  parse: async function(aStr, aType)
  {
    // Reparse the text until there is no difference in the text
    // or that we parse 100 times (so we don't make an infinitive loop)
    var oldStr;
    var count = 0;

    do {
      count++;
      oldStr = aStr;
      aStr = await this.parseText(aStr, aType);
    } while (aStr != oldStr && count < 20);

    return aStr;
  }
,
  parseText: async function(aStr, aType)
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

      // if the method "get_[tagname]" exists and there is enough arguments we call it
      if (typeof this["get_"+ tags[i].tagName.toLowerCase()] == "function" && variable_limit >= 0 && tags[i].variables.length >= variable_limit) {
	      
        // these tags need different behaviour if added in "text" or "html" mode
        if (
          tags[i].tagName.toLowerCase() == "image" ||
          tags[i].tagName.toLowerCase() == "clipboard" ||
          tags[i].tagName.toLowerCase() == "selection")
        {
          value = await this["get_"+ tags[i].tagName.toLowerCase()](tags[i].variables, aType);
        } else {
          value = await this["get_"+ tags[i].tagName.toLowerCase()](tags[i].variables);
        }
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
  get_image: function(aVariables, aType)
  {
    if (aType == 1) {
      // image tag may only be added in html mode
      return this.process_image_content(aVariables);
    } else {
      return "";
    }
  }
,
  get_text: function(aVariables)
  {
    return this.process_text(aVariables);
  }
,
  get_script: async function(aVariables)
  {
    return await this.process_script(aVariables);
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
    gQuicktext.mCurrentTemplate.addHeader(aVariables[0], aVariables[1]);
    // return an empty string, to remove the header tags from the body.
    return "";
  }
,
  get_clipboard: function(aVariables, aType)
  {
    return TrimString(this.process_clipboard(aVariables, aType));
  }
,  
  get_selection: function(aVariables, aType)
  {
    return this.process_selection(aVariables, aType);
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
  get_url: async function(aVariables)
  {
    return await this.process_url(aVariables);
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
  get_counter: async function(aVariables)
  {
    return await this.process_counter(aVariables);
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
    if (aVariables.length > 0 && aVariables[0] != "")
    {
      // Tries to open the file and returning the content
      var fp = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      try {
        aVariables[0] = this.mQuicktext.parseFilePath(aVariables[0]);
        fp.initWithPath(aVariables[0]);
        let content = this.mQuicktext.readFile(fp);
        if (aVariables.length > 1 && aVariables[1].includes("strip_html_comments")) {
          return content.replace(/<!--[\s\S]*?(?:-->)/g, '');
        }
        return content;
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
  process_script: async function(aVariables)
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
          returnValue = await Components.utils.evalInSandbox("scriptObject = {}; scriptObject.mQuicktext = mQuicktext; scriptObject.mVariables = mVariables; scriptObject.mWindow = mWindow; scriptObject.run = async function() {\n" + script.script +"\n }; scriptObject.run();", s);
        } catch (e) {
          if (this.mWindow)
          {
            var lines = script.script.split("\n");
            
            // Takes the linenumber where the error where and remove
            // the line that it was run on so we get the line in the script
            // calculate it by using a reference error linenumber and an offset
            // offset: 10 lines between "variableNotAvailable" and "evalInSandbox"
            var lineNumber = e.lineNumber - referenceLineNumber - 10;
            this.mWindow.alert(gQuicktext.mStringBundle.GetStringFromName("scriptError") + " " + script.name + "\n" + e.name + ": "+ e.message + "\n" + gQuicktext.mStringBundle.GetStringFromName("scriptLine") + " " + lineNumber + ": " + lines[lineNumber-1]);
          }
        }

        return returnValue;
      }
    }

    //if we reach this point, the user requested an non-existing script
    this.mWindow.alert(gQuicktext.mStringBundle.formatStringFromName("scriptNotFound", [scriptName], 1))
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
      if (promptService.select(this.mWindow, gQuicktext.mStringBundle.GetStringFromName("inputTitle"), gQuicktext.mStringBundle.formatStringFromName("inputText", [aVariables[0]], 1), value.value, checkValue))
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
      if (promptService.prompt(this.mWindow, gQuicktext.mStringBundle.GetStringFromName("inputTitle"), gQuicktext.mStringBundle.formatStringFromName("inputText", [aVariables[0]], 1), value, null, checkValue))
        this.mData['INPUT'].data[aVariables[0]] = value.value;
      else
        this.mData['INPUT'].data[aVariables[0]] = "";
    }

    return this.mData['INPUT'].data;
  }
,
  process_selection: function(aVariables, aType)
  {
    if (aType == 0) {
      // return selected text as plain text
      return this.mQuicktext.mSelectionContent;
    } else {
      // return selected text as html
      return this.mQuicktext.mSelectionContentHtml;
    }
  }
,
  process_clipboard: function(aVariables, aType)
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
        // HTML templates: request the clipboard content as html first
        var clipboardHTMLfilled = 0;
        if (aType == 1)
        {
          trans.addDataFlavor("text/html");
          clip.getData(trans, clip.kGlobalClipboard);
          var clipboardHTML = {};
          try {
            trans.getTransferData("text/html", clipboardHTML);
            if (clipboardHTML)
            {
              clipboardHTML = clipboardHTML.value.QueryInterface(Components.interfaces.nsISupportsString);
              if (clipboardHTML)
              {
                this.mData['CLIPBOARD'].data = clipboardHTML.data;
                clipboardHTMLfilled = 1;
              }
            }
          }
          catch (e) { Components.utils.reportError(e); }
        }


        // HTML templates: request clipboard content as plain text, if requesting as html failed
        // Text templates: request clipboard content as plain text only
        if(clipboardHTMLfilled == 0)
        {
          trans.addDataFlavor("text/unicode");
          clip.getData(trans, clip.kGlobalClipboard);
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
    }

    return this.mData['CLIPBOARD'].data;
  }
,
  getcarddata_from: function(aData, aIdentity)
  {
    let passStandardCheck = false;
    try {
      let card = cardbookRepository.cardbookUtils.getCardFromEmail(aIdentity.email.toLowerCase());
      if (card)
      {
        aData['FROM'].data['firstname'] = TrimString(card.firstname);
        aData['FROM'].data['lastname'] = TrimString(card.lastname);
        aData['FROM'].data['displayname'] = TrimString(card.fn);
        aData['FROM'].data['nickname'] = TrimString(card.nickname);
        aData['FROM'].data['fullname'] = TrimString(cardbookRepository.cardbookUtils.getName(card));
        aData['FROM'].data['title'] = TrimString(card.title);
        aData['FROM'].data['workphone'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.worktype", false));
        aData['FROM'].data['faxnumber'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.faxtype", false));
        aData['FROM'].data['cellularnumber'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.celltype", false));
        aData['FROM'].data['custom1'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM1", false));
        aData['FROM'].data['custom2'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM2", false));
        aData['FROM'].data['custom3'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM3", false));
        aData['FROM'].data['custom4'] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM4", false));
        passStandardCheck = true;
      }
    } catch(e) {}

    if (!passStandardCheck)
    {
      let card = this.getCardForEmail(aIdentity.email.toLowerCase());
      if (card == null && aIdentity.escapedVCard != null)
      {
        const manager = Cc["@mozilla.org/addressbook/msgvcardservice;1"]
          .getService(Ci.nsIMsgVCardService)
        card = manager.escapedVCardToAbCard(aIdentity.escapedVCard);
      }
      if (card != null)
      {
        var props = this.getPropertiesFromCard(card);
        for (var p in props)
          this.mData['FROM'].data[p] = props[p];

        aData['FROM'].data['fullname'] = TrimString(aData['FROM'].data['firstname'] +" "+ aData['FROM'].data['lastname']);
      }
    }

    return aData;
  }
,
  process_from: function(aVariables)
  {
    if (this.mData['FROM'] && this.mData['FROM'].checked)
      return this.mData['FROM'].data;

    const identity = this.mWindow.gCurrentIdentity;

    this.mData['FROM'] = {};
    this.mData['FROM'].checked = true;
    this.mData['FROM'].data = {
      'email': identity.email,
      'displayname': identity.fullName,
      'firstname': '',
      'lastname': ''
    };

    this.mData = this.getcarddata_from(this.mData, identity);

    return this.mData['FROM'].data;
  }
,
  getcarddata_to: function(aData, aIndex)
  {
    let passStandardCheck = false;
    try {
      let card = cardbookRepository.cardbookUtils.getCardFromEmail(aData['TO'].data['email'][aIndex]);
      if (card)
      {
        aData['TO'].data['firstname'][aIndex] = TrimString(card.firstname);
        aData['TO'].data['lastname'][aIndex] = TrimString(card.lastname);
        aData['TO'].data['fullname'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getName(card));

        // others
        for (let prop of [ 'displayname', 'nickname', 'title', 'workphone', 'faxnumber', 'cellularnumber', 'custom1', 'custom2', 'custom3', 'custom4' ])
        {
          if (typeof aData['TO'].data[prop] == 'undefined')
            aData['TO'].data[prop] = []
        }
        aData['TO'].data['displayname'][aIndex] = TrimString(card.fn);
        aData['TO'].data['nickname'][aIndex] = TrimString(card.nickname);
        aData['TO'].data['title'][aIndex] = TrimString(card.title);
        aData['TO'].data['workphone'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.worktype", false));
        aData['TO'].data['faxnumber'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.faxtype", false));
        aData['TO'].data['cellularnumber'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "tel.0.celltype", false));
        aData['TO'].data['custom1'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM1", false));
        aData['TO'].data['custom2'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM2", false));
        aData['TO'].data['custom3'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM3", false));
        aData['TO'].data['custom4'][aIndex] = TrimString(cardbookRepository.cardbookUtils.getCardValueByField(card, "X-CUSTOM4", false));
        passStandardCheck = true;
        }
    } catch(e) {}

    if (!passStandardCheck)
    {
      // take card value, if it exists
      var card = this.getCardForEmail(aData['TO'].data['email'][aIndex]);
      if (card != null)
      {
        var props = this.getPropertiesFromCard(card);
        for (var p in props)
        {
          if (typeof aData['TO'].data[p] == 'undefined')
            aData['TO'].data[p] = []
          if (props[p] != "" || typeof aData['TO'].data[p][aIndex] == 'undefined' || aData['TO'].data[p][aIndex] == "")
            aData['TO'].data[p][aIndex] = TrimString(props[p]);
        }
      }
    }
    return aData;
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
    let emailAddresses = MailServices.headerParser.parseEncodedHeader(this.mWindow.gMsgCompose.compFields.to);

    if (emailAddresses.length > 0)
    {
      for (var i = 0; i < emailAddresses.length; i++)
      {
        // TODO: Add code for getting info about all people in a mailing list

        var k = this.mData['TO'].data['email'].length;
        this.mData['TO'].data['email'][k] = emailAddresses[i].email.toLowerCase();
        this.mData['TO'].data['fullname'][k] = TrimString(emailAddresses[i].name);
        this.mData['TO'].data['firstname'][k] = "";
        this.mData['TO'].data['lastname'][k] = "";

        this.mData = this.getcarddata_to(this.mData, k);
    
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
  process_url: async function(aVariables)
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
              data = await this["process_"+ tag]();
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
              data = await this["process_"+ tag]();
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
              data = await this["process_"+ tag]();
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
  process_counter: async function(aVariables)
  {
    if (this.mData['COUNTER'] && this.mData['COUNTER'].checked)
      return this.mData['COUNTER'].data;

    this.mData['COUNTER'] = {};
    this.mData['COUNTER'].checked = true;
    this.mData['COUNTER'].data = await this.mQuicktext.notifyTools.notifyBackground({command:"getPref", pref: "counter"});
    this.mData['COUNTER'].data++;
    await this.mQuicktext.notifyTools.notifyBackground({command:"setPref", pref: "counter", value: this.mData['COUNTER'].data});

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
    let directories = MailServices.ab.directories;
    for (let addrbook of directories)
    {
        let card = addrbook.cardForEmailAddress(aAddress);
        if (card) {
          return card;
        }
    }
    return null;
  }
,
  getPropertiesFromCard: function(card)
  {
    var retval = {}
    var props = card.properties;
    for (let prop of props)
    {
      retval[prop.name.toLowerCase()] = prop.value;
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
