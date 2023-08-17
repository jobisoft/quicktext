"use strict";

(function (exports) {

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
