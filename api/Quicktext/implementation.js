"use strict";

(function (exports) {

  function install(extension, window) {
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
      <toolbar id="quicktext-toolbar">
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

    window.quicktext.load();
    console.log("install");
  }

  function uninstall(window) {
    window.quicktext.unload();
    console.log("uninstall");
  }

  class Quicktext extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      function getComposeWindow(windowId) {
        let { window } = context.extension.windowManager.get(windowId);
        return window;
      }
      
      return {
        Quicktext: {
          openSettings(windowId) {
            let window = context.extension.windowManager.get(windowId, context)
              .window;
            window.openDialog(
              "chrome://quicktext/content/settings.xhtml",
              "QuicktextOptions",
              "chrome,resizable,centerscreen"
            );
          },
          load(windowId) {
            let window = getComposeWindow(windowId);
            if (!window || window.document.documentElement.getAttribute("windowtype") != "msgcompose") {
              return;
            }
            install(context.extension, window);
          },
          toggleToolbar(visible) {
            console.log("toggleToolbar", visible);
          }
        }
      };
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) return;
      for (let window of Services.wm.getEnumerator("msgcompose")) {
        uninstall(window);
      }
    }
  };

  exports.Quicktext = Quicktext;

})(this)
