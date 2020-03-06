/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = ["ConversionHelper"];

var { ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm");

const ADDON_ID = "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}";

var ConversionHelper = {
  getWXAPI(name, sync=false) {
    function implementation(api) {
      let impl = api.getAPI(context)[name];

      if (name == "storage") {
        impl.local.get = (...args) => impl.local.callMethodInParentProcess("get", args);
        impl.local.set = (...args) => impl.local.callMethodInParentProcess("set", args);
        impl.local.remove = (...args) => impl.local.callMethodInParentProcess("remove", args);
        impl.local.clear = (...args) => impl.local.callMethodInParentProcess("clear", args);
      }
      return impl;
    }

    let extension = ExtensionParent.GlobalManager.getExtension(ADDON_ID);
    // ToDo: Get the true context
    let context = { extension , callOnClose : function() {} };
    
    if (sync) {
      let api = extension.apiManager.getAPI(name, extension, "addon_parent");
      return implementation(api);
    } else {
      return extension.apiManager.asyncGetAPI(name, extension, "addon_parent").then((api) => {
        return implementation(api);
      });
    }
  },
  
  GetStringFromName: function(aName) {
    return this.getWXAPI("i18n", true).getMessage(aName);
  },
  
  formatStringFromName: function(aName, aParams, aLength) {
    return this.getWXAPI("i18n", true).getMessage(aName, aParams);
  },

  
  
  getPref: async function(aName, aFallback = null) {
    let storage = await this.getWXAPI("storage");
    let defaultValue = await storage.local.get({ ["pref.default." + aName] : aFallback });
    let value = await storage.sync.get({ ["pref.value." + aName] :  defaultValue["pref.default." + aName] });
    return value["pref.value." + aName];
  },
  
  setPref: async function(aName, aValue) {
    let storage = await this.getWXAPI("storage");
    await storage.sync.set({ ["pref.value." + aName] : aValue });
  }  
}
