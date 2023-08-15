"use strict";

(function (exports) {

  async function install(extension, window, option) {
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

    Services.scriptloader.loadSubScript("chrome://quicktext/content/quicktext.js", window, "UTF-8");

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
                <menuitem label="__MSG_quicktext.worknumber.label__" oncommand="quicktext.insertVariable('TO=workphone');" />
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
                <menuitem label="__MSG_quicktext.worknumber.label__" oncommand="quicktext.insertVariable('FROM=workphone');" />
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

    await window.quicktext.load(extension);
    console.log("install");
  }

  function uninstall(window) {
    window.document.getElementById("quicktext-toolbar").remove();
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
      function getComposeWindow(windowId) {
        let { window } = context.extension.windowManager.get(windowId);
        return window;
      }

      return {
        Quicktext: {
          registerChromeUrl(data) {
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

          openSettings(windowId) {
            let { window } = context.extension.windowManager.get(windowId, context);
            window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "QuicktextOptions",
              "chrome,resizable,centerscreen"
            );
          },
          async load(windowId, options) {
            let window = getComposeWindow(windowId);
            if (!window || window.document.documentElement.getAttribute("windowtype") != "msgcompose") {
              return;
            }
            await install(context.extension, window, options);
          },
          toggleToolbar(windowId, visible) {
              let { window } = context.extension.windowManager.get(windowId, context);
              if (visible) {
                window.document.getElementById("quicktext-toolbar").removeAttribute("collapsed");
              } else {
                window.document.getElementById("quicktext-toolbar").setAttribute("collapsed", true);
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
