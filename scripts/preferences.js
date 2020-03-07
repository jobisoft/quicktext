var preferences = {
  setDefaults: async function(defaultPrefs) {
    // set defaultPrefs in local storage, so we can access them from everywhere
    const prefs = Object.keys(defaultPrefs);
    for (const pref of prefs) {
        await browser.storage.local.set({ ["pref.default." + pref] : defaultPrefs[pref] });
    }

    // The following migration block can be removed, when definitly all users
    // have been migrated, or experiments are no longer allowed.
    
    // ** MIGRATION BEGIN ** //
    
    for (const pref of prefs) {
      let legacyValue = await browser.legacyprefs.get("extensions.quicktext." + pref, defaultPrefs[pref]);
      if (legacyValue !== null) {
        console.log("Migrating legacy preference <extensions.quicktext." +pref + "> = <" + legacyValue + ">.");
        await browser.storage.sync.set({ ["pref.value." + pref] : legacyValue });
        await browser.legacyprefs.clear("extensions.quicktext." + pref);
      }
    }

    // ** MIGRATION END ** //

  },
   
  getPref: async function(aName, aFallback = null) {
    let defaultValue = await browser.storage.local.get({ ["pref.default." + aName] : aFallback });
    let value = await browser.storage.sync.get({ ["pref.value." + aName] :  defaultValue["pref.default." + aName] });
    return value["pref.value." + aName];
  },

  setPref: async function(aName, aValue) {
    await browser.storage.sync.set({ ["pref.value." + aName] : aValue });
  },

  load: async function(document) {
    for (let node of document.querySelectorAll("[preference]")) {
      if (node.getAttribute("instantApply") == "true") {
        node.addEventListener("change", function(event) {this.savePref(event.target);});
      }
    this.loadPref(node);    
    }
  },

  save: async function(document) {
    for (let node of document.querySelectorAll("[preference]")) {
      this.savePref(node);    
    }
  },

  loadPref: async function(node) {
    switch (node.tagName.toLowerCase()) {
      case "input":
        node.setAttribute("value", await this.getPref(node.getAttribute("preference")));
        break;
    }
  },

  savePref: async function(node) {
    switch (node.tagName.toLowerCase()) {
      case "input":
        await this.setPref(node.getAttribute("preference"), node.value);
        break;
    }
  }
}



