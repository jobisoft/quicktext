import { QuicktextVar } from "/modules/quicktextVar.js";

/*
 * INSERTING TEXT
 */

export async function insertBody(tab, aStr, type = 0) { // 0 = text
  if (type > 0) {
    await messenger.tabs.sendMessage(tab.id, {
      insertHtml: removeBadHTML(aStr),
    });
  } else {
    await messenger.tabs.sendMessage(tab.id, {
      insertText: aStr,
    });
  }
}

function removeBadHTML(aStr) {
  // Remove the head-tag
  aStr = aStr.replace(/<head(| [^>]*)>.*<\/head>/gim, '');
  // Remove html and body tags
  aStr = aStr.replace(/<(|\/)(head|body)(| [^>]*)>/gim, '');
  return aStr;
}

export async function parseVariable(aTab, aVar) {
  let quicktextVar = new QuicktextVar(aTab);
  return quicktextVar.parse("[[" + aVar + "]]");
}

export async function insertVariable(aTab, aVar, aType = 0) {
  await insertBody(aTab, `${await parseVariable(aTab, aVar)} `, aType);
}

export async function insertContentFromFile(tab, aType) {
  if ((file = await gQuicktext.pickFile(window, aType, 0, browser.i18n.getMessage("insertFile"))) != null)
    await insertBody(gQuicktext.readFile(file), aType, true);
}

//----------------------

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

