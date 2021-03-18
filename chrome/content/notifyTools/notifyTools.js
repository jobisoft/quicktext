// Set this to the ID of your add-on.
const ADDON_ID = "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}";

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

var notifyTools = {
  registeredCallbacks: {},
  registeredCallbacksNextId: 1,
  
  onNotifyExperimentObserver: {
    observe: async function (aSubject, aTopic, aData) {
      if (ADDON_ID == "") {
        throw new Error("notifyTools: ADDON_ID is empty!");
      }
      if (aData != ADDON_ID) {
        return;
      }
      // The data has been stuffed in an array so simple strings can be used as
      // payload without the observerService complaining.
      let [data] = aSubject.wrappedJSObject;
      for (let registeredCallback of Object.values(notifyTools.registeredCallbacks)) {
        registeredCallback(data);
      }
    }
  },

  registerListener: function (listener) {
    let id = this.registeredCallbacksNextId++;
    this.registeredCallbacks[id] = listener;
    return id;
  },

  removeListener: function (id) {
    delete this.registeredCallbacks[id];
  },

  notifyBackground: function (data) {
    if (ADDON_ID == "") {
      throw new Error("notifyTools: ADDON_ID is empty!");
    }
    return new Promise(resolve => {
    Services.obs.notifyObservers(
      {data, resolve},
      "WindowListenerNotifyBackgroundObserver",
      ADDON_ID
    );
    });
  }
}

try {
  window.addEventListener("load", function (event) {
    Services.obs.addObserver(notifyTools.onNotifyExperimentObserver, "WindowListenerNotifyExperimentObserver", false);
    window.addEventListener("unload", function (event) {
    Services.obs.removeObserver(notifyTools.onNotifyExperimentObserver, "WindowListenerNotifyExperimentObserver");
    }, false);
  }, false);
} catch (e) {
  console.log("WindowListenerNotifyExperimentObserver cannot be registered in window-less environment")
}
