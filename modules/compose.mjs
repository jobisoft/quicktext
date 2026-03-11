import * as quicktext from "./quicktext.mjs";
import * as menus from "./menus.mjs";
import * as storage from "/modules/storage.mjs";
import * as utils from "/modules/utils.mjs";

import { getVariablesMenuStructure, getInsertFileMenuStructure, getTemplatesMenuStructure } from "/modules/menuStructure.mjs";

let composeMenuEntries = [];

async function prepareComposeTab(tab) {
  if (tab.type != "messageCompose") {
    return;
  }

  // BUG: Thunderbird should wait with executeScript until tab is ready.
  //      Getting the compose details works around this.
  await messenger.compose.getComposeDetails(tab.id);
  await messenger.tabs.executeScript(tab.id, {
    file: "/scripts/compose.js"
  });
}

async function getComposeBodyMenuData() {
  let menuData = [];
  let contexts = ["compose_body", "compose_action_menu"];
  const menuCollapse = await storage.getPref("menuCollapse");

  const templateNodes = await getTemplatesMenuStructure();
  for (const node of templateNodes) {
    if (node.children.length == 1 && menuCollapse) {
      // Node is a promoted single-template group (collapsed).
      menuData.push({
        contexts,
        id: node.id,
        title: node.children[0].title,
        onclick: (_info, tab) => quicktext.insertTemplate(tab.id, node.children[0].groupIndex, node.children[0].textIndex)
      });
    } else {
      menuData.push({
        contexts,
        id: node.id,
        title: node.title,
        children: node.children.map(({ id, title, groupIndex, textIndex }) => ({
          id,
          title,
          onclick: (_info, tab) => quicktext.insertTemplate(tab.id, groupIndex, textIndex),
        }))
      });
    }
  }

  if (templateNodes.length > 0) {
    menuData.push({ contexts, id: "group-separator", type: "separator" });
  }

  let now = Date.now();
  menuData.push(
    {
      contexts,
      id: "insertVariable",
      children: menus.structureToMenuData(getVariablesMenuStructure(), now)
    },
    {
      contexts,
      id: "insertStaticFile",
      children: getInsertFileMenuStructure().map(node => ({
        id: node.id,
        onclick: (_info, tab) => quicktext.insertContentFromFile(tab.id, node.mimeType)
      }))
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
      onclick: () => utils.openSettingsDialog()
    },
  );

  return menuData;
}

export async function init() {
  // Listener for the compose script.
  messenger.runtime.onMessage.addListener((info, sender, sendResponse) => {
    // All these functions return Promises.
    switch (info.command) {
      // Sent by scripts/compose.js
      case "getKeywordsAndShortcuts":
        return quicktext.getKeywordsAndShortcuts();
      // Sent by scripts/compose.js
      case "insertTemplate":
        return quicktext.insertTemplate(sender.tab.id, info.group, info.text);
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "composeAPI":
        return browser.compose[info.func](sender.tab.id, ...info.params);
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "messagesAPI":
        return browser.messages[info.func](...info.params);
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "identitiesAPI":
        return browser.identities[info.func](...info.params);
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "processTag":
        return quicktext.processTag({ tabId: info.tabId, tag: info.tag, variables: info.variables });
      // Sent by modules/quicktextParser.mjs (running in compose window context)
      case "getTag":
        return quicktext.getTag({ tabId: info.tabId, tag: info.tag, variables: info.variables });
      default:
        return false;
    }
  });

  // Load compose script into all open compose windows.
  let composeTabs = await messenger.tabs.query({ type: "messageCompose" });
  for (let composeTab of composeTabs) {
    await prepareComposeTab(composeTab);
  }

  // Load compose script into any new compose window being opened.
  messenger.tabs.onCreated.addListener(prepareComposeTab);

  // Remove saved state data after tab closed.
  messenger.tabs.onRemoved.addListener(tabId => {
    browser.storage.session.remove(`QuicktextStateData_${tabId}`);
  });

  // Prevent sending, if a popover is shown.
  browser.compose.onBeforeSend.addListener(async (tab, details) => {
    let isPopoverShown = await messenger.tabs.sendMessage(tab.id, {
      isPopoverShown: true,
    });
    return {
      cancel: isPopoverShown
    }
  })

  // Add Quicktext composeBody context menu.
  await menus.processMenuData(composeMenuEntries, await getComposeBodyMenuData());

  // Register a listener for changes in templates and settings, to update the
  // compose context menus.
  new storage.StorageListener(
    {
      watchedPrefs: ["templates", "popup", "menuCollapse"],
      listener: async (_changes) => {
        // Throw away the menu.
        for (let entry of composeMenuEntries.reverse()) {
          await messenger.menus.remove(entry);
        }
        composeMenuEntries = [];

        const popup = await storage.getPref("popup");
        if (popup) {
          await menus.processMenuData(composeMenuEntries, await getComposeBodyMenuData());
        }
      }
    }
  )
}
