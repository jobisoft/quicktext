
const persistentTags  = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];

wzQuicktextVar.prototype = {
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
  // The get-functions takes the data from the process-functions and
  // returns string depending of what aVariables is

  get_file: function(aVariables)
  {
    return this.process_file(aVariables);
  }
,
  get_script: async function(aVariables)
  {
    return await this.process_script(aVariables);
  }
,



  get_url: async function(aVariables)
  {
    return await this.process_url(aVariables);
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
        let content = this.mQuicktext.readTextFile(fp);
        if (aVariables.length > 1 && aVariables[1].includes("strip_html_comments")) {
          return content.replace(/<!--[\s\S]*?(?:-->)/g, '');
        }
        return content;
      } catch(e) { console.error(e); }
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
          returnValue = await Components.utils.evalInSandbox("scriptObject = {}; scriptObject.mQuicktext = mQuicktext; scriptObject.mVariables = mVariables; scriptObject.mWindow = mWindow; scriptObject.run = async function() {\n" + script.script +"\n; return ''; }; scriptObject.run();", s);
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

}
