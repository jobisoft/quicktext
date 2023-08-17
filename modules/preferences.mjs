const userPrefStorageArea = "sync";
const defaultPrefs = {
  "counter": 0,
  "templateFolder": "",
  "defaultImport": "",
  "menuCollapse": true,
  "keywordKey": "Tab",
  "shortcutModifier": "alt",
  "shortcutTypeAdv": false,
  "collapseState": ""
};

export async function getPref(aName) {
  let { userPrefs } = await messenger.storage[userPrefStorageArea].get({"userPrefs":{}});
  if (userPrefs.hasOwnProperty(aName)) {
    return userPrefs[aName];
  }
  return defaultPrefs[aName];
}

export async function setPref(aName, aValue) {
  let { userPrefs } = await messenger.storage[userPrefStorageArea].get({"userPrefs": {}});
  userPrefs[aName] = aValue;
  await messenger.storage[userPrefStorageArea].set({ userPrefs });
}
