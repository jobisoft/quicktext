
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
 
  get_script: async function(aVariables)
  {
    return await this.process_script(aVariables);
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




}
