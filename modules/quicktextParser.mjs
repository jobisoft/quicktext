/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as utils from "/modules/utils.mjs";
import * as storage from "/modules/storage.mjs";

const allowedTags = [
  'ALERT', 'ATT', 'ATTACHMENT', 'CLIPBOARD', 'COUNTER', 'CSCRIPT', 'DATE', 'ESCRIPT', 'FILE', 'IMAGE', 'FROM', 'INPUT', 'ORGATT',
  'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION', 'SELECTION', 'HEADER'
];

// These tags do not generate content and should be collapsed with a leading line break.
const collapsingTags = [
  'ALERT', 'ATTACHMENT', 'HEADER'
]

// The value of these tags are persistent and only computed once per tab. All other
// tags are computed once per template insertion and then re-use the computed value.
// If another template is inserted (or the same template again), the state is cleared.
const persistentTags = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];

// TODO: Some tags (subject, att, from, to) are currently not cached, because they
//       can be modified in scripts or by other tags. If we find a reliable method
//       to update the cache using onChange events, we could cache these and declare
//       them as persistent tags.

export class QuicktextParser {
  constructor(aTabId, templates, scripts) {
    this.mTabId = aTabId;
    this.mTemplates = templates;
    this.mScripts = scripts;
    this.mStaticDetails = null;

    //TODO: Evaluate if these these values SHOULD be preserved (as getters/setters
    //      into local storage)

    // Insert the content as text/plain into an html composer (verbatim).
    // Can only be changed by the current template or nested templates which by
    // definition use the same QuicktextParser. This value is currently not saved
    // nor restored.
    this.mForceAsText = false;
    // The template insertion type (text/html or text/plain).
    this.mInsertType = null;

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
  get scripts() {
    return this.mScripts;
  }
  get templates() {
    return this.mTemplates;
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

    // Looks through all scripts and tries to find the one we look for.
    for (let script of this.mScripts) {
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

              this.quicktext = {
                tabId,
                variables: sVariables,
                processTag: (tag, ...variables) => browser.runtime.sendMessage({
                  command: "processTag",
                  tabId,
                  tag,
                  variables,
                }),
                getTag: (tag, ...variables) => browser.runtime.sendMessage({
                  command: "getTag",
                  tabId,
                  tag,
                  variables,
                }),
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
              alertLabel: `[${script.name}] ${browser.i18n.getMessage("scriptError")}\n${e.name}: ${e.message}`,
            });
          }
        }

        return returnValue || "";
      }
    }

    // If we reach this point, the user requested an non-existing script.
    await messenger.tabs.sendMessage(this.mTabId, {
      alertLabel: browser.i18n.getMessage("scriptNotFound", [scriptName]),
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
              let processedTag = await this[`process_${message.tag.toLowerCase()}`](message.variables);
              port.postMessage({ command: "processedTag", processedTag });
            }
            break;
          case "getTag":
            {
              let gotTag = await this[`get_${message.tag.toLowerCase()}`](message.variables);
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
    let method = "post";
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
          case 'subject':
          case 'clipboard':
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

    let response = new Promise(resolve => {
      let req = new XMLHttpRequest();
      req.open(method, url, true);
      if (method == "post") req.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

      req.ontimeout = function () {
        if (debug) {
          resolve("Quicktext timeout");
        } else {
          resolve()
        }
      };

      req.onerror = function () {
        if (debug) {
          resolve(`Quicktext global error: ${req.status}`);
        } else {
          resolve()
        }
      };

      req.onload = function () {
        if (req.status == 200) {
          resolve(req.responseText);
        } else if (debug) {
          resolve(`Quicktext onLoad error: ${req.status}`);
        } else {
          resolve();
        }
      };

      let postdata = method == "post"
        ? post.map(encodeURIComponent).join("&")
        : null;
      req.send(postdata);
    });

    return response;
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
        let content = await browser.Quicktext.readTextFile(aVariables[0]);
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
  async process_file_content(content, options) {
    let insertMode = options?.insertMode ?? "text/html";
    let stripHtmlComments = options?.stripHtmlComments == false;

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
    if (!["url", "file"].includes(mode_lc)) {
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
            let bytes = await browser.Quicktext.readBinaryFile(source);
            let leafName = utils.getLeafName(source);
            let type = utils.getTypeFromExtension(leafName);
            let binContent = utils.uint8ArrayToBase64(bytes);
            src = "data:" + type + ";filename=" + leafName + ";base64," + binContent;
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
    // Looks after the group and text-name and returns
    // the text from it
    for (let i = 0; i < this.mTemplates.groups.length; i++) {
      if (aVariables[0] == this.mTemplates.groups[i].name) {
        for (let j = 0; j < this.mTemplates.texts[i].length; j++) {
          let text = this.mTemplates.texts[i][j];
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

  async process_input(aVariables) {
    const inputState = `INPUT_${aVariables[0]}`;
    let states = await this.loadStates({
      [inputState]: { checked: false, data: "" }
    });

    if (!states[inputState].checked) {
      let rv;
      let label = browser.i18n.getMessage("inputText", [aVariables[0]]);
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

      // Note: Empty is cancel.
      if (rv) {
        states[inputState].data = rv;
        states[inputState].checked = true;
        await this.saveStates(states);
      }

    }

    return states[inputState].data;
  }
  async get_input(aVariables) {
    return this.process_input(aVariables);
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
    if (!["url", "file"].includes(mode_lc)) {
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
        let bytes = await browser.Quicktext.readBinaryFile(source);
        let leafName = name ?? utils.getLeafName(source);
        let type = utils.getTypeFromExtension(leafName);
        let file = new File([bytes], leafName, { type });
        await this.addAttachment(file);
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
      // TODO: Add code for getting info about all people in a mailing list

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
    let card = cards.find(c => c.type == "contact");

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
      // Reparse the text until there is no difference in the text
      // or that we parse 100 times (so we don't make an infinitive loop)
      let oldStr;
      let count = 0;

      do {
        count++;
        oldStr = aStr;
        aStr = await this.parseText(aStr);
      } while (aStr != oldStr && count < 20);

      return aStr;
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
      let value = "";
      let variable_limit = -1;
      switch (tags[i].tagName.toLowerCase()) {
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
      if (typeof this["get_" + tags[i].tagName.toLowerCase()] == "function" && variable_limit >= 0 && tags[i].variables.length >= variable_limit) {
        value = await this["get_" + tags[i].tagName.toLowerCase()](tags[i].variables);
      }
      aStr = utils.replaceText(tags[i].tag, value, aStr, { collapseLineBreaks: collapsingTags.includes(tags[i].tagName) });
    }

    return aStr;
  }
}

function getTags(aStr) {
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
      // We go through until we find ]] but we must have went
      // through the same amount of [ and ] before. So if there
      // is an tag in the middle we just jump over it.
      pos++;
      let bracketCount = 0;
      let ready = false;
      let vars = "";
      while (!ready && pos < strLen) {
        if (aStr[pos] == "[")
          bracketCount++;
        if (aStr[pos] == "]") {
          bracketCount--;
          if (bracketCount == -1 && aStr[pos + 1] == "]") {
            ready = true;
            break;
          }
        }
        vars += aStr[pos];
        pos++;
      }

      // If we found the end we parse the arguments.
      if (ready) {
        tmpHit.tag += "=" + vars + "]]";
        vars = vars.split("|");
        for (let j = 0; j < vars.length; j++)
          tmpHit.variables.push(vars[j]);

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
