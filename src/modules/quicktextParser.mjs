/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as utils from "/modules/utils.mjs";
import * as storage from "/modules/storage.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";

const allowedTags = [
  'ALERT', 'ATT', 'ATTACHMENT', 'CLIPBOARD', 'COUNTER', 'CSCRIPT', 'DATE', 'ESCRIPT', 'FILE', 'IMAGE', 'FROM', 'INPUT', 'ORGATT',
  'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION', 'SELECTION', 'HEADER', 'VFSFILE'
];

// These tags do not generate content and should be collapsed with a leading line break.
const collapsingTags = [
  'ALERT', 'ATTACHMENT', 'HEADER'
]

// Placeholders a resolved value's *stray* "[[" / "]]" are masked to before it is spliced into the
// string, so they cannot be (mis)read as tag syntax on later re-parse passes. Private Use Area chars
// (contain no brackets); introduced in `parseText`, removed again in `parse` after the loop, so they
// never leave the parser. See `maskStrayBrackets`.
const MASK_OPEN = "\uE000";
const MASK_CLOSE = "\uE001";
// Longest-first tag-name alternation, snapshotted once for the anchored matcher in `matchTagEnd`.
const SORTED_TAG_ALT = allowedTags.slice().sort((a, b) => b.length - a.length).join("|");
const ANCHORED_TAG_RE = new RegExp("^\\[\\[((" + SORTED_TAG_ALT + ")(\\_[a-z]+)?)", "i");

// Possible states of `mActiveStorage`. Each template-backed state corresponds
// 1:1 to a bundle `type`:
// - VFS_TEMPLATE: bundle type "vfs" (OPFS or external). uuid identifies the
//   bundle; ref is the VFS storageRef (null = OPFS). VFS tag reads (IMAGE=VFS,
//   ATTACHMENT=VFS, VFSFILE) use `ref`.
// - IMPORT_TEMPLATE: bundle type "import" (fetched from a remote URL). uuid
//   identifies the bundle; ref is null. VFS tag reads skip with a warning (no
//   filesystem backing).
// - MANAGED_TEMPLATE: bundle type "managed" (enterprise policy). uuid
//   identifies the bundle; ref is null. VFS tag reads skip with a warning.
// - SINGLE_VARIABLE: one-shot insertion from the compose variables menu or the
//   Insert File menu. No template context (uuid is null). For VFSFILE,
//   IMAGE=VFS and ATTACHMENT=VFS the ref property may carry a VFS-picker ref.
//   TEXT/SCRIPT tags are blanked out, since there's no bundle to resolve
//   against. Other tags evaluate normally.
export const STORAGE_STATE = Object.freeze({
  VFS_TEMPLATE: "vfs-template",
  IMPORT_TEMPLATE: "import-template",
  MANAGED_TEMPLATE: "managed-template",
  SINGLE_VARIABLE: "single-variable",
});

// The value of these tags are persistent and only computed once per tab. All other
// tags are computed once per template insertion and then re-use the computed value.
// If another template is inserted (or the same template again), the state is cleared.
const persistentTags = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];

// TODO: Some tags (subject, att, from, to) are currently not cached, because they
//       can be modified in scripts or by other tags. If we find a reliable method
//       to update the cache using onChange events, we could cache these and declare
//       them as persistent tags.

export class QuicktextParser {
  constructor(aTabId, bundles) {
    this.mTabId = aTabId;
    // `bundles` is the per-storage bundle array produced by
    // storage.getActiveStorageEntries(). Each element has {storageUuid,
    // storageName, isReadOnly, templates, scripts}. TEXT and SCRIPT tag lookups
    // are scoped to the currently active bundle - see `mActiveStorage.uuid`.
    this.mBundles = bundles || [];
    // The storage context this parser evaluates against. Mutated via
    // `setActiveStorage` at the start of every top-level insertion
    // (insertTemplate / insertVariable / insertFileContent).
    this.mActiveStorage = {
      state: STORAGE_STATE.SINGLE_VARIABLE,
      ref: null,
      uuid: null,
    };
    this.mStaticDetails = null;

    //TODO: Evaluate if these values SHOULD be preserved (as getters/setters
    //      into local storage)

    // Insert the content as text/plain into an html composer (verbatim).
    // Can only be changed by the current template or nested templates which by
    // definition use the same QuicktextParser. This value is currently not saved
    // nor restored.
    this.mForceAsText = false;
    // The template insertion type (text/html or text/plain).
    this.mInsertType = null;

  }

  // Bind the parser to a storage context. See `STORAGE_STATE` for the allowed
  // states. `ref` defaults to `null` (OPFS). `uuid` defaults to `null` (no
  // bundle context). Callers provide what matters for their state and omit
  // the rest.
  setActiveStorage({ state, ref = null, uuid = null }) {
    this.mActiveStorage = { state, ref, uuid };
  }

  // Look up the currently active bundle. Only meaningful in template states
  // where a uuid is bound (VFS_TEMPLATE, IMPORT_TEMPLATE, MANAGED_TEMPLATE).
  get activeBundle() {
    return this.mBundles.find(b => b.storageUuid === this.mActiveStorage.uuid)
  }

  async parseAndInsert(str) {
    const parsed = await this.parse(str);
    if (parsed) {
      await this.insertBody(parsed, { extraSpace: false });
    }
  }

  async insertBody(aStr, options = {}) {
    let { isPlainText } = await this.getStaticDetails();
    let extraSpace = options?.extraSpace !== false;

    if (isPlainText || this.mForceAsText) {
      await messenger.tabs.sendMessage(this.mTabId, {
        insertText: aStr,
        extraSpace,
      });
    } else {
      await messenger.tabs.sendMessage(this.mTabId, {
        insertHtml: utils.removeBadHTML(aStr),
        extraSpace,
      });
    }
  }

  get tabId() {
    return this.mTabId
  }

  async getStateData() {
    return browser.storage.session
      .get({ [`QuicktextStateData_${this.mTabId}`]: {} })
      .then(rv => rv[`QuicktextStateData_${this.mTabId}`]);
  }

