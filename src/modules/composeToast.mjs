/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Overlay toast in the compose window, drawn by /scripts/composeToast.js into
// the message editor document. Stand-alone: callers hand in a fully localized
// model, this module does not know where the content comes from.
//
//   {
//     title:   "Quicktext",
//     tone:    "success",   // optional, default is red (warning)
//     summary: "one line, shown collapsed and expanded",
//     details: ["one entry per line", ...],
//     link:    { label, url },   // optional, opened in the default browser
//     labels:  { expand, collapse, close },
//   }
//
// The toast lives in the editor document, which Thunderbird serializes as a
// whole when sending - a host left there would be sent along (as an empty div,
// the shadow content is not serialized). init() therefore removes it before
// every send. Drafts and templates have no before-save event and may keep the
// empty host; it is removed when that message is eventually sent.

// Keep in sync with HOST_ID in /scripts/composeToast.js.
const HOST_ID = "quicktext-compose-toast";
const SCRIPT_FILE = "/scripts/composeToast.js";
const CSS_FILE = "/scripts/composeToast.css";

// The stylesheet is handed to the compose document as text and applied with a
// <style> element: a <link> loads asynchronously and the host would show up
// unstyled for a moment.
let cssText = null;
function getCss() {
  cssText ??= fetch(browser.runtime.getURL(CSS_FILE)).then(r => r.text());
  return cssText;
}

// Links of delivered models, per tab. Only these may be opened on request of
// the compose document.
const allowedLinks = new Map();

export async function show(tabId, model) {
  await browser.tabs.executeScript(tabId, { file: SCRIPT_FILE });
  if (model.link?.url) {
    allowedLinks.set(tabId, model.link.url);
  } else {
    allowedLinks.delete(tabId);
  }
  const css = await getCss();
  await browser.tabs.sendMessage(tabId, { composeToast: "show", model, css });
}

// Removes the host by id. Does not rely on the toast script: a reopened draft
// can carry the host into a tab the script was never injected into.
export async function hide(tabId) {
  allowedLinks.delete(tabId);
  try {
    await browser.tabs.executeScript(tabId, {
      code: `document.getElementById(${JSON.stringify(HOST_ID)})?.remove();`,
    });
  } catch (ex) {
    // Compose tab not ready or already gone - nothing to remove.
  }
}

export function init() {
  browser.compose.onBeforeSend.addListener(async tab => {
    await hide(tab.id);
  });

  browser.tabs.onRemoved.addListener(tabId => allowedLinks.delete(tabId));

  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.composeToast !== "openLink" || !sender.tab) {
      return false;
    }
    const url = allowedLinks.get(sender.tab.id);
    if (!url) {
      return false;
    }
    return browser.windows.openDefaultBrowser(url);
  });
}
