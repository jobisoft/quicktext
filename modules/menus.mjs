/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "/modules/quicktext.mjs";
import { getDateTimeMenuTitle } from "/modules/menuStructure.mjs";

// Converts a generic menu structure to the menu data required by processMenuData()
// to create menu entries using the WebExtensions menus API.
export function structureToMenuData(nodes, now) {
    return nodes.flatMap(node => {
        if (node.type === "separator") return [{ type: "separator" }];

        const entry = { id: node.id };
        if (node.localeKey) entry.title = browser.i18n.getMessage(node.localeKey);
        if (node.type === "dateTime") entry.title = getDateTimeMenuTitle(node.format, now);

        if (node.value?.includes("<path>")) {
            // Open a file picker before inserting the variable.
            let filter, titleKey;
            if (node.value.startsWith("IMAGE=")) {
                filter = "images";
                titleKey = "quicktext.insertImage.label";
            } else if (node.value.startsWith("ATTACHMENT=")) {
                filter = "any";
                titleKey = "quicktext.attachmentFile.label";
            } else {
                filter = "any";
                titleKey = "quicktext.insertFile.label";
            }
            const title = browser.i18n.getMessage(titleKey);
            entry.onclick = async (_info, tab) => {
                const path = await browser.FileSystemAccess.pickFile(title, filter);
                if (path) quicktext.insertVariable({ tabId: tab.id, variable: node.value.replace("<path>", path) });
            };
        } else if (node.value?.includes("<url>")) {
            // Prompt for a URL — run in the compose tab context where native dialogs are allowed.
            const promptLabel = browser.i18n.getMessage("quicktext.prompt.addUrl.label");
            entry.onclick = async (_info, tab) => {
                const results = await browser.tabs.executeScript(tab.id, {
                    code: `window.prompt(${JSON.stringify(promptLabel)}, "https://")`,
                });
                const url = results?.[0];
                if (url) quicktext.insertVariable({ tabId: tab.id, variable: node.value.replace("<url>", url) });
            };
        } else if (node.value) {
            entry.onclick = (_info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: node.value });
        }

        if (node.children) entry.children = structureToMenuData(node.children, now);
        return [entry];
    });
}

// Creates menu entries using the menus API, following the provided menu data
// structure.
export async function processMenuData(menuEntries, menuData, parentId) {
    for (let entry of menuData) {
        let createData = {}

        createData.id = entry.type === "separator"
            ? crypto.randomUUID()
            : parentId ? `${parentId}.${entry.id}` : entry.id;
        if (entry.type == "separator") {
            createData.type = entry.type;
        } else {
            createData.title = entry.title ? entry.title : browser.i18n.getMessage(`quicktext.${entry.id}.label`);
        }

        if (entry.contexts) createData.contexts = entry.contexts;
        if (entry.documentUrlPatterns) createData.documentUrlPatterns = entry.documentUrlPatterns;
        if (entry.visible) createData.visible = entry.visible;
        if (entry.onclick) createData.onclick = entry.onclick;
        if (parentId) createData.parentId = parentId;

        const created = Promise.withResolvers()
        const id = browser.menus.create(createData, () => {
            let receivedError = browser.runtime.lastError;
            if (receivedError) {
                console.error(receivedError);
            }
            created.resolve();
        });
        await created.promise;
        if (id != createData.id) {
            console.error(`Menu with requested id <${createData.id}> was created as <${id}>`)
        }
        if (menuEntries.includes(id)) {
            console.error(`Menu with id <${id}> exists already!`)
        } else {
            menuEntries.push(id);
        }

        if (entry.id && entry.children) {
            await processMenuData(menuEntries, entry.children, createData.id);
        }
    }
}


export async function updateDateTimeWebExtMenus(prefix) {
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    let now = Date.now();

    for (let field of fields) {
        const title = getDateTimeMenuTitle(field, now);
        await browser.menus.update(`${prefix}.${field}`, { title })
    }
}