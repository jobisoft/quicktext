"use strict";

(function (exports) {

  /*
   * KEYPRESS MOVE TO compose script
   */
  async function install() {
    window.quicktext = {
      mLoaded: false,
      mShortcuts: {},
      mShortcutString: "",
      mShortcutModifierDown: false,
      mKeywords: {}
      ,
      load: async function (extension, aTabId) {
        // Add an eventlistener for keypress in the window
        window.addEventListener("keypress", function (e) { quicktext.windowKeyPress(e); }, true);
        window.addEventListener("keydown", function (e) { quicktext.windowKeyDown(e); }, true);
        window.addEventListener("keyup", function (e) { quicktext.windowKeyUp(e); }, true);

        // Add an eventlistener for keypress in the editor
        var contentFrame = GetCurrentEditorElement();
        contentFrame.addEventListener("keypress", function (e) { quicktext.editorKeyPress(e); }, false);
      }
      ,
      unload: function () {
        window.removeEventListener("keypress", function (e) { quicktext.windowKeyPress(e); }, true);
        window.removeEventListener("keydown", function (e) { quicktext.windowKeyDown(e); }, true);
        window.removeEventListener("keyup", function (e) { quicktext.windowKeyUp(e); }, true);

        // Remove the eventlistener from the editor
        var contentFrame = GetCurrentEditorElement();
        contentFrame.removeEventListener("keypress", function (e) { quicktext.editorKeyPress(e); }, false);
      }
      ,
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
  }

  class Quicktext extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        Quicktext: {
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
          async readTextFile(aFilePath) {
            return IOUtils.readUTF8(aFilePath);
          },
          async readBinaryFile(aFilePath) {
            return IOUtils.read(aFilePath);
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
    }
  };

  exports.Quicktext = Quicktext;

})(this)
