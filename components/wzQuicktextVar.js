Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

const kDebug          = true;
const persistentTags  = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];
const allowedTags     = ['ATT', 'CLIPBOARD', 'COUNTER', 'DATE', 'FILE', 'FROM', 'INPUT', 'ORGATT', 'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION'];

function streamListener()
{
  var newStreamListener = {
    mAttachments: [],
    mHeaders:     [],
    mBusy:        true,

    onStartRequest : function (aRequest, aContext)
    {
      this.mAttachments = [];
      this.mHeaders     = [];
      this.mBusy        = true;

      var channel = aRequest.QueryInterface(Components.interfaces.nsIChannel);
      channel.URI.QueryInterface(Components.interfaces.nsIMsgMailNewsUrl);
      channel.URI.msgHeaderSink = this;  // adds this header sink interface to the channel
    },
    onStopRequest : function (aRequest, aContext, aStatusCode)
    {
      this.mBusy = false;  // if needed, you can poll this var to see if we are done collecting attachment details
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
  this.mQuicktext = Components.classes["@hesslow.se/quicktext/main;1"].getService(Components.interfaces.wzIQuicktext);

  // Add prefs for preferences
  this.mPrefService = Components.classes["@mozilla.org/preferences-service;1"].getService(Components.interfaces.nsIPrefService);
  this.mPrefBranch = this.mPrefService.getBranch("quicktext.");
}

wzQuicktextVar.prototype = {
  classID:          Components.ID("{baf42192-e051-4319-956d-1e1f2a81077e}"),
  classDescription: "Quicktext Variables",
  contractID:       "@hesslow.se/quicktext/variables;1",
  QueryInterface:   XPCOMUtils.generateQI([Components.interfaces.wzIQuicktextVar, Components.interfaces.nsISupports])
,
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
  parse: function(aStr)
  {
    // Reparse the text until there is no difference in the text
    // or that we parse 100 times (so we don't make an infinitive loop)
    var oldStr;
    var count = 0;

    do {
      count++;
      oldStr = aStr;
      aStr = this.parseText(aStr);
    } while (aStr != oldStr && count < 20);

    return aStr;
  }
,
  parseText: function(aStr)
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
        case 'counter':
        case 'date':
        case 'subject':
        case 'time':
        case 'version':
          variable_limit = 0;
          break;
        case 'file':
        case 'from':
        case 'input':
        case 'orgatt':
        case 'orgheader':
        case 'script':
        case 'to':
        case 'url':
          variable_limit = 1;
          break;
        case 'text':
          variable_limit = 2;
          break;
      }

      // if the method "get_[tagname]" exists and there is enough arguments we call it
      if (typeof this["get_"+ tags[i].tagName.toLowerCase()] == "function" && variable_limit >= 0 && tags[i].variables.length >= variable_limit)
        value = this["get_"+ tags[i].tagName.toLowerCase()](tags[i].variables);
      else
        value = "";

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
  get_clipboard: function(aVariables)
  {
    return TrimString(this.process_clipboard(aVariables));
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
      if (aVariables.length < 2)
        aVariables[1] = ", ";

      return data[aVariables[0]].join(aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t"));
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
      } catch(e) {}
    }

    return "";
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
        returnValue = "";
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
            var lineNumber = e.lineNumber-543;
            this.mWindow.alert("You have an error in your script: "+ script.name +"\n"+ e.name +": "+ e.message +"\nLine ("+ lineNumber +"): "+ lines[lineNumber-1] );
          }
        }

        return returnValue;
      }
    }

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
      if (promptService.select(this.mWindow, this.mWindow.quicktext.mStringBundle.getString("inputTitle"), this.mWindow.quicktext.mStringBundle.getFormattedString("inputText", [aVariables[0]]), value.value.length, value.value, checkValue))
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
      if (promptService.prompt(this.mWindow, this.mWindow.quicktext.mStringBundle.getString("inputTitle"), this.mWindow.quicktext.mStringBundle.getFormattedString("inputText", [aVariables[0]]), value, null, checkValue))
        this.mData['INPUT'].data[aVariables[0]] = value.value;
      else
        this.mData['INPUT'].data[aVariables[0]] = "";
    }

    return this.mData['INPUT'].data;
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
        var clipboardLength = {};
        try {
          trans.getTransferData("text/unicode", clipboard, clipboardLength);
          if (clipboard)
          {
            clipboard = clipboard.value.QueryInterface(Components.interfaces.nsISupportsString);
            if (clipboard)
              this.mData['CLIPBOARD'].data = clipboard.data.substring(0,clipboardLength.value / 2);
          }
        }
        catch (e) {}
      }
    }

    return this.mData['CLIPBOARD'].data;
  }
