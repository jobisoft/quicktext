/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": "",
  "menuCollapse": true,
  "toolbar": true,
  "popup": true,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": ""
};

const managedPrefs = [
  "defaultImport",
  "menuCollapse",
  "popup",
  "keywordKey",
  "shortcutModifier",
  "shortcutTypeAdv",
];

async function getManagedPref(aName) {
  if (!managedPrefs.includes(aName)) {
    return undefined;
  }
  try {
    let override = await browser.storage.managed.get({ [aName]: undefined });
    return override[aName];
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
    .then(o => o[aName]);
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

export async function setTemplates(templates) {
  await browser.storage.local.set({ templates: JSON.stringify(templates) });
}
export async function getTemplates() {
  return browser.storage.local.get({ templates: null }).then(
    e => e.templates ? JSON.parse(e.templates) : null);
}

export async function setScripts(scripts) {
  await browser.storage.local.set({ scripts: JSON.stringify(scripts) });
}
export async function getScripts() {
  return browser.storage.local.get({ scripts: null }).then(
    e => e.scripts ? JSON.parse(e.scripts) : null);
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