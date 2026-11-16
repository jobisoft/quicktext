/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "/modules/quicktext.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";
import * as vfs from "/vendor/vfs-client/vfs-client.mjs";
import { getDateTimeMenuTitle } from "/modules/menuStructure.mjs";

// Dispatch a menu action of the compose body context menu (structureToMenuData
// onclick handlers). `action` carries:
//   value      - the menu item's tag value (may contain placeholders)
//   insertMode - "text/html" or "text/plain" (for content insertion)
// Placeholders are resolved here by picking a file or prompting for a URL.
export async function handleMenuAction(tabId, action) {
    const { value, insertMode } = action;

    if (value?.includes("<path>")) {
        if (value.startsWith("IMAGE=")) {
            const file = await utils.pickFileFromDisc([4]);
            if (file) return quicktext.insertImageFile(tabId, file);
        } else if (value.startsWith("ATTACHMENT=")) {
            const file = await utils.pickFileFromDisc([2]);
            if (file) return quicktext.insertAttachmentFile(tabId, file);
        } else {
            const mode = insertMode ?? "text/plain";
            const file = await utils.pickFileFromDisc([mode]);
            if (!file) return;
            const content = await utils.getTextFileContent(file);
            if (content) return quicktext.insertFileContent(tabId, content, mode);
        }
        return;
    }

    if (value?.includes("<vfs-path>")) {
        const types = value.startsWith("IMAGE=")
            ? [{ description: browser.i18n.getMessage("quicktext.insertImage.label"),
                 accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"] } }]
            : null;
        const [picked] = await vfs.showSelectFilePicker({
            opfsStorageName: storage.OPFS_STORAGE_NAME,
            types,
        });
        if (!picked) return;
        const file = await vfs.readFile({ path: picked.path, storageRef: picked.storageRef });
        if (value.startsWith("IMAGE="))
            return quicktext.insertImageFile(tabId, file);
        if (value.startsWith("ATTACHMENT="))
            return quicktext.insertAttachmentFile(tabId, file);
        const content = await file.text();
        if (content) return quicktext.insertFileContent(tabId, content, insertMode);
        return;
    }

    if (value?.includes("<url>")) {
        const promptLabel = browser.i18n.getMessage("quicktext.prompt.addUrl.label");
        const results = await browser.tabs.executeScript(tabId, {
            code: `window.prompt(${JSON.stringify(promptLabel)}, "https://")`,
        });
        const url = results?.[0];
        if (!url) return;
        if (value.startsWith("IMAGE="))
            return quicktext.insertImageFile(tabId, await utils.fetchFileAsFile(url));
        if (value.startsWith("ATTACHMENT="))
            return quicktext.insertAttachmentFile(tabId, await utils.fetchFileAsFile(url));
        const content = await utils.fetchFileAsText(url);
        if (content) return quicktext.insertFileContent(tabId, content, insertMode);
        return;
    }

    if (value) {
        await quicktext.insertVariable({ tabId, variable: value });
    }
}

// Converts a generic menu structure to the menu data required by processMenuData()
// to create menu entries using the WebExtensions menus API. Each leaf item's onclick
// delegates to handleMenuAction.
export function structureToMenuData(nodes, now) {
    return nodes.flatMap(node => {
        if (node.type === "separator") return [{ type: "separator" }];

        const entry = { id: node.id };
        if (node.localeKey) entry.title = browser.i18n.getMessage(node.localeKey);
        if (node.type === "dateTime") entry.title = getDateTimeMenuTitle(node.format, now);

        if (node.value) {
            const action = { value: node.value, insertMode: node.insertMode };
            entry.onclick = (_info, tab) => handleMenuAction(tab.id, action);
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
            // The menus API treats `&` as an access-key marker (the next char
            // is underlined and the `&` is stripped). Double it so user-
            // supplied names like "Hello & Bye" render literally.
            const rawTitle = entry.title ? entry.title : browser.i18n.getMessage(`quicktext.${entry.id}.label`);
            createData.title = rawTitle.replace(/&/g, "&&");
        }

        if (entry.contexts) createData.contexts = entry.contexts;
        if (entry.documentUrlPatterns) createData.documentUrlPatterns = entry.documentUrlPatterns;
        if (entry.visible) createData.visible = entry.visible;
        if (entry.enabled === false) createData.enabled = false;
        if (entry.onclick) createData.onclick = entry.onclick;
        if (entry.icons) createData.icons = entry.icons;
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