,
  process_from: function(aVariables)
  {
    if (this.mData['FROM'] && this.mData['FROM'].checked)
      return this.mData['FROM'].data;

    this.mData['FROM'] = {};
    this.mData['FROM'].checked = true;
    this.mData['FROM'].data = {
      'email': this.mWindow.getCurrentIdentity().email,
      'firstname': '',
      'lastname': ''
    };

    var card = this.getCardForEmail(this.mData['FROM'].data['email'].toLowerCase());
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
    var parser = Components.classes["@mozilla.org/messenger/headerparser;1"]
                           .getService(Components.interfaces.nsIMsgHeaderParser);
    var emailAddresses = {};
    var names = {};
    var fullAddresses = {};

    var numOfAddresses = parser.parseHeadersWithArray(this.mWindow.gMsgCompose.compFields.to, emailAddresses, names, fullAddresses);

    if (numOfAddresses > 0)
    {
      for (var i = 0; i < numOfAddresses; i++)
      {
        // TODO: Add code for getting info about all people in a mailing list

        var k = this.mData['TO'].data['email'].length;
        this.mData['TO'].data['email'][k] = emailAddresses.value[i];
        this.mData['TO'].data['firstname'][k] = "";
        this.mData['TO'].data['lastname'][k] = "";

        var name = names.value[i];
        if (name)
        {
          if (name.indexOf(",") > -1)
          {
            let tempnames = name.split(",");
            this.mData['TO'].data['lastname'][k] = tempnames.splice(0, 1);
            this.mData['TO'].data['firstname'][k] = tempnames.join(",");
          }
          else
          {
            let tempnames = name.split(" ");
            this.mData['TO'].data['firstname'][k] = tempnames.splice(0, 1);
            this.mData['TO'].data['lastname'][k] = tempnames.join(" ");
          }
        }

        var card = this.getCardForEmail(this.mData['TO'].data['email'][k].toLowerCase());
        if (card != null)
        {
          var props = this.getPropertiesFromCard(card);
          for (var p in props)
          {
            if (typeof this.mData['TO'].data[p] == 'undefined')
              this.mData['TO'].data[p] = []
            if (props[p] != "" || typeof this.mData['TO'].data[p][k] == 'undefined' || this.mData['TO'].data[p][k] == "")
              this.mData['TO'].data[p][k] = props[p];
          }
        }

        this.mData['TO'].data['fullname'][k] = TrimString(this.mData['TO'].data['firstname'][k] +" "+ this.mData['TO'].data['lastname'][k]);
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
      var post = [];
      if (aVariables.length > 0)
      {
        var variables = aVariables.shift().split(";");
        for (var k = 0; k < variables.length; k++)
        {
          var tag = variables[k].toLowerCase();
          var data = this["process_"+ tag]();

          switch (tag)
          {
            case 'to':
            case 'att':
            case 'orgheader':
            case 'orgatt':
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
              if (typeof data != 'undefined')
              {
                for (var i in data)
                  post.push(tag +'['+ i +']='+ data[i]);
              }
              break;
            case 'subject':
            case 'clipboard':
            case 'counter':
              if (typeof data != 'undefined')
                post.push(tag +'='+ data);
              break;
          }
        }
      }

      var req = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Components.interfaces.nsIXMLHttpRequest);
      req.open('POST', url, false);
      req.setRequestHeader('Content-Type','application/x-www-form-urlencoded');
      req.send(post.join("&"));

      if (req.status == 200)
        return req.responseText;
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
    this.mData['VERSION'].data['number'] = '';
    this.mData['VERSION'].data['full'] = '';

    try {
      if (typeof Components.interfaces.nsIXULAppInfo != "undefined")
      {
        var appInfo = Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULAppInfo);
        if (appInfo)
        {
          this.mData['VERSION'].data['number'] = appInfo.version;
          this.mData['VERSION'].data['full'] = appInfo.name +' '+ appInfo.version;
        }
      }
      else
      {
        this.mData['VERSION'].data['number'] = TrimString(this.mPrefService.getBranch("app.").getCharPref("version"));
        this.mData['VERSION'].data['full'] = TrimString('Thunderbird '+ this.mPrefService.getBranch("app.").getCharPref("version"));
      }
    }
    catch(e) {}

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

    if (this.mPrefBranch.prefHasUserValue("counter"))
      this.mData['COUNTER'].data = this.mPrefBranch.getIntPref("counter");

    this.mData['COUNTER'].data++;
    this.mPrefBranch.setIntPref("counter", this.mData['COUNTER'].data);

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
    var options = {};
    options["DATE-long"] = { weekday: "long", year: "numeric", month: "long", day: "2-digit" };
    options["DATE-short"] = { year: "numeric", month: "2-digit", day: "2-digit" }; 
    options["TIME-seconds"] = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
    options["TIME-noseconds"] = { hour: "2-digit", minute: "2-digit" }; 
      
    let fields = Object.keys(options);
    for (let i=0; i < fields.length; i++) {
        let field = fields[i];
        let fieldinfo = field.split("-");
        this.mData[fieldinfo[0]].data[fieldinfo[1]] = TrimString(new Intl.DateTimeFormat([], options[field]).format(timeStamp));
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
    var listener = streamListener();
    mms.streamMessage(msgURI, listener, null, null, true, "filter");

    const eqs = Components.interfaces.nsIEventQueueService;
    while (listener.mBusy)
    {
      // This works like a yield. Not sure why
      Components.classes["@mozilla.org/event-queue-service;1"]
        .getService(eqs).getSpecialEventQueue(eqs.UI_THREAD_EVENT_QUEUE)
        .processPendingEvents();
    }

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
    return Math.round(size) + " " + unit[i];
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
        } catch(e) {}
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
,
  QueryInterface: function(aIID)
  {
    if (aIID.equals(Components.interfaces.wzIQuicktextVar) ||
        aIID.equals(Components.interfaces.nsISupports))
      return this;

    Components.returnCode = Components.results.NS_ERROR_NO_INTERFACE;
    return null;
  }
}

/**
 * XPCOMUtils.generateNSGetFactory was introduced in Mozilla 2 (Firefox 4, SeaMonkey 2.1).
 * XPCOMUtils.generateNSGetModule was introduced in Mozilla 1.9 (Firefox 3.0).
 */
if (XPCOMUtils.generateNSGetFactory)
  var NSGetFactory = XPCOMUtils.generateNSGetFactory([wzQuicktextVar]);
else
  var NSGetModule = XPCOMUtils.generateNSGetModule([wzQuicktextVar]);

var debug = kDebug ?  function(m) {dump("\t *** wzQuicktext: " + m + "\n");} : function(m) {};


function TrimString(aStr)
{
  if (!aStr) return "";
  return aStr.replace(/(^\s+)|(\s+$)/g, '')
}

// Make Array.indexOf work in Firefox versions older than 1.1
if  (!Array.prototype.indexOf)
{
  Array.prototype.indexOf = function(item)
  {
    for (var i = 0; i < this.length; i++)
        if (this[i] == item)
            return i;
    return -1;
  };
}
