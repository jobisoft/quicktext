import { QuicktextVar } from "/modules/quicktextVar.mjs";
import { QuicktextGroup } from "/modules/quicktextGroup.mjs";
import { QuicktextScript } from "/modules/quicktextScript.mjs";
import { QuicktextTemplate } from "/modules/quicktextTemplate.mjs";

// ---- INSERT

export async function insertBody(aTabId, aStr, aType = 0) { // 0 = text
  if (aType > 0) {
    await messenger.tabs.sendMessage(aTabId, {
      insertHtml: utils.removeBadHTML(aStr),
    });
  } else {
    await messenger.tabs.sendMessage(aTabId, {
      insertText: aStr,
    });
  }
}

export async function parseVariable(aTabId, aVar) {
  let quicktextVar = new QuicktextVar(aTabId);
  return quicktextVar.parse("[[" + aVar + "]]");
}

export async function insertVariable(aTabId, aVar, aType = 0) {
  await insertBody(aTabId, `${await parseVariable(aTabId, aVar)} `, aType);
}

export async function insertContentFromFile(aTabId, aType) {
  if ((file = await gQuicktext.pickFile(window, aType, 0, browser.i18n.getMessage("insertFile"))) != null)
    await insertBody(gQuicktext.readFile(file), aType, true);
}

// ---- TEMPLATE

