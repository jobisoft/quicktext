import * as utils from "/modules/utils.mjs";
import * as quicktext from "/modules/quicktext.mjs";
import * as preferences from "/modules/preferences.mjs";

export async function buildComposeBodyMenu() {
    await processMenuData(await getComposeBodyMenuData());
}

async function processMenuData(menuData, parentId) {
    for (let entry of menuData) {
        let createData = {}

        createData.id = parentId ? `${parentId}.${entry.id}` : entry.id;
        createData.title = entry.title ? entry.title : messenger.i18n.getMessage(`quicktext.${entry.id}.label`);

        if (entry.contexts) createData.contexts = entry.contexts;
        if (entry.visible) createData.visible = entry.visible;
        if (entry.onclick) createData.onclick = entry.onclick;
        if (parentId) createData.parentId = parentId;

        await messenger.menus.create(createData);
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
            onclick: (info, tab) => quicktext.insertVariable(tab, `${type}=${field}`)
        })
    }
    return children;
}

async function getComposeBodyMenuData() {
    return [
        {
            id: "composeContextMenu",
            title: messenger.i18n.getMessage("quicktext.label"),
            contexts: ["compose_body"],
            visible: await preferences.getPref("popup"),
            children: [
                {
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
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'ATT=name')
                                },
                                {
                                    id: "filenameAndSize",
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'ATT=full')
                                },
                            ]
                        },
                        {
                            id: "dateTime",
                            children: [
                                {
                                    id: "date",
                                    title: await quicktext.parseVariable(null, "DATE"),
                                    onclick: (info, tab) => quicktext.insertVariable(tab, "DATE")
                                },
                                {
                                    id: "date-long",
                                    title: await quicktext.parseVariable(null, "DATE=long"),
                                    onclick: (info, tab) => quicktext.insertVariable(tab, "DATE=long")
                                },
                                {
                                    id: "date-month",
                                    title: await quicktext.parseVariable(null, "DATE=monthname"),
                                    onclick: (info, tab) => quicktext.insertVariable(tab, "DATE=monthname")
                                },
                                {
                                    id: "time",
                                    title: await quicktext.parseVariable(null, "TIME"),
                                    onclick: (info, tab) => quicktext.insertVariable(tab, "TIME")
                                },
                                {
                                    id: "time-seconds",
                                    title: await quicktext.parseVariable(null, "TIME=seconds"),
                                    onclick: (info, tab) => quicktext.insertVariable(tab, "TIME=seconds")
                                }
                            ]
                        },
                        {
                            id: "other",
                            children: [
                                {
                                    id: "clipboard",
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'CLIPBOARD')
                                },
                                {
                                    id: "counter",
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'COUNTER')
                                },
                                {
                                    id: "subject",
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'SUBJECT')
                                },
                                {
                                    id: "version",
                                    onclick: (info, tab) => quicktext.insertVariable(tab, 'VERSION')
                                },
                            ]
                        }
                    ]
                },
                {
                    id: "other",
                    children: [
                        {
                            id: "insertTextFromFileAsText",
                            onclick: (info, tab) => quicktext.insertContentFromFile(tab, 0)
                        },
                        {
                            id: "insertTextFromFileAsHTML",
                            onclick: (info, tab) => quicktext.insertContentFromFile(tab, 1)
                        },
                    ]
                }
            ]
        },
    ]
}

export async function updateDateTimeMenus() {
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    let menus = ["composeContextMenu.variables.to.", "composeContextMenu.variables.from."];
    let now = Date.now();

    for (let menu of menus) {
        for (let field of fields) {
            await messenger.menus.update(`${menu}${field}`, {
                title: messenger.i18n.getMessage("date", utils.getDateTimeFormat(field, now))
            })
        }
    }
}

export async function updateTemplateMenus() {
}

async function insertCursorTest(info, tab) {
    // TODO: Process insert commands.
    let fragment = "Juhu [[CURSOR]] Haha";
    quicktext.insertBody(tab, fragment, 0);
}
