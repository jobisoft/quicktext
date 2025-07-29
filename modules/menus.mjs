/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import * as quicktext from "/modules/quicktext.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";

let composeContextEntries = [];

export async function buildComposeBodyMenu() {
    await processMenuData(await getComposeBodyMenuData());

    // Update the menus before showing them.
    messenger.menus.onShown.addListener(async () => {
        await updateDateTimeMenus();
        messenger.menus.refresh();
    });

    new storage.StorageListener(
        {
            watchedPrefs: ["templates", "popup", "menuCollapse"],
            listener: async (changes) => {
                // Throw away the menu.
                for (let entry of composeContextEntries.reverse()) {
                    await messenger.menus.remove(entry);
                }
                composeContextEntries = [];

                const popup = await storage.getPref("popup");
                if (popup) {
                    await processMenuData(await getComposeBodyMenuData());
                }
            }
        }
    )
}

async function processMenuData(menuData, parentId) {
    for (let entry of menuData) {
        let createData = {}

        createData.id = parentId ? `${parentId}.${entry.id}` : entry.id;
        if (entry.type == "separator") {
            createData.type = entry.type;
        } else {
            createData.title = entry.title ? entry.title : messenger.i18n.getMessage(`quicktext.${entry.id}.label`);
        }

        if (entry.contexts) createData.contexts = entry.contexts;
        if (entry.visible) createData.visible = entry.visible;
        if (entry.onclick) createData.onclick = entry.onclick;
        if (parentId) createData.parentId = parentId;

        const created = Promise.withResolvers()
        const id = messenger.menus.create(createData, () => {
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
        if (composeContextEntries.includes(id)) {
            console.error(`Menu with id <${id}} exists already!`)
        } else {
            composeContextEntries.push(id);
        }

        if (entry.id && entry.children) {
            await processMenuData(entry.children, createData.id);
        }
    }
}

async function getContactMenuData(type) {
    let fields = ["firstname", "lastname", "fullname", "displayname", "nickname", "email", "workphone", "faxnumber", "cellularnumber", "jobtitle", "custom1", "custom2", "custom3", "custom4"];
    let children = [];
    for (let field of fields) {
        children.push({
            id: field,
            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: `${type}=${field}` })
        })
    }
    return children;
}

async function getComposeBodyMenuData() {
    let menuData = [];
    let contexts = ["compose_body", "compose_action_menu"];
    let templates = await storage.getTemplates();
    for (let i = 0; i < templates.groups.length; i++) {
        let children = [];
        for (let j = 0; j < templates.texts[i].length; j++) {
            children.push({
                id: `group-${i}-text-${j}`,
                title: templates.texts[i][j].name,
                onclick: (info, tab) => quicktext.insertTemplate(tab.id, i, j)
            });

        }
        // Ignore this group, if it has now children.
        if (children.length == 0) {
            continue;
        }

        // If this group has only a single child, and menuCollapse is true, print
        // only that.
        if (await storage.getPref("menuCollapse") && children.length == 1) {
            menuData.push({
                contexts,
                ...children[0]
            });
            continue;
        }

        menuData.push({
            contexts,
            id: `group-${i}`,
            title: templates.groups[i].name,
            children
        });
    }

    if (templates.groups.length > 0) {
        menuData.push({
            contexts,
            id: `group-separator`,
            type: "separator"
        });
    }

    let now = Date.now();
    menuData.push(
        {
            contexts,
            id: "variables",
            children: [
                {
                    id: "to",
                    children: await getContactMenuData("TO")
                },
                {
                    id: "from",
                    children: await getContactMenuData("FROM")
                },
                {
                    id: "attachments",
                    children: [
                        {
                            id: "filename",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'ATT=name' })
                        },
                        {
                            id: "filenameAndSize",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'ATT=full' })
                        },
                    ]
                },
                {
                    id: "dateTime",
                    children: [
                        {
                            id: "date",
                            title: getDateTimeMenuTitle("date-short", now),
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: "DATE" })
                        },
                        {
                            id: "date-long",
                            title: getDateTimeMenuTitle("date-long", now),
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: "DATE=long" })
                        },
                        {
                            id: "date-month",
                            title: getDateTimeMenuTitle("date-monthname", now),
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: "DATE=monthname" })
                        },
                        {
                            id: "time",
                            title: getDateTimeMenuTitle("time-noseconds", now),
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: "TIME" })
                        },
                        {
                            id: "time-seconds",
                            title: getDateTimeMenuTitle("time-seconds", now),
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: "TIME=seconds" })
                        }
                    ]
                },
                {
                    id: "other",
                    children: [
                        {
                            id: "clipboard",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'CLIPBOARD' })
                        },
                        {
                            id: "counter",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'COUNTER' })
                        },
                        {
                            id: "subject",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'SUBJECT' })
                        },
                        {
                            id: "version",
                            onclick: (info, tab) => quicktext.insertVariable({ tabId: tab.id, variable: 'VERSION' })
                        },
                    ]
                }
            ]
        },
        {
            contexts,
            id: "other",
            children: [
                {
                    id: "insertTextFromFileAsText",
                    onclick: (info, tab) => quicktext.insertContentFromFile(tab.id, "text/plain")
                },
                {
                    id: "insertTextFromFileAsHTML",
                    onclick: (info, tab) => quicktext.insertContentFromFile(tab.id, "text/html")
                },
            ]
        },
        {
            contexts,
            id: "separator",
            type: "separator",
        },
        {
            contexts,
            id: "settings",
            title: messenger.i18n.getMessage("quicktext.settings.title"),
            onclick: (info, tab) => messenger.Quicktext.openTemplateManager()
        },
    );

    return menuData;
}

function getDateTimeMenuTitle(field, timeStamp) {
    const fieldType = field.split("-")[0];
    return messenger.i18n.getMessage(fieldType, utils.getDateTimeFormat(field, timeStamp));
}

async function updateDateTimeMenus() {
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    let menus = ["variables.dateTime."];
    let now = Date.now();

    for (let menu of menus) {
        for (let field of fields) {
            const title = getDateTimeMenuTitle(field, now);
            await messenger.menus.update(`${menu}${field}`, { title })
        }
    }
}