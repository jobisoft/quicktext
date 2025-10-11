var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);
var extension = ExtensionParent.GlobalManager.getExtension(
  "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}"
);
var { wzQuicktextGroup } = ChromeUtils.importESModule(
  `chrome://quicktext/content/wzQuicktextGroup.sys.mjs?v=${extension.manifest.version}`
);
var { wzQuicktextTemplate } = ChromeUtils.importESModule(
  `chrome://quicktext/content/wzQuicktextTemplate.sys.mjs?v=${extension.manifest.version}`
);
var { wzQuicktextScript } = ChromeUtils.importESModule(
  `chrome://quicktext/content/wzQuicktextScript.sys.mjs?v=${extension.manifest.version}`
);

const kFileShortcuts = ['ProfD', 'UsrDocs', 'Home', 'Desk', 'Pers'];
const OS = Services.appinfo.OS;

Services.scriptloader.loadSubScript("resource://quicktext/api/NotifyTools/notifyTools.js", window, "UTF-8");


function isIncompatibleScript(script) {
  const targets = ["this.mWindow", "this.mVariables", "this.mQuicktext"];
  return script && targets.some(target => script.script.includes(target));
}

// This exists for historic reasons, but all of it is related to the settings
// dialog as well.
var gQuicktext = {
  mGroup: [],
  mTexts: [],
  mScripts: [],
  mEditingGroup: [],
  mEditingTexts: [],
  mEditingScripts: [],
  mViewPopup: false,
  mCollapseGroup: true,
  mDefaultImport: "",
  mKeywordKey: "Tab",
  mShortcutModifier: "alt",
  mShortcutTypeAdv: false,
  mObserverList: [],
  mCollapseState: "",
  mSelectionContent: "",
  mSelectionContentHtml: "",
  mCurrentTemplate: "",

  get viewToolbar() { return this.mViewToolbar; },
  set viewToolbar(aViewToolbar) {
    this.mViewToolbar = aViewToolbar;
    this.notifyObservers("updatetoolbar", "");

    return this.mViewToolbar;
  },
  get viewPopup() { return this.mViewPopup; },
  set viewPopup(aViewPopup) {
    this.mViewPopup = aViewPopup;
    return this.mViewPopup;
  },
  get collapseGroup() { return this.mCollapseGroup; },
  set collapseGroup(aCollapseGroup) {
    this.mCollapseGroup = aCollapseGroup;
    this.notifyObservers("updatesettings", "");

    return this.mCollapseGroup;
  },
  get defaultImport() { return this.mDefaultImport; },
  set defaultImport(aDefaultImport) {
    this.mDefaultImport = aDefaultImport;
    return this.mDefaultImport;
  },
  get storageLocations() { return this.mStorageLocations; },
  set storageLocations(aStorageLocations) {
    this.mStorageLocations = aStorageLocations;
    return this.mStorageLocations;
  },
  get keywordKey() { return this.mKeywordKey; },
  set keywordKey(aKeywordKey) {
    this.mKeywordKey = aKeywordKey;
    return this.mKeywordKey;
  },
  get shortcutModifier() { return this.mShortcutModifier; },
  set shortcutModifier(aShortcutModifier) {
    this.mShortcutModifier = aShortcutModifier;
    return this.mShortcutModifier;
  },
  get collapseState() { return this.mCollapseState; },
  set collapseState(aCollapseState) {
    this.mCollapseState = aCollapseState;
    return this.mCollapseState;
  },
  get shortcutTypeAdv() {
    if (OS.substr(0, 3).toLowerCase() == "mac" || (OS.substr(0, 3).toLowerCase() == "win" && this.mShortcutModifier == "alt"))
      return false;

    return this.mShortcutTypeAdv;
  },
  set shortcutTypeAdv(aShortcutTypeAdv) {
    this.mShortcutTypeAdv = aShortcutTypeAdv;
    return this.mShortcutTypeAdv;
  },
  loadSettings: async function () {
    const scripts = await notifyTools.notifyBackground({ command: "getScripts" });
    const { groups, texts } = await notifyTools.notifyBackground({ command: "getTemplates" });

    this.mScripts = (scripts || []).map(e => new wzQuicktextScript(e));
    this.mGroup = (groups || []).map(e => new wzQuicktextGroup(e));
    this.mTexts = []
    // The templates are grouped.
    for (let groupTexts of (texts || [])) {
      this.mTexts.push(groupTexts.map(e => new wzQuicktextTemplate(e)))
    }

    // Get prefs
    this.mViewToolbar = await notifyTools.notifyBackground({ command: "getPref", pref: "toolbar" });
    this.mCollapseState = await notifyTools.notifyBackground({ command: "getPref", pref: "collapseState" });

    this.mCollapseGroup = await notifyTools.notifyBackground({ command: "getPref", pref: "menuCollapse" });
    this.mViewPopup = await notifyTools.notifyBackground({ command: "getPref", pref: "popup" });
    this.mKeywordKey = await notifyTools.notifyBackground({ command: "getPref", pref: "keywordKey" });
    this.mShortcutTypeAdv = await notifyTools.notifyBackground({ command: "getPref", pref: "shortcutTypeAdv" });
    this.mShortcutModifier = await notifyTools.notifyBackground({ command: "getPref", pref: "shortcutModifier" });
    this.mDefaultImport = await notifyTools.notifyBackground({ command: "getPref", pref: "defaultImport" });

    // Managed prefs cannot be changed by the user.
    for (let { pref, elemId, m } of [
      { pref: "menuCollapse", elemId: "checkbox-collapseGroup", m: this.mCollapseGroup },
      { pref: "popup", elemId: "checkbox-viewPopup", m: this.mViewPopup },
      { pref: "keywordKey", elemId: "select-keywordKey", m: this.mKeywordKey },
      { pref: "shortcutTypeAdv", elemId: "checkbox-shortcutTypeAdv", m: this.mShortcutTypeAdv },
      { pref: "shortcutModifier", elemId: "select-shortcutModifier", m: this.mShortcutModifier },
    ]) {
      const { value, isManaged } = await notifyTools.notifyBackground({
        command: "getPrefWithManagedInfo",
        pref
      });
      m = value;
      if (isManaged) {
        const element = document.getElementById(elemId);
        element.setAttribute("disabled", "true");
        element.setAttribute('tooltiptext', extension.localeData.localizeMessage("controlled-via-managed-storage"));
      }
    }

    this.startEditing();

    // Notify that settings has been changed
    this.notifyObservers("updatesettings", "");
  },
  // Rename the legacy quicktext class members.
  prettify(data) {
    function prettifier(value) {
      if (Array.isArray(value)) {
        let pArray = [];
        for (let entry of value) {
          pArray.push(prettifier(entry))
        }
        return pArray;
      }

      if (typeof value === 'object' && value !== null) {
        let pObj = {};
        for (let [k, v] of Object.entries(value)) {
          const pKey = k.startsWith("m")
            ? k[1].toLowerCase() + k.slice(2)
            : k;
          pObj[pKey] = prettifier(v);
        }
        return pObj;
      }

      return value;
    }
    return prettifier(data);
  },

  saveSettings: async function () {
    // Save prefs.
    await notifyTools.notifyBackground({ command: "setPref", pref: "toolbar", value: this.mViewToolbar });
    await notifyTools.notifyBackground({ command: "setPref", pref: "menuCollapse", value: this.mCollapseGroup });
    await notifyTools.notifyBackground({ command: "setPref", pref: "keywordKey", value: this.mKeywordKey });
    await notifyTools.notifyBackground({ command: "setPref", pref: "popup", value: this.mViewPopup });
    await notifyTools.notifyBackground({ command: "setPref", pref: "shortcutTypeAdv", value: this.mShortcutTypeAdv });
    await notifyTools.notifyBackground({ command: "setPref", pref: "shortcutModifier", value: this.mShortcutModifier });
    await notifyTools.notifyBackground({ command: "setPref", pref: "collapseState", value: this.mCollapseState });
    await notifyTools.notifyBackground({ command: "setPref", pref: "defaultImport", value: this.mDefaultImport });
    await notifyTools.notifyBackground({ command: "setPref", pref: "storageLocations", value: this.mStorageLocations });

    // Save templates and scripts.
    this.endEditing();
    const templates = { texts: this.prettify(this.mTexts), groups: this.prettify(this.mGroup) }
    const scripts = this.prettify(this.mScripts);
    await notifyTools.notifyBackground({ command: "setScripts", data: scripts });
    await notifyTools.notifyBackground({ command: "setTemplates", data: templates });
    await notifyTools.notifyBackground({ command: "checkBadEntries", data: { scripts, templates } });
    this.startEditing();

    this.notifyObservers("updatesettings", "");
  },
  addGroup: function (aName, aEditingMode) {
    var tmp = new wzQuicktextGroup();
    tmp.name = aName;
    tmp.protected = false;

    if (aEditingMode) {
      this.mEditingGroup.push(tmp);
      this.mEditingTexts.push([]);
    }
    else {
      this.mGroup.push(tmp);
      this.mTexts.push([]);
    }
  },
  removeGroup: function (aRow, aEditingMode) {
    if (aEditingMode) {
      this.mEditingGroup.splice(aRow, 1);
      this.mEditingTexts.splice(aRow, 1);
    }
    else {
      this.mGroup.splice(aRow, 1);
      this.mTexts.splice(aRow, 1);
    }
  },
  getGroup: function (aGroupIndex, aEditingMode) {
    if (aEditingMode) {
      if (typeof this.mEditingGroup[aGroupIndex] != 'undefined')
        return this.mEditingGroup[aGroupIndex];
    }
    else {
      if (typeof this.mGroup[aGroupIndex] != 'undefined')
        return this.mGroup[aGroupIndex];
    }
  },
  getGroupLength: function (aEditingMode) {
    if (aEditingMode)
      return this.mEditingGroup.length;
    else
      return this.mGroup.length;
  },
  moveGroup: function (aFromIndex, aToIndex, aEditingMode) {
    if (aEditingMode) {
      var tmpGroup = this.mEditingGroup.splice(aFromIndex, 1)[0];
      var tmpTexts = this.mEditingTexts.splice(aFromIndex, 1)[0];
      if (aToIndex > aFromIndex) {
        this.mEditingGroup.splice(aToIndex - 1, 0, tmpGroup);
        this.mEditingTexts.splice(aToIndex - 1, 0, tmpTexts);
      }
      else {
        this.mEditingGroup.splice(aToIndex, 0, tmpGroup);
        this.mEditingTexts.splice(aToIndex, 0, tmpTexts);
      }
    }
    else {
      var tmpGroup = this.mGroup.splice(aFromIndex, 1)[0];
      var tmpTexts = this.mTexts.splice(aFromIndex, 1)[0];
      if (aToIndex > aFromIndex) {
        this.mGroup.splice(aToIndex - 1, 0, tmpGroup);
        this.mTexts.splice(aToIndex - 1, 0, tmpTexts);
      }
      else {
        this.mGroup.splice(aToIndex, 0, tmpGroup);
        this.mTexts.splice(aToIndex, 0, tmpTexts);
      }
    }
  },
  addText: function (aGroupIndex, aName, aEditingMode) {
    var tmp = new wzQuicktextTemplate();
    tmp.name = aName;
    tmp.shortcut = "";

    if (aEditingMode)
      this.mEditingTexts[aGroupIndex].push(tmp);
    else
      this.mTexts[aGroupIndex].push(tmp);
  },
  removeText: function (aGroupIndex, aRow, aEditingMode) {
    if (aEditingMode)
      this.mEditingTexts[aGroupIndex].splice(aRow, 1);
    else
      this.mTexts[aGroupIndex].splice(aRow, 1);
  },
  getText: function (aGroupIndex, aTextIndex, aEditingMode) {
    if (aEditingMode) {
      if (typeof this.mEditingTexts[aGroupIndex][aTextIndex] != 'undefined')
        return this.mEditingTexts[aGroupIndex][aTextIndex];
    }
    else {
      if (typeof this.mTexts[aGroupIndex][aTextIndex] != 'undefined')
        return this.mTexts[aGroupIndex][aTextIndex];
    }
  },
  getTextLength: function (aGroupIndex, aEditingMode) {
    if (aEditingMode) {
      if (this.mEditingTexts[aGroupIndex])
        return this.mEditingTexts[aGroupIndex].length;
    }
    else {
      if (this.mTexts[aGroupIndex])
        return this.mTexts[aGroupIndex].length;
    }

    return 0;
  },
  doTextExists: function (aGroupIndex, aTextIndex, aEditingMode) {
    if (aEditingMode)
      return (typeof this.mEditingTexts[aGroupIndex][aTextIndex] != 'undefined') ? true : false;
    else
      return (typeof this.mTexts[aGroupIndex][aTextIndex] != 'undefined') ? true : false;
  },
  moveText: function (aFromGroupIndex, aFromTextIndex, aToGroupIndex, aToTextIndex, aEditingMode) {
    if (aEditingMode) {
      var tmpText = this.mEditingTexts[aFromGroupIndex].splice(aFromTextIndex, 1)[0];
      if (aFromGroupIndex == aToGroupIndex && aFromTextIndex < aToTextIndex)
        this.mEditingTexts[aToGroupIndex].splice(aToTextIndex - 1, 0, tmpText);
      else
        this.mEditingTexts[aToGroupIndex].splice(aToTextIndex, 0, tmpText);
    }
    else {
      var tmpText = this.mTexts[aFromGroupIndex].splice(aFromTextIndex, 1)[0];
      if (aFromGroupIndex == aToGroupIndex && aFromTextIndex < aToTextIndex)
        this.mTexts[aFromGroupIndex].splice(aToTextIndex - 1, 0, tmpText);
      else
        this.mTexts[aFromGroupIndex].splice(aToTextIndex, 0, tmpText);
    }
  },
  addScript: function (aName, aEditingMode) {
    var tmp = new wzQuicktextScript();
    tmp.name = aName;
    tmp.protected = false;

    if (aEditingMode)
      this.mEditingScripts.push(tmp);
    else
      this.mScripts.push(tmp);
  },
  removeScript: function (aIndex, aEditingMode) {
    if (aEditingMode)
      this.mEditingScripts.splice(aIndex, 1);
    else
      this.mScripts.splice(aIndex, 1);
  },
  getScript: function (aIndex, aEditingMode) {
    if (aEditingMode) {
      if (typeof this.mEditingScripts[aIndex] != 'undefined')
        return this.mEditingScripts[aIndex];
    }
    else {
      if (typeof this.mScripts[aIndex] != 'undefined')
        return this.mScripts[aIndex];
    }
  },
  getScriptLength: function (aEditingMode) {
    if (aEditingMode)
      return this.mEditingScripts.length;
    else
      return this.mScripts.length;
  },

  // Create temporary vars that hold the edited-but-not-yet-saved scripts and
  // templates.
  startEditing: function () {
    this.mEditingGroup = [];
    this.mEditingTexts = [];
    for (var i = 0; i < this.mGroup.length; i++) {
      this.mEditingGroup[i] = this.mGroup[i].clone();
      this.mEditingTexts[i] = [];
      if (this.mTexts[i])
        for (var j = 0; j < this.mTexts[i].length; j++)
          this.mEditingTexts[i][j] = this.mTexts[i][j].clone();
    }

    this.mEditingScripts = [];
    for (var i = 0; i < this.mScripts.length; i++) {
      this.mEditingScripts[i] = this.mScripts[i].clone();
    }
  },
  // When the editing ended, move the values back to the original vars.
  endEditing: function () {
    this.mGroup = [];
    this.mTexts = [];
    for (var i = 0; i < this.mEditingGroup.length; i++) {
      this.mGroup[i] = this.mEditingGroup[i].clone();
      this.mTexts[i] = [];
      if (this.mEditingTexts[i])
        for (var j = 0; j < this.mEditingTexts[i].length; j++)
          this.mTexts[i][j] = this.mEditingTexts[i][j].clone();
    }

    this.mScripts = [];
    for (var i = 0; i < this.mEditingScripts.length; i++) {
      this.mScripts[i] = this.mEditingScripts[i].clone();
    }
  },

  /*
   * FILE FUNCTIONS (will be replaced by picker from the planned vfs API)
   */
  async pickFile(aTypes, aMode, aTitle) {
    let filePicker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
    switch (aMode) {
      case 2: // modeGetFolder
        filePicker.init(window.browsingContext, aTitle, filePicker.modeGetFolder);
        break;
      case 1: // save
        filePicker.init(window.browsingContext, aTitle, filePicker.modeSave);
        break;
      default: // open
        filePicker.init(window.browsingContext, aTitle, filePicker.modeOpen);
        break;
    }

    for (let aType of aTypes) {
      switch (aType) {
        case 0: // insert TXT file
          filePicker.appendFilters(filePicker.filterText);
          filePicker.defaultExtension = "txt";
          break;
        case 1: // insert HTML file
          filePicker.appendFilters(filePicker.filterHTML);
          filePicker.defaultExtension = "html";
          break;
        case 2: // insert file
          break;
        case 3: // Quicktext XML file
          filePicker.appendFilter("Quicktext XML Export", "*.xml");
          filePicker.defaultExtension = "xml";
          break;
        case 4: // images
          filePicker.appendFilters(filePicker.filterImages);
        case 5: // JSON
          filePicker.appendFilter("Quicktext JSON Export", "*.json");
          filePicker.defaultExtension = "json";
        default: // attachments
          break;
      }
    }

    filePicker.appendFilters(filePicker.filterAll);

    let rv = await new Promise(function (resolve, reject) {
      filePicker.open(result => {
        resolve(result);
      });
    });

    if (rv == filePicker.returnOK || rv == filePicker.returnReplace) {
      return filePicker.file;
    } else {
      return null;
    }
  },
  importTemplates(templates) {
    let importedGroup = (templates?.groups || []).map(e => new wzQuicktextGroup(e));
    let importedTexts = [];
    // The templates are grouped.
    for (let texts of templates?.texts || []) {
      importedTexts.push(texts.map(e => new wzQuicktextTemplate(e)))
    }

    // Imports are not not saved directly, but imported as unsaved changes.
    for (var i = 0; i < importedGroup.length; i++)
      this.mEditingGroup.push(importedGroup[i]);
    for (var i = 0; i < importedTexts.length; i++)
      this.mEditingTexts.push(importedTexts[i]);
  },
  importScripts(scripts) {
    let importedScripts = scripts.map(e => new wzQuicktextScript(e));

    // Imports are not not saved directly, but imported as unsaved changes.
    for (var i = 0; i < importedScripts.length; i++)
      this.mEditingScripts.push(importedScripts[i]);
  },

  /*
   * OBSERVERS
   */
  addObserver: function (aObserver) {
    this.mObserverList.push(aObserver);
  },
  removeObserver: function (aObserver) {
    for (var i = 0; i < this.mObserverList.length; i++) {
      if (this.mObserverList[i] == aObserver)
        this.mObserverList.splice(i, 1);
    }
  },
  notifyObservers: function (aTopic, aData) {
    for (var i = 0; i < this.mObserverList.length; i++)
      this.mObserverList[i].observe(this, aTopic, aData);
  }
}

