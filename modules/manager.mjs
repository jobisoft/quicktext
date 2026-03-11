/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as storage from "/modules/storage.mjs";

import { getTagsMenuStructure, getDateTimeMenuTitle } from "/modules/menuStructure.mjs";
import { processMenuData } from "/modules/menus.mjs";

let managerMenuEntries = [];

function buildManagerMenuData(nodes, now, isRoot = true) {
    const MANAGER_URL = browser.runtime.getURL("/dialogs/manager/manager.html");
    return nodes.flatMap(node => {
        if (node.type === "separator") return [{ type: "separator" }];

        const entry = { id: node.id };
        if (node.title) entry.title = node.title;
        else if (node.localeKey) entry.title = browser.i18n.getMessage(node.localeKey);
        else if (node.type === "dateTime") entry.title = getDateTimeMenuTitle(node.format, now);

        if (isRoot) {
            entry.contexts = ["editable"];
            entry.documentUrlPatterns = [MANAGER_URL];
        }

        if (node.value?.includes("<path>")) {
            let filter, titleKey;
            if (node.value.startsWith("IMAGE=")) { filter = "images"; titleKey = "quicktext.insertImage.label"; }
            else if (node.value.startsWith("ATTACHMENT=")) { filter = "any"; titleKey = "quicktext.attachmentFile.label"; }
            else { filter = "any"; titleKey = "quicktext.insertFile.label"; }
            const title = browser.i18n.getMessage(titleKey);
            entry.onclick = async (_info, tab) => {
                const path = await browser.FileSystemAccess.pickFile(title, filter);
                if (path) browser.tabs.sendMessage(tab.id, { command: "insertTag", variable: node.value.replace("<path>", path) });
            };
        } else if (node.value?.includes("<url>")) {
            entry.onclick = (_info, tab) => browser.tabs.sendMessage(tab.id, { command: "promptInsertTag", variable: node.value });
        } else if (node.value) {
            entry.onclick = (_info, tab) => browser.tabs.sendMessage(tab.id, { command: "insertTag", variable: node.value });
        }

        if (node.children) entry.children = buildManagerMenuData(node.children, now, false);
        return [entry];
    });
}

async function buildManagerContextMenu(menuEntries) {
    const MANAGER_URL = browser.runtime.getURL("/dialogs/manager/manager.html");
    const nodes = await getTagsMenuStructure();
    const menuCollapse = await storage.getPref("menuCollapse");
    if (menuCollapse) {
        const templatesSection = nodes.find(n => n.id === "templates");
        if (templatesSection) {
            templatesSection.children = templatesSection.children.flatMap(grp =>
                grp.type === "group" && grp.children.length === 1 ? grp.children : [grp]
            );
        }
    }
    const now = Date.now();
    const root = {
        id: "managerInsertTagMenu",
        title: browser.i18n.getMessage("quicktext.insertTag.label"),
        contexts: ["editable"],
        documentUrlPatterns: [MANAGER_URL],
        children: buildManagerMenuData(nodes, now, false),
    };
    await processMenuData(menuEntries, [root], null);
}

async function rebuildManagerContextMenu() {
    for (const entry of managerMenuEntries.reverse()) {
        await browser.menus.remove(entry);
    }
    managerMenuEntries = [];
    await buildManagerContextMenu(managerMenuEntries);
}

export async function init() {
    // Context menu for editable fields in the manager dialog.
    await buildManagerContextMenu(managerMenuEntries);

    // Rebuild when templates or scripts change.
    new storage.StorageListener({
        watchedPrefs: ["templates", "scripts", "menuCollapse"],
        listener: rebuildManagerContextMenu,
    });

    // Rebuild when external script add-ons register/unregister.
    browser.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "session" && "externalScripts" in changes) {
            rebuildManagerContextMenu();
        }
    });
}
