/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// A toolbar inside the message editor of a compose window, built with the
// same technique as the compose toast (see composeToast.mjs): a host element
// with an open shadow root, injected into the editor document. This module
// knows nothing about Quicktext templates. The caller hands in a model and
// gets the action of a clicked entry back through the onAction callback.
//
// Model:
//   {
//     sections: [{
//       label?: string,          // shown for multi-storage setups
//       disabled?: boolean,
//       entries: [
//         { label, hint?, action }                    // a button
//         { label, children: [{ label, hint?, action }] }   // a menu
//         { label, disabled: true }                   // greyed-out label
//       ],
//     }],
//   }
//
// The host lives in the editor document, which Thunderbird serializes as a
// whole when sending, so it must be removed before sending (see init()).

const HOST_ID = "quicktext-compose-toolbar";
const SCRIPT_FILE = "/scripts/composeToolbar.js";
const CSS_FILE = "/scripts/composeToolbar.css";

// The stylesheet is handed to the compose document as text and applied with a
// <style> element: a <link> loads asynchronously and the host would show up
// unstyled for a moment.
let cssText = null;
function getCss() {
  cssText ??= fetch(browser.runtime.getURL(CSS_FILE)).then(r => r.text());
  return cssText;
}

export async function show(tabId, model) {
  await browser.tabs.executeScript(tabId, { file: SCRIPT_FILE });
  const css = await getCss();
  await browser.tabs.sendMessage(tabId, { composeToolbar: "show", model, css });
}

// Removes the host by id, without depending on the toolbar script being loaded
// (a reopened draft may contain an empty host from an earlier session).
export async function hide(tabId) {
  try {
    await browser.tabs.executeScript(tabId, {
      code: `document.getElementById(${JSON.stringify(HOST_ID)})?.remove();`,
    });
  } catch {
    // Tab is gone or not a compose tab, nothing to remove.
  }
}

// onAction(tabId, action) is called when an entry was clicked.
export function init({ onAction }) {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (message?.composeToolbar !== "action" || !sender.tab) {
      return false;
    }
    return Promise.resolve(onAction(sender.tab.id, message.action)).then(() => { });
  });
}