class SourceListBox {
  #listBox
  #loadCallback
  #updateCallback
  #selectCallback
  #canRemoveCallback
  #canSelectCallback
  #buttonDefinitions

  constructor({ listBoxId, loadCallback, updateCallback, selectCallback, canRemoveCallback, canSelectCallback, buttonDefinitions }) {
    this.#listBox = document.getElementById(listBoxId);
    this.#loadCallback = loadCallback;
    this.#updateCallback = updateCallback;
    this.#selectCallback = selectCallback;
    this.#canRemoveCallback = canRemoveCallback;
    this.#canSelectCallback = canSelectCallback;
    this.#buttonDefinitions = buttonDefinitions;
  }

  get defaultUrlValue() {
    return "https://";
  }

  get listBox() {
    return this.#listBox;
  }

  async load() {
    const {
      entries,
      activeIdx,
    } = await this.#loadCallback();


    for (let [elementId, definition] of Object.entries(this.#buttonDefinitions)) {
      if (!definition.isManaged) {
        document.getElementById(elementId).removeAttribute("disabled");
      }
      document.getElementById(elementId).addEventListener("command", () => this[definition.callback](), false);
    }

    for (let i = 0; i < entries.length; i++) {
      const item = await this.addItem(entries[i]);
      if (i == activeIdx) {
        item.dataset.active = "true";
        this.listBox.selectedIndex = i;
      }
    }
    this.listBox.addEventListener("select", () => this.checkButtons());
    this.checkButtons();
  }

  checkButtons() {
    if (this.#canRemoveCallback) {
      const canRemove = this.#canRemoveCallback(this.listBox.selectedIndex, this.activeIdx);
      let btns = Object.entries(this.#buttonDefinitions).filter(e => e[1].callback == "removeItem");
      for (let [btnId, definition] of btns) {
        if (definition.isManaged) {
          continue;
        }

        if (canRemove) {
          document.getElementById(btnId).removeAttribute("disabled");
        } else {
          document.getElementById(btnId).setAttribute("disabled", "true");
        }
      }
    }
    if (this.#canSelectCallback) {
      const canSelect = this.#canSelectCallback(this.listBox.selectedIndex, this.activeIdx);
      let btns = Object.entries(this.#buttonDefinitions).filter(e => e[1].callback == "selectItem");
      for (let [btnId, definition] of btns) {
        if (definition.isManaged) {
          continue;
        }

        if (canSelect) {
          document.getElementById(btnId).removeAttribute("disabled");
        } else {
          document.getElementById(btnId).setAttribute("disabled", "true");
        }
      }
    }
  }

  get activeIdx() {
    const childrenArray = Array.from(this.listBox.children);
    const activeIdx = childrenArray.findIndex(e => e.dataset.active === "true");
    return activeIdx;
  }

  get value() {
    let entries = [];
    for (let child of this.listBox.children) {
      entries.push({
        source: child.dataset.source,
        data: child.dataset.data,
      })
    }
    return entries;
  }

  async update() {
    if (this.#updateCallback) {
      await this.#updateCallback(this.value, this.activeIdx);
    }
    this.checkButtons();
  }

  getLabel(entry) {
    return entry.source.toLowerCase() == "internal"
      ? extension.localeData.localizeMessage(`quicktext.storage.internal.${entry.data.toLowerCase()}.label`)
      : entry.data
  }

  async addItem(entry) {
    let newItem = document.createXULElement("richlistitem");
    newItem.dataset.source = entry.source;
    newItem.dataset.data = entry.data;

    const ICONS = {
      "url": "🌎",
      "file": "💻", // 🗎
      "internal": "📦", // 🏠,📦
    }

    let newItemType = document.createXULElement("label");
    newItemType.value = ICONS[entry.source.toLowerCase()] ?? "⚠️";
    newItemType.style.width = "16px";
    newItemType.style.display = "block";
    newItemType.style.textAlign = "center";
    newItem.appendChild(newItemType);

    let newItemLabel = document.createXULElement("label");
    newItemLabel.value = this.getLabel(entry);
    if (entry.source.toLowerCase() == "url") {
      newItem.addEventListener("dblclick", () => {
        let input = document.createElement("input");
        input.value = newItemLabel.value;
        input.dataset.originalValue = newItemLabel.value;
        newItemLabel.parentNode.replaceChild(input, newItemLabel);
        input.focus();

        // commit value on Enter
        const commit = (data) => {
          newItemLabel.value = data;
          input.parentNode.replaceChild(newItemLabel, input);
          newItem.dataset.data = data;
        };

        input.addEventListener("blur", (e) => {
          commit(input.value);
          this.update();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            commit(input.value);
            this.update();
          }
          if (e.key === "Escape") {
            if (input.dataset.originalValue == this.defaultUrlValue) {
              this.listBox.removeChild(newItem);
            } else {
              commit(input.dataset.originalValue);
            }
            this.update();
          }
        }, true);

      });
    }
    newItem.appendChild(newItemLabel);

    this.listBox.appendChild(newItem);
    return newItem;
  }

  async addUrlItem() {
    const item = await this.addItem({
      source: "URL",
      data: this.defaultUrlValue,
    });
    await this.update();
    item.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      cancelable: true,
      view: window,
      detail: 2
    }));
  }

  async addFileItem() {
    const file = await gQuicktext.pickFile([5, 3], 0, extension.localeData.localizeMessage("importFile"));
    if (!file) return;
    await this.addItem({
      source: "FILE",
      data: file.path,
    });
    await this.update();
  }

  async addFolderItem() {
    const folder = await gQuicktext.pickFile([], 2, "select folder");
    if (!folder) return;
    await this.addItem({
      source: "FILE",
      data: folder.path,
    });
    await this.update();
  }

  async selectItem() {
    if (this.#selectCallback) {
      await this.#selectCallback(this.listBox.selectedIndex);
    }
  }

  async removeItem() {
    let item = this.listBox.getItemAtIndex(this.listBox.selectedIndex);
    if (item) {
      this.listBox.removeChild(item);
    }
    await this.update();
  }
}

var settingsDialog = {
  mChangesMade: false,
  mTextChangesMade: [],
  mScriptChangesMade: [],
  mGeneralChangesMade: [],
  mTreeArray: [],
  mCollapseState: [],
  mScriptIndex: null,
  mPickedIndex: null,

  init: async function () {
    await window.i18n.updateDocument({ extension });
    document.getElementById('quicktextSettingsWindow').setAttribute("OS", Services.appinfo.OS);
    console.log("Adding attribute 'OS' = '" + Services.appinfo.OS + "' to settings dialog element.");

    gQuicktext.addObserver(this);
    await gQuicktext.loadSettings()

    var states = gQuicktext.collapseState;
    if (states != "") {
      states = states.split(/;/);
      for (var i = 0; i < states.length; i++)
        this.mCollapseState[i] = (states[i] == "1");
    }

    var groupLength = gQuicktext.getGroupLength(true);
    if (states.length < groupLength) {
      for (var i = states.length; i < groupLength; i++)
        this.mCollapseState[i] = true;
    }

    document.getElementById('tabbox-main').selectedIndex = 1;
    document.getElementById('tabpanels-main').addEventListener("select", function (e) {
      document.getElementById('scripthelpbutton').dataset.selectedTabIndex = document.getElementById('tabbox-main').selectedIndex;
    }, false);

    document.getElementById('text-keyword').addEventListener("keypress", function (e) { settingsDialog.noSpaceForKeyword(e); }, false);

    this.disableSave();
    document.getElementById("savebutton").addEventListener("command", function (e) { settingsDialog.save(); }, false);
    document.getElementById("closebutton").addEventListener("command", function (e) { settingsDialog.close(true); }, false);
    document.getElementById("helpbutton").addEventListener("command", function (e) { settingsDialog.openHomepage(); }, false);
    document.getElementById("scripthelpbutton").addEventListener("command", function (e) { settingsDialog.openScriptHelp(); }, false);

    // Update boxHeightOffset
    let scriptListElem = document.getElementById('script-list');
    let elementHeight = scriptListElem.getBoundingClientRect().height;
    boxHeightOffset = window.innerHeight - elementHeight;

    // Load defaultImport
    {
      const {
        value: defaultImportEntries,
        isManaged: defaultImportEntriesManaged,
      } = await notifyTools.notifyBackground({
        command: "getPrefWithManagedInfo",
        pref: "defaultImport"
      });

      const defaultImportUI = new SourceListBox({
        listBoxId: "box-defaultImport",
        loadCallback: async () => {
          document.getElementById("box-defaultImport").dataset.value = defaultImportEntries;
          return {
            entries: JSON.parse(defaultImportEntries),
          }
        },
        updateCallback: (updatedEntries, activeIdx) => {
          document.getElementById("box-defaultImport").dataset.value = JSON.stringify(updatedEntries);
          settingsDialog.checkForGeneralChanges(5);
        },
        buttonDefinitions: {
          "defaultImport_remove": { callback: "removeItem", isManaged: defaultImportEntriesManaged },
          "defaultImport_addUrlItem": { callback: "addUrlItem", isManaged: defaultImportEntriesManaged },
          "defaultImport_addFileItem": { callback: "addFileItem", isManaged: defaultImportEntriesManaged },
        }
      })
      await defaultImportUI.load();
    }

    // Storage location
    {
      const {
        value: storageLocationEntries,
        isManaged: storageLocationsManaged,
      } = await notifyTools.notifyBackground({
        command: "getPrefWithManagedInfo",
        pref: "storageLocations"
      });
      const {
        value: activeStorageLocationIdx,
        isManaged: activeStorageLocationIdxManaged,
      } = await notifyTools.notifyBackground({
        command: "getPrefWithManagedInfo",
        pref: "activeStorageLocationIdx"
      });

      const storageLocationsUI = new SourceListBox({
        listBoxId: "box-storageLocations",
        loadCallback: async () => {
          const entries = JSON.parse(storageLocationEntries);
          if (!(
            entries.some(e => e.source.toLowerCase() == "internal") &&
            entries.some(e => e.data.toLowerCase() == "local")
          )) {
            entries.unshift({
              source: "INTERNAL",
              data: "local",
            })
          }
          document.getElementById("box-storageLocations").dataset.value = storageLocationEntries;
          document.getElementById("box-storageLocations").dataset.activeIdx = activeStorageLocationIdx;
          return {
            entries,
            activeIdx: activeStorageLocationIdx,
          }
        },
        updateCallback: async (updatedEntries, activeIdx) => {
          document.getElementById("box-storageLocations").dataset.value = JSON.stringify(updatedEntries);
          document.getElementById("box-storageLocations").dataset.activeIdx = activeIdx;
          settingsDialog.checkForGeneralChanges(6);
        },
        selectCallback: async (idx) => {
          // Save the current list of storage entries.
          await notifyTools.notifyBackground({
            command: "setPref",
            pref: "storageLocations",
            value: document.getElementById("box-storageLocations").dataset.value
          });
          await notifyTools.notifyBackground({
            command: "setPref",
            pref: "activeStorageLocationIdx",
            value: idx
          });
          notifyTools.notifyBackground({
            command: "reload",
          });
        },
        canRemoveCallback: (idx, activeIdx) => {
          return idx > 0 && idx != activeIdx
        },
        canSelectCallback: (idx, activeIdx) => {
          return idx > -1 && idx != activeIdx
        },
        buttonDefinitions: {
          "storageLocations_remove": { callback: "removeItem", isManaged: storageLocationsManaged || activeStorageLocationIdxManaged},
          "storageLocations_addFolderItem": { callback: "addFolderItem", isManaged: storageLocationsManaged || activeStorageLocationIdxManaged},
          "storageLocations_select": { callback: "selectItem", isManaged: activeStorageLocationIdxManaged },
        }
      })
      await storageLocationsUI.load();
    }
  },
  unload: function () {
    gQuicktext.removeObserver(this);

    var states = [];
    for (var i = 0; i < this.mCollapseState.length; i++)
      states[i] = (this.mCollapseState[i]) ? "1" : "";
    gQuicktext.collapseState = states.join(";");

    document.getElementById('text-keyword').removeEventListener("keypress", function (e) { settingsDialog.noSpaceForKeyword(e); }, false);
  },
  close: async function (aClose) {
    this.saveText();
    this.saveScript();

    if (this.anyChangesMade()) {
      promptService = Services.prompt;
      if (promptService) {
        result = promptService.confirmEx(window,
          extension.localeData.localizeMessage("saveMessageTitle"),
          extension.localeData.localizeMessage("saveMessage"),
          (promptService.BUTTON_TITLE_SAVE * promptService.BUTTON_POS_0) +
          (promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1) +
          (promptService.BUTTON_TITLE_DONT_SAVE * promptService.BUTTON_POS_2),
          null, null, null,
          null, { value: 0 });
        switch (result) {
          // Cancel
          case 1:
            return false;
          // Save
          case 0:
            await this.save();
            break;
          // Quit
          case 2:
            break;
        }
      }
    }

    if (aClose)
      window.close();

    return true;
  },
  save: async function () {
    this.saveText();
    this.saveScript();

    if (document.getElementById("checkbox-viewPopup"))
      gQuicktext.viewPopup = document.getElementById("checkbox-viewPopup").checked;
    if (document.getElementById("box-defaultImport"))
      gQuicktext.defaultImport = document.getElementById("box-defaultImport").dataset.value;
    if (document.getElementById("box-storageLocations"))
      gQuicktext.storageLocations = document.getElementById("box-storageLocations").dataset.value;
    if (document.getElementById("select-shortcutModifier"))
      gQuicktext.shortcutModifier = document.getElementById("select-shortcutModifier").value;
    if (document.getElementById("checkbox-shortcutTypeAdv"))
      gQuicktext.shortcutTypeAdv = document.getElementById("checkbox-shortcutTypeAdv").checked;
    if (document.getElementById("select-keywordKey"))
      gQuicktext.keywordKey = document.getElementById("select-keywordKey").value;
    if (document.getElementById("checkbox-collapseGroup"))
      gQuicktext.collapseGroup = document.getElementById("checkbox-collapseGroup").checked;

    await gQuicktext.saveSettings();

    this.mChangesMade = false;
    this.mTextChangesMade = [];
    this.mScriptChangesMade = [];
    this.mGeneralChangesMade = [];
    this.disableSave();
    await this.updateGUI();
  },
  saveText: function () {
    if (this.mPickedIndex != null) {
      if (this.mPickedIndex[1] > -1) {
        // The title is updated in the onchange event.
        //var title = document.getElementById('text-title').value;
        //if (title.replace(/[\s]/g, '') == "")
        //  title = extension.localeData.localizeMessage("newTemplate");
        //this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'name', title);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'text', document.getElementById('text').value);

        if (gQuicktext.shortcutTypeAdv)
          this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'shortcut', document.getElementById('text-shortcutAdv').value);
        else
          this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'shortcut', document.getElementById('text-shortcutBasic').value);

        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'type', document.getElementById('text-type').value);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'keyword', document.getElementById('text-keyword').value.replace(/[\s]/g, ''));
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'subject', document.getElementById('text-subject').value);
        this.saveTextCell(this.mPickedIndex[0], this.mPickedIndex[1], 'attachments', document.getElementById('text-attachments').value);
      }
      else {
        // The title is updated in the onchange event.
        //var title = document.getElementById('text-title').value;
        //if (title.replace(/[\s]/g, '') == "")
        //  title = extension.localeData.localizeMessage("newGroup");
        //this.saveGroupCell(this.mPickedIndex[0], 'name', title);
      }
    }
  },
  saveTextCell: function (aGroupIndex, aTextIndex, aColumn, aValue) {
    var text = gQuicktext.getText(aGroupIndex, aTextIndex, true);
    if (typeof text[aColumn] != "undefined" && text[aColumn] != aValue) {
      text[aColumn] = aValue;

      this.changesMade();
      return true;
    }
    return false;
  },
  saveGroupCell: function (aGroupIndex, aColumn, aValue) {
    var group = gQuicktext.getGroup(aGroupIndex, true);
    if (typeof group[aColumn] != "undefined" && group[aColumn] != aValue) {
      group[aColumn] = aValue;

      this.changesMade();
      return true;
    }
    return false;
  },
  saveScript: function () {
    if (this.mScriptIndex != null) {
      // The title is updated in the onchange event.
      //var title = document.getElementById('script-title').value;
      //if (title.replace(/[\s]/g, '') == "")
      //  title = extension.localeData.localizeMessage("newScript");
      //this.saveScriptCell(this.mScriptIndex, 'name', title);
      this.saveScriptCell(this.mScriptIndex, 'script', document.getElementById('script').value);
    }
  },
  saveScriptCell: function (aIndex, aColumn, aValue) {
    var script = gQuicktext.getScript(aIndex, true);
    if (typeof script[aColumn] != "undefined" && script[aColumn] != aValue) {
      script[aColumn] = aValue;


      this.changesMade();
      return true;
    }
    return false;
  },
  noSpaceForKeyword: function (e) {
    if (e.charCode == KeyEvent.DOM_VK_SPACE) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  checkForGeneralChanges: function (aIndex) {
    const ids = ['checkbox-viewPopup', 'checkbox-collapseGroup', 'select-shortcutModifier', 'checkbox-shortcutTypeAdv', 'select-keywordKey', 'box-defaultImport', 'box-storageLocations'];
    const type = ['checked', 'checked', 'value', 'checked', 'value', 'dataset', 'dataset'];
    const keys = ['viewPopup', 'collapseGroup', 'shortcutModifier', 'shortcutTypeAdv', 'keywordKey', 'defaultImport', 'storageLocations'];

    if (typeof ids[aIndex] == 'undefined')
      return;

    const value = (type[aIndex] === "dataset")
      ? document.getElementById(ids[aIndex]).dataset.value
      : document.getElementById(ids[aIndex])[type[aIndex]];

    if (gQuicktext[keys[aIndex]] != value)
      this.generalChangeMade(aIndex);
    else
      this.noGeneralChangeMade(aIndex);
  },
  checkForTextChanges: function (aIndex) {
    if (!this.mPickedIndex)
      return;

    var ids = ['text-title', 'text', 'text-shortcutBasic', 'text-type', 'text-keyword', 'text-subject', 'text-attachments'];
    var keys = ['name', 'text', 'shortcut', 'type', 'keyword', 'subject', 'attachments'];

    if (gQuicktext.shortcutTypeAdv)
      ids[2] = 'text-shortcutAdv';

    let element = document.getElementById(ids[aIndex])
    var value = element.value;
    switch (aIndex) {
      case 0:
        if (this.mPickedIndex[1] > -1) {
          if (value.replace(/[\s]/g, '') == "") {
            value = extension.localeData.localizeMessage("newTemplate");
          }
          // Prevent duplicated names.
          value = this.makeUnique(value, gQuicktext.mEditingTexts[this.mPickedIndex[0]].map(t => t.mName));
        } else {
          if (value.replace(/[\s]/g, '') == "") {
            value = extension.localeData.localizeMessage("newGroup");
          }
          // Prevent duplicated names.
          value = this.makeUnique(value, gQuicktext.mEditingGroup.map(g => g.mName))
        }
        break;
      case 2:
        if (gQuicktext.shortcutTypeAdv) {
          value = value.replace(/[^\d]/g, '');
          element.value = value;
        }
      case 4:
        value = value.replace(/[\s]/g, '');
        element.value = value;
        break;
      case 6:
        document.getElementById("deprecated_attachment").style.display = document.getElementById('text-attachments').value ? "" : "none"
        break;
    }

    if (this.mPickedIndex[1] > -1) {
      if (gQuicktext.getText(this.mPickedIndex[0], this.mPickedIndex[1], true)[keys[aIndex]] != value) {
        this.textChangeMade(aIndex);
      } else {
        this.noTextChangeMade(aIndex);
      }
    }
    else {
      if (gQuicktext.getGroup(this.mPickedIndex[0], true)[keys[aIndex]] != value) {
        this.textChangeMade(aIndex);
      } else {
        this.noTextChangeMade(aIndex);
      }
    }

    // Auto-save names.
    if (aIndex == 0) {
      if (this.mPickedIndex[1] > -1) {
        gQuicktext.mEditingTexts[this.mPickedIndex[0]][this.mPickedIndex[1]].mName = value;
      } else {
        gQuicktext.mEditingGroup[this.mPickedIndex[0]].mName = value;
      }
    }

    if (aIndex == 0 || aIndex == 2) {
      var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
      if (aIndex == 0) {
        this.mTreeArray[selectedIndex][6] = value;
      }
      else {
        this.mTreeArray[selectedIndex][7] = value;
      }
      document.getElementById('group-tree').invalidateRow(selectedIndex);
      this.updateVariableGUI();
    }
  },
  checkForScriptChanges: function (aIndex) {
    if (this.mScriptIndex == null)
      return;

    var ids = ['script-title', 'script'];
    var keys = ['name', 'script'];

    var value = document.getElementById(ids[aIndex]).value;
    switch (aIndex) {
      case 0:
        if (value.replace(/[\s]/g, '') == "") {
          value = extension.localeData.localizeMessage("newScript");
        }
        // Prevent duplicated names.
        value = this.makeUnique(value, gQuicktext.mEditingScripts.map(t => t.mName));
        break;
    }

    if (gQuicktext.getScript(this.mScriptIndex, true)[keys[aIndex]] != value)
      this.scriptChangeMade(aIndex);
    else
      this.noScriptChangeMade(aIndex);

    if (aIndex == 0) {
      // Auto-save names.
      gQuicktext.mEditingScripts[this.mScriptIndex].mName = value;

      this.updateVariableGUI();
      var listItem = document.getElementById('script-list').getItemAtIndex(this.mScriptIndex);
      listItem.firstChild.value = value;
    }
  },
  changesMade: function () {
    this.mChangesMade = true;
    this.enableSave();
  },
  anyChangesMade: function () {
    if (this.textChangesMade() || this.scriptChangesMade() || this.generalChangesMade())
      return true;

    return false;
  },
  generalChangesMade: function () {
    for (var i = 0; i < this.mGeneralChangesMade.length; i++) {
      if (typeof this.mGeneralChangesMade[i] != "undefined" && this.mGeneralChangesMade[i] == true)
        return true;
    }

    return false;
  },
  generalChangeMade: function (aIndex) {
    this.enableSave();

    this.mGeneralChangesMade[aIndex] = true;
  },
  noGeneralChangeMade: function (aIndex) {
    this.mGeneralChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  },
  textChangesMade: function () {
    for (var i = 0; i < this.mTextChangesMade.length; i++) {
      if (typeof this.mTextChangesMade[i] != "undefined" && this.mTextChangesMade[i] == true)
        return true;
    }

    return false;
  },
  textChangeMade: function (aIndex) {
    this.enableSave();

    this.mTextChangesMade[aIndex] = true;
  },
  noTextChangeMade: function (aIndex) {
    this.mTextChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  },
  scriptChangesMade: function () {
    for (var i = 0; i < this.mScriptChangesMade.length; i++) {
      if (typeof this.mScriptChangesMade[i] != "undefined" && this.mScriptChangesMade[i] == true)
        return true;
    }

    return false;
  },
  scriptChangeMade: function (aIndex) {
    this.enableSave();

    this.mScriptChangesMade[aIndex] = true;
  },
  noScriptChangeMade: function (aIndex) {
    this.mScriptChangesMade[aIndex] = false;

    if (!this.mChangesMade && !this.anyChangesMade())
      this.disableSave();
  },
  shortcutModifierChange: function () {
    var state = (OS.substr(0, 3).toLowerCase() == "mac" || (OS.substr(0, 3).toLowerCase() == "win" && document.getElementById('select-shortcutModifier').value == "alt"));
    document.getElementById('checkbox-shortcutTypeAdv').disabled = state;
  },

  /*
   * GUI CHANGES
   */
  updateGUI: async function () {
    const dateTimeFormat = async (format, timeStamp) => {
      return notifyTools.notifyBackground({ command: "getDateTimeFormat", data: { format, timeStamp } });
    }

    // Set the date/time in the variablemenu
    var timeStamp = new Date();
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i];
      let fieldType = field.split("-")[0];
      if (document.getElementById(field)) {
        document.getElementById(field).setAttribute(
          "label",
          extension.localeData.localizeMessage(fieldType, [await dateTimeFormat(field, timeStamp)])
        );
      }
    }

    // Update info in the generalsettings tab
    if (document.getElementById("checkbox-viewPopup"))
      document.getElementById("checkbox-viewPopup").checked = gQuicktext.viewPopup;
    if (document.getElementById("checkbox-collapseGroup"))
      document.getElementById("checkbox-collapseGroup").checked = gQuicktext.collapseGroup;
    if (document.getElementById("select-shortcutModifier"))
      document.getElementById("select-shortcutModifier").value = gQuicktext.shortcutModifier;
    if (document.getElementById("checkbox-shortcutTypeAdv")) {
      var elem = document.getElementById("checkbox-shortcutTypeAdv");
      elem.checked = gQuicktext.shortcutTypeAdv;
      this.shortcutModifierChange();
    }
    if (document.getElementById("select-keywordKey"))
      document.getElementById("select-keywordKey").value = gQuicktext.keywordKey;

    // Update the variable menu 
    this.updateVariableGUI();

    // Update Script list
    this.updateScriptGUI();

    // Update the tree
    this.buildTreeGUI();

    // Update the remove and add buttons
    this.updateButtonStates();
  },
  updateVariableGUI: function () {
    // Set all other text in the variablemenu
    var topParent = document.getElementById('quicktext-other-texts');
    for (var i = topParent.childNodes.length - 1; i >= 0; i--)
      topParent.removeChild(topParent.childNodes[i]);

    var groupLength = gQuicktext.getGroupLength(true);
    if (groupLength > 0) {
      topParent.removeAttribute('hidden');
      parent = document.createXULElement("menupopup");
      parent = topParent.appendChild(parent);
      for (var i = 0; i < groupLength; i++) {
        var textLength = gQuicktext.getTextLength(i, true);
        if (textLength > 0) {
          var group = gQuicktext.getGroup(i, true);
          var groupElem = document.createXULElement("menu");
          groupElem.setAttribute('label', group.name);
          groupElem = parent.appendChild(groupElem);

          groupParent = document.createXULElement("menupopup");
          groupParent = groupElem.appendChild(groupParent);
          for (var j = 0; j < textLength; j++) {
            var textElem = document.createXULElement("menuitem");
            var text = gQuicktext.getText(i, j, true);
            textElem.setAttribute('label', text.name);
            textElem.setAttribute('group', group.name);
            textElem.addEventListener("command", function () { settingsDialog.insertVariable("TEXT=" + this.getAttribute("group") + "|" + this.getAttribute("label")); });
            textElem = groupParent.appendChild(textElem);
          }
        }
      }
    }
    else
      topParent.setAttribute('hidden', true);

    var topParent = document.getElementById('variables-scripts');
    for (var i = topParent.childNodes.length - 1; i >= 0; i--)
      topParent.removeChild(topParent.childNodes[i]);

    var scriptLength = gQuicktext.getScriptLength(true);
    if (scriptLength > 0) {
      topParent.removeAttribute('hidden');
      parent = document.createXULElement("menupopup");
      parent = topParent.appendChild(parent);

      for (var i = 0; i < scriptLength; i++) {
        var script = gQuicktext.getScript(i, true);
        var textElem = document.createXULElement("menuitem");
        textElem.setAttribute('label', script.name);
        textElem.addEventListener("command", function () { settingsDialog.insertVariable("SCRIPT=" + this.getAttribute("label")); });
        textElem = parent.appendChild(textElem);
      }
    }
    else
      topParent.setAttribute('hidden', true);
  },
  updateScriptGUI: function () {
    // Update the listmenu in the scripttab and the variable-menu
    var scriptLength = gQuicktext.getScriptLength(true);

    listElem = document.getElementById('script-list');
    var selectedIndex = listElem.selectedIndex;
    var oldLength = listElem.getRowCount();

    if (scriptLength > 0) {
      for (var i = 0; i < scriptLength; i++) {
        var script = gQuicktext.getScript(i, true);
        if (i < oldLength) {
          var listItem = listElem.getItemAtIndex(i);
          listItem.firstChild.value = script.name;
          listItem.value = i;

          let isIncompatible = isIncompatibleScript(script);
          if (listItem.children.length > 1 && !isIncompatible) {
            listItem.children[1].remove();
          } else if (listItem.children.length == 1 && isIncompatible) {
            let newItemWarning = document.createXULElement("label");
            newItemWarning.value = "⚠️";
            listItem.appendChild(newItemWarning);
          };
        } else {
          // Keep the height of the script list fixed, prevent it growing.
          let elementHeight = listElem.getBoundingClientRect().height;
          let newItem = document.createXULElement("richlistitem");
          newItem.value = i;

          let newItemLabel = document.createXULElement("label");
          newItemLabel.value = script.name;
          newItem.appendChild(newItemLabel);

          if (isIncompatibleScript(script)) {
            let newItemWarning = document.createXULElement("label");
            newItemWarning.value = "⚠️";
            newItem.appendChild(newItemWarning);
          }

          listElem.appendChild(newItem);
          listElem.style.height = `${elementHeight}px`;
        }
      }
    }

    if (oldLength > scriptLength) {
      for (var i = scriptLength; i < oldLength; i++)
        listElem.getItemAtIndex(scriptLength).remove();
    }

    if (selectedIndex >= 0)
      listElem.selectedIndex = selectedIndex;
    else if (scriptLength > 0)
      listElem.selectedIndex = 0;
    else
      listElem.selectedIndex = -1;

    this.pickScript();
  },
  disableShortcuts: function (aShortcut) {
    var grouplist = document.getElementById('popup-shortcutBasic');
    for (var i = 0; i <= 10; i++)
      grouplist.childNodes[i].removeAttribute("disabled");

    var groupLength = gQuicktext.getGroupLength(true);
    for (var i = 0; i < groupLength; i++) {
      var textLength = gQuicktext.getTextLength(i, true);
      for (var j = 0; j < textLength; j++) {
        var shortcut = gQuicktext.getText(i, j, true).shortcut;
        var selectedIndex = (shortcut == "0") ? 10 : shortcut;
        if (shortcut != "" && shortcut != aShortcut && grouplist.childNodes[selectedIndex])
          grouplist.childNodes[selectedIndex].setAttribute("disabled", true);
      }
    }
  },
  disableSave: function () {
    document.getElementById("savebutton").setAttribute("disabled", true);
  },
  enableSave: function () {
    document.getElementById("savebutton").removeAttribute("disabled");
  },

  /*
   * Update the treeview
   */
  makeTreeArray: function () {
    this.mTreeArray = [];
    var k = 0;

    var groupLength = gQuicktext.getGroupLength(true);

    if (this.mCollapseState.length < groupLength) {
      for (var i = this.mCollapseState.length; i < groupLength; i++)
        this.mCollapseState[i] = true;
    }
    else if (this.mCollapseState.length > groupLength)
      this.mCollapseState.splice(groupLength, this.mCollapseState.length - groupLength);

    for (var i = 0; i < groupLength; i++) {
      var groupIndex = k;
      var textLength = gQuicktext.getTextLength(i, true);

      this.mTreeArray[k] = [i, -1, 0, -1, true, textLength, gQuicktext.getGroup(i, true).name, ''];
      k++;

      if (!this.mCollapseState[i])
        continue;

      for (var j = 0; j < textLength; j++) {
        var text = gQuicktext.getText(i, j, true);
        var shortcut = text.shortcut;
        this.mTreeArray[k] = [i, j, 1, groupIndex, false, 0, text.name, shortcut];
        k++;
      }
    }
  },
  updateTreeGUI: function () {
    // maybe
  },
  buildTreeGUI: function () {
    this.makeTreeArray();

    var treeview = {
      rowCount: this.mTreeArray.length,
      lastIndex: null,

      isContainer: function (aRow) {
        return (settingsDialog.mTreeArray[aRow][1] == -1);
      },
      isContainerOpen: function (aRow) {
        return settingsDialog.mCollapseState[settingsDialog.mTreeArray[aRow][0]];
      },
      isContainerEmpty: function (aRow) {
        return (settingsDialog.mTreeArray[aRow][5] == 0);
      },
      isSeparator: function (aRow) {
        return false;
      },
      isSorted: function (aRow) {
        return false;
      },
      isEditable: function (aRow) {
        return false;
      },
      hasNextSibling: function (aRow, aAfter) {
        return (settingsDialog.mTreeArray[aAfter + 1]
          && settingsDialog.mTreeArray[aRow][2] == settingsDialog.mTreeArray[aAfter + 1][2]
          && settingsDialog.mTreeArray[aRow][3] == settingsDialog.mTreeArray[aAfter + 1][3]);
      },
      getLevel: function (aRow) {
        return settingsDialog.mTreeArray[aRow][2];
      },
      getImageSrc: function (aRow, aCol) { return null; },
      getParentIndex: function (aRow) {
        return settingsDialog.mTreeArray[aRow][3];
      },
      getRowProperties: function (aRow, aProps) { },
      getCellProperties: function (aRow, aCol, aProps) { },
      getColumnProperties: function (aColid, aCol, aProps) { },
      getProgressMode: function (aRow, aCol) { },
      getCellValue: function (aRow, aCol) { return null; },
      canDropBeforeAfter: function (aRow, aBefore) {
        if (aBefore)
          return this.canDrop(aRow, -1);

        return this.canDrop(aRow, 1);
      },
      canDropOn: function (aRow) {
        return this.canDrop(aRow, 0);
      },
      canDrop: function (aRow, aOrient) {
        var index = document.getElementById('group-tree').view.selection.currentIndex;
        if (index == aRow)
          return false;

        // Can only drop templates on groups
        if (aOrient == 0) {
          if (settingsDialog.mTreeArray[index][2] > 0 && settingsDialog.mTreeArray[aRow][2] == 0)
            return true;
          else
            return false;
        }

        // Take care if we drag a group
        if (settingsDialog.mTreeArray[index][2] == 0) {
          if (aOrient < 0 && settingsDialog.mTreeArray[aRow][2] == 0)
            return true;
          if (aOrient > 0 && settingsDialog.mTreeArray.length - 1 == aRow)
            return true;
        }
        // Take care if we drag a template
        else {
          if (settingsDialog.mTreeArray[aRow][2] > 0)
            return true;
        }

        return false;
      },
      drop: function (aRow, aOrient) {
        settingsDialog.saveText();
        settingsDialog.mPickedIndex = null;
        var selectIndex = -1;
        var index = document.getElementById('group-tree').view.selection.currentIndex;

        // Droping a group
        if (settingsDialog.mTreeArray[index][2] == 0) {
          var textLength = gQuicktext.getTextLength(settingsDialog.mTreeArray[index][0], true);
          if (!settingsDialog.mCollapseState[settingsDialog.mTreeArray[index][0]])
            textLength = 0;

          if (aOrient > 0) {
            gQuicktext.moveGroup(settingsDialog.mTreeArray[index][0], gQuicktext.getGroupLength(true), true);

            var state = settingsDialog.mCollapseState.splice(settingsDialog.mTreeArray[index][0], 1);
            state = (state == "false") ? false : true;
            settingsDialog.mCollapseState.push(state);

            selectIndex = settingsDialog.mTreeArray.length - textLength - 1;
          }
          else {
            gQuicktext.moveGroup(settingsDialog.mTreeArray[index][0], settingsDialog.mTreeArray[aRow][0], true);

            var state = settingsDialog.mCollapseState.splice(settingsDialog.mTreeArray[index][0], 1);
            state = (state == "false") ? false : true;
            settingsDialog.mCollapseState.splice(settingsDialog.mTreeArray[aRow][0], 0, state);

            selectIndex = (aRow > index) ? aRow - textLength - 1 : aRow;
          }
        }
        // Droping a template
        else {
          switch (aOrient) {
            case 0:
              var textLength = gQuicktext.getTextLength(settingsDialog.mTreeArray[aRow][0], true);
              gQuicktext.moveText(settingsDialog.mTreeArray[index][0], settingsDialog.mTreeArray[index][1], settingsDialog.mTreeArray[aRow][0], textLength, true);
              selectIndex = (settingsDialog.mTreeArray[index][0] == settingsDialog.mTreeArray[aRow][0] || aRow > index) ? aRow + textLength : aRow + textLength + 1;
              break;
            case 1:
              gQuicktext.moveText(settingsDialog.mTreeArray[index][0], settingsDialog.mTreeArray[index][1], settingsDialog.mTreeArray[aRow][0], settingsDialog.mTreeArray[aRow][1] + 1, true);
              selectIndex = (aRow > index) ? aRow : aRow + 1;
              break;
            default:
              gQuicktext.moveText(settingsDialog.mTreeArray[index][0], settingsDialog.mTreeArray[index][1], settingsDialog.mTreeArray[aRow][0], settingsDialog.mTreeArray[aRow][1], true);
              selectIndex = (aRow > index) ? aRow - 1 : aRow;
              break;
          }
        }

        settingsDialog.makeTreeArray();
        document.getElementById('group-tree').invalidate();
        document.getElementById('group-tree').view.selection.select(selectIndex);
        settingsDialog.changesMade();
      },
      getCellText: function (aRow, aCol) {
        colName = (aCol.id) ? aCol.id : aCol;
        if (colName == "group") {
          return settingsDialog.mTreeArray[aRow][6];
        }
        else if (colName == "shortcut" && settingsDialog.mTreeArray[aRow][1] > -1) {
          return settingsDialog.mTreeArray[aRow][7];
        }

        return "";
      },
      toggleOpenState: function (aRow) {
        var state = settingsDialog.mCollapseState[settingsDialog.mTreeArray[aRow][0]];
        settingsDialog.mCollapseState[settingsDialog.mTreeArray[aRow][0]] = !state;

        settingsDialog.makeTreeArray();

        var treeObject = document.getElementById('group-tree');

        if (state)
          treeObject.rowCountChanged(aRow, -settingsDialog.mTreeArray[aRow][5]);
        else
          treeObject.rowCountChanged(aRow, settingsDialog.mTreeArray[aRow][5]);

        treeObject.invalidate();
        document.getElementById('group-tree').view.selection.select(aRow);
      },
      setTree: function (aTreebox) {
        this.treebox = aTreebox;
      }
    }

    var firstVisibleRow = document.getElementById('group-tree').getFirstVisibleRow();
    var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
    if (selectedIndex == -1 && this.mTreeArray.length)
      selectedIndex = 0;

    document.getElementById('group-tree').view = treeview;
    document.getElementById('group-tree').scrollToRow(firstVisibleRow);
    this.selectTreeRow(selectedIndex);

    this.pickText();
  },
  selectTreeRow: function (aRow) {
    document.getElementById('group-tree').view.selection.select(aRow);
    document.getElementById('group-tree').ensureRowIsVisible(aRow);
  },
  updateButtonStates: function () {
    // Update the add-buttons
    if (this.mTreeArray.length) {
      var index = document.getElementById('group-tree').view.selection.currentIndex;
      if (this.mTreeArray[index] && gQuicktext.getGroup(this.mTreeArray[index][0], true).protected) {
        document.getElementById("group-button-remove").setAttribute("disabled", true);
        document.getElementById("group-button-add-text").setAttribute("disabled", true);
      }
      else {
        document.getElementById("group-button-remove").removeAttribute("disabled");
        document.getElementById("group-button-add-text").removeAttribute("disabled");
      }
    }
    else {
      document.getElementById('group-button-add-text').setAttribute("disabled", true);
      document.getElementById('group-button-remove').setAttribute("disabled", true);
    }

    let scriptIndex = document.getElementById('script-list').value;
    let script = gQuicktext.getScript(scriptIndex, true);
    if (gQuicktext.getScriptLength(true) && !script.protected)
      document.getElementById('script-button-remove').removeAttribute("disabled");
    else
      document.getElementById('script-button-remove').setAttribute("disabled", true);
  },

  /*
   * INSERT VARIABLES
   */
  insertVariable: function (aStr) {
    var textbox = document.getElementById("text-subject");
    if (!textbox.getAttribute("focused"))
      var textbox = document.getElementById("text");

    var selStart = textbox.selectionStart;
    var selEnd = textbox.selectionEnd;
    var selLength = textbox.textLength;

    var s1 = (textbox.value).substring(0, selStart);
    var s2 = (textbox.value).substring(selEnd, selLength)
    textbox.value = s1 + "[[" + aStr + "]]" + s2;

    var selNewStart = selStart + 4 + aStr.length;
    textbox.setSelectionRange(selNewStart, selNewStart);
    this.enableSave();
  },
  // TODO: Hardcoding files is no longer possible in pure WebExt, either Exp only or gallery.
  insertAttachmentVariable: async function () {
    if ((file = await gQuicktext.pickFile([2], 0, extension.localeData.localizeMessage("attachmentFile"))) != null) {
      this.insertVariable('ATTACHMENT=FILE|' + file.path);
    }
    this.enableSave();
  },
  // TODO: Hardcoding files is no longer possible in pure WebExt, either Exp only or gallery.
  insertFileVariable: async function () {
    if ((file = await gQuicktext.pickFile([2], 0, extension.localeData.localizeMessage("insertFile"))) != null) {
      this.insertVariable('FILE=' + file.path);
    }
    this.enableSave();
  },
  // TODO: Hardcoding files is no longer possible in pure WebExt, either Exp only or gallery.
  insertImageVariable: async function () {
    if ((file = await gQuicktext.pickFile([4], 0, extension.localeData.localizeMessage("insertImage"))) != null) {
      this.insertVariable('IMAGE=FILE|' + file.path);
    }
    this.enableSave();
  },

  /*
   * IMPORT/EXPORT FUNCTIONS
   */
  exportTemplatesToFile: async function () {
    await notifyTools.notifyBackground({ command: "exportTemplates" });
    window.focus();
  },
  importTemplatesFromFile: async function () {
    // We use the legacy file picker here, because the user event handler sometimes
    // gets lost when piped through notify Tools.
    // const parsedData = await notifyTools.notifyBackground({ command: "pickAndParseConfigFile" });
    const file = await gQuicktext.pickFile([5, 3], 0, extension.localeData.localizeMessage("importFile"));
    if (!file) return;
    const templates = await notifyTools.notifyBackground({ command: "parseTemplateFileForImport", path: file.path });

    if (!templates) return;

    this.saveText();
    this.saveScript();
    var length = this.mTreeArray.length;

    gQuicktext.importTemplates(templates)

    this.changesMade();
    this.makeTreeArray();
    document.getElementById('group-tree').rowCountChanged(length - 1, this.mTreeArray.length - length);
    this.updateButtonStates();
  },
  exportScriptsToFile: async function () {
    await notifyTools.notifyBackground({ command: "exportScripts" });
    window.focus();
  },
  importScriptsFromFile: async function () {
    // We use the legacy file picker here, because the user event handler sometimes
    // gets lost when piped through notify Tools.
    // const parsedData = await notifyTools.notifyBackground({ command: "pickAndParseConfigFile" });
    const file = await gQuicktext.pickFile([5, 3], 0, extension.localeData.localizeMessage("importFile"));
    if (!file) return;
    const scripts = await notifyTools.notifyBackground({ command: "parseScriptFileForImport", path: file.path });

    if (!scripts) return;

    this.saveText();
    this.saveScript();

    gQuicktext.importScripts(scripts)

    this.changesMade();
    this.updateScriptGUI();
    this.updateButtonStates();
  },
  browseAttachment: async function () {
    if ((file = await gQuicktext.pickFile([], 0, extension.localeData.localizeMessage("attachmentFile"))) != null) {
      var filePath = file.path;
      var attachments = document.getElementById('text-attachments').value;
      if (attachments != "")
        document.getElementById('text-attachments').value = attachments + ";" + filePath;
      else
        document.getElementById('text-attachments').value = filePath;
      this.checkForTextChanges(6);
    }
  },
  pickScript: function () {
    var index = document.getElementById('script-list').value;

    if (index == null) {
      document.getElementById('script-title').value = "";
      document.getElementById('script').value = "";
      this.mScriptIndex = null;
      document.getElementById('script-title').disabled = true;
      document.getElementById('script').hidden = true;
      return;
    }
    document.getElementById('script').hidden = false;


    if (this.mScriptIndex != index) {
      if (this.scriptChangesMade()) {
        this.changesMade();
        this.mScriptChangesMade = [];
      }
      this.saveScript();
    }

    this.mScriptIndex = index;

    var script = gQuicktext.getScript(index, true);
    let disabled = script.protected;

    document.getElementById('script-title').value = script.name;
    document.getElementById('script').value = script.script;

    document.getElementById('script-title').disabled = disabled;
    document.getElementById('script').disabled = disabled;

    if (disabled)
      document.getElementById('script-button-remove').setAttribute("disabled", true);
    else
      document.getElementById('script-button-remove').removeAttribute("disabled");

    if (isIncompatibleScript(script)) {
      document.getElementById('scripthelpbutton').dataset.isIncompatible = "true";
      document.getElementById('scriptwarning').style.display = "block";
    } else {
      document.getElementById('scripthelpbutton').dataset.isIncompatible = "false";
      document.getElementById('scriptwarning').style.display = "none";
    }

  },
  pickText: function () {
    var index = document.getElementById('group-tree').view.selection.currentIndex;

    if (!this.mTreeArray[index]) {
      document.getElementById('text-caption').textContent = extension.localeData.localizeMessage("group");
      document.getElementById('text-title').value = "";
      this.showElement("group", true);
      this.mPickedIndex = null;
      return;
    }

    groupIndex = this.mTreeArray[index][0];
    textIndex = this.mTreeArray[index][1];

    if (this.mPickedIndex && this.textChangesMade()) {
      this.changesMade();
      this.mTextChangesMade = [];
      this.saveText();
    }

    this.mPickedIndex = [groupIndex, textIndex];

    if (textIndex > -1) {
      var text = gQuicktext.getText(groupIndex, textIndex, true);
      document.getElementById('text-caption').textContent = extension.localeData.localizeMessage("template");

      document.getElementById('text-title').value = text.name;
      document.getElementById('text').value = text.text;
      document.getElementById('text-keyword').value = text.keyword;
      document.getElementById('text-subject').value = text.subject;
      document.getElementById('text-attachments').value = text.attachments;
      document.getElementById("deprecated_attachment").style.display = text.attachments ? "" : "none"

      document.getElementById('label-shortcutModifier').value = extension.localeData.localizeMessage(document.getElementById('select-shortcutModifier').value + "Key") + "+";


      if (gQuicktext.shortcutTypeAdv) {
        var elem = document.getElementById('text-shortcutAdv');
        elem.value = text.shortcut;

        elem.hidden = false;
        document.getElementById('text-shortcutBasic').hidden = true;
      }
      else {
        var shortcut = text.shortcut;
        var elem = document.getElementById('text-shortcutBasic');

        if (shortcut < 10)
          elem.selectedIndex = (shortcut == "0") ? 10 : shortcut;
        else
          elem.selectedIndex = 0;

        elem.hidden = false;
        document.getElementById('text-shortcutAdv').hidden = true;

        this.disableShortcuts(shortcut);
      }

      document.getElementById('text-type').selectedIndex = text.type == "text/html" ? 1 : 0;
    }
    else {
      document.getElementById('text-caption').textContent = extension.localeData.localizeMessage("group");

      document.getElementById("text-title").value = gQuicktext.getGroup(groupIndex, true).name;
      document.getElementById("text").value = "";
      document.getElementById("text-keyword").value = "";
      document.getElementById("text-subject").value = "";
      document.getElementById("text-attachments").value = "";
      document.getElementById("deprecated_attachment").style.display = "none";
    }

    var disabled = false;
    if (gQuicktext.getGroup(groupIndex, true).protected) {
      document.getElementById("group-button-remove").setAttribute("disabled", true);
      document.getElementById("group-button-add-text").setAttribute("disabled", true);
      disabled = true;
    }
    else {
      document.getElementById("group-button-remove").removeAttribute("disabled");
      document.getElementById("group-button-add-text").removeAttribute("disabled");
    }

    if (textIndex < 0)
      this.showElement("group", disabled);
    else
      this.showElement("text", disabled);
  },
  showElement: function (aType, aDisabled) {
    var elements = document.getElementsByAttribute("candisable", "true");
    for (var i = 0; i < elements.length; i++) {
      if (aDisabled)
        elements[i].setAttribute("disabled", true);
      else
        elements[i].removeAttribute("disabled");
    }

    var elements = document.getElementsByAttribute("showfor", "*");
    for (var i = 0; i < elements.length; i++) {
      var types = elements[i].getAttribute("showfor").split(",");
      var found = false;
      for (var type = 0; type < types.length; type++) {
        if (types[type] == aType)
          found = true;
      }

      if (found)
        elements[i].hidden = false;
      else
        elements[i].hidden = true;
    }
  },

  makeUnique: function (name, arr) {
    let sanitizedName = name
      .replaceAll("|", "/")
      .replaceAll("[[", "{[")
      .replaceAll("]]", "]}");
    let suffix = 1;
    let unique = sanitizedName;
    while (arr.includes(unique)) {
      suffix++;
      unique = `${sanitizedName} #${suffix}`
    }
    return unique;
  },

  /*
   * Add/Remove groups/templates
   */
  addGroup: function () {
    this.saveText();

    let title = this.makeUnique(
      extension.localeData.localizeMessage("newGroup"),
      gQuicktext.mEditingGroup.map(g => g.mName)
    );
    gQuicktext.addGroup(title, true);
    this.mCollapseState.push(true);

    this.makeTreeArray();
    var treeObject = document.getElementById('group-tree');
    treeObject.rowCountChanged(this.mTreeArray.length - 1, 1);
    treeObject.invalidateRow(this.mTreeArray.length - 1);

    selectedIndex = this.mTreeArray.length - 1;
    this.selectTreeRow(selectedIndex);

    this.updateButtonStates();
    this.changesMade();

    var titleElem = document.getElementById('text-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  },
  addText: function () {
    this.saveText();

    var groupIndex = -1;
    if (this.mPickedIndex)
      groupIndex = this.mPickedIndex[0];

    var groupLength = gQuicktext.getGroupLength(true);
    if (groupIndex == -1) {
      if (groupLength == 0)
        return;
      else
        groupIndex = 0;
    }

    let title = this.makeUnique(
      extension.localeData.localizeMessage("newTemplate"),
      gQuicktext.mEditingTexts[groupIndex].map(t => t.mName)
    );
    gQuicktext.addText(groupIndex, title, true);

    this.makeTreeArray();
    var selectedIndex = -1;
    for (var i = 0; i <= groupIndex; i++) {
      selectedIndex++;
      if (this.mCollapseState[i])
        selectedIndex += gQuicktext.getTextLength(i, true);
    }

    var treeObject = document.getElementById('group-tree');
    treeObject.rowCountChanged(selectedIndex - 1, 1);
    treeObject.invalidateRow(selectedIndex);
    this.selectTreeRow(selectedIndex);

    this.updateButtonStates();
    this.changesMade();

    var titleElem = document.getElementById('text-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  },
  removeText: function () {
    this.saveText();

    if (this.mPickedIndex) {
      var groupIndex = this.mPickedIndex[0];
      var textIndex = this.mPickedIndex[1];

      var title = gQuicktext.getGroup(groupIndex, true).name;
      if (textIndex > -1)
        title = gQuicktext.getText(groupIndex, textIndex, true).name;

      if (confirm(extension.localeData.localizeMessage("remove", [title]))) {
        this.mPickedIndex = null;

        var textLength = gQuicktext.getTextLength(groupIndex, true);

        var selectedIndex = document.getElementById('group-tree').view.selection.currentIndex;
        var moveSelectionUp = false;
        if (this.mTreeArray[selectedIndex + 1] && this.mTreeArray[selectedIndex + 1][2] < this.mTreeArray[selectedIndex][2])
          moveSelectionUp = true;

        var treeObject = document.getElementById('group-tree');
        if (textIndex == -1) {
          gQuicktext.removeGroup(groupIndex, true);

          if (this.mCollapseState[groupIndex])
            treeObject.rowCountChanged(selectedIndex, -(textLength + 1));
          else
            treeObject.rowCountChanged(selectedIndex, -1);

          this.makeTreeArray();
          treeObject.invalidate();
        }
        else {
          gQuicktext.removeText(groupIndex, textIndex, true);

          treeObject.rowCountChanged(selectedIndex, -1);
          this.makeTreeArray();
          treeObject.invalidate();
        }

        this.updateVariableGUI();
        this.updateButtonStates();
        this.changesMade();

        var selectedRow = false;
        if (moveSelectionUp) {
          selectedRow = true;
          this.selectTreeRow(selectedIndex - 1);
        }

        var rowCount = this.mTreeArray.length - 1;
        if (selectedIndex > rowCount || selectedIndex == -1) {
          selectedRow = true;
          this.selectTreeRow(rowCount);
        }

        if (!selectedRow)
          this.selectTreeRow(selectedIndex);
      }
    }
  },
  addScript: function () {
    this.saveScript();

    let title = this.makeUnique(
      extension.localeData.localizeMessage("newScript"),
      gQuicktext.mEditingScripts.map(s => s.mName)
    );
    gQuicktext.addScript(title, true);

    this.updateScriptGUI();
    this.updateButtonStates();

    var listElem = document.getElementById('script-list');
    selectedIndex = listElem.getRowCount() - 1;
    listElem.selectedIndex = selectedIndex;

    this.changesMade();

    var titleElem = document.getElementById('script-title');
    titleElem.focus();
    titleElem.setSelectionRange(0, title.length);
  },
  removeScript: function () {
    this.saveScript();

    var scriptIndex = document.getElementById('script-list').value;
    if (scriptIndex != null) {
      var title = gQuicktext.getScript(scriptIndex, true).name;
      if (confirm(extension.localeData.localizeMessage("remove", [title]))) {
        gQuicktext.removeScript(scriptIndex, true);
        this.changesMade();

        if (gQuicktext.getScriptLength(true) > 0) {
          var selectedIndex = document.getElementById('script-list').selectedIndex - 1;
          if (selectedIndex < 0)
            selectedIndex = 0;
          this.mScriptIndex = selectedIndex;
        }
        else {
          this.mScriptIndex = null;
          selectedIndex = -1;
          document.getElementById('scriptwarning').style.display = "none";
        }

        document.getElementById('script-list').selectedIndex = selectedIndex;

        this.updateScriptGUI();
        this.updateVariableGUI();
        this.updateButtonStates();
      }
    }
  },

  /*
   * Other actions
   */
  getCommunityScripts: function () {
    notifyTools.notifyBackground({ command: "openWebPage", url: "https://github.com/jobisoft/quicktext/wiki/Community-scripts" });
  },
  openHomepage: function () {
    notifyTools.notifyBackground({ command: "openWebPage", url: "https://github.com/jobisoft/quicktext/wiki/" });
  },
  openScriptHelp: function () {
    notifyTools.notifyBackground({ command: "openWebPage", url: "https://github.com/jobisoft/quicktext/issues/451" });
  },
  resetCounter: function () {
    notifyTools.notifyBackground({ command: "setPref", pref: "counter", value: 0 });
  },

  /*
   * OBSERVERS
   */
  observe: function (aSubject, aTopic, aData) {
    if (aTopic == "updatesettings") {
      this.updateGUI();
    }
  }
}

window.addEventListener("DOMContentLoaded", () => settingsDialog.init());
window.addEventListener("unload", () => settingsDialog.unload());
window.addEventListener('resize', () => {
  // Keep the known offset between window size and script list size, to make it
  // correctly adjust to the changed window size.
  let listElem = document.getElementById('script-list');
  listElem.style.height = `${Math.max(150, window.innerHeight - boxHeightOffset)}px`;
});


