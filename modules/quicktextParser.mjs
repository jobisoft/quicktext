/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as utils from "/modules/utils.mjs";
import * as storage from "/modules/storage.mjs";

const allowedTags = [
  'ALERT', 'ATT', 'CLIPBOARD', 'COUNTER', 'CSCRIPT', 'DATE', 'ESCRIPT', 'FILE', 'IMAGE', 'FROM', 'INPUT', 'ORGATT',
  'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION', 'SELECTION', 'HEADER'
];

// The value of these tags are persistent and only computed once per tab. All other
// tags are computed once per template insertion and then re-use the computed value.
// If another template is inserted (or the same template again), the state is cleared.
const persistentTags = ['COUNTER', 'ORGATT', 'ORGHEADER', 'VERSION'];

export class QuicktextParser {
  constructor(aTabId, templates, scripts) {
    this.mTabId = aTabId;
    this.mTemplates = templates;
    this.mScripts = scripts;

    // Can only be changed by the current template or nested templates which by
    // definition use the same QuicktextParser. This value is not saved nor
    // restored.
    this.mForceAsText = false;

    this.mData = {}
    this.mDetails = null;

    this.keepStates = false;
  }

  async insertBody(aStr, options = {}) {
    let { isPlainText } = await this.getDetails();
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

  async clearNonPersistentData() {
    for (let key of Object.keys(this.mData)) {
      if (persistentTags.includes(key)) {
        continue;
      }
      delete this.mData[key];
    }
  }

  async saveState() {
    let state = {
      mData: this.mData,
    }
    await browser.storage.local.set({ [`QuicktextStateData_${this.mTabId}`]: state });
  }

  async loadState() {
    let stateData = await browser.storage.local
      .get({ [`QuicktextStateData_${this.mTabId}`]: null })
      .then(rv => rv[`QuicktextStateData_${this.mTabId}`]);

    if (stateData) {
      this.mData = stateData.mData;
    }
  }

  async getDetails() {
    if (!this.mDetails) {
      this.mDetails = await browser.compose.getComposeDetails(this.mTabId);
    }
    return this.mDetails
  }

  async setDetail(name, newValue) {
    await browser.compose.setComposeDetails(this.mTabId, { [name]: newValue });
    this.mDetails = await browser.compose.getComposeDetails(this.mTabId);
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
    this.mDetails = await browser.compose.getComposeDetails(this.mTabId);
  }

  async addAttachment(file) {
    await browser.compose.addAttachment(this.mTabId, { file })
    this.mDetails = await browser.compose.getComposeDetails(this.mTabId);
  }

  // These process functions get the data and mostly saves it
  // in this.mData so if the data is requested again, it is quick.
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

    let { isPlainText } = await this.getDetails();
    if (insertMode == "text/plain" && isPlainText == false) {
      this.mForceAsText = true;
    }

    if (stripHtmlComments) {
      content = content.replace(/<!--[\s\S]*?(?:-->)/g, '');
    }

    return this.parse(content);
  }

  async process_image_content(aVariables) {
    let rv = "";

    if (aVariables.length > 0 && aVariables[0] != "") {
      let mode = (aVariables.length > 1 && "src" == aVariables[1].toString().toLowerCase()) ? "src" : "tag";

      // Tries to open the file and returning the content
      try {
        let bytes = await browser.Quicktext.readBinaryFile(aVariables[0]);
        let leafName = utils.getLeafName(aVariables[0]);
        let type = utils.getTypeFromExtension(leafName);
        let binContent = utils.uint8ArrayToBase64(bytes);
        let src = "data:" + type + ";filename=" + leafName + ";base64," + binContent;
        rv = (mode == "tag")
          ? "<img src='" + src + "'>"
          : src;
      } catch (e) {
        console.error(e);
      }
    }
    return rv;
  }
  async get_image(aVariables) {
    let details = await this.getDetails();
    if (!details.isPlainText) {
      // image tag may only be added in html mode
      return this.process_image_content(aVariables);
    } else {
      return "";
    }
  }

