/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

"use strict";

// Using a closure to not leak anything but the API to the outside world.
(function (exports) {
  // Helper function to inject a legacy XUL string into the DOM of Thunderbird.
  const injectElements = function (extension, window, xulString, labels, debug = false) {
    function checkElements(stringOfIDs) {
      let arrayOfIDs = stringOfIDs.split(",").map((e) => e.trim());
      for (let id of arrayOfIDs) {
        let element = window.document.getElementById(id);
        if (element) {
          return element;
        }
      }
      return null;
    }

    function localize(entity, labels) {
      let msg = entity.slice("__MSG_".length, -2);
      return labels[msg] || msg;
    }

    function injectChildren(elements, container) {
      for (let i = 0; i < elements.length; i++) {
        if (
          elements[i].hasAttribute("insertafter") &&
          checkElements(elements[i].getAttribute("insertafter"))
        ) {
          let insertAfterElement = checkElements(
            elements[i].getAttribute("insertafter")
          );
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertAfterElement.parentNode.insertBefore(
            elements[i],
            insertAfterElement.nextSibling
          );
        } else if (
          elements[i].hasAttribute("insertbefore") &&
          checkElements(elements[i].getAttribute("insertbefore"))
        ) {
          let insertBeforeElement = checkElements(
            elements[i].getAttribute("insertbefore")
          );
          elements[i].setAttribute("data-extension-injected", extension.id);
          insertBeforeElement.parentNode.insertBefore(
            elements[i],
            insertBeforeElement
          );
        } else if (
          elements[i].id &&
          window.document.getElementById(elements[i].id)
        ) {
          injectChildren(
            Array.from(elements[i].children),
            window.document.getElementById(elements[i].id)
          );
        } else {
          elements[i].setAttribute("data-extension-injected", extension.id);
          container.appendChild(elements[i]);
        }
      }
    }

    let localizedXulString = xulString.replace(
      /__MSG_(.*?)__/g,
      entity => localize(entity, labels)
    );
    injectChildren(
      Array.from(
        window.MozXULElement.parseXULToFragment(localizedXulString, []).children
      ),
      window.document.documentElement
    );
  };

  const injectCSS = function (extension, window, cssFile) {
    let element = window.document.createElement("link");
    element.setAttribute("data-extension-injected", extension.id);
    element.setAttribute("rel", "stylesheet");
    element.setAttribute("href", cssFile);
    return window.document.documentElement.appendChild(element);
  };

  const removeEverything = function (extension) {
    for (const window of Services.wm.getEnumerator("msgcompose")) {
      if (window) {
        let elements = Array.from(
          window.document.querySelectorAll(
            '[data-extension-injected="' + extension.id + '"]'
          )
        );
        for (let element of elements) {
          element.remove();
        }
        if (window.quicktextToolbar) {
          window.quicktextToolbar.unload();
          window.quicktextToolbar = null;
        }
      }
    }
  }

  // Listeners registered via the onCommand EventManager.
  var commandListeners = new Set();

  var QuicktextToolbar = class extends ExtensionCommon.ExtensionAPI {
    getAPI(context) {
      return {
        QuicktextToolbar: {
          onCommand: new ExtensionCommon.EventManager({
            context,
            name: "QuicktextToolbar.onCommand",
            register(fire) {
              commandListeners.add(fire.async);
              return () => commandListeners.delete(fire.async);
            },
          }).api(),

          async injectLegacyToolbar(windowId, labels) {
            let { window } = context.extension.windowManager.get(windowId);

            // Remove any previously injected elements and unload toolbar state.
            for (const element of window.document.querySelectorAll(`[data-extension-injected="${context.extension.id}"]`)) {
              element.remove();
            }
            if (window.quicktextToolbar) {
              window.quicktextToolbar.unload();
              window.quicktextToolbar = null;
            }

            Services.scriptloader.loadSubScript("resource://quicktext-legacy/api/QuicktextToolbar/composerToolbar.js", window, "UTF-8");
            window.quicktextToolbar.windowId = windowId;

            injectCSS(context.extension, window, "resource://quicktext-legacy/api/QuicktextToolbar/composerToolbar.css");
            injectElements(context.extension, window, `
  <toolbar id="quicktext-toolbar" insertbefore="messageEditor">
    <html:div id="quicktext-templates-toolbar" />
    <spacer flex="1" />
    <hbox>
      <button type="menu" id="quicktext-insert-variable" label="__MSG_quicktext.insertVariable.label__" tabindex="-1">
        <menupopup id="quicktext-insert-variable-popup" />
      </button>
      <button type="menu" id="quicktext-insert-file" label="__MSG_quicktext.insertStaticFile.label__" tabindex="-1">
        <menupopup id="quicktext-insert-file-popup" />
      </button>
    </hbox>
  </toolbar>`, labels
            );

            await window.quicktextToolbar.load();
          },
          async updateLegacyToolbar(windowId) {
            let { window } = context.extension.windowManager.get(windowId);
            if (window.quicktextToolbar) {
              window.quicktextToolbar.update();
            }
          },
          async removeLegacyToolbar() {
            removeEverything(context.extension);
          }
        },
      };
    }

    onStartup() {
      this.commandObserver = async (aSubject, aTopic, aData) => {
        if (commandListeners.size === 0) return;
        let payload = aSubject.wrappedJSObject;
        if (!payload.resolve) return;
        let results = [];
        for (let listener of commandListeners) {
          let rv = await listener(payload.data);
          if (rv != null) results.push(rv);
        }
        payload.resolve(results.length > 0 ? results[0] : undefined);
      };
      Services.obs.addObserver(this.commandObserver, "QuicktextToolbarCommand", false);
    }

    onShutdown(isAppShutdown) {
      if (isAppShutdown) {
        return;
      }

      Services.obs.removeObserver(this.commandObserver, "QuicktextToolbarCommand");
      removeEverything(this.extension);
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }
  };
  exports.QuicktextToolbar = QuicktextToolbar;
})(this);
