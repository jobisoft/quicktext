/*
 * This file is provided by the addon-developer-support repository at
 * https://github.com/thundernest/addon-developer-support
 *
 * Author: John Bieling (john@thunderbird.net)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Import some things we need.
var { ExtensionCommon } = ChromeUtils.import(
  "resource://gre/modules/ExtensionCommon.jsm"
);
var { ExtensionSupport } = ChromeUtils.import(
  "resource:///modules/ExtensionSupport.jsm"
);

// Only works in Thunderbird 115+
var WindowListener = class extends ExtensionCommon.ExtensionAPI {
  log(msg) {
    if (this.debug) console.log("WindowListener API: " + msg);
  }

  getCards(e) {
    // This gets triggered by real events but also manually by providing the outer window.
    // The event is attached to the outer browser, get the inner one.
    let doc = e.document || e.target;
    return doc.querySelectorAll("addon-card");
  }


  // Event handler for the addon manager, to update the state of the options button.
  handleEvent(e) {
    switch (e.type) {
      case "click": {
        e.preventDefault();
        e.stopPropagation();
        let WL = {};
        WL.extension = this.extension;
        WL.messenger = this.getMessenger(this.context);
        let w = Services.wm.getMostRecentWindow("mail:3pane");
        w.openDialog(
          this.pathToOptionsPage,
          "AddonOptions",
          "chrome,resizable,centerscreen",
          WL
        );
      }
        break;

      // update, ViewChanged and manual call for add-on manager options overlay
      default: {
        let cards = this.getCards(e);
        for (let card of cards) {
          // Setup either the options entry in the menu or the button
          if (card.addon.id == this.extension.id) {
            // Add-on button
            let addonOptionsButton = card.querySelector(
              ".windowlistener-options-button"
            );
            if (card.addon.isActive && !addonOptionsButton) {
              let origAddonOptionsButton = card.querySelector(".extension-options-button")
              origAddonOptionsButton.setAttribute("hidden", "true");

              addonOptionsButton = card.ownerDocument.createElement("button");
              addonOptionsButton.classList.add("windowlistener-options-button");
              addonOptionsButton.classList.add("extension-options-button");
              card.optionsButton.parentNode.insertBefore(
                addonOptionsButton,
                card.optionsButton
              );
              card
                .querySelector(".windowlistener-options-button")
                .addEventListener("click", this);
            } else if (!card.addon.isActive && addonOptionsButton) {
              addonOptionsButton.remove();
            }
          }
        }
      }
    }
  }

  // Some tab/add-on-manager related functions
  getTabMail(window) {
    return window.document.getElementById("tabmail");
  }

  // returns the outer browser, not the nested browser of the add-on manager
  // events must be attached to the outer browser
  getAddonManagerFromTab(tab) {
    if (tab.browser) {
      let win = tab.browser.contentWindow;
      if (win && win.location.href == "about:addons") {
        return win;
      }
    }
  }

  getAddonManagerFromWindow(window) {
    let tabMail = this.getTabMail(window);
    for (let tab of tabMail.tabInfo) {
      let win = this.getAddonManagerFromTab(tab);
      if (win) {
        return win;
      }
    }
  }

  setupAddonManager(managerWindow, forceLoad = false) {
    if (!managerWindow) {
      return;
    }
    if (!this.pathToOptionsPage) {
      return;
    }
    if (
      managerWindow &&
      managerWindow[this.uniqueRandomID] &&
      managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
    ) {
      return;
    }

    managerWindow.document.addEventListener("ViewChanged", this);
    managerWindow.document.addEventListener("update", this);
    managerWindow.document.addEventListener("view-loaded", this);
    managerWindow[this.uniqueRandomID] = {};
    managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = true;
    if (forceLoad) {
      this.handleEvent(managerWindow);
    }
  }

  getMessenger(context) {
    let apis = ["storage", "runtime", "extension", "i18n"];

    function getStorage() {
      let localstorage = null;
      try {
        localstorage = context.apiCan.findAPIPath("storage");
        localstorage.local.get = (...args) =>
          localstorage.local.callMethodInParentProcess("get", args);
        localstorage.local.set = (...args) =>
          localstorage.local.callMethodInParentProcess("set", args);
        localstorage.local.remove = (...args) =>
          localstorage.local.callMethodInParentProcess("remove", args);
        localstorage.local.clear = (...args) =>
          localstorage.local.callMethodInParentProcess("clear", args);
      } catch (e) {
        console.info("Storage permission is missing");
      }
      return localstorage;
    }

    let messenger = {};
    for (let api of apis) {
      switch (api) {
        case "storage":
          ChromeUtils.defineLazyGetter(messenger, "storage", () => getStorage());
          break;

        default:
          ChromeUtils.defineLazyGetter(messenger, api, () =>
            context.apiCan.findAPIPath(api)
          );
      }
    }
    return messenger;
  }

  error(msg) {
    if (this.debug) console.error("WindowListener API: " + msg);
  }

  // async sleep function using Promise
  async sleep(delay) {
    let timer = Components.classes["@mozilla.org/timer;1"].createInstance(
      Components.interfaces.nsITimer
    );
    return new Promise(function (resolve, reject) {
      let event = {
        notify: function (timer) {
          resolve();
        },
      };
      timer.initWithCallback(
        event,
        delay,
        Components.interfaces.nsITimer.TYPE_ONE_SHOT
      );
    });
  }

  getAPI(context) {
    // Track if this is the background/main context
    if (context.viewType != "background")
      throw new Error(
        "The WindowListener API may only be called from the background page."
      );

    this.context = context;

    this.uniqueRandomID = "AddOnNS" + context.extension.instanceId;
    this.menu_addonPrefs_id = "addonPrefs";

    this.registeredWindows = {};
    this.pathToOptionsPage = null;
    this.chromeHandle = null;
    this.chromeData = null;
    this.resourceData = null;
    this.openWindows = [];
    this.debug = context.extension.addonData.temporarilyInstalled;

    const aomStartup = Cc[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Ci.amIAddonManagerStartup);
    const resProto = Cc[
      "@mozilla.org/network/protocol;1?name=resource"
    ].getService(Ci.nsISubstitutingProtocolHandler);

    let self = this;

    // TabMonitor to detect opening of tabs, to setup the options button in the add-on manager.
    this.tabMonitor = {
      onTabTitleChanged(aTab) { },
      onTabClosing(aTab) { },
      onTabPersist(aTab) { },
      onTabRestored(aTab) { },
      onTabSwitched(aNewTab, aOldTab) {
        //self.setupAddonManager(self.getAddonManagerFromTab(aNewTab));
      },
      async onTabOpened(aTab) {
        if (aTab.browser) {
          if (!aTab.pageLoaded) {
            // await a location change if browser is not loaded yet
            await new Promise((resolve) => {
              let reporterListener = {
                QueryInterface: ChromeUtils.generateQI([
                  "nsIWebProgressListener",
                  "nsISupportsWeakReference",
                ]),
                onStateChange() { },
                onProgressChange() { },
                onLocationChange(
                  /* in nsIWebProgress*/ aWebProgress,
                  /* in nsIRequest*/ aRequest,
                  /* in nsIURI*/ aLocation
                ) {
                  aTab.browser.removeProgressListener(reporterListener);
                  resolve();
                },
                onStatusChange() { },
                onSecurityChange() { },
                onContentBlockingEvent() { },
              };
              aTab.browser.addProgressListener(reporterListener);
            });
          }
          self.setupAddonManager(self.getAddonManagerFromTab(aTab));
          self._loadIntoWindow(aTab.browser.contentWindow, false);
        }

        if (aTab.chromeBrowser) {
          self._loadIntoWindow(aTab.chromeBrowser.contentWindow, false);
        }
      },
    };

    return {
      WindowListener: {
        aDocumentExistsAt(uriString) {
          // No sane way yet to detect if about:urls exists, maybe lookup the definition?
          if (uriString.startsWith("about:")) {
            return true;
          }

          self.log(
            "Checking if document at <" +
            uriString +
            "> used in registration actually exists."
          );
          try {
            let uriObject = Services.io.newURI(uriString);
            let content = Cu.readUTF8URI(uriObject);
          } catch (e) {
            Components.utils.reportError(e);
            return false;
          }
          return true;
        },

        registerOptionsPage(optionsUrl) {
          self.pathToOptionsPage = optionsUrl.startsWith("chrome://")
            ? optionsUrl
            : context.extension.rootURI.resolve(optionsUrl);
        },

        registerChromeUrl(data) {
          let chromeData = [];
          let resourceData = [];
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
            self.chromeHandle = aomStartup.registerChrome(
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

          self.chromeData = chromeData;
          self.resourceData = resourceData;
        },

        registerWindow(windowHref, jsFile) {
          if (self.debug && !this.aDocumentExistsAt(windowHref)) {
            self.error(
              "Attempt to register an injector script for non-existent window: " +
              windowHref
            );
            return;
          }

          if (!self.registeredWindows.hasOwnProperty(windowHref)) {
            // path to JS file can either be chrome:// URL or a relative URL
            let path = jsFile.startsWith("chrome://")
              ? jsFile
              : context.extension.rootURI.resolve(jsFile);

            self.registeredWindows[windowHref] = path;
          } else {
            self.error(
              "Window <" + windowHref + "> has already been registered"
            );
          }
        },

        openOptionsDialog(windowId) {
          let window = context.extension.windowManager.get(windowId, context)
            .window;
          let WL = {};
          WL.extension = self.extension;
          WL.messenger = self.getMessenger(self.context);
          window.openDialog(
            self.pathToOptionsPage,
            "AddonOptions",
            "chrome,resizable,centerscreen",
            WL
          );
        },

        async startListening() {
          let urls = Object.keys(self.registeredWindows);
          if (urls.length > 0) {
            // Before registering the window listener, check which windows are already open
            self.openWindows = [];
            for (let window of Services.wm.getEnumerator(null)) {
              self.openWindows.push(window);
            }

            // Register window listener for all pre-registered windows
            ExtensionSupport.registerWindowListener(
              "injectListener_" + self.uniqueRandomID,
              {
                // React on all windows and manually reduce to the registered
                // windows, so we can do special actions when the main
                // messenger window is opened.
                //chromeURLs: Object.keys(self.registeredWindows),
                async onLoadWindow(window) {
                  // Load JS into window
                  await self._loadIntoWindow(
                    window,
                    self.openWindows.includes(window)
                  );
                },

                onUnloadWindow(window) {
                  // Remove JS from window, window is being closed, addon is not shut down
                  self._unloadFromWindow(window, false);
                },
              }
            );
          } else {
            self.error("Failed to start listening, no windows registered");
          }
        },
      },
    };
  }

  _loadIntoNestedBrowsers(window, isAddonActivation) {
    let elements = [];
    elements = elements.concat(...window.document.getElementsByTagName("browser"));
    elements = elements.concat(...window.document.getElementsByTagName("xul:browser"));
    for (let element of elements) {
      this._loadIntoWindow(element.contentWindow, isAddonActivation);
    }

  }

  async _loadIntoWindow(window, isAddonActivation) {
    const fullyLoaded = async window => {
      for (let i = 0; i < 20; i++) {
        await this.sleep(50);
        if (
          window &&
          window.location.href != "about:blank" &&
          window.document.readyState == "complete"
        ) {
          return;
        }
      }
      throw new Error("Window ignored");
    }

    try {
      await fullyLoaded(window);
    } catch(ex) {
      return;
    }

    if (!window || window.hasOwnProperty(this.uniqueRandomID)) {
      return;
    }

    // Special action if this is the main messenger window.
    if (window.location.href == "chrome://messenger/content/messenger.xhtml") {
      // Add a tab monitor. The tabMonitor checks newly opened tabs and injects us.
      this.getTabMail(window).registerTabMonitor(this.tabMonitor);
      window[this.uniqueRandomID] = {};
      window[this.uniqueRandomID].hasTabMonitor = true;

      // Setup the options button/menu in the add-on manager, if it is already open.
      this.setupAddonManager(this.getAddonManagerFromWindow(window), true);
    }

    // Load into nested browsers
    this._loadIntoNestedBrowsers(window, isAddonActivation);

    if (this.registeredWindows.hasOwnProperty(window.location.href)) {
      if (!window.hasOwnProperty(this.uniqueRandomID)) {
        window[this.uniqueRandomID] = {};
      }

      try {
        let uniqueRandomID = this.uniqueRandomID;
        let extension = this.extension;

        // Add reference to window to add-on scope
        window[this.uniqueRandomID].window = window;
        window[this.uniqueRandomID].document = window.document;

        // Keep track of toolbarpalettes we are injecting into
        window[this.uniqueRandomID]._toolbarpalettes = {};

        //Create WLDATA object
        window[this.uniqueRandomID].WL = {};
        window[this.uniqueRandomID].WL.scopeName = this.uniqueRandomID;

        // Add helper function to inject CSS to WLDATA object
        window[this.uniqueRandomID].WL.injectCSS = function (cssFile) {
          let element;
          let v = parseInt(Services.appinfo.version.split(".").shift());

          // using createElementNS in TB78 delays the insert process and hides any security violation errors
          if (v > 68) {
            element = window.document.createElement("link");
          } else {
            let ns = window.document.documentElement.lookupNamespaceURI("html");
            element = window.document.createElementNS(ns, "link");
          }

          element.setAttribute("wlapi_autoinjected", uniqueRandomID);
          element.setAttribute("rel", "stylesheet");
          element.setAttribute("href", cssFile);
          return window.document.documentElement.appendChild(element);
        };

        // Add helper function to inject XUL to WLDATA object
        window[this.uniqueRandomID].WL.injectElements = function (
          xulString,
          dtdFiles = [],
          debug = false
        ) {
          let toolbarsToResolve = [];

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

          function localize(entity) {
            let msg = entity.slice("__MSG_".length, -2);
            return extension.localeData.localizeMessage(msg);
          }

          function injectChildren(elements, container) {
            if (debug) console.log(elements);

            for (let i = 0; i < elements.length; i++) {
              // take care of persists
              const uri = window.document.documentURI;
              for (const persistentNode of elements[i].querySelectorAll(
                "[persist]"
              )) {
                for (const persistentAttribute of persistentNode
                  .getAttribute("persist")
                  .trim()
                  .split(" ")) {
                  if (
                    Services.xulStore.hasValue(
                      uri,
                      persistentNode.id,
                      persistentAttribute
                    )
                  ) {
                    persistentNode.setAttribute(
                      persistentAttribute,
                      Services.xulStore.getValue(
                        uri,
                        persistentNode.id,
                        persistentAttribute
                      )
                    );
                  }
                }
              }

              if (
                elements[i].hasAttribute("insertafter") &&
                checkElements(elements[i].getAttribute("insertafter"))
              ) {
                let insertAfterElement = checkElements(
                  elements[i].getAttribute("insertafter")
                );

                if (debug)
                  console.log(
                    elements[i].tagName +
                    "#" +
                    elements[i].id +
                    ": insertafter " +
                    insertAfterElement.id
                  );
                if (
                  debug &&
                  elements[i].id &&
                  window.document.getElementById(elements[i].id)
                ) {
                  console.error(
                    "The id <" +
                    elements[i].id +
                    "> of the injected element already exists in the document!"
                  );
                }
                elements[i].setAttribute("wlapi_autoinjected", uniqueRandomID);
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

                if (debug)
                  console.log(
                    elements[i].tagName +
                    "#" +
                    elements[i].id +
                    ": insertbefore " +
                    insertBeforeElement.id
                  );
                if (
                  debug &&
                  elements[i].id &&
                  window.document.getElementById(elements[i].id)
                ) {
                  console.error(
                    "The id <" +
                    elements[i].id +
                    "> of the injected element already exists in the document!"
                  );
                }
                elements[i].setAttribute("wlapi_autoinjected", uniqueRandomID);
                insertBeforeElement.parentNode.insertBefore(
                  elements[i],
                  insertBeforeElement
                );
              } else if (
                elements[i].id &&
                window.document.getElementById(elements[i].id)
              ) {
                // existing container match, dive into recursivly
                if (debug)
                  console.log(
                    elements[i].tagName +
                    "#" +
                    elements[i].id +
                    " is an existing container, injecting into " +
                    elements[i].id
                  );
                injectChildren(
                  Array.from(elements[i].children),
                  window.document.getElementById(elements[i].id)
                );
              } else if (elements[i].localName === "toolbarpalette") {
                // These vanish from the document but still exist via the palette property
                if (debug) console.log(elements[i].id + " is a toolbarpalette");
                let boxes = [
                  ...window.document.getElementsByTagName("toolbox"),
                ];
                let box = boxes.find(
                  (box) => box.palette && box.palette.id === elements[i].id
                );
                let palette = box ? box.palette : null;

                if (!palette) {
                  if (debug)
                    console.log(
                      `The palette for ${elements[i].id} could not be found, deferring to later`
                    );
                  continue;
                }

                if (debug)
                  console.log(`The toolbox for ${elements[i].id} is ${box.id}`);

                toolbarsToResolve.push(...box.querySelectorAll("toolbar"));
                toolbarsToResolve.push(
                  ...window.document.querySelectorAll(
                    `toolbar[toolboxid="${box.id}"]`
                  )
                );
                for (let child of elements[i].children) {
                  child.setAttribute("wlapi_autoinjected", uniqueRandomID);
                }
                window[uniqueRandomID]._toolbarpalettes[palette.id] = palette;
                injectChildren(Array.from(elements[i].children), palette);
              } else {
                // append element to the current container
                if (debug)
                  console.log(
                    elements[i].tagName +
                    "#" +
                    elements[i].id +
                    ": append to " +
                    container.id
                  );
                elements[i].setAttribute("wlapi_autoinjected", uniqueRandomID);
                container.appendChild(elements[i]);
              }
            }
          }

          if (debug) console.log("Injecting into root document:");
          let localizedXulString = xulString.replace(
            /__MSG_(.*?)__/g,
            localize
          );
          injectChildren(
            Array.from(
              window.MozXULElement.parseXULToFragment(
                localizedXulString,
                dtdFiles
              ).children
            ),
            window.document.documentElement
          );

          for (let bar of toolbarsToResolve) {
            let currentset = Services.xulStore.getValue(
              window.location,
              bar.id,
              "currentset"
            );
            if (currentset) {
              bar.currentSet = currentset;
            } else if (bar.getAttribute("defaultset")) {
              bar.currentSet = bar.getAttribute("defaultset");
            }
          }
        };

        // Add extension object to WLDATA object
        window[this.uniqueRandomID].WL.extension = this.extension;
        // Add messenger object to WLDATA object
        window[this.uniqueRandomID].WL.messenger = this.getMessenger(
          this.context
        );
        // Load script into add-on scope
        Services.scriptloader.loadSubScript(
          this.registeredWindows[window.location.href],
          window[this.uniqueRandomID],
          "UTF-8"
        );
        window[this.uniqueRandomID].onLoad(isAddonActivation);
      } catch (e) {
        Components.utils.reportError(e);
      }
    }
  }

  _unloadFromWindow(window, isAddonDeactivation) {
    // Unload any contained browser elements.
    let elements = [];
    elements = elements.concat(...window.document.getElementsByTagName("browser"));
    elements = elements.concat(...window.document.getElementsByTagName("xul:browser"));
    for (let element of elements) {
      if (element.contentWindow) {
        this._unloadFromWindow(
          element.contentWindow,
          isAddonDeactivation
        );
      }
    }

    if (
      window.hasOwnProperty(this.uniqueRandomID) &&
      this.registeredWindows.hasOwnProperty(window.location.href)
    ) {
      // Remove this window from the list of open windows
      this.openWindows = this.openWindows.filter((e) => e != window);

      if (window[this.uniqueRandomID].onUnload) {
        try {
          // Call onUnload()
          window[this.uniqueRandomID].onUnload(isAddonDeactivation);
        } catch (e) {
          Components.utils.reportError(e);
        }
      }

      // Remove all auto injected objects
      let elements = Array.from(
        window.document.querySelectorAll(
          '[wlapi_autoinjected="' + this.uniqueRandomID + '"]'
        )
      );
      for (let element of elements) {
        element.remove();
      }

      // Remove all autoinjected toolbarpalette items
      for (const palette of Object.values(
        window[this.uniqueRandomID]._toolbarpalettes
      )) {
        let elements = Array.from(
          palette.querySelectorAll(
            '[wlapi_autoinjected="' + this.uniqueRandomID + '"]'
          )
        );
        for (let element of elements) {
          element.remove();
        }
      }
    }

    // Remove add-on scope, if it exists
    if (window.hasOwnProperty(this.uniqueRandomID)) {
      delete window[this.uniqueRandomID];
    }
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return; // the application gets unloaded anyway
    }

    // Unload from all still open windows
    let urls = Object.keys(this.registeredWindows);
    if (urls.length > 0) {
      for (let window of Services.wm.getEnumerator(null)) {
        //remove our entry in the add-on options menu
        if (window.location.href == "chrome://messenger/content/messenger.xhtml") {
          // Remove event listener for addon manager view changes
          let managerWindow = this.getAddonManagerFromWindow(window);
          if (
            managerWindow &&
            managerWindow[this.uniqueRandomID] && 
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners
          ) {
            managerWindow.document.removeEventListener("ViewChanged", this);
            managerWindow.document.removeEventListener("view-loaded", this);
            managerWindow.document.removeEventListener("update", this);
            managerWindow[this.uniqueRandomID].hasAddonManagerEventListeners = false;

            let buttons = managerWindow.document.getElementsByClassName("extension-options-button");
            for (let button of buttons) {
              button.removeAttribute("hidden");
            }
            let cards = this.getCards(managerWindow);
            // Remove options button in 88+
            for (let card of cards) {
              if (card.addon.id == this.extension.id) {
                let origAddonOptionsButton = card.querySelector(".extension-options-button")
                origAddonOptionsButton.removeAttribute("hidden");

                let addonOptionsButton = card.querySelector(
                  ".windowlistener-options-button"
                );
                if (addonOptionsButton) addonOptionsButton.remove();
                break;
              }
            }
          }

          // Remove tabmonitor
          if (window[this.uniqueRandomID].hasTabMonitor) {
            this.getTabMail(window).unregisterTabMonitor(this.tabMonitor);
            window[this.uniqueRandomID].hasTabMonitor = false;
          }
        }

        // if it is app shutdown, it is not just an add-on deactivation
        this._unloadFromWindow(window, !isAppShutdown);
      }
      // Stop listening for new windows.
      ExtensionSupport.unregisterWindowListener(
        "injectListener_" + this.uniqueRandomID
      );
    }

    // Extract all registered chrome content urls
    let chromeUrls = [];
    if (this.chromeData) {
      for (let chromeEntry of this.chromeData) {
        if (chromeEntry[0].toLowerCase().trim() == "content") {
          chromeUrls.push("chrome://" + chromeEntry[1] + "/");
        }
      }
    }

    // Unload JSMs of this add-on
    const rootURI = this.extension.rootURI.spec;
    for (let module of Cu.loadedModules) {
      if (
        module.startsWith(rootURI) ||
        (module.startsWith("chrome://") &&
          chromeUrls.find((s) => module.startsWith(s)))
      ) {
        this.log("Unloading: " + module);
        Cu.unload(module);
      }
    }

    // Flush all caches
    Services.obs.notifyObservers(null, "startupcache-invalidate");
    this.registeredWindows = {};

    if (this.resourceData) {
      const resProto = Cc[
        "@mozilla.org/network/protocol;1?name=resource"
      ].getService(Ci.nsISubstitutingProtocolHandler);
      for (let res of this.resourceData) {
        // [ "resource", "shortname" , "path" ]
        resProto.setSubstitution(res[1], null);
      }
    }

    if (this.chromeHandle) {
      this.chromeHandle.destruct();
      this.chromeHandle = null;
    }
  }
};