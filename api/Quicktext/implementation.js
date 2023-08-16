"use strict";

(function (exports) {

  async function install(extension, tabId, option, dateLabels) {
    function localize(entity) {
      let msg = entity.slice("__MSG_".length, -2);
      return extension.localeData.localizeMessage(msg);
    }

    function injectCSS(window, cssFile) {
      let element = window.document.createElement("link");
      element.setAttribute("rel", "stylesheet");
      element.setAttribute("href", cssFile);
      return window.document.documentElement.appendChild(element);
    };

    let { window } = extension.tabManager.get(tabId);
    if (!window || window.document.documentElement.getAttribute("windowtype") != "msgcompose") {
      return null;
    }

    window.quicktext = {
      mLoaded: false,
      mShortcuts: {},
      mShortcutString: "",
      mShortcutModifierDown: false,
      mKeywords: {}
      ,
      load: async function (extension, aTabId) {
        if (!this.mLoaded) {
          this.mLoaded = true;
          this.extension = extension;
          this.mTabId = aTabId;

          /*
                // Add an eventlistener for keypress in the window
                window.addEventListener("keypress", function(e) { quicktext.windowKeyPress(e); }, true);
                window.addEventListener("keydown", function(e) { quicktext.windowKeyDown(e); }, true);
                window.addEventListener("keyup", function(e) { quicktext.windowKeyUp(e); }, true);
          
                // Add an eventlistener for keypress in the editor
                var contentFrame = GetCurrentEditorElement();
                contentFrame.addEventListener("keypress", function(e) { quicktext.editorKeyPress(e); }, false);
          */
          console.log("load");
        }
      }
      ,
      unload: function () {
        console.log("unload");
        return;
        // Remove the observer
        gQuicktext.removeObserver(this);

        window.removeEventListener("keypress", function (e) { quicktext.windowKeyPress(e); }, true);
        window.removeEventListener("keydown", function (e) { quicktext.windowKeyDown(e); }, true);
        window.removeEventListener("keyup", function (e) { quicktext.windowKeyUp(e); }, true);

        // Remove the eventlistener from the editor
        var contentFrame = GetCurrentEditorElement();
        contentFrame.removeEventListener("keypress", function (e) { quicktext.editorKeyPress(e); }, false);
      }
      ,
      /*
       * INSERTING TEXT
       */
      insertVariable: async function (aVar) {
        return this.notifyTools.notifyBackground({ command: "insertVariable", tabId: this.mTabId, variable: aVar });
      }
      ,
      insertContentFromFile: async function (aType) {
        return this.notifyTools.notifyBackground({ command: "insertContentFromFile", tabId: this.mTabId, type: aType });
      }
      ,
      /*
       * KEYPRESS MOVE TO compose script
       */
      windowKeyPress: async function (e) {
        if (gQuicktext.shortcutTypeAdv) {
          var shortcut = e.charCode - 48;
          if (shortcut >= 0 && shortcut < 10 && this.mShortcutModifierDown) {
            this.mShortcutString += String.fromCharCode(e.charCode);

            e.stopPropagation();
            e.preventDefault();
          }
        }
        else {
          var modifier = gQuicktext.shortcutModifier;
          var shortcut = e.charCode - 48;
          if (shortcut >= 0 && shortcut < 10 && typeof this.mShortcuts[shortcut] != "undefined" && (
            e.altKey && modifier == "alt" ||
            e.ctrlKey && modifier == "control" ||
            e.metaKey && modifier == "meta")) {
            await this.insertTemplate(this.mShortcuts[shortcut][0], this.mShortcuts[shortcut][1]);

            e.stopPropagation();
            e.preventDefault();
          }
        }
      }
      ,
      windowKeyDown: function (e) {
        var modifier = gQuicktext.shortcutModifier;
        if (!this.mShortcutModifierDown && gQuicktext.shortcutTypeAdv && (
          e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
          e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
          e.keyCode == e.DOM_VK_META && modifier == "meta"))
          this.mShortcutModifierDown = true;
      }
      ,
      windowKeyUp: async function (e) {
        var modifier = gQuicktext.shortcutModifier;
        if (gQuicktext.shortcutTypeAdv && (
          e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
          e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
          e.keyCode == e.DOM_VK_META && modifier == "meta")) {
          if (this.mShortcutString != "" && typeof this.mShortcuts[this.mShortcutString] != "undefined") {
            await this.insertTemplate(this.mShortcuts[this.mShortcutString][0], this.mShortcuts[this.mShortcutString][1]);

            e.stopPropagation();
            e.preventDefault();
          }

          this.mShortcutModifierDown = false;
          this.mShortcutString = "";
        }
      }
      ,
      editorKeyPress: async function (e) {
        const alternatives = {
          "Enter": ["NumpadEnter"]
        }

        if (e.code == gQuicktext.keywordKey || alternatives[gQuicktext.keywordKey]?.includes(e.code)) {
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
          if (!(selection.rangeCount > 0)) {
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
      }
    }
    
    Services.scriptloader.loadSubScript("chrome://quicktext/content/notifyTools/notifyTools.js", window.quicktext, "UTF-8");

    injectCSS(window, "resource://quicktext/skin/quicktext.css");

    let xulString = `
      <toolbar id="quicktext-toolbar" ${option.toolbar ? "" : "collapsed='true'"}>
        <button type="menu" id="quicktext-variables" label="__MSG_quicktext.variables.label__" tabindex="-1">
          <menupopup>
            <menu label="__MSG_quicktext.to.label__">
              <menupopup>
                <menuitem label="__MSG_quicktext.firstname.label__" oncommand="quicktext.insertVariable('TO=firstname');" />
                <menuitem label="__MSG_quicktext.lastname.label__" oncommand="quicktext.insertVariable('TO=lastname');" />
                <menuitem label="__MSG_quicktext.fullname.label__" oncommand="quicktext.insertVariable('TO=fullname');" />
                <menuitem label="__MSG_quicktext.displayname.label__" oncommand="quicktext.insertVariable('TO=displayname');" />
                <menuitem label="__MSG_quicktext.nickname.label__" oncommand="quicktext.insertVariable('TO=nickname');" />
                <menuitem label="__MSG_quicktext.email.label__" oncommand="quicktext.insertVariable('TO=email');" />
                <menuitem label="__MSG_quicktext.workphone.label__" oncommand="quicktext.insertVariable('TO=workphone');" />
                <menuitem label="__MSG_quicktext.faxnumber.label__" oncommand="quicktext.insertVariable('TO=faxnumber');" />
                <menuitem label="__MSG_quicktext.cellularnumber.label__" oncommand="quicktext.insertVariable('TO=cellularnumber');" />
                <menuitem label="__MSG_quicktext.jobtitle.label__" oncommand="quicktext.insertVariable('TO=jobtitle');" />
                <menuitem label="__MSG_quicktext.custom1.label__" oncommand="quicktext.insertVariable('TO=custom1');" />
                <menuitem label="__MSG_quicktext.custom2.label__" oncommand="quicktext.insertVariable('TO=custom2');" />
                <menuitem label="__MSG_quicktext.custom3.label__" oncommand="quicktext.insertVariable('TO=custom3');" />
                <menuitem label="__MSG_quicktext.custom4.label__" oncommand="quicktext.insertVariable('TO=custom4');" />
              </menupopup>
            </menu>
            <menu label="__MSG_quicktext.from.label__">
              <menupopup>
                <menuitem label="__MSG_quicktext.firstname.label__" oncommand="quicktext.insertVariable('FROM=firstname');" />
                <menuitem label="__MSG_quicktext.lastname.label__" oncommand="quicktext.insertVariable('FROM=lastname');" />
                <menuitem label="__MSG_quicktext.fullname.label__" oncommand="quicktext.insertVariable('FROM=fullname');" />
                <menuitem label="__MSG_quicktext.displayname.label__" oncommand="quicktext.insertVariable('FROM=displayname');" />
                <menuitem label="__MSG_quicktext.nickname.label__" oncommand="quicktext.insertVariable('FROM=nickname');" />
                <menuitem label="__MSG_quicktext.email.label__" oncommand="quicktext.insertVariable('FROM=email');" />
                <menuitem label="__MSG_quicktext.workphone.label__" oncommand="quicktext.insertVariable('FROM=workphone');" />
                <menuitem label="__MSG_quicktext.faxnumber.label__" oncommand="quicktext.insertVariable('FROM=faxnumber');" />
                <menuitem label="__MSG_quicktext.cellularnumber.label__" oncommand="quicktext.insertVariable('FROM=cellularnumber');" />
                <menuitem label="__MSG_quicktext.jobtitle.label__" oncommand="quicktext.insertVariable('FROM=jobtitle');" />
                <menuitem label="__MSG_quicktext.custom1.label__" oncommand="quicktext.insertVariable('FROM=custom1');" />
                <menuitem label="__MSG_quicktext.custom2.label__" oncommand="quicktext.insertVariable('FROM=custom2');" />
                <menuitem label="__MSG_quicktext.custom3.label__" oncommand="quicktext.insertVariable('FROM=custom3');" />
                <menuitem label="__MSG_quicktext.custom4.label__" oncommand="quicktext.insertVariable('FROM=custom4');" />
              </menupopup>
            </menu>
            <menu label="__MSG_quicktext.attachments.label__">
              <menupopup>
                <menuitem label="__MSG_quicktext.filename.label__" oncommand="quicktext.insertVariable('ATT=name');" />
                <menuitem label="__MSG_quicktext.filenameAndSize.label__" oncommand="quicktext.insertVariable('ATT=full');" />
              </menupopup>
            </menu>
            <menu label="__MSG_quicktext.dateTime.label__">
              <menupopup>
                <menuitem id="date-short" oncommand="quicktext.insertVariable('DATE');" />
                <menuitem id="date-long" oncommand="quicktext.insertVariable('DATE=long');" />
                <menuitem id="date-monthname" oncommand="quicktext.insertVariable('DATE=monthname');" />
                <menuitem id="time-noseconds" oncommand="quicktext.insertVariable('TIME');" />
                <menuitem id="time-seconds" oncommand="quicktext.insertVariable('TIME=seconds');" />
              </menupopup>
            </menu>
            <menu label="__MSG_quicktext.other.label__">
              <menupopup>
                <menuitem label="__MSG_quicktext.clipboard.label__" oncommand="quicktext.insertVariable('CLIPBOARD');" />
                <menuitem label="__MSG_quicktext.counter.label__" oncommand="quicktext.insertVariable('COUNTER');" />
                <menuitem label="__MSG_quicktext.subject.label__" oncommand="quicktext.insertVariable('SUBJECT');" />
                <menuitem label="__MSG_quicktext.version.label__" oncommand="quicktext.insertVariable('VERSION');" />
              </menupopup>
            </menu>
          </menupopup>
        </button>
        <button type="menu" id="quicktext-other" label="__MSG_quicktext.other.label__" tabindex="-1">
          <menupopup>
            <menuitem label="__MSG_quicktext.insertTextFromFileAsText.label__" oncommand="quicktext.insertContentFromFile(0);" />
            <menuitem label="__MSG_quicktext.insertTextFromFileAsHTML.label__" oncommand="quicktext.insertContentFromFile(1);" />
          </menupopup>
        </button>
      </toolbar>`;
    let localizedXulString = xulString.replace(
      /__MSG_(.*?)__/g,
      localize
    );
    let element = Array.from(
      window.MozXULElement.parseXULToFragment(localizedXulString, []).children
    ).pop();

    let messageEditor = window.document.getElementById("messageEditor");
    messageEditor.parentNode.insertBefore(
      element,
      messageEditor
    );

    // Update date menu entries
    for (let [field, label] of Object.entries(dateLabels)) {
      if (window.document.getElementById(field)) {
        window.document.getElementById(field).setAttribute("label", label);
      }
    }

    await window.quicktext.load(extension, tabId);
    console.log("install");
  }

  function uninstall(window) {
    let toolbar = window.document.getElementById("quicktext-toolbar");
    if (toolbar) {
      toolbar.remove();
    }
    window.quicktext.unload();
    window.quicktext = {};
    console.log("uninstall");
  }

  let chromeHandle = null;
  let chromeData = [];
  let resourceData = [];

  const aomStartup = Cc[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Ci.amIAddonManagerStartup);
  const resProto = Cc[
    "@mozilla.org/network/protocol;1?name=resource"
  ].getService(Ci.nsISubstitutingProtocolHandler);

  class Quicktext extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        Quicktext: {
          async registerChromeUrl(data) {
            console.log("registerChromeUrl START");

            for (let entry of data) {
              if (entry[0] == "resource") resourceData.push(entry);
              else chromeData.push(entry);
            }

            if (chromeData.length > 0) {
              const manifestURI = Services.io.newURI(
                "manifest.json",
                null,
                context.extension.rootURI
              );
              chromeHandle = aomStartup.registerChrome(
                manifestURI,
                chromeData
              );
            }

            for (let res of resourceData) {
              // [ "resource", "shortname" , "path" ]
              let uri = Services.io.newURI(
                res[2],
                null,
                context.extension.rootURI
              );
              resProto.setSubstitutionWithFlags(
                res[1],
                uri,
                resProto.ALLOW_CONTENT_ACCESS
              );
            }

            console.log("registerChromeUrl DONE");
          },
          async openSettings(tabId) {
            let { window } = context.extension.tabManager.get(tabId);
            window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "QuicktextOptions",
              "chrome,resizable,centerscreen"
            );
          },
          async addToolbar(tabId, options, dateLabels) {
            return install(context.extension, tabId, options, dateLabels);
          },
          async toggleToolbar(tabId, visible) {
            let { window } = context.extension.tabManager.get(tabId);
            if (visible) {
              window.document.getElementById("quicktext-toolbar").removeAttribute("collapsed");
            } else {
              window.document.getElementById("quicktext-toolbar").setAttribute("collapsed", true);
            }
          },
          async getQuicktextFilePaths(options) {
            let rv = {};

            // get profile directory
            let profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
              .getService(Components.interfaces.nsIProperties)
              .get("ProfD", Components.interfaces.nsIFile);
            // check if an alternative path has been given for the config folder
            if (options.TemplateFolder) {
              profileDir = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
              profileDir.initWithPath(templateFolder);
            }

            let quicktextDir = profileDir;
            quicktextDir.append("quicktext");
            if (!quicktextDir.exists())
              quicktextDir.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o755);

            if (!quicktextDir.isDirectory()) {
              // Must warn the user that the quicktext dir don't exists and couldn't be created
            } else {
              let quicktextFile = quicktextDir.clone();
              quicktextFile.append("templates.xml");

              // Checks if the template-file exists and import that, if it exists.
              if (quicktextFile.exists()) {
                rv.quicktextFilePath = quicktextFile.path;
              }

              // Checks if the script-file exists and import that, if it exists.
              let scriptFile = quicktextDir.clone();
              scriptFile.append("scripts.xml");
              if (scriptFile.exists()) {
                rv.scriptFilePath = scriptFile.path;
              }
            }
            return rv;
          },
          async readFile(aFilePath) {
            return IOUtils.readUTF8(aFilePath);
          },
          async pickFile(tabId, type, mode, title) {
            let { window } = context.extension.tabManager.get(tabId);
            var filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);

            switch (mode) {
              case 1:
                filePicker.init(window, title, filePicker.modeSave);
                checkFileEncoding = false;
                break;
              default:
                filePicker.init(window, title, filePicker.modeOpen);
                break;
            }

            switch (type) {
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

            let rv = await new Promise(function (resolve, reject) {
              filePicker.open(result => {
                resolve(result);
              });
            });

            if (rv == filePicker.returnOK || rv == filePicker.returnReplace) {
              return IOUtils.readUTF8(filePicker.file.path);
            } else {
              return null;
            }
          }
        }
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) return;
      for (let window of Services.wm.getEnumerator("msgcompose")) {
        uninstall(window);
      }

      // Extract all registered chrome content urls.
      let chromeUrls = [];
      if (chromeData) {
        for (let chromeEntry of chromeData) {
          if (chromeEntry[0].toLowerCase().trim() == "content") {
            chromeUrls.push("chrome://" + chromeEntry[1] + "/");
          }
        }
      }

      // Unload JSMs.
      const rootURI = this.extension.rootURI.spec;
      for (let module of Cu.loadedModules) {
        if (
          module.startsWith(rootURI) ||
          (module.startsWith("chrome://") &&
            chromeUrls.find((s) => module.startsWith(s)))
        ) {
          console.log("Unloading: " + module);
          Cu.unload(module);
        }
      }

      // Flush all caches
      Services.obs.notifyObservers(null, "startupcache-invalidate");

      if (resourceData) {
        const resProto = Cc[
          "@mozilla.org/network/protocol;1?name=resource"
        ].getService(Ci.nsISubstitutingProtocolHandler);
        for (let res of resourceData) {
          // [ "resource", "shortname" , "path" ]
          resProto.setSubstitution(res[1], null);
        }
      }

      if (chromeHandle) {
        chromeHandle.destruct();
        chromeHandle = null;
      }

    }
  };

  exports.Quicktext = Quicktext;

})(this)
