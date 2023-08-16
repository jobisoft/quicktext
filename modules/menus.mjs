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
        if (entry.type == "separator") {
            createData.type = entry.type;
        } else {
            createData.title = entry.title ? entry.title : messenger.i18n.getMessage(`quicktext.${entry.id}.label`);
        }

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
            onclick: (info, tab) => quicktext.insertVariable(tab.id, `${type}=${field}`)
        })
    }
    return children;
}

async function getComposeBodyMenuData() {
    let menuData = [];
    let contexts = await preferences.getPref("popup")
        ? ["compose_body", "compose_action_menu"]
        : ["compose_action_menu"];

    for (let i = 0; i < quicktext.templates.group.length; i++) {
        let children = [];
        for (let j = 0; j < quicktext.templates.texts[i].length; j++) {
            children.push({
                id: `group-${i}-text-${j}`,
                title: quicktext.templates.texts[i][j].mName,
                onclick: (info, tab) => quicktext.insertVariable(tab.id, `TEXT=${quicktext.templates.group[i].mName}|${quicktext.templates.texts[i][j].mName}`)
            });

        }
        menuData.push({
            contexts,
            id: `group-${i}`,
            title: quicktext.templates.group[i].mName,
            children
        });
    }

    if (quicktext.templates.group.length > 0) {
        menuData.push({
            contexts,
            id: `group-separator`,
            type: "separator"
        });
    }

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
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'ATT=name')
                        },
                        {
                            id: "filenameAndSize",
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'ATT=full')
                        },
                    ]
                },
                {
                    id: "dateTime",
                    children: [
                        {
                            id: "date",
                            title: await quicktext.parseVariable(null, "DATE"),
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, "DATE")
                        },
                        {
                            id: "date-long",
                            title: await quicktext.parseVariable(null, "DATE=long"),
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, "DATE=long")
                        },
                        {
                            id: "date-month",
                            title: await quicktext.parseVariable(null, "DATE=monthname"),
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, "DATE=monthname")
                        },
                        {
                            id: "time",
                            title: await quicktext.parseVariable(null, "TIME"),
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, "TIME")
                        },
                        {
                            id: "time-seconds",
                            title: await quicktext.parseVariable(null, "TIME=seconds"),
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, "TIME=seconds")
                        }
                    ]
                },
                {
                    id: "other",
                    children: [
                        {
                            id: "clipboard",
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'CLIPBOARD')
                        },
                        {
                            id: "counter",
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'COUNTER')
                        },
                        {
                            id: "subject",
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'SUBJECT')
                        },
                        {
                            id: "version",
                            onclick: (info, tab) => quicktext.insertVariable(tab.id, 'VERSION')
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
                    onclick: (info, tab) => quicktext.insertContentFromFile(tab.id, 0)
                },
                {
                    id: "insertTextFromFileAsHTML",
                    onclick: (info, tab) => quicktext.insertContentFromFile(tab.id, 1)
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
            onclick: (info, tab) => messenger.Quicktext.openSettings(tab.id)
        },
    );

    return menuData;
}

export async function updateDateTimeMenus() {
    let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
    let menus = ["variables.to.", "variables.from."];
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
