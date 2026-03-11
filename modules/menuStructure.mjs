/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";

// Abstract menu structure shared across the compose action menu,
// the manager flyout menu, and the legacy toolbar companion.
//
// Each node:
//   { type: "group",     id, localeKey?, title?, children }
//   { type: "item",      id, localeKey?, title?, value?, groupIndex?, textIndex? }
//   { type: "separator", id? }
//   { type: "dateTime",  id, value, format }
//
// Default locale key: `quicktext.${id}.label`
// Explicit localeKey overrides this for ids that contain characters not
// usable in menu ID paths (e.g. dots).
// Dynamic title overrides localeKey for user-defined names (e.g. template names).

const CONTACT_FIELDS = [
  "firstname", "lastname", "fullname", "displayname", "nickname",
  "email", "workphone", "faxnumber", "cellularnumber", "jobtitle",
  "custom1", "custom2", "custom3", "custom4",
];

function contactItems(prefix) {
  return CONTACT_FIELDS.map(field => ({ type: "item", id: field, value: `${prefix}=${field}` }));
}

export function getVariablesMenuStructure() {
  return [
    { type: "group", id: "to", children: contactItems("TO") },
    { type: "group", id: "from", children: contactItems("FROM") },
    {
      type: "group", id: "attachments", children: [
        { type: "item", id: "filename", value: "ATT=name" },
        { type: "item", id: "filenameAndSize", value: "ATT=full" },
        { type: "separator" },
        {
          type: "group", id: "attachmentFile", children: [
            { type: "item", id: "mode-file", localeKey: "quicktext.mode.file.label", value: "ATTACHMENT=FILE|<path>" },
            { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "ATTACHMENT=URL|<url>" },
          ]
        },
      ]
    },
    {
      type: "group", id: "dateTime", children: [
        { type: "dateTime", id: "date-short", value: "DATE", format: "date-short" },
        { type: "dateTime", id: "date-long", value: "DATE=long", format: "date-long" },
        { type: "dateTime", id: "date-monthname", value: "DATE=monthname", format: "date-monthname" },
        { type: "dateTime", id: "time-noseconds", value: "TIME", format: "time-noseconds" },
        { type: "dateTime", id: "time-seconds", value: "TIME=seconds", format: "time-seconds" },
      ]
    },
    {
      type: "group", id: "other", children: [
        { type: "item", id: "clipboard", value: "CLIPBOARD" },
        { type: "item", id: "counter", value: "COUNTER" },
        { type: "item", id: "input", value: "INPUT=name|type|options" },
        { type: "item", id: "selection", value: "SELECTION" },
        { type: "item", id: "orgatt", value: "ORGATT=\\n" },
        { type: "item", id: "orgheader", value: "ORGHEADER=type|\\n" },
        { type: "item", id: "subject", value: "SUBJECT" },
        { type: "item", id: "url", value: "URL=url|data" },
        { type: "item", id: "insertfile", value: "FILE=<path>" },
        {
          type: "group", id: "image", children: [
            { type: "item", id: "mode-file", localeKey: "quicktext.mode.file.label", value: "IMAGE=FILE|<path>" },
            { type: "item", id: "mode-url", localeKey: "quicktext.mode.url.label", value: "IMAGE=URL|<url>" },
          ]
        },
        { type: "item", id: "version", value: "VERSION" },
        { type: "separator" },
        { type: "item", id: "header", value: "HEADER=type|value" },
        { type: "item", id: "cursor", value: "CURSOR" },
      ]
    },
  ];
}

export function getInsertFileMenuStructure() {
  return [
    { type: "item", id: "insertTextFromFileAsText", mimeType: "text/plain" },
    { type: "item", id: "insertTextFromFileAsHTML", mimeType: "text/html" },
  ];
}

export function getDateTimeMenuTitle(field, timeStamp) {
  const fieldType = field.split("-")[0];
  return browser.i18n.getMessage(`quicktext.${fieldType}.label`, utils.getDateTimeFormat(field, timeStamp));
}

export async function getTemplatesMenuStructure() {
  const templates = await storage.getTemplates();
  const nodes = [];

  for (let i = 0; i < templates.groups.length; i++) {
    const children = [];
    for (let j = 0; j < templates.texts[i].length; j++) {
      children.push({
        type: "item",
        id: `group-${i}-text-${j}`,
        title: templates.texts[i][j].name,
        groupIndex: i,
        textIndex: j,
        shortcut: templates.texts[i][j].shortcut,
        keyword: templates.texts[i][j].keyword,
      });
    }

    // Skip empty groups.
    if (children.length == 0) {
      continue;
    }

    nodes.push({
      type: "group",
      id: `group-${i}`,
      title: templates.groups[i].name,
      children,
    });
  }

  return nodes;
}

export async function getScriptsMenuStructure() {
  const scripts = await storage.getScripts();
  return scripts.map((script, i) => ({
    type: "item",
    id: `script-${i}`,
    title: script.name,
  }));
}

export async function getTagsMenuStructure() {
  const templateNodes = await getTemplatesMenuStructure();
  const templateChildren = templateNodes.map(node => ({
    ...node,
    children: node.children.map(child => ({
      ...child,
      value: `TEXT=${node.title}|${child.title}`,
    })),
  }));

  const scriptNodes = await getScriptsMenuStructure();
  const scriptChildren = scriptNodes.map(node => ({
    ...node,
    value: `SCRIPT=${node.title}`,
  }));

  const nodes = [
    { type: "group", id: "variables", localeKey: "quicktext.variablesGroup.label", children: getVariablesMenuStructure() },
  ];
  if (templateChildren.length > 0 || scriptChildren.length > 0) {
    nodes.push({
      type: "separator"
    });
    
    if (templateChildren.length > 0) {
      nodes.push({
        type: "group",
        id: "templates",
        localeKey: "quicktext.templates.label",
        children: templateChildren
      });
    }
    
    if (scriptChildren.length > 0) {
      nodes.push({
        type: "group",
        id: "scripts",
        localeKey: "quicktext.scripts.label",
        children: scriptChildren
      });
    }
  }
  
  const { externalScripts } = await browser.storage.session.get("externalScripts") ?? {};
  if (externalScripts?.length) {
    nodes.push({ type: "separator" });
    for (const provider of externalScripts) {
      nodes.push({
        type: "group",
        id: `external-${provider.id}`,
        title: provider.name,
        children: Object.entries(provider.scripts).map(([scriptName, scriptInfo], i) => ({
          type: "item",
          id: `external-${provider.id}-script-${i}`,
          description: scriptInfo.description,
          title: scriptName,
          value: provider.id === "quicktext.scripts@community.jobisoft.de"
            ? `CSCRIPT=${scriptInfo.usage}`
            : `ESCRIPT=${provider.id}|${scriptInfo.usage}`,
          providerId: provider.id,
        })),
      });
    }
  }

  return nodes;
}