export async function loadTemplates(imports, options) {
  let { quicktextFilePath, scriptFilePath } = await browser.Quicktext.getQuicktextFilePaths(options);

  if (quicktextFilePath) {
    await importFromFilePath(imports, quicktextFilePath, 0, true, false);
  }

  if (scriptFilePath) {
    await importFromFilePath(imports, scriptFilePath, 0, true, false);
  }

  if (options.defaultImport) {
    let defaultImport = options.defaultImport.split(";");
    defaultImport.reverse();

    for (let i = 0; i < defaultImport.length; i++) {
      try {
        if (defaultImport[i].match(/^(http|https):\/\//)) {
          await importFromHttpUrl(imports, defaultImport[i], 1, true, false);
        } else {
          await importFromFilePath(imports, parseFilePath(defaultImport[i]), 1, true, false);
        }
      } catch (e) { console.error(e); }
    }
  }
}

export async function importFromFilePath(imports, aFilePath, aType, aBefore, aEditingMode) {
  let data = await browser.Quicktext.readFile(aFilePath);
  let parsed = await parseImport(imports, data, aType, aBefore, aEditingMode);
  console.log(parsed);
  return parsed;
}

export async function importFromHttpUrl(imports, aURI, aType, aBefore, aEditingMode) {
  return new Promise((resolve, reject) => {
    var req = new XMLHttpRequest();
    req.open('GET', aURI, true);
    req.setRequestHeader("Cache-Control", "no-cache, no-store, max-age=0");
    req.mQuicktext = this;
    req.mType = aType;
    req.mBefore = aBefore;
    req.mEditingMode = aEditingMode
    req.onload = async function (event) {
      var self = event.target;
      if (self.status == 200) {
        await parseImport(imports, self.responseText, self.mType, self.mBefore, self.mEditingMode);
        resolve();
      } else {
        reject("Something strange has happend");
      }
    }
    req.send(null);
  })
}

async function parseImport(imports, aData, aType, aBefore, aEditingMode) {
  var parser = new DOMParser();
  var dom = parser.parseFromString(aData, "text/xml");

  var version = dom.documentElement.getAttribute("version");

  var foundGroups = [];
  var foundTexts = [];
  var foundScripts = [];

  for (let part of ["group", "scripts", "texts", "editingGroup", "editingScripts", "editingTexts"]) {
    if (!imports.hasOwnProperty(part)) {
      imports[part] = []
    }
  }

  switch (version) {
    case "2":
      var filetype = getTagValue(dom.documentElement, "filetype");
      switch (filetype) {
        case "scripts":
          var elems = dom.documentElement.getElementsByTagName("script");
          for (var i = 0; i < elems.length; i++) {
            var tmp = new QuicktextScript({
              name: getTagValue(elems[i], "name"),
              script: getTagValue(elems[i], "body"),
              type: aType
            });

            foundScripts.push(tmp);
          }
          break;
        case "":
        case "templates":
          var elems = dom.documentElement.getElementsByTagName("menu");
          for (var i = 0; i < elems.length; i++) {
            let tmp = new QuicktextGroup({
              name: getTagValue(elems[i], "title"),
              type: aType
            });

            foundGroups.push(tmp);
            var subTexts = [];
            var textsNodes = elems[i].getElementsByTagName("texts");
            if (textsNodes.length > 0) {
              var subElems = textsNodes[0].getElementsByTagName("text");
              for (var j = 0; j < subElems.length; j++) {
                let tmp = new QuicktextTemplate({
                  name: getTagValue(subElems[j], "name"),
                  text: getTagValue(subElems[j], "body"),
                  shortcut: subElems[j].getAttribute("shortcut"),
                  type: subElems[j].getAttribute("type"),
                  keyword: getTagValue(subElems[j], "keyword"),
                  subject: getTagValue(subElems[j], "subject"),
                  attachments: getTagValue(subElems[j], "attachments"),
                });

                // There seems to be no use to read dynamically gathered header informations from the last use of a template from the file

                // var headersTag = subElems[j].getElementsByTagName("headers");
                // if (headersTag.length > 0)
                // {
                //   var headers = headersTag[0].getElementsByTagName("header");
                //   for (var k = 0; k < headers.length; k++)
                //     tmp.addHeader(getTagValue(headers[k], "type"), getTagValue(headers[k], "value"));
                // }

                subTexts.push(tmp);
              }
            }
            foundTexts.push(subTexts);
          }
          break;
        default:
          // Alert the user that the importer don't understand the filetype
          break;
      }

      break;
    // Do we still have to support this old file format?
    /*case null:
      // When the version-number not is set it is version 1.

      var elems = dom.documentElement.getElementsByTagName("menu");
      for (var i = 0; i < elems.length; i++) {
        var tmp = new wzQuicktextGroup();
        tmp.name = elems[i].getAttribute("title");
        tmp.type = aType;

        group.push(tmp);

        var subTexts = [];
        var subElems = elems[i].getElementsByTagName("text");
        for (var j = 0; j < subElems.length; j++) {
          var tmp = new wzQuicktextTemplate();
          tmp.name = subElems[j].getAttribute("title");
          tmp.text = subElems[j].firstChild.nodeValue;
          tmp.shortcut = subElems[j].getAttribute("shortcut");
          tmp.type = subElems[j].getAttribute("type");
          tmp.keyword = subElems[j].getAttribute("keyword");
          tmp.subject = subElems[j].getAttribute("subject");

          subTexts.push(tmp);
        }
        texts.push(subTexts);
      }
      break;*/
    default:
      // Alert the user that there version of Quicktext can't import the file, need to upgrade
      return;
  }

  if (foundScripts.length > 0) {
    if (aBefore) {
      foundScripts.reverse();
      if (!aEditingMode)
        for (let i = 0; i < foundScripts.length; i++)
          imports.scripts.unshift(foundScripts[i]);

      for (let i = 0; i < foundScripts.length; i++)
        imports.editingScripts.unshift(foundScripts[i]);
    }
    else {
      if (!aEditingMode)
        for (let i = 0; i < foundScripts.length; i++)
          imports.scripts.push(foundScripts[i]);

      for (let i = 0; i < foundScripts.length; i++)
        imports.editingScripts.push(foundScripts[i]);
    }
  }

  if (foundGroups.length > 0 && foundTexts.length > 0) {
    if (aBefore) {
      foundGroups.reverse();
      foundTexts.reverse();
      if (!aEditingMode) {
        for (var i = 0; i < foundGroups.length; i++)
          imports.group.unshift(foundGroups[i]);
        for (var i = 0; i < foundTexts.length; i++)
          imports.texts.unshift(foundTexts[i]);
      }
      for (var i = 0; i < foundGroups.length; i++)
        imports.editingGroup.unshift(foundGroups[i]);
      for (var i = 0; i < foundTexts.length; i++)
        imports.editingTexts.unshift(foundTexts[i]);
    }
    else {
      if (!aEditingMode) {
        for (var i = 0; i < foundGroups.length; i++)
          imports.group.push(foundGroups[i]);
        for (var i = 0; i < foundTexts.length; i++)
          imports.texts.push(foundTexts[i]);
      }
      for (var i = 0; i < foundGroups.length; i++)
        imports.editingGroup.push(foundGroups[i]);
      for (var i = 0; i < foundTexts.length; i++)
        imports.editingTexts.push(foundTexts[i]);
    }
  }

}

function getTagValue(aElem, aTag) {
  var tagElem = aElem.getElementsByTagName(aTag);
  if (tagElem.length > 0) {
    // can't be used anymore as sometimes there are several CDATA entries - see removeIllegalCharsCDATA
    // return tagElem[0].firstChild.nodeValue;

    var result = '';
    for (const child of tagElem[0].childNodes) {
      result = result + child.nodeValue;
    }
    return result;
  }

  return "";
}

// ----

async function insertTemplate(aGroupIndex, aTextIndex, aHandleTransaction = true, aFocusBody = false) {
  //store selected content
  var editor = GetCurrentEditor();
  var selection = editor.selection;
  if (selection.rangeCount > 0) {
    // store the selected content as plain text
    gQuicktext.mSelectionContent = selection.toString();
    // store the selected content as html text
    gQuicktext.mSelectionContentHtml = editor.outputToString('text/html', 1);
  }

  if (gQuicktext.doTextExists(aGroupIndex, aTextIndex, false)) {
    this.mLastFocusedElement = document.activeElement;
    gQuicktextVar.cleanTagData();

    var text = gQuicktext.getText(aGroupIndex, aTextIndex, false);
    text.removeHeaders();
    gQuicktext.mCurrentTemplate = text;

    // this parsing of the header informations isn't able to parse something like: [[HEADER=to|[[SCRIPT=getReciepients]]]]

    // // Parse text for HEADER tags and move them to the header object
    // let headers = text.text.match(/\[\[header=[^\]]*\]\]/ig);
    // if (headers && Array.isArray(headers)) {
    //   for (let header of headers) {
    //     let parts = header.split(/=|\]\]|\|/);
    //     if (parts.length==4) {
    //       text.addHeader(parts[1], parts[2]);
    //     }
    //   }
    // }

    await insertSubject(text.subject);
    await insertAttachments(text.attachments);

    if (text.text != "" && text.text.indexOf('[[CURSOR]]') > -1) {
      // only if we really have text to insert with a [[CURSOR]] tag,
      // focus the message body first
      focusMessageBody();
    }

    await insertBody(text.text, text.type, aHandleTransaction);

    // has to be inserted below "insertBody" as "insertBody" gathers the header data from the header tags
    await insertHeaders(text);

    if (aFocusBody) {
      // the variable aFocusBody is only used from Quicktext-toolbar to focus the message body after using the toolbar
      setTimeout(function () { quicktext.focusMessageBody(); }, 1);
    } else {
      // if we insert any headers we maybe needs to return the placement of the focus
      setTimeout(function () { quicktext.moveFocus(); }, 1);
    }
  }
}

async function insertAttachments(aStr) {
  if (aStr != "") {
    aStr = await gQuicktextVar.parse(aStr);
    var files = aStr.split(";");

    for (var i = 0; i < files.length; i++) {
      var currentFile = Components.classes["@mozilla.org/file/local;1"].createInstance(Components.interfaces.nsIFile);
      currentFile.initWithPath(files[i]);
      if (!currentFile.exists())
        continue;

      var attachment = FileToAttachment(currentFile);
      if (!DuplicateFileAlreadyAttached(attachment.url)) {
        AddAttachments([attachment]);
      }

    }
  }
}

async function insertHeaders(aText) {
  var headerLength = aText.getHeaderLength();
  if (headerLength == 0)
    return;

  var convertHeaderToType = [];
  convertHeaderToType["to"] = "To";
  convertHeaderToType["cc"] = "Cc";
  convertHeaderToType["bcc"] = "Bcc";
  convertHeaderToType["reply-to"] = "Reply";

  var convertHeaderToParse = [];
  convertHeaderToParse["to"] = "to";
  convertHeaderToParse["cc"] = "cc";
  convertHeaderToParse["bcc"] = "bcc";
  convertHeaderToParse["reply-to"] = "replyTo";

  var recipientHeaders = [];
  recipientHeaders["to"] = [];
  recipientHeaders["cc"] = [];
  recipientHeaders["bcc"] = [];
  recipientHeaders["reply-to"] = [];

  // Add all recipient headers to an array
  var count = 0;
  for (var i = 0; i < headerLength; i++) {
    var header = aText.getHeader(i);
    var type = header.type.toLowerCase();
    if (typeof recipientHeaders[type] != "undefined") {
      recipientHeaders[type].push(await gQuicktextVar.parse(header.value));
      count++;
    }
  }

  if (count > 0) {
    Recipients2CompFields(gMsgCompose.compFields);

    // Go through all recipientHeaders to remove duplicates
    var tmpRecipientHeaders = [];
    count = 0;
    for (var header in recipientHeaders) {
      if (recipientHeaders[header].length == 0)
        continue;

      tmpRecipientHeaders[header] = [];

      // Create an array of emailaddresses for this header that allready added
      let tmpEmailAddresses = MailServices.headerParser.parseEncodedHeaderW(gMsgCompose.compFields[convertHeaderToParse[header]]);
      let emailAddresses = [];
      for (let i = 0; i < tmpEmailAddresses.length; i++)
        emailAddresses.push(tmpEmailAddresses[i].email);

      // Go through all recipient of this header that I want to add
      for (var i = 0; i < recipientHeaders[header].length; i++) {
        // Get the mailaddresses of all the addresses
        let insertedAddresses = MailServices.headerParser.parseEncodedHeaderW(recipientHeaders[header][i]);
        for (var j = 0; j < insertedAddresses.length; j++) {
          if (insertedAddresses[j].email && !emailAddresses.includes(insertedAddresses[j].email)) {
            tmpRecipientHeaders[header].push(insertedAddresses[j].toString());
            emailAddresses.push(insertedAddresses[j].email);
            count++;
          }
        }
      }
    }

    if (count > 0) {
      for (var header in tmpRecipientHeaders) {
        for (var i = 0; i < tmpRecipientHeaders[header].length; i++) {
          let addressRow = document.getElementById("addressRow" + convertHeaderToType[header]);
          addressRowAddRecipientsArray(addressRow, [tmpRecipientHeaders[header][i]], false);
        }
      }
    }
  }
}

function moveFocus() {
  if (this.mLastFocusedElement) {
    this.mLastFocusedElement.focus();
    this.mLastFocusedElement = null;
  }
}

function focusMessageBody() {
  let editor = GetCurrentEditorElement();//document.getElementsByTagName("editor");
  if (editor) {
    editor.focus();
    this.mLastFocusedElement = editor;
  }
}

async function insertSubject(aStr) {
  if (aStr != "") {
    aStr = await gQuicktextVar.parse(aStr);

    if (aStr != "" && !aStr.match(/^\s+$/) && document.getElementById('msgSubject'))
      document.getElementById('msgSubject').value = aStr;
  }
}

function dumpTree(aNode, aLevel) {
  for (var i = 0; i < aLevel * 2; i++)
    dump(" ");
  dump(aNode.nodeName + ": " + aNode.nodeValue + "\n");
  for (var i = 0; i < aNode.childNodes.length; i++) {
    dumpTree(aNode.childNodes[i], aLevel + 1);
  }
}

