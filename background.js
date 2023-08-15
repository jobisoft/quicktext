(async () => {

  // Define default prefs.
  const defaultPrefs = {
    "counter": 0,
    "templateFolder": "",
    "defaultImport": "",
    "menuCollapse": true,
    "toolbar": true,
    "popup": false,
    "keywordKey": "Tab",
    "shortcutModifier": "alt",
    "shortcutTypeAdv": false,
    "collapseState": ""
  };
  await preferences.init(defaultPrefs);

  // Define prefs, which can be overridden by system admins.
  const managedPrefs = [
    "defaultImport",
    "templateFolder",
  ];

  // Still allow to read overrides from LegacyPref.
  const legacyPrefBranch = "extensions.quicktext.";
  for (let managedPref of managedPrefs) {
    let override = await messenger.LegacyPrefs.getUserPref(`${legacyPrefBranch}${managedPref}Override`);
    if (override !== null) {
      preferences.setPref(managedPref, override);
    }
  }

  // Allow override via managed storage.
  for (let managedPref of managedPrefs) {
    try {
      let rv = await messenger.storage.managed.get({ [managedPref]: null });
      if (rv[managedPref] != null) {
        preferences.setPref([managedPref], rv[managedPref]);
      }
    } catch (ex) {
      // No managed storage manifest found, ignore.
    }
  }

  // Allow legacy code to access local storage prefs.
  messenger.NotifyTools.onNotifyBackground.addListener(async (info) => {
    switch (info.command) {
      case "setPref":
        preferences.setPref(info.pref, info.value);
        break;
      case "getPref":
        return await preferences.getPref(info.pref);
        break;
    }
  });

  // As long as we have a XUL settings window, we still need this. The next step
  // is to convert the settings window to html and move all legacy functions from
  // the JSMs directly into the Quicktext API.
  await messenger.Quicktext.registerChromeUrl([
    ["content", "quicktext", "chrome/content/"],
    ["resource", "quicktext", "chrome/"],
  ]);

  // React to open composer tabs.
  async function prepareComposeTab(tab) {
    await messenger.tabs.executeScript(tab.id, {
      file: "/scripts/compose.js"
    });
    messenger.Quicktext.load(tab.windowId, { toolbar: await preferences.getPref("toolbar")});
  }
  messenger.tabs.onCreated.addListener(prepareComposeTab);
  let composeTabs = await messenger.tabs.query({type: "messageCompose"});
  for (let composeTab of composeTabs) {
    await prepareComposeTab(composeTab);
  }

  // React to pref changes.
  messenger.storage.sync.onChanged.addListener(async changes => {
    if (changes.userPrefs.newValue.hasOwnProperty("popup")) {
      let visible = changes.userPrefs.newValue.popup;
      await messenger.menus.update("composeContextMenu", { visible })
    }
    if (changes.userPrefs.newValue.hasOwnProperty("toolbar")) {
      let visible = changes.userPrefs.newValue.toolbar;
      let composeTabs = await messenger.tabs.query({type: "messageCompose"});
      for (let composeTab of composeTabs) {
        await messenger.Quicktext.toggleToolbar(composeTab.windowId, visible);
      }
    }
  })

  // Add entries to open settings.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.label"),
    contexts: ["tools_menu"],
    onclick: (info, tab) => messenger.Quicktext.openSettings(tab.windowId)
  })
  messenger.composeAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });
  messenger.browserAction.onClicked.addListener(tab => { messenger.Quicktext.openSettings(tab.windowId); });

  // Add config options to composeAction context menu.
  await messenger.menus.create({
    title: messenger.i18n.getMessage("quicktext.showToolbar.label"),
    contexts: ["compose_action"],
    type: "checkbox",
    checked: await preferences.getPref("toolbar"),
    onclick: (info, tab) => preferences.setPref("toolbar", info.checked)
  })

  // Add Quicktext composeBody context menu.
  await processMenuData(await getComposeBodyMenuData());

  // Update the menus before showing them.
  messenger.menus.onShown.addListener(async () => {
    await updateDateTimeMenus();
    await updateTemplateMenus();
    messenger.menus.refresh();
  });

})();


