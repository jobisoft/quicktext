/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import { QuicktextParser, STORAGE_STATE } from "/modules/quicktextParser.mjs";

// Helper

export async function readLegacyXmlTemplateFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { templateFilePath } = await browser.FileSystemAccess.getQuicktextFilePaths(templateFolder);
  let xmlData = await browser.FileSystemAccess.readTextFile(templateFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function readLegacyXmlScriptFile() {
  let templateFolder = await storage.getPref("templateFolder");
  let { scriptFilePath } = await browser.FileSystemAccess.getQuicktextFilePaths(templateFolder);
  let xmlData = await browser.FileSystemAccess.readTextFile(scriptFilePath);
  return parseLegacyXmlData(xmlData);
}

export async function parseLegacyXmlData(xmlData) {
  const domParser = new DOMParser();
  const dom = domParser.parseFromString(xmlData, "text/xml");

  const version = dom.documentElement.getAttribute("version");

  const foundGroups = [];
  const foundTexts = [];
  const foundScripts = [];

  switch (version) {
    case "2":
      const filetype = getTagValue(dom.documentElement, "filetype");
      switch (filetype) {
        case "scripts":
          {
            const elems = dom.documentElement.getElementsByTagName("script");
            for (let i = 0; i < elems.length; i++) {
              let tmp = {
                name: getTagValue(elems[i], "name"),
                script: getTagValue(elems[i], "body"),
              };

              foundScripts.push(tmp);
            }
          }
          break;

        case "":
        case "templates":
          {
            const elems = dom.documentElement.getElementsByTagName("menu");
            for (let i = 0; i < elems.length; i++) {
              let tmp = {
                name: getTagValue(elems[i], "title"),
              };

              foundGroups.push(tmp);
              const subTexts = [];
              const textsNodes = elems[i].getElementsByTagName("texts");
              if (textsNodes.length > 0) {
                const subElems = textsNodes[0].getElementsByTagName("text");
                for (let j = 0; j < subElems.length; j++) {
                  let tmp = {
                    name: getTagValue(subElems[j], "name"),
                    text: getTagValue(subElems[j], "body"),
                    shortcut: subElems[j].getAttribute("shortcut"),
                    type: subElems[j].getAttribute("type") == "0" ? "text/plain" : "text/html",
                    keyword: getTagValue(subElems[j], "keyword"),
                    subject: getTagValue(subElems[j], "subject"),
                    attachments: getTagValue(subElems[j], "attachments"),
                  };

                  subTexts.push(tmp);
                }
              }
              foundTexts.push(subTexts);
            }
          }
          break;
        default:
          // Alert the user that the importer don't understand the filetype
          break;
      }

      break;

    default:
      console.error("invalid data format", xmlData)
      return;
  }

  const imports = {}

  if (foundScripts.length > 0) {
    imports.scripts = [];
    for (let i = 0; i < foundScripts.length; i++) {
      imports.scripts.push(foundScripts[i]);
    }
  }

  if (foundGroups.length > 0 && foundTexts.length > 0) {
    imports.templates = {};
    imports.templates.groups = [];
    for (let i = 0; i < foundGroups.length; i++) {
      imports.templates.groups.push(foundGroups[i]);
    }
    imports.templates.texts = [];
    for (let i = 0; i < foundTexts.length; i++) {
      imports.templates.texts.push(foundTexts[i]);
    }
  }

  return imports;
}

export async function parseConfigFileData(fileData) {
  let errors = [];
  try {
    return JSON.parse(fileData);
  } catch (e) {
    errors.push(e);
  }

  try {
    return await parseLegacyXmlData(fileData);
  } catch (e) {
    errors.push(e);
  }

  console.error("Failed to parse config file, does not seem to be a supported JSON or XML format", errors);
}


function getTagValue(aElem, aTag) {
  const tagElem = aElem.getElementsByTagName(aTag);
  if (tagElem.length > 0) {
    // can't be used anymore as sometimes there are several CDATA entries - see removeIllegalCharsCDATA
    // return tagElem[0].firstChild.nodeValue;

    let result = '';
    for (const child of tagElem[0].childNodes) {
      result = result + child.nodeValue;
    }
    return result;
  }

  return "";
}

// ---- INSERT

async function getQuicktextParser({ tabId }) {
  const bundles = await storage.getActiveStorageEntries();
  return new QuicktextParser(tabId, bundles);
}

export async function insertTemplate(tabId, storageUuid, groupIdx, textIdx) {
  const qParser = await getQuicktextParser({ tabId });
  const bundle = qParser.mBundles.find(b => b.storageUuid === storageUuid);
  // Bail out if the bundle has been removed or disabled, rather than silently
  // inserting a template from the wrong storage.
  if (!bundle) return;

  // Bundle type maps 1:1 to a template state.
  const stateByBundleType = {
    vfs:     STORAGE_STATE.VFS_TEMPLATE,
    import:  STORAGE_STATE.IMPORT_TEMPLATE,
    managed: STORAGE_STATE.MANAGED_TEMPLATE,
  };
  qParser.setActiveStorage({
    state: stateByBundleType[bundle.type] ?? STORAGE_STATE.IMPORT_TEMPLATE,
    ref: bundle.type === "vfs" ? (bundle.storageRef ?? null) : null,
    uuid: storageUuid,
  });
  const group = bundle.templates.groups[groupIdx];
  const text = bundle.templates.texts[groupIdx][textIdx];
  await qParser.clearNonPersistentData();
  await insertSubject({ qParser, subject: text.subject });
  await qParser.parseAndInsert(`[[TEXT=${group.name}|${text.name}]]`);
}

export async function insertVariable({ tabId, variable, storageRef }) {
  const qParser = await getQuicktextParser({ tabId });
  // One-shot variable insertions never expand TEXT/SCRIPT tags. For VFS
  // variants (IMAGE=VFS, ATTACHMENT=VFS, VFSFILE) the picker supplies a
  // storageRef directly, so any connection the picker can reach works.
  qParser.setActiveStorage({ state: STORAGE_STATE.SINGLE_VARIABLE, ref: storageRef });
  await qParser.clearNonPersistentData();
  await qParser.parseAndInsert(`[[${variable}]]`);
}

async function insertSubject({ qParser, subject }) {
  if (!subject) {
    return;
  }

  let parsedSubject = await qParser.parse(subject);
  if (parsedSubject && !parsedSubject.match(/^\s+$/)) {
    await qParser.setDetail("subject", parsedSubject);
  }
}



// When true, content inserted via the compose-menu FILE/URL/VFS entries is
// parsed for embedded Quicktext tags (except TEXT/SCRIPT). When false, the
// content is inserted verbatim.
const PARSE_INSERTED_FILE_CONTENT = false;

// Insert text content (from any source) into the compose body. Used by
// the compose-menu handlers for FILE, URL, and VFS content insertion.
export async function insertFileContent(tabId, content, insertMode = "text/plain") {
  let qParser = await getQuicktextParser({ tabId });
  if (PARSE_INSERTED_FILE_CONTENT) {
    qParser.setActiveStorage({ state: STORAGE_STATE.SINGLE_VARIABLE });
    let parsedContent = await qParser.process_file_content(content, {
      insertMode,
      stripHtmlComments: false,
    });
    if (parsedContent) {
      await qParser.insertBody(parsedContent, { extraSpace: false });
    }
  } else {
    let { isPlainText } = await qParser.getStaticDetails();
    if (insertMode === "text/plain" && !isPlainText) {
      qParser.mForceAsText = true;
    }
    await qParser.insertBody(content, { extraSpace: false });
  }
}

// Embed a File as an inline <img> with a data-URL src. The image menu is
// disabled in plain-text compose (compose.mjs onShown), so HTML mode is
// guaranteed when this runs.
export async function insertImageFile(tabId, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const leafName = file.name;
  const mimeType = file.type || utils.getTypeFromExtension(leafName);
  const binContent = utils.uint8ArrayToBase64(bytes);
  const src = "data:" + mimeType + ";filename=" + leafName + ";base64," + binContent;
  const html = "<img src='" + src + "'>";
  await messenger.tabs.sendMessage(tabId, {
    insertHtml: utils.removeBadHTML(html),
    extraSpace: false,
  });
}

// Add a File as a compose attachment.
export async function insertAttachmentFile(tabId, file) {
  await messenger.compose.addAttachment(tabId, { file });
}

// This function is called from outside and needs to use data of an existing
// parser
export async function getTag({ tabId, tag, variables }) {
  let qParser = await getQuicktextParser({ tabId })
  return await qParser[`get_${tag.toLowerCase()}`](variables);
}

// This function is called from outside and needs to use data of an existing
// parser
export async function processTag({ tabId, tag, variables }) {
  let qParser = await getQuicktextParser({ tabId })
  return await qParser[`process_${tag.toLowerCase()}`](variables);
}

// ---- TEMPLATE

// This is defined async, so it can be used in an runtime.onMessage listener
// without further logic to return a Promise.
export async function getKeywordsAndShortcuts() {
  let bundles = await storage.getActiveStorageEntries();
  let keywords = {};
  let shortcuts = {};

  for (const bundle of bundles) {
    const templates = bundle.templates;
    for (let i = 0; i < templates.groups.length; i++) {
      for (let j = 0; j < templates.texts[i].length; j++) {
        let text = templates.texts[i][j];
        let shortcut = text.shortcut;
        // Earlier storage/group wins on conflict.
        if (shortcut != "" && typeof shortcuts[shortcut] == "undefined") {
          shortcuts[shortcut] = [bundle.storageUuid, i, j];
        }

        let keyword = text.keyword.toLocaleLowerCase();
        if (keyword != "" && typeof keywords[keyword] == "undefined")
          keywords[keyword] = [bundle.storageUuid, i, j];
      }
    }
  }
  return { keywords, shortcuts };
}
