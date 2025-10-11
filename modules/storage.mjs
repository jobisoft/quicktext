/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "./quicktext.mjs";

const defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": JSON.stringify([]),
  "menuCollapse": true,
  "toolbar": true,
  "popup": true,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": "",
  "storageLocations": JSON.stringify([{
    source: "INTERNAL",
    data: "local",
  }]),
  "activeStorageLocationIdx": 0
};

const managedPrefs = [
  "storageLocations",
  "activeStorageLocationIdx",
  "defaultImport",
  "menuCollapse",
  "popup",
  "keywordKey",
  "shortcutModifier",
  "shortcutTypeAdv",
];

let ACTIVE_STORAGE;

async function getActiveStorage() {
  if (!ACTIVE_STORAGE) {
    let storageLocations = JSON.parse(await getPref("storageLocations"));
    let activeStorageLocationIdx = await getPref("activeStorageLocationIdx");
    let { source, data } = storageLocations[activeStorageLocationIdx];
    ACTIVE_STORAGE = {
      source: source.toLowerCase(),
      data,
    }
  }
  return ACTIVE_STORAGE;
}

function migratePrefOnTheFly(data, name) {
  switch (name) {
    case "defaultImport": {
      try {
        JSON.parse(data[name]);
        return data[name];
      } catch {
        // Is not a JSON and needs to be migrated.
      }

      // Assume legacy string, separated by ";"
      let defaultImports = [];
      for (let path of data[name].split(";").map(e => e.trim()).filter(Boolean)) {
        if (!path.match(/^(http|https):\/\//)) {
          defaultImports.push({
            source: "FILE",
            data: path
          })
        } else {
          defaultImports.push({
            source: "URL",
            data: path
          })
        }
      }
      return JSON.stringify(defaultImports);
    }
    default:
      return data[name];
  }
}

async function getManagedPref(aName) {
  if (!managedPrefs.includes(aName)) {
    return undefined;
  }
  try {
    let override = await browser.storage.managed.get({ [aName]: undefined });
    return migratePrefOnTheFly(override, aName);
  } catch {
    // No managed storage available.
  }
  return undefined;
}
async function getLocalPref(aName, aFallback = undefined) {
  const defaultPref = Object.hasOwn(defaultPrefs, aName)
    ? defaultPrefs[aName]
    : aFallback

  return browser.storage.local
    .get({ [aName]: defaultPref })
    .then(o => migratePrefOnTheFly(o, aName));
}

export async function getPrefWithManagedInfo(aName, aFallback = undefined) {
  let managedPref = await getManagedPref(aName);
  if (managedPref !== undefined) {
    return { value: managedPref, isManaged: true }
  }
  let localPref = await getLocalPref(aName, aFallback);
  return { value: localPref, isManaged: false }
}

export async function getPref(aName, aFallback = undefined) {
  const managedPref = await getManagedPref(aName);
  if (managedPref !== undefined) {
    return managedPref;
  }
  return getLocalPref(aName, aFallback);
}

export async function setPref(aName, aValue) {
  await browser.storage.local.set({ [aName]: aValue });
}
export async function clearPref(aName) {
  await browser.storage.local.remove(aName);
}

/**
 * Read data fronm the active storage.
 * 
 * @param {scripts|templates} type 
 */
async function readDataFromStorage(type) {
  const { source, data: path } = await getActiveStorage();
  const DEFAULT_RV = {
    scripts: [],
    templates: { groups: [], texts: [] },
  }
  try {
    switch (source) {
      case "internal":
        return browser.storage.local.get({ [type]: null })
          .then(e => e[type] ? JSON.parse(e[type]) : null);
      case "file": {
        // Try reading the cache first.
        const cache = await browser.storage.session.get({ [type]: null })
          .then(e => e[type] ? JSON.parse(e[type]) : null);
        if (cache) {
          return cache;
        }

        // Read the actual storage.
        const content = await browser.Quicktext.readTextFile(`${type}.json`, path);
        const parsed = await quicktext.parseConfigFileData(content);
        if (parsed[type]) {
          // Update cache.
          await browser.storage.session.set({ [type]: JSON.stringify(parsed[type]) });
          return parsed[type];
        }
        break;
      }
      default:
        throw new Error(`Unkown storage source "${source}".`);
    }
  } catch (ex) {
    // Failed, use default.
    console.log(ex)
  }
  return DEFAULT_RV[type];
}

/**
 * Write data to the active storage.
 * 
 * @param {scripts|templates} type
 * @param {object} content 
 */
async function writeDataToStorage(type, content) {
  const { source, data: path } = await getActiveStorage();
  try {
    switch (source) {
      case "internal":
        await browser.storage.local.set({ [type]: JSON.stringify(content) });
        break;
      case "file": {
        // Check for changes.
        const stringContent = JSON.stringify(content);
        const cache = await browser.storage.session.get({ [type]: null })
          .then(e => e[type] ? e[type] : null);
        if (cache && cache == stringContent) {
          return;
        }

        // Update cache and write to the actual storage..
        await browser.storage.session.set({ [type]: stringContent });
        await browser.Quicktext.writeTextFile(`${type}.json`, JSON.stringify({ [type]: content }), path);
        break;
      }
      default:
        throw new Error(`Unkown storage source "${source}".`);
    }
  } catch (ex) {
    // Failed.
    console.log(ex)
  }
}

export async function setTemplates(templates) {
  return writeDataToStorage("templates", templates);
}
export async function getTemplates() {
  return readDataFromStorage("templates")
}
export async function setScripts(scripts) {
  return writeDataToStorage("scripts", scripts);
}
export async function getScripts() {
  return readDataFromStorage("scripts")
}

export async function migrate() {
  // Migrate options from sync to local storage, as sync storage can only hold
  // 100 KB which will not be enough for templates.
  const { userPrefs: syncUserPrefs } = await browser.storage.sync.get({ userPrefs: undefined });
  if (syncUserPrefs) {
    await browser.storage.local.set({ userPrefs: syncUserPrefs });
    await browser.storage.sync.remove("userPrefs");
  }

  // Migrate from userPrefs/defaultPrefs objects to *.value and *.default.
  const { userPrefs: v1UserPrefs } = await browser.storage.local.get({ userPrefs: undefined });
  if (v1UserPrefs) {
    for (let [key, value] of Object.entries(v1UserPrefs)) {
      await browser.storage.local.set({ [`${key}.value`]: value });
    }
    await browser.storage.local.remove("userPrefs");
  }
  const { defaultPrefs: v1DefaultPrefs } = await browser.storage.local.get({ defaultPrefs: undefined });
  if (v1DefaultPrefs) {
    await browser.storage.local.remove("defaultPrefs");
  }

  // Migrate from *.value and *.default to simple values.
  for (let aName of Object.keys(defaultPrefs)) {
    const aValue = await browser.storage.local
      .get({ [`${aName}.value`]: undefined })
      .then(o => o[`${aName}.value`]);
    if (aValue !== undefined) {
      await browser.storage.local.remove(`${aName}.value`);
      await browser.storage.local.set({ [aName]: aValue });
    }
    await browser.storage.local.remove(`${aName}.default`);
    await browser.storage.local.remove(`${aName}.managed.value`);
  }
}

export class StorageListener {
  #watchedPrefs = [];
  #listener = null;
  #timeoutId;
  #changedWatchedPrefs = {};

  #eventEmitter() {
    this.#listener(this.#changedWatchedPrefs);
    this.#changedWatchedPrefs = {}
  }

  #eventCollapse = async (changes, area) => {
    if (area == "local") {
      for (let [key, value] of Object.entries(changes)) {
        const watchedPref = this.#watchedPrefs.find(p => key == p);

        // Do not monitor managed prefs.
        let managedPref = await getManagedPref(key);
        if (managedPref !== undefined) {
          continue;
        }

        if (watchedPref && value.oldValue != value.newValue) {
          this.#changedWatchedPrefs[watchedPref] = value;
        }
      }

      if (Object.keys(this.#changedWatchedPrefs).length > 0) {
        window.clearTimeout(this.#timeoutId);
        this.#timeoutId = window.setTimeout(() => this.#eventEmitter(), 500);
      }
    }
  }

  constructor(options = {}) {
    this.#watchedPrefs = options.watchedPrefs || [];
    this.#listener = options.listener;
    browser.storage.onChanged.addListener(this.#eventCollapse);
  }
}