// TODO: ES6 module.
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

async function getContactMenuData() {
  return [
    {
      id: "firstname",
      onclick: insertFragment,
    },
    {
      id: "lastname",
      onclick: insertFragment,
    },
    {
      id: "fullname",
      onclick: insertFragment,
    },
    {
      id: "displayname",
      onclick: insertFragment,
    },
    {
      id: "nickname",
      onclick: insertFragment,
    },
    {
      id: "email",
      onclick: insertFragment,
    },
    {
      id: "worknumber",
      onclick: insertFragment,
    },
    {
      id: "faxnumber",
      onclick: insertFragment,
    },
    {
      id: "cellularnumber",
      onclick: insertFragment,
    },
    {
      id: "jobtitle",
      onclick: insertFragment,
    },
    {
      id: "custom1",
      onclick: insertFragment,
    },
    {
      id: "custom2",
      onclick: insertFragment,
    },
    {
      id: "custom3",
      onclick: insertFragment,
    },
    {
      id: "custom4",
      onclick: insertFragment,
    }
  ];
}

async function getDateTimeMenuData() {
  let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
  let children = [];
  let now = Date.now();

  for (let field of fields) {
    let createData = {
      id: field,
      title: messenger.i18n.getMessage("date", quicktextUtils.getDateTimeFormat(field, now)),
      onclick: insertFragment
    }
    children.push(createData)
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
              children: await getContactMenuData()
            },
            {
              id: "from",
              children: await getContactMenuData()
            },
            {
              id: "attachments",
              children: [
                {
                  id: "filename",
                  onclick: insertFragment
                },
                {
                  id: "filenameAndSize",
                  onclick: insertFragment
                },
              ]
            },
            {
              id: "dateTime",
              children: await getDateTimeMenuData(),
            },
            {
              id: "other",
              children: [
                {
                  id: "clipboard",
                  onclick: insertFragment
                },
                {
                  id: "counter",
                  onclick: insertFragment
                },
                {
                  id: "subject",
                  onclick: insertFragment
                },
                {
                  id: "version",
                  onclick: insertFragment
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
              onclick: insertFragment
            },
            {
              id: "insertTextFromFileAsHTML",
              onclick: insertFragment
            },
          ]
        }
      ]
    },
  ]  
}

async function updateDateTimeMenus() {
  let fields = ["date-short", "date-long", "date-monthname", "time-noseconds", "time-seconds"];
  let menus = ["composeContextMenu.variables.to.", "composeContextMenu.variables.from."];
  let now = Date.now();

  for (let menu of menus) {
    for (let field of fields) {
      await messenger.menus.update(`${menu}${field}`, {
        title: messenger.i18n.getMessage("date", quicktextUtils.getDateTimeFormat(field, now))
      })
    }
  }
}

async function updateTemplateMenus() {
}

async function insertFragment(info, tab) {
  let itemId = info.menuItemId;
  let group = null;
  const GROUP_FROM = "composeContextMenu.variables.from.";
  const GROUP_TO = "composeContextMenu.variables.to.";
  
  if (itemId.startsWith(GROUP_FROM)) {
    group = "from";
    itemId = itemId.substring(GROUP_FROM.length)
  } else if (itemId.startsWith(GROUP_TO)) {
    group = "to";
    itemId = itemId.substring(GROUP_TO.length)
  }

  // Process insert commands


  console.log("sending", tab.id, {itemId});
  let rv = await messenger.tabs.sendMessage(tab.id, {insertText:itemId});
  console.log("done", rv);
}

// TODO: ES6 module.
var quicktextUtils = {
  getDateTimeFormat(format, timeStamp) {
    let options = {};
    options["date-short"] = { dateStyle: "short" };
    options["date-long"] = { dateStyle: "full" };
    options["date-monthname"] = { month: "long" };
    options["time-noseconds"] = { timeStyle: "short" };
    options["time-seconds"] = { timeStyle: "medium" };
    return new Intl.DateTimeFormat(messenger.i18n.getUILanguage(), options[format.toLowerCase()]).format(timeStamp)
  }
}
