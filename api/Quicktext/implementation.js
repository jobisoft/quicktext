/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {

  let managerWindow = null;
  var Quicktext = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        Quicktext: {
          async getQuicktextFilePaths(templateFolder) {
            let rv = {};

            // get profile directory
            let profileDir = Components.classes["@mozilla.org/file/directory_service;1"]
              .getService(Components.interfaces.nsIProperties)
              .get("ProfD", Components.interfaces.nsIFile);
            // check if an alternative path has been given for the config folder
            if (templateFolder) {
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
              let templateFile = quicktextDir.clone();
              templateFile.append("templates.xml");

              // Checks if the template-file exists and import that, if it exists.
              if (templateFile.exists()) {
                rv.templateFilePath = templateFile.path;
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
          openTemplateManager() {
            let window = Services.wm.getMostRecentWindow("mail:3pane");
            managerWindow = window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "quicktextConfig",
              "chrome,resizable,centerscreen"
            );
          },
          async readBinaryFile(aFilePath) {
            return IOUtils.read(aFilePath);
          },
          async readTextFile(aFilePath, aBasePath) {
            if (aBasePath) {
              aFilePath =  PathUtils.join(aBasePath, aFilePath)
            }
            return IOUtils.readUTF8(aFilePath);
          },
          async writeTextFile(aFilePath, aData, aBasePath) {
            if (aBasePath) {
              aFilePath =  PathUtils.join(aBasePath, aFilePath)
            }
            return IOUtils.writeUTF8(aFilePath, aData)
          },
        },
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) {
        return; // the application gets unloaded anyway
      }

      if (managerWindow) {
        managerWindow.close();
      }
    }
  };
  exports.Quicktext = Quicktext;
})(this);