  async setStateData(value) {
    return browser.storage.session
      .set({ [`QuicktextStateData_${this.mTabId}`]: value });
  }

  async clearNonPersistentData() {
    let stateData = await this.getStateData();
    for (let key of Object.keys(stateData)) {
      if (persistentTags.includes(key)) {
        continue;
      }
      delete stateData[key];
    }
    await this.setStateData(stateData);
  }

  async loadStates(itemsWithDefaults) {
    const stateData = await this.getStateData();
    // Shallow clone so we don’t mutate the original.
    const result = { ...itemsWithDefaults };
    for (const key of Object.keys(result)) {
      if (Object.hasOwn(stateData, key)) {
        result[key] = stateData[key];
      }
    }
    return result;
  }

  async saveStates(items) {
    let stateData = await this.getStateData();
    for (let [item, value] of Object.entries(items)) {
      stateData[item] = value;
    }
    await this.setStateData(stateData);
  }

  async getStaticDetails() {
    if (!this.mStaticDetails) {
      this.mStaticDetails = await browser.compose.getComposeDetails(this.mTabId);
    }
    return this.mStaticDetails
  }

  async getDetails() {
    return browser.compose.getComposeDetails(this.mTabId);
  }

  async setDetail(name, newValue) {
    await browser.compose.setComposeDetails(this.mTabId, { [name]: newValue });
  }

  async addDetail(name, newValue) {
    let values = await browser.compose
      .getComposeDetails(this.tabId)
      .then(details => details[name]);

    if (!Array.isArray(values)) {
      values = [values];
    }
    if (values.includes(newValue)) {
      return;
    }
    values.push(newValue);

    await browser.compose.setComposeDetails(this.mTabId, { [name]: values });
  }

  async addAttachment(file) {
    await browser.compose.addAttachment(this.mTabId, { file })
  }

  // These process functions get the data and mostly saves their state, 
  // so if the data is requested again, it is quick.
  // Not all tags have a process function.

  // The get-functions takes the data from the process-functions and
  // returns string depending of what aVariables is.

  async get_header(aVariables) {
    if (aVariables.length == 0) {
      return "";
    }

    let name = aVariables[0].toLowerCase();
    switch (name) {
      case "to":
      case "cc":
      case "bcc":
        await this.addDetail(name, aVariables[1]);
        break;
      case "reply-to":
        await this.addDetail("replyTo", aVariables[1]);
        break;
      case "from":
      case "subject":
        await this.setDetail(name, aVariables[1]);
        break;
    }

    return "";
  }

  async get_script(aVariables) {
    return this.process_script(aVariables);
  }
  async process_script(aVariables) {
    if (aVariables.length == 0)
      return "";

    let scriptName = aVariables.shift();

    // Looks through scripts of the currently active storage only.
    const scripts = this.activeBundle?.scripts;
    if (!scripts) return "";
    for (let script of scripts) {
      if (script.name == scriptName) {
        let returnValue = "";

        try {
          // MV2 - allows code injection via strings.
          returnValue = await browser.tabs.executeScript(this.mTabId, {
            code: `(async function (tabId, sVariables) {
              this.identities = {};
              for (let func of [
                "get",
                "getDefault",
                "list"
              ]) {
                this.identities[func] = (...params) => browser.runtime.sendMessage({
                  command: "identitiesAPI",
                  func,
                  params,
                })
              }

              this.compose = {};
              for (let func of [
                "getComposeDetails",
                "setComposeDetails",
                "addAttachment",
                "removeAttachment",
                "updateAttachment",
                "getAttachmentFile",
                "listAttachments",
                "getActiveDictionaries",
                "setActiveDictionaries",
                "beginNew",
                "beginForward",
                "beginReply",
              ]) {
                this.compose[func] = (...params) => browser.runtime.sendMessage({
                  command: "composeAPI",
                  func,
                  params,
                })
              }

              this.messages = {};
              for (let func of [
                "get",
                "getFull",
                "getRaw",
                "listAttachments",
                "listInlineTextParts",
                "getAttachmentFile",
              ]) {
                this.messages[func] = (...params) => browser.runtime.sendMessage({
                  command: "messagesAPI",
                  func,
                  params,
                })
              }

              // A trailing plain-object argument is an options bag (tag
              // variables are always strings), e.g. { nullOnAbort: true }.
              // Split it off and forward it. With { nullOnAbort: true }, an
              // aborted (cancelled) interactive tag resolves to null instead of
              // the default "" - mirroring window.prompt(). Callers that want an
              // exception can throw themselves when the result is null.
              const callTag = (command, tag, args) => {
                let options = {};
                let last = args[args.length - 1];
                if (args.length && typeof last === "object" && last !== null && !Array.isArray(last)) {
                  options = args.pop();
                }
                return browser.runtime.sendMessage({ command, tabId, tag, variables: args, options });
              };
              this.quicktext = {
                tabId,
                variables: sVariables,
                processTag: (tag, ...variables) => callTag("processTag", tag, variables),
                getTag: (tag, ...variables) => callTag("getTag", tag, variables),
              };
              
              ${script.script};
            }).call({}, ${this.mTabId},${JSON.stringify(aVariables)});`,
          }).then(rv => rv[0] ? rv[0] : "");

          // MV3 - No string support :-(.
          /*
            returnValue = await browser.scripting.executeScript({
              target: { tabId: this.mTabId },
              args: [this.mTabId],
              func: new Function("tabId",`return tabId;`),
            }).then(rv => rv[0].result);
          */

          // UNSAFE EVAL - Blocked by CPG, banned on ATN.
          // "content_security_policy": "script-src 'self' 'unsafe-eval'",
          /*
            let scope = {}
            scope.mDetails = await this.getDetails();
            scope.mVariables = aVariables;
            scope.mQuicktext = this;
            scope.mTabId = this.mTabId;
            
            const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
            const func = new AsyncFunction('with(this) { ' + script.script + ' }');
            returnValue = await func.call(scope);
          */
        } catch (e) {
          if (this.mTabId) {
            await messenger.tabs.sendMessage(this.mTabId, {
              alertLabel: `[${script.name}] ${browser.i18n.getMessage("quicktext.scriptError.label")}\n${e.name}: ${e.message}`,
            });
          }
        }

        return returnValue || "";
      }
    }

    // If we reach this point, the user requested an non-existing script.
    await messenger.tabs.sendMessage(this.mTabId, {
      alertLabel: browser.i18n.getMessage("quicktext.scriptNotFound.label", [scriptName]),
    });

    return "";
  }

  async get_escript(aVariables) {
    return this.process_escript(aVariables);
  }
  async process_escript(aVariables) {
    if (aVariables.length < 2)
      return "";

    let [extensionId, scriptName, ...scriptArgs] = aVariables;
    let transmission = Promise.withResolvers();

    try {
      let port = browser.runtime.connect(extensionId, { name: "quicktext" });

      port.onMessage.addListener(async message => {
        switch (message.command) {
          case "evaluatedScript":
            transmission.resolve(message.evaluatedScript);
            break;
          case "processTag":
            {
              let processedTag = await this[`process_${message.tag.toLowerCase()}`](message.variables, message.options);
              port.postMessage({ command: "processedTag", processedTag });
            }
            break;
          case "getTag":
            {
              let gotTag = await this[`get_${message.tag.toLowerCase()}`](message.variables, message.options);
              port.postMessage({ command: "gotTag", gotTag });
            }
            break;
        }
      });

      port.postMessage({
        command: "evaluateScript",
        scriptName,
        scriptArgs,
        tabId: this.mTabId,
      });

      let rv = await transmission.promise;
      port.disconnect();

      return rv ? rv : "";
    } catch (ex) {
      console.error(`Failed to request script from <${extensionId}>`, ex)
    }
    return "";
  }

  async get_cscript(aVariables) {
    return this.process_cscript(aVariables);
  }
  async process_cscript(aVariables) {
    return this.process_escript(["quicktext.scripts@community.jobisoft.de", ...aVariables]);
  }

  // This needs the <all_urls> permission, otherwise requests to remote pages
  // will fail due to CORS.
  async process_url(aVariables) {
    if (aVariables.length == 0) {
      return "";
    }

    let url = aVariables.shift();
    if (url == "") {
      return "";
    }

    let debug = true;
    // GET is the conventional default for URL fetches; the second
    // tag arg (`|post`, `|get`, `|options`) overrides if needed.
    let method = "get";
    let post = [];

    if (aVariables.length > 0) {
      let variables = aVariables.shift().split(";");
      for (let k = 0; k < variables.length; k++) {
        let tag = variables[k].toLowerCase();
        let data = null;

        switch (tag) {
          case 'to':
          case 'att':
          case 'orgheader':
          case 'orgatt':
            data = await this["process_" + tag]();
            if (typeof data != 'undefined') {
              for (let i in data)
                for (let j in data[i])
                  post.push(tag + '[' + i + '][' + j + ']=' + data[i][j]);
            }
            break;
          case 'from':
          case 'version':
          case 'date':
          case 'time':
            data = await this["process_" + tag]();
            if (typeof data != 'undefined') {
              for (let i in data)
                post.push(tag + '[' + i + ']=' + data[i]);
            }
            break;
          case 'clipboard':
            data = await this.process_clipboard();
            if (data?.plain)
              post.push(tag + '=' + data.plain);
            break;
          case 'subject':
          case 'selection':
          case 'counter':
            data = await this["process_" + tag]();
            if (typeof data != 'undefined')
              post.push(tag + '=' + data);
            break;

          case 'post':
          case 'get':
          case 'options':
            method = tag;
            break;

          case 'debug':
            debug = true;
            break;
        }
      }
    }

    // The URL tag can transmit message, clipboard and attachment data to a
    // server chosen by the template author, so it stays blocked until the
    // user opts in on the options page (which discloses what is sent).
    if (!await storage.getPref("allowRemoteRequests")) {
      if (this.mTabId) {
        await messenger.tabs.sendMessage(this.mTabId, {
          alertLabel: browser.i18n.getMessage("quicktext.remoteBlocked.label", [url]),
        });
      }
      return debug ? "Quicktext onLoad error: remote requests are not enabled" : "";
    }

    // Bypass the HTTP cache: tag-driven URL reads should always
    // see the live resource, never a stale copy from a previous
    // template insert.
    const init = {
      method: method.toUpperCase(),
      cache: "no-store",
    };
    if (method == "post") {
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = post.map(encodeURIComponent).join("&");
    }

    try {
      const response = await fetch(url, init);
      if (response.status == 200) return this.parse(await response.text());
      return debug ? `Quicktext onLoad error: ${response.status}` : "";
    } catch (e) {
      return debug ? `Quicktext global error: ${e.message}` : "";
    }
  }
  async get_url(aVariables) {
    return this.process_url(aVariables);
  }

  async get_file(aVariables) {
    return this.process_file(aVariables);
  }
  async process_file(aVariables) {
    if (aVariables.length > 0 && aVariables[0] != "") {
      // Tries to open the file and returning the content.
      try {
        let content = await browser.FileSystemAccess.readTextFile(aVariables[0]);
        let insertMode = aVariables.length > 1 && aVariables[1].includes("force_as_text")
          ? "text/plain"
          : "text/html";
        let stripHtmlComments = aVariables.length > 1 && aVariables[1].includes("strip_html_comments");

        return this.process_file_content(content, {
          insertMode,
          stripHtmlComments
        });
      } catch (e) { console.error(e); }
    }
    return "";
  }