  async process_selection(aVariables) {
    let details = await this.getDetails();

    if (details.isPlainText) {
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
            let { isPlainText } = await this.getDetails();
            if (
              (text.type == "text/plain" || (aVariables.length > 2 && aVariables[2].includes("force_as_text"))) &&
              isPlainText == false
            ) {
              this.mForceAsText = true;
            }

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
    if (typeof this.mData['INPUT'] == 'undefined')
      this.mData['INPUT'] = {};
    if (typeof this.mData['INPUT'].data == 'undefined')
      this.mData['INPUT'].data = {};

    if (typeof this.mData['INPUT'].data[aVariables[0]] != 'undefined')
      return this.mData['INPUT'].data;

    let rv;
    let label = browser.i18n.getMessage("inputText", [aVariables[0]]);
    let value = typeof aVariables[2] != 'undefined'
      ? aVariables[2]
      : "";

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
    if (rv) {
      this.mData['INPUT'].data[aVariables[0]] = rv
    } else {
      this.mData['INPUT'].data[aVariables[0]] = "";
    }

    return this.mData['INPUT'].data;
  }
  async get_input(aVariables) {
    let data = await this.process_input(aVariables);

    if (typeof data[aVariables[0]] != "undefined")
      return data[aVariables[0]];

    return "";
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
    this.mData['ORGHEADER'] = {};
    this.mData['ORGHEADER'].checked = true;
    this.mData['ORGHEADER'].data = {};

    this.mData['ORGATT'] = {};
    this.mData['ORGATT'].checked = true;
    this.mData['ORGATT'].data = [];

    let details = await this.getDetails();
    if (!details.relatedMessageId) {
      return
    }


    // Store all headers in the mData-variable
    let data = await browser.messages.getFull(details.relatedMessageId);
    for (let [name, value] of Object.entries(data.headers)) {
      if (typeof this.mData['ORGHEADER'].data[name] == 'undefined') {
        this.mData['ORGHEADER'].data[name] = [];
      }
      this.mData['ORGHEADER'].data[name].push(...value);
    }

    // Store all attachments in the mData-variable
    let attachments = await browser.messages.listAttachments(details.relatedMessageId);
    for (let attachment of attachments) {
      this.mData['ORGATT'].data.push(attachment); // {contentType, name, size, partName}
    }
  }
  async process_orgheader(aVariables) {
    if (this.mData['ORGHEADER'] && this.mData['ORGHEADER'].checked)
      return this.mData['ORGHEADER'].data;

    await this.preprocess_org();
    return this.mData['ORGHEADER'].data;
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
    if (this.mData['ORGATT'] && this.mData['ORGATT'].checked)
      return this.mData['ORGATT'].data;

    await this.preprocess_org();
    return this.mData['ORGATT'].data;
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
    if (this.mData['VERSION'] && this.mData['VERSION'].checked) {
      return this.mData['VERSION'].data;
    }

    let info = await browser.runtime.getBrowserInfo();
    this.mData['VERSION'] = {};
    this.mData['VERSION'].checked = true;
    this.mData['VERSION'].data = {};
    this.mData['VERSION'].data['number'] = info.version;
    this.mData['VERSION'].data['full'] = `${info.name} ${info.version}`;

    return this.mData['VERSION'].data;
  }
  async get_version(aVariables = []) {
    let data = await this.process_version(aVariables);

    if (aVariables.length < 1) {
      aVariables.push("full");
    }

    if (typeof data[aVariables[0]] != 'undefined') {
      return data[aVariables[0]];
    }

    return "";
  }

  async process_att(aVariables) {
    if (this.mData['ATT'] && this.mData['ATT'].checked)
      return this.mData['ATT'].data;

    this.mData['ATT'] = {};
    this.mData['ATT'].checked = true;
    this.mData['ATT'].data = [];

    let attachments = await browser.compose.listAttachments(this.mTabId);
    for (let attachment of attachments) {
      let file = await browser.compose.getAttachmentFile(attachment.id);
      this.mData['ATT'].data.push([file.name, file.size, file.lastModified]);
    }

    return this.mData['ATT'].data;
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

  async process_subject(aVariables) {
    if (this.mData['SUBJECT'] && this.mData['SUBJECT'].checked)
      return this.mData['SUBJECT'].data;

    this.mData['SUBJECT'] = {};
    this.mData['SUBJECT'].checked = true;
    this.mData['SUBJECT'].data = "";

    let details = await this.getDetails();
    this.mData['SUBJECT'].data = details.subject;

    return this.mData['SUBJECT'].data;
  }
  async get_subject(aVariables) {
    return this.process_subject(aVariables);
  }

  preprocess_datetime() {
    this.mData['DATE'] = {};
    this.mData['DATE'].checked = true;
    this.mData['DATE'].data = {};
    this.mData['TIME'] = {};
    this.mData['TIME'].checked = true;
    this.mData['TIME'].data = {};

    let timeStamp = new Date();
    let fields = ["DATE-long", "DATE-short", "DATE-monthname", "TIME-seconds", "TIME-noseconds"];
    for (let i = 0; i < fields.length; i++) {
      let field = fields[i];
      let fieldinfo = field.split("-");
      this.mData[fieldinfo[0]].data[fieldinfo[1]] = utils.trimString(utils.getDateTimeFormat(field, timeStamp));
    }
  }
  async process_date(aVariables) {
    if (this.mData['DATE'] && this.mData['DATE'].checked)
      return this.mData['DATE'].data;

    this.preprocess_datetime();
    return this.mData['DATE'].data;
  }
  async process_time(aVariables) {
    if (this.mData['TIME'] && this.mData['TIME'].checked)
      return this.mData['TIME'].data;

    this.preprocess_datetime();
    return this.mData['TIME'].data;
  }
  async get_date(aVariables) {
    let data = await this.process_date(aVariables);

    if (aVariables.length < 1)
      aVariables[0] = "short";
    if (typeof data[aVariables[0]] != 'undefined')
      return data[aVariables[0]];

    return "";
  }
  async get_time(aVariables) {
    let data = await this.process_time(aVariables);
    if (aVariables.length < 1)
      aVariables[0] = "noseconds";
    if (typeof data[aVariables[0]] != 'undefined')
      return data[aVariables[0]];

    return "";
  }

  async process_clipboard() {
    if (this.mData['CLIPBOARD'] && this.mData['CLIPBOARD'].checked)
      return this.mData['CLIPBOARD'].data;

    this.mData['CLIPBOARD'] = {};
    this.mData['CLIPBOARD'].checked = true;

    let html = "";
    const items = await navigator.clipboard.read();
    const htmlItem = items.find((item) => item.types.includes("text/html"));
    if (htmlItem) {
      html = await (await htmlItem.getType("text/html")).text();
    }

    this.mData['CLIPBOARD'].data = {
      html,
      plain: await navigator.clipboard.readText(),
    };

    return this.mData['CLIPBOARD'].data;
  }
  async get_clipboard(aVariables) {
    const format = aVariables?.[0]?.toLowerCase?.() === "html" ? "html" : "plain";
    return utils.trimString((await this.process_clipboard(aVariables))[format]);
  }

  async process_counter(aVariables) {
    if (this.mData['COUNTER'] && this.mData['COUNTER'].checked)
      return this.mData['COUNTER'].data;

    this.mData['COUNTER'] = {};
    this.mData['COUNTER'].checked = true;
    this.mData['COUNTER'].data = await storage.getPref("counter");
    this.mData['COUNTER'].data++;
    await storage.setPref("counter", this.mData['COUNTER'].data);

    return this.mData['COUNTER'].data;
  }
  async get_counter(aVariables) {
    return this.process_counter(aVariables);
  }

  async process_from(aVariables) {
    if (this.mData['FROM'] && this.mData['FROM'].checked) {
      return this.mData['FROM'].data;
    }

    let details = await this.getDetails();
    let identity = await browser.identities.get(details.identityId);

    this.mData['FROM'] = {};
    this.mData['FROM'].checked = true;
    this.mData['FROM'].data = {
      'email': identity.email,
      'displayname': identity.name,
      'firstname': '',
      'lastname': ''
    };
    await this.getcarddata_from(identity);

    return this.mData['FROM'].data;
  }
  async getcarddata_from(identity) {
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
      this.mData['FROM'].data[name.toLowerCase()] = value;
    }
    this.mData['FROM'].data['fullname'] = utils.trimString(this.mData['FROM'].data['firstname'] + " " + this.mData['FROM'].data['lastname']);
  }
  async get_from(aVariables) {
    let data = await this.process_from(aVariables);

    if (typeof data[aVariables[0]] != 'undefined') {
      return utils.trimString(data[aVariables[0]]);
    }
    return "";
  }

  async process_to(aVariables) {
    if (this.mData['TO'] && this.mData['TO'].checked)
      return this.mData['TO'].data;

    this.mData['TO'] = {};
    this.mData['TO'].checked = true;
    this.mData['TO'].data = {
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
      let k = this.mData['TO'].data['email'].length;
      this.mData['TO'].data['email'][k] = contactData.email.toLowerCase();
      this.mData['TO'].data['fullname'][k] = utils.trimString(contactData.name);
      this.mData['TO'].data['firstname'][k] = "";
      this.mData['TO'].data['lastname'][k] = "";

      await this.getcarddata_to(k);

      let validParts = [this.mData['TO'].data['firstname'][k], this.mData['TO'].data['lastname'][k]].filter(e => e.trim() != "");
      if (validParts.length == 0) {
        // if no first and last name, generate them from fullname
        let parts = this.mData['TO'].data['fullname'][k].replace(/,/g, ", ").split(" ").filter(e => e.trim() != "");
        this.mData['TO'].data['firstname'][k] = parts.length > 1 ? utils.trimString(parts.splice(0, 1)) : "";
        this.mData['TO'].data['lastname'][k] = utils.trimString(parts.join(" "));
      } else {
        // if we have a first and/or last name (which can only happen if read from card), generate fullname from it
        this.mData['TO'].data['fullname'][k] = validParts.join(" ");
      }

      // swap names if wrong
      if (this.mData['TO'].data['firstname'][k].endsWith(",")) {
        let temp_firstname = this.mData['TO'].data['firstname'][k].replace(/,/g, "");
        let temp_lastname = this.mData['TO'].data['lastname'][k];
        this.mData['TO'].data['firstname'][k] = temp_lastname;
        this.mData['TO'].data['lastname'][k] = temp_firstname;
        // rebuild fullname
        this.mData['TO'].data['fullname'][k] = [this.mData['TO'].data['firstname'][k], this.mData['TO'].data['lastname'][k]].join(" ");
      }
    }

    return this.mData['TO'].data;
  }
  async getcarddata_to(aIndex) {
    // 1. CardBook -> need cardbook api
    // ...

    // take card value, if it exists
    // 2. search identity email
    let cards = await browser.contacts.quickSearch({
      includeRemote: false,
      searchString: this.mData['TO'].data['email'][aIndex].toLowerCase()
    })
    let card = cards.find(c => c.type == "contact");

    if (card != null) {
      // Get directly stored props first.
      for (let [name, value] of Object.entries(card.properties)) {
        let lowerCaseName = name.toLowerCase();

        if (typeof this.mData['TO'].data[lowerCaseName] == 'undefined') {
          this.mData['TO'].data[lowerCaseName] = []
        }
        if (value != "" || typeof this.mData['TO'].data[lowerCaseName][aIndex] == 'undefined' || this.mData['TO'].data[lowerCaseName][aIndex] == "") {
          this.mData['TO'].data[lowerCaseName][aIndex] = utils.trimString(value);
        }
      }
    }
    return this.mData;
  }
  async get_to(aVariables) {
    let data = await this.process_to(aVariables);

    if (typeof data[aVariables[0]] != 'undefined') {
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
    // If a template is inserted, keepStates is set to true and all non-persistent
    // states are kept until the entire template has been processed. The persistent
    // states are kept for the entire lifetime of the tab.
    if (!this.keepStates) {
      await this.clearNonPersistentData();
    }

    let tags = getTags(aStr);

    // If we don't find any tags there will be no changes to the string so return.
    if (tags.length == 0)
      return aStr;

    // Replace all tags with there right contents
    for (let i = 0; i < tags.length; i++) {
      // Save state.
      await this.saveState();

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

      // Save state.
      await this.saveState();

      aStr = utils.replaceText(tags[i].tag, value, aStr);
    }

    return aStr;
  }
}

function getTags(aStr) {
  // We only get the beginning of the tag.
  // This is because we want to handle recursive use of tags.
  let rexp = new RegExp("\\[\\[((" + allowedTags.join("|") + ")(\\_[a-z]+)?)", "ig");
  let results = [];
  let result = null;
  while ((result = rexp.exec(aStr)))
    results.push(result);

  // If we don't found any tags we return
  if (results.length == 0)
    return [];

  // Take care of the tags starting with the last one
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

    // Get the end of the starttag
    pos = results[i].index + results[i][1].length + 2;

    // If the tag ended here we're done
    if (aStr.substr(pos, 2) == "]]") {
      tmpHit.tag += "]]";
      hits = addTag(hits, tmpHit);
    }
    // If there is arguments we get them
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

      // If we found the end we parses the arguments
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