  async get_vfsfile(aVariables) {
    return this.process_vfsfile(aVariables);
  }
  async process_vfsfile(aVariables) {
    if (aVariables.length === 0 || aVariables[0] === "") return "";
    if (this.mActiveStorage.state === STORAGE_STATE.IMPORT_TEMPLATE ||
        this.mActiveStorage.state === STORAGE_STATE.MANAGED_TEMPLATE) {
      console.warn(`VFSFILE in non-VFS bundle; skipping: ${aVariables[0]}`);
      return "";
    }
    try {
      const file = await vfs.readFile({ path: aVariables[0], storageRef: this.mActiveStorage.ref });
      const content = await file.text();
      const insertMode = aVariables.length > 1 && aVariables[1].includes("force_as_text")
        ? "text/plain"
        : "text/html";
      const stripHtmlComments = aVariables.length > 1 && aVariables[1].includes("strip_html_comments");
      return this.process_file_content(content, { insertMode, stripHtmlComments });
    } catch (e) { console.error(e); }
    return "";
  }
  async process_file_content(content, options) {
    let insertMode = options?.insertMode ?? "text/html";
    let stripHtmlComments = options?.stripHtmlComments ?? false;

    let { isPlainText } = await this.getStaticDetails();
    if (insertMode == "text/plain" && isPlainText == false) {
      this.mForceAsText = true;
    }

    if (stripHtmlComments) {
      content = content.replace(/<!--[\s\S]*?(?:-->)/g, '');
    }

    return this.parse(content);
  }

  async process_image_content(aVariables) {
    let [mode, source, type] = aVariables;
    let mode_lc = mode.toLowerCase();

    // The first parameter is optional, defaults to FILE.
    if (!["url", "file", "vfs"].includes(mode_lc)) {
      type = source;
      source = mode;
      mode_lc = "file";
    }

    if (!type) {
      type = "tag"
    }

    let src = "";
    if (mode && source && type) {
      // Tries to open the file and return the content
      try {
        switch (mode_lc) {
          case "url": {
            src = await utils.fetchFileAsDataUrl(source);
            break;
          }
          case "file": {
            let bytes = await browser.FileSystemAccess.readBinaryFile(source);
            let leafName = utils.getLeafName(source);
            let type = utils.getTypeFromExtension(leafName);
            let binContent = utils.uint8ArrayToBase64(bytes);
            src = "data:" + type + ";filename=" + leafName + ";base64," + binContent;
            break;
          }
          case "vfs": {
            if (this.mActiveStorage.state === STORAGE_STATE.IMPORT_TEMPLATE ||
                this.mActiveStorage.state === STORAGE_STATE.MANAGED_TEMPLATE) {
              console.warn(`IMAGE=VFS in non-VFS bundle; skipping: ${source}`);
              break;
            }
            const file = await vfs.readFile({ path: source, storageRef: this.mActiveStorage.ref });
            const bytes = new Uint8Array(await file.arrayBuffer());
            const leafName = utils.getLeafName(source);
            const mimeType = utils.getTypeFromExtension(leafName);
            src = "data:" + mimeType + ";filename=" + leafName +
                  ";base64," + utils.uint8ArrayToBase64(bytes);
            break;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
    if (src) {
      return (type == "tag")
        ? "<img src='" + src + "'>"
        : src;
    }
    return "";
  }

  async get_image(aVariables) {
    let { isPlainText } = await this.getStaticDetails();
    if (!isPlainText) {
      // image tag may only be added in html mode
      return this.process_image_content(aVariables);
    } else {
      return "";
    }
  }

  async process_selection(aVariables) {
    let { isPlainText } = await this.getStaticDetails();

    if (isPlainText) {
      return messenger.tabs.sendMessage(this.mTabId, {
        getSelection: "TEXT",
      });
    } else {
      return messenger.tabs.sendMessage(this.mTabId, {
        getSelection: "HTML",
      });
    }
  }
  async get_selection(aVariables) {
    return this.process_selection(aVariables);
  }

  async process_text(aVariables) {
    if (aVariables.length < 2)
      return "";
    // Looks after the group and text-name within the currently active
    // storage only. Multi-storage lookups by name are ambiguous by design:
    // the caller's storage context must be set via setActiveStorage().
    const templates = this.activeBundle?.templates;
    if (!templates) return "";
    for (let i = 0; i < templates.groups.length; i++) {
      if (aVariables[0] == templates.groups[i].name) {
        for (let j = 0; j < templates.texts[i].length; j++) {
          let text = templates.texts[i][j];
          if (aVariables[1] == text.name) {
            let content = text.text;
            // Force insertion mode to TEXT if the template requests it.
            // This will affect also the "parent" template, if the current
            // template is a nested template, because the entire parsed string
            // will be inserted in one go. 
            let { isPlainText } = await this.getStaticDetails();
            if (
              (text.type == "text/plain" || (aVariables.length > 2 && aVariables[2].includes("force_as_text"))) &&
              isPlainText == false
            ) {
              this.mForceAsText = true;
            }

            // The template insertion type (text/html or text/plain).
            this.mInsertType = text.type;

            if (aVariables.length > 2 && aVariables[2].includes("strip_html_comments")) {
              content = content.replace(/<!--[\s\S]*?(?:-->)/g, '');
            }

            return content;
          }
        }
      }
    }

    return "";
  }
  async get_text(aVariables) {
    return this.process_text(aVariables);
  }

  async process_input(aVariables, options) {
    const inputState = `INPUT_${aVariables[0]}`;
    let states = await this.loadStates({
      [inputState]: { checked: false, data: "" }
    });

    if (!states[inputState].checked) {
      let rv;
      let label = browser.i18n.getMessage("quicktext.inputText.label", [aVariables[0]]);
      let value = aVariables[2] ?? "";

      // There are two types of input: select and text.
      if (aVariables[1] == 'select') {
        let values = value.split(";");
        rv = await utils.openPopup(this.mTabId, {
          selectLabel: label,
          selectValues: values,
        });
      } else {
        rv = await utils.openPopup(this.mTabId, {
          promptLabel: label,
          promptValue: value,
        });
      }

      // openPopup resolves to `undefined` on cancel/escape/close and to the
      // entered string (possibly "") on OK. By default we keep the legacy
      // behavior where both collapse to "". A script can opt in via
      // `options.nullOnAbort` to distinguish a cancel: we return `null`,
      // mirroring window.prompt() (null = cancel, "" = empty OK).
      if (rv) {
        states[inputState].data = rv;
        states[inputState].checked = true;
        await this.saveStates(states);
      } else if (options?.nullOnAbort && rv === undefined) {
        return null;
      }

    }

    return states[inputState].data;
  }
  async get_input(aVariables, options) {
    return this.process_input(aVariables, options);
  }

  async process_alert(aVariables) {
    messenger.tabs.sendMessage(this.mTabId, {
      alertLabel: aVariables[0],
    });
  }
  async get_alert(aVariables) {
    // An alert does not stop the evaluation.
    this.process_alert(aVariables);

    return "";
  }

  async preprocess_org() {
    let states = await this.loadStates({
      "ORGHEADER": { checked: false, data: {} },
      "ORGATT": { checked: false, data: [] },
    });

    if (!states["ORGHEADER"].checked || !states["ORGATT"].checked) {
      states["ORGHEADER"].checked = true;
      states["ORGATT"].checked = true;

      let { relatedMessageId } = await this.getStaticDetails();
      if (relatedMessageId) {
        // Store all headers in states["ORGHEADER"].
        let data = await browser.messages.getFull(relatedMessageId);
        for (let [name, value] of Object.entries(data.headers)) {
          if (!Object.hasOwn(states["ORGHEADER"].data, name)) {
            states["ORGHEADER"].data[name] = [];
          }
          states["ORGHEADER"].data[name].push(...value);
        }
        // Store all attachments in states["ORGATT"].
        let attachments = await browser.messages.listAttachments(relatedMessageId);
        for (let attachment of attachments) {
          states["ORGATT"].data.push(attachment); // {contentType, name, size, partName}
        }
      }
      await this.saveStates(states)
    }

    return {
      orgHeaderState: states["ORGHEADER"],
      orgAttState: states["ORGATT"]
    }
  }
  async process_orgheader(aVariables) {
    const { orgHeaderState } = await this.preprocess_org();
    return orgHeaderState.data;
  }
  async get_orgheader(aVariables) {
    if (aVariables.length == 0) {
      return "";
    }

    let data = await this.process_orgheader(aVariables);

    let name = aVariables[0].toLowerCase();
    let seperator = aVariables.length > 1
      ? aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t")
      : ", "

    // data is array of objects, reduce to array of specific object member.
    if (data[name]) {
      return data[name].join(seperator);
    }
    return "";
  }
  async process_orgatt(aVariables) {
    const { orgAttState } = await this.preprocess_org();
    return orgAttState.data;
  }
  async get_orgatt(aVariables) {
    let data = await this.process_orgatt(aVariables);
    let seperator = aVariables.length > 0
      ? aVariables[0].replace(/\\n/g, "\n").replace(/\\t/g, "\t")
      : ", "

    // data is array of objects {contentType, name, size, partName}, reduce to
    // array of specific object member.
    return data.map(a => a["name"]).join(seperator);
  }

  async process_version(aVariables) {
    let states = await this.loadStates({
      "VERSION": { checked: false, data: {} }
    });

    if (!states["VERSION"].checked) {
      let info = await browser.runtime.getBrowserInfo();
      states["VERSION"].checked = true;
      states["VERSION"].data['number'] = info.version;
      states["VERSION"].data['full'] = `${info.name} ${info.version}`;
      await this.saveStates(states);
    }

    return states["VERSION"].data;
  }
  async get_version(aVariables = []) {
    let data = await this.process_version(aVariables);

    if (aVariables.length < 1) {
      aVariables.push("full");
    }

    if (Object.hasOwn(data, aVariables[0])) {
      return data[aVariables[0]];
    }

    return "";
  }

  async process_att(aVariables) {
    // We cache known attachments, but not the return value itself, since
    // attachments can be removed/added by scripts.
    // Note: We do have onAttachmentAdded/onAttachmentRemoved.
    let att = [];
    let updated = false;
    let states = await this.loadStates({
      "ATT": { data: {} }
    });

    let attachments = await browser.compose.listAttachments(this.mTabId);
    for (let attachment of attachments) {
      if (!Object.hasOwn(states["ATT"], attachment.id)) {
        let file = await browser.compose.getAttachmentFile(attachment.id);
        states['ATT'][attachment.id] = [file.name, file.size, file.lastModified];
        updated = true;
      }
      att.push(states["ATT"][attachment.id]);
    }
    if (updated) {
      await this.saveStates(states);
    }
    return att;
  }
  async get_att(aVariables) {
    let data = await this.process_att(aVariables);

    if (data.length > 0) {
      let value = [];
      for (let i in data) {
        if (aVariables[0] == "full")
          value.push(data[i][0] + " (" + await browser.messengerUtilities.formatFileSize(data[i][1]) + ")");
        else if (aVariables[0] == "modified")
          value.push(data[i][2])
        else
          value.push(data[i][0]);
      }

      if (aVariables.length < 2)
        aVariables[1] = ", ";

      return utils.trimString(value.join(aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t")));
    }

    return "";
  }


  async process_attachment(aVariables) {
    let [mode, source, name] = aVariables;
    let mode_lc = mode.toLowerCase();

    // The first parameter is optional, defaults to FILE.
    if (!["url", "file", "vfs"].includes(mode_lc)) {
      name = source;
      source = mode;
      mode_lc = "file";
    }

    switch (mode_lc) {
      case "url": {
        let file = await utils.fetchFileAsFile(source, name);
        await this.addAttachment(file);
        break;
      }
      case "file": {
        let bytes = await browser.FileSystemAccess.readBinaryFile(source);
        let leafName = name ?? utils.getLeafName(source);
        let type = utils.getTypeFromExtension(leafName);
        let file = new File([bytes], leafName, { type });
        await this.addAttachment(file);
        break;
      }
      case "vfs": {
        if (this.mActiveStorage.state === STORAGE_STATE.IMPORT_TEMPLATE ||
            this.mActiveStorage.state === STORAGE_STATE.MANAGED_TEMPLATE) {
          console.warn(`ATTACHMENT=VFS in non-VFS bundle; skipping: ${source}`);
          break;
        }
        const file = await vfs.readFile({ path: source, storageRef: this.mActiveStorage.ref });
        const bytes = new Uint8Array(await file.arrayBuffer());
        const leafName = name ?? utils.getLeafName(source);
        const type = utils.getTypeFromExtension(leafName);
        await this.addAttachment(new File([bytes], leafName, { type }));
        break;
      }
    }
    return "";
  }
  async get_attachment(aVariables) {
    return this.process_attachment(aVariables);
  }

  async process_subject(aVariables) {
    // For now we do not cache the subject. Since scripts can change it, we
    // need a global onChange event in order to cache and update it correctly.
    let { subject } = await this.getDetails();
    return subject;
  }
  async get_subject(aVariables) {
    return this.process_subject(aVariables);
  }

  async preprocess_datetime() {
    let states = await this.loadStates({
      "TIME": { checked: false, data: {} },
      "DATE": { checked: false, data: {} },
    });

    if (!states["TIME"].checked || !states["DATE"].checked) {
      states["DATE"].checked = true;
      states["TIME"].checked = true;

      let timeStamp = new Date();
      for (let field of ["long", "short", "monthname"]) {
        states["DATE"].data[field] = utils.trimString(utils.getDateTimeFormat(`date-${field}`, timeStamp));
      }
      for (let field of ["seconds", "noseconds"]) {
        states["TIME"].data[field] = utils.trimString(utils.getDateTimeFormat(`time-${field}`, timeStamp));
      }
      await this.saveStates(states);
    }

    return {
      timeState: states["TIME"],
      dateState: states["DATE"],
    };
  }
  async process_date(aVariables) {
    const { dateState } = await this.preprocess_datetime();
    return dateState.data;
  }
  async process_time(aVariables) {
    const { timeState } = await this.preprocess_datetime();
    return timeState.data;
  }
  async get_date(aVariables) {
    let data = await this.process_date(aVariables);
    if (aVariables.length < 1)
      aVariables[0] = "short";
    if (Object.hasOwn(data, aVariables[0])) {
      return data[aVariables[0]];
    }

    return "";
  }
  async get_time(aVariables) {
    let data = await this.process_time(aVariables);
    if (aVariables.length < 1)
      aVariables[0] = "noseconds";
    if (Object.hasOwn(data, aVariables[0])) {
      return data[aVariables[0]];
    }

    return "";
  }

  async process_clipboard() {
    let states = await this.loadStates({
      "CLIPBOARD": { checked: false, data: {} }
    });

    if (!states["CLIPBOARD"].checked) {
      states['CLIPBOARD'].data.plain = await navigator.clipboard.readText();
      const html = await navigator.clipboard.read().then(items => items.find(
        item => item.types.includes("text/html")
      ));
      if (html) {
        states['CLIPBOARD'].data.html = await html.getType("text/html").then(
          v => v.text()
        );
      }
      await this.saveStates(states);
    }

    return states['CLIPBOARD'].data;
  }
  async get_clipboard(aVariables) {
    const { isPlainText } = await this.getStaticDetails();
    const data = await this.process_clipboard();
    const parameter = aVariables?.[0]?.toLowerCase?.();

    const getFormat = (parameter) => {
      switch (parameter) {
        case "auto":
          // Auto should never paste verbatim html code into the composer. The
          // insert type must be text/html and the composer must support html.
          return (!isPlainText && this.mInsertType == "text/html")
            ? "html"
            : "plain";
        case "html":
          return "html";
        case "plain":
        default:
          return "plain"
      }
    }

    return utils.trimString(data[getFormat(parameter)] || data.plain);
  }

  async process_counter(aVariables) {
    let states = await this.loadStates({
      "COUNTER": { checked: false, data: null }
    });

    if (!states["COUNTER"].checked) {
      states['COUNTER'].checked = true;
      states['COUNTER'].data = (await storage.getPref("counter")) + 1;
      await storage.setPref("counter", states['COUNTER'].data);
      await this.saveStates(states);
    }

    return states['COUNTER'].data;
  }
  async get_counter(aVariables) {
    return this.process_counter(aVariables);
  }

  async process_from(aVariables) {
    // For now we do not cache FROM, since it can be changed by scripts. We need
    // a global on change event for the used identity in order to cache FROM.
    // Note: We do have onIdentityChanged
    let details = await this.getDetails();
    let identity = await browser.identities.get(details.identityId);

    let states = {};
    states['FROM'] = {};
    states['FROM'].data = {
      'email': identity.email,
      'displayname': identity.name,
      'firstname': '',
      'lastname': ''
    };
    await this.getcarddata_from(identity, states);

    return states['FROM'].data;
  }
  async getcarddata_from(identity, states) {
    // 1. TODO: CardBook -> need cardbook api
    // ...

    // 2. search identity email
    let cards = await browser.contacts.quickSearch({
      includeRemote: false,
      searchString: identity.email.toLowerCase()
    })
    let card = cards.find(c => c.type == "contact");

    // 3. TODO: vcard of identity
    if (!card && identity.escapedVCard) {
      //card = manager.escapedVCardToAbCard(aIdentity.escapedVCard);
    }

    if (!card) {
      return;
    }

    // Get directly stored props first.
    for (let [name, value] of Object.entries(card.properties)) {
      // For backward compatibility, use lowercase props.
      states['FROM'].data[name.toLowerCase()] = value;
    }
    states['FROM'].data['fullname'] = utils.trimString(states['FROM'].data['firstname'] + " " + states['FROM'].data['lastname']);
  }
  async get_from(aVariables) {
    let data = await this.process_from(aVariables);

    if (Object.hasOwn(data, aVariables[0])) {
      return utils.trimString(data[aVariables[0]]);
    }
    return "";
  }

  async process_to(aVariables) {
    // For now we do not cache TO, since it can be changed by scripts or by
    // the HEADER tag.
    let states = {};
    states['TO'] = {};
    states['TO'].data = {
      'email': [],
      'firstname': [],
      'lastname': [],
      'fullname': []
    };

    let details = await this.getDetails();
    let emailAddresses = Array.isArray(details.to) ? details.to : [details.to];

    for (let i = 0; i < emailAddresses.length; i++) {
      // TODO: Add code for getting info about all people in a mailing list.

      let contactData = await utils.parseDisplayName(emailAddresses[i]);
      let k = states['TO'].data['email'].length;
      states['TO'].data['email'][k] = contactData.email.toLowerCase();
      states['TO'].data['fullname'][k] = utils.trimString(contactData.name);
      states['TO'].data['firstname'][k] = "";
      states['TO'].data['lastname'][k] = "";

      await this.getcarddata_to(k, states);

      let validParts = [states['TO'].data['firstname'][k], states['TO'].data['lastname'][k]].filter(e => e.trim() != "");
      if (validParts.length == 0) {
        // if no first and last name, generate them from fullname
        let parts = states['TO'].data['fullname'][k].replace(/,/g, ", ").split(" ").filter(e => e.trim() != "");
        states['TO'].data['firstname'][k] = parts.length > 1 ? utils.trimString(parts.splice(0, 1)) : "";
        states['TO'].data['lastname'][k] = utils.trimString(parts.join(" "));
      } else {
        // if we have a first and/or last name (which can only happen if read from card), generate fullname from it
        states['TO'].data['fullname'][k] = validParts.join(" ");
      }

      // swap names if wrong
      if (states['TO'].data['firstname'][k].endsWith(",")) {
        let temp_firstname = states['TO'].data['firstname'][k].replace(/,/g, "");
        let temp_lastname = states['TO'].data['lastname'][k];
        states['TO'].data['firstname'][k] = temp_lastname;
        states['TO'].data['lastname'][k] = temp_firstname;
        // rebuild fullname
        states['TO'].data['fullname'][k] = [states['TO'].data['firstname'][k], states['TO'].data['lastname'][k]].join(" ");
      }
    }

    return states['TO'].data;
  }
  async getcarddata_to(aIndex, states) {
    // 1. CardBook -> need cardbook api
    // ...

    // take card value, if it exists
    // 2. search identity email
    let cards = await browser.contacts.quickSearch({
      includeRemote: false,
      searchString: states['TO'].data['email'][aIndex].toLowerCase()
    })

    let email = states['TO'].data['email'][aIndex].toLowerCase();
    
    // Prefer an exact email address match.
    // Thunderbird's quickSearch() may return contacts with similar email addresses, so using the first result can select the wrong contact.
    let card = cards.find(c =>
      c.type == "contact" &&
      (
        c.properties.PrimaryEmail?.toLowerCase() == email ||
        c.properties.SecondEmail?.toLowerCase() == email
      )
    );

    // Fall back to the previous behavior if no exact match is available.
    if (!card) {
      card = cards.find(c => c.type == "contact");
    }

    if (card != null) {
      // Get directly stored props first.
      for (let [name, value] of Object.entries(card.properties)) {
        let lowerCaseName = name.toLowerCase();

        if (!Object.hasOwn(states['TO'].data, lowerCaseName)) {
          states['TO'].data[lowerCaseName] = []
        }
        if (value != "" || !Object.hasOwn(states['TO'].data[lowerCaseName], aIndex) || states['TO'].data[lowerCaseName][aIndex] == "") {
          states['TO'].data[lowerCaseName][aIndex] = utils.trimString(value);
        }
      }
    }
    return states;
  }
  async get_to(aVariables) {
    let data = await this.process_to(aVariables);

    if (Object.hasOwn(data, aVariables[0])) {
      // use ", " as default seperator
      let mainSep = (aVariables.length > 1) ? aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : ", ";
      let lastSep = (aVariables.length > 2) ? aVariables[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t") : mainSep;

      // clone the data, so we can work on it without mod the source object
      let entries = data[aVariables[0]].slice(0);
      let last = entries.pop();

      // build the final string
      let all = [];
      if (entries.length > 0) all.push(entries.join(mainSep));
      all.push(last);
      return all.join(lastSep);
    }

    return "";
  }

  // -------------------------------------------------------------------------

  async parse(aStr) {
    try {
      // Strip any pre-existing mask placeholders so a template can't smuggle one in (defensive; the
      // masks are an internal artifact introduced/removed within this method).
      aStr = aStr.replaceAll(MASK_OPEN, "").replaceAll(MASK_CLOSE, "");

      // Reparse the text until there is no difference in the text
      // or that we parse 100 times (so we don't make an infinitive loop)
      let oldStr;
      let count = 0;

      do {
        count++;
        oldStr = aStr;
        aStr = await this.parseText(aStr);
      } while (aStr != oldStr && count < 20);

      // Restore stray brackets that were masked while resolving tag values.
      return unmaskBrackets(aStr);
    } catch (ex) {
      console.log(ex);
    }
  }
  async parseText(aStr) {
    let tags = getTags(aStr);

    // If we don't find any tags there will be no changes to the string so return.
    if (tags.length == 0)
      return aStr;

    // Replace all tags with there right contents
    for (let i = 0; i < tags.length; i++) {
      const tagName = tags[i].tagName.toLowerCase();
      // TEXT and SCRIPT tags resolve against `activeBundle`, so they only
      // make sense inside a template context. In SINGLE_VARIABLE state
      // (compose-menu FILE/VFSFILE, Insert File menu) there is no bundle
      // bound, so these evaluate to "" and disappear from the output.
      const isUnresolvableBundleTag =
        this.mActiveStorage.state === STORAGE_STATE.SINGLE_VARIABLE &&
        (tagName === "text" || tagName === "script");
      let value = "";
      let variable_limit = -1;
      switch (tagName) {
        case 'att':
        case 'clipboard':
        case 'selection':
        case 'counter':
        case 'date':
        case 'subject':
        case 'time':
        case 'version':
        case 'orgatt':
          variable_limit = 0;
          break;
        case 'alert':
        case 'file':
        case 'vfsfile':
        case 'image':
        case 'from':
        case 'input':
        case 'orgheader':
        case 'script':
        case 'cscript':
        case 'to':
        case 'url':
        case 'attachment':
          variable_limit = 1;
          break;
        case 'text':
        case 'header':
        case 'escript':
          variable_limit = 2;
          break;
      }

      // if the method "get_[tagname]" exists and there is enough arguments we call it
      if (!isUnresolvableBundleTag &&
          typeof this["get_" + tagName] == "function" &&
          variable_limit >= 0 &&
          tags[i].variables.length >= variable_limit) {
        // Variables were parsed out of the masked string; unmask them so a value that carried stray
        // brackets reaches the getter (and any display it does, e.g. an INPUT prompt) as literal text.
        value = await this["get_" + tagName](tags[i].variables.map(unmaskBrackets));
      }
      // Mask stray "[[" / "]]" in the resolved value so inserted data can never restructure the
      // template on a later pass (complete tags survive and still fire). Unmasked in parse() at the end.
      aStr = utils.replaceText(tags[i].tag, maskStrayBrackets(value), aStr, { collapseLineBreaks: collapsingTags.includes(tags[i].tagName) });
    }

    return aStr;
  }
}

// If a *complete* recognized tag starts at `pos` in `str`, return the index just past its closing
// "]]"; otherwise return -1. Single brackets stay literal.
//
// The argument of an =tag may itself contain nested recognized tags, e.g.
// `[[URL=https://host/?id=[[VERSION]]]]`. Scanning to the *first* "]]" would stop at the inner
// tag's closer and report `[[URL=...[[VERSION]]` as the whole tag - leaving the outer tag's real
// "]]" behind to be masked as a stray, which then prevents the URL tag from ever closing on a later
// pass (#630/#636). So the scan steps over each nested recognized tag as a unit and only accepts a
// "]]" that closes THIS tag. Lone brackets and unrecognized "[[" remain literal, as in the flat case.
function matchTagEnd(str, pos) {
  const m = ANCHORED_TAG_RE.exec(str.slice(pos));
  if (!m) return -1;
  const nameEnd = pos + m[0].length;           // m[0] = "[[" + tagname(+_var)
  if (str.substr(nameEnd, 2) == "]]") return nameEnd + 2;
  if (str[nameEnd] == "=") {
    let i = nameEnd + 1;
    while (i < str.length) {
      if (str[i] == "]" && str[i + 1] == "]") return i + 2;
      if (str[i] == "[" && str[i + 1] == "[") {
        const inner = matchTagEnd(str, i);   // a nested recognized tag: skip it whole
        if (inner != -1) { i = inner; continue; }
      }
      i++;
    }
  }
  return -1;
}

// Mask a resolved value's *stray* brackets before it is spliced into the parse string. Complete tags
// (`[[VERSION]]`, `[[TO=x]]`, …) are copied verbatim so intentional injection / nesting still fires;
// every other "[[" and "]]" is replaced with a bracket-free placeholder so it can neither form nor
// move a tag boundary on a later pass (also forbids assembling a tag from separate fragments). Lone
// "[" / "]" are left as-is (already inert under the first-"]]" scanner). Reversed by unmaskBrackets.
function maskStrayBrackets(str) {
  if (typeof str !== "string" || !str) return str;
  let out = "";
  let i = 0;
  const n = str.length;
  while (i < n) {
    if (str[i] == "[" && str[i + 1] == "[") {
      const end = matchTagEnd(str, i);
      if (end != -1) { out += str.slice(i, end); i = end; continue; }
      out += MASK_OPEN; i += 2; continue;
    }
    if (str[i] == "]" && str[i + 1] == "]") {
      out += MASK_CLOSE; i += 2; continue;
    }
    out += str[i]; i++;
  }
  return out;
}

function unmaskBrackets(str) {
  return str.replaceAll(MASK_OPEN, "[[").replaceAll(MASK_CLOSE, "]]");
}

export function getTags(aStr) {
  // We only get the beginning of the tag.
  // This is because we want to handle recursive use of tags.
  // Sorting to test for longer tags first (ATTACHMENT vs ATT).
  let rexp = new RegExp("\\[\\[((" + allowedTags.sort((a, b) => b.length - a.length).join("|") + ")(\\_[a-z]+)?)", "ig");
  let results = [];
  let result = null;
  while ((result = rexp.exec(aStr)))
    results.push(result);

  // If we did't find any tags we return.
  if (results.length == 0)
    return [];

  // Take care of the tags starting with the last one.
  let hits = [];
  results.reverse();
  let strLen = aStr.length;
  for (let i = 0; i < results.length; i++) {
    let tmpHit = {};
    tmpHit.tag = results[i][0];
    tmpHit.variables = [];

    // if the tagname contains a "_"-char that means
    // that is an old tag and we need to translate it
    // to a tagname and a variable
    let pos = results[i][1].indexOf("_");
    if (pos > 0) {
      tmpHit.variables.push(results[i][1].substr(pos + 1).toLowerCase());
      tmpHit.tagName = results[i][1].substring(0, pos);
    }
    else
      tmpHit.tagName = results[i][1];

    // Get the end of the starttag.
    pos = results[i].index + results[i][1].length + 2;

    // If the tag ended here we're done.
    if (aStr.substr(pos, 2) == "]]") {
      tmpHit.tag += "]]";
      hits = addTag(hits, tmpHit);
    }
    // If there are arguments we get them.
    else if (aStr[pos] == "=") {
      // The argument runs up to the first "]]" (before the next tag start, tracked by strLen).
      // Only "]]" terminates - lone "[" / "]" and stray "[[" inside the argument are literal, so
      // no unbalanced bracket (e.g. from inserted contact data) can desync the scan. Recognized
      // nested tags are handled inner-first across re-parse passes via the strLen bound below.
      pos++;
      const end = aStr.indexOf("]]", pos);
      if (end != -1 && end + 2 <= strLen) {
        const vars = aStr.substring(pos, end);
        tmpHit.tag += "=" + vars + "]]";
        for (const v of vars.split("|"))
          tmpHit.variables.push(v);

        // Adds the tag
        hits = addTag(hits, tmpHit);
      }
    }

    // We don't want to go over this tag again
    strLen = results[i].index;
  }

  hits.reverse();
  return hits;
}
// Checks if the tag isn't added before.
// We just want to handle all unique tags once
function addTag(aTags, aNewTag) {
  for (let i = 0; i < aTags.length; i++)
    if (aTags[i].tag == aNewTag.tag)
      return aTags;

  aTags.push(aNewTag);
  return aTags;
}
