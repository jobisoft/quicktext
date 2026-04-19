/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

const alternatives = {
    "Enter": ["NumpadEnter"]
}

let keywords, keywordKey, shortcutTypeAdv, shortcutModifier, shortcuts;
let advShortcutModifierIsDown = false;
let advShortcutString = "";
let popoverShown = false;

// -----------------------------------------------------------------------------

async function insertHtmlFragment(message) {
    // A normal space causes the selection to ignore the space.
    let space = message.extraSpace ? "&nbsp;" : "";
    document.execCommand('insertHtml', false, `${message.insertHtml}${space}`);
    await handlerCursorTags();
}

async function insertTextFragment(message) {
    let space = message.extraSpace ? " " : "";
    document.execCommand('insertText', false, `${message.insertText}${space}`);
    await handlerCursorTags();
}

function requestInsertTemplate(coord) {
    return messenger.runtime.sendMessage({
        command: "insertTemplate",
        storageUuid: coord[0],
        group: coord[1],
        text: coord[2],
    });
}

async function getSelection(mode) {
    let selection = window.getSelection();
    if (mode == "TEXT") {
        return selection.toString();
    }
    // https://stackoverflow.com/questions/5083682/get-selected-html-in-browser-via-javascript
    if (selection.rangeCount > 0) {
        // It may be beneficial to include the surrounding node
        // to copy the format
        // let wrapperNode = selection.anchorNode.parentElement.tagName;

        let range = selection.getRangeAt(0);
        let clonedSelection = range.cloneContents();
        //let container = document.createElement(wrapperNode);
        //container.appendChild(clonedSelection);

        let div = document.createElement('div');
        div.appendChild(clonedSelection);
        return div.innerHTML;
    }
    return "";
}

async function handlerCursorTags() {
    const CURSOR = '[[CURSOR]]'
    try {
        let items = window.document.evaluate("//*", document, null, XPathResult.ANY_TYPE, null);
        let foundElements = [];
        let nextItem;
        do {
            if (nextItem && nextItem.childNodes.length > 0) {
                for (let node of nextItem.childNodes) {
                    if (node.nodeType == 3 && node.nodeValue.includes(CURSOR)) {
                        foundElements.push(node);
                    }
                }
            }
            nextItem = items.iterateNext();
        }
        while (nextItem)

        if (foundElements.length == 0) {
            return;
        }

        let selection = window.getSelection();
        for (let foundElement of foundElements) {
            let startPos = -1;
            do {
                if (startPos != -1) {
                    let range = document.createRange();
                    range.setStart(foundElement, startPos);
                    range.setEnd(foundElement, startPos + CURSOR.length);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    // execCommand() does not collapse the leading and trailing
                    // spaces which selection.deleteFromDocument() does. All the
                    // text altering functions from selection and range seem to
                    // collapse spaces.

                    document.execCommand('delete');
                    //selection.deleteFromDocument();
                    //selection.getRangeAt(0).deleteContents();
                }
                startPos = foundElement.nodeValue.indexOf(CURSOR);
            } while (startPos != -1)
        }

    } catch (ex) {
        console.debug(ex);
    }
}

// -----------------------------------------------------------------------------

function hasMatchingModifier(e, modifier) {
    return (
        e.altKey && modifier == "alt" ||
        e.ctrlKey && modifier == "control" ||
        e.metaKey && modifier == "meta"
    )
}

function isMatchingModifier(e, modifier) {
    return (
        e.key == "Alt" && modifier == "alt" ||
        e.key == "Control" && modifier == "control" ||
        e.key == "Meta" && modifier == "meta"
    )
}

function isRealNumberKey(e) {
    return e.key.length == 1 &&  /^[0-9]$/i.test(e.key);
}

function keywordListener(e) {
    if (e.code == keywordKey || alternatives[keywordKey]?.includes(e.code)) {
        let selection = window.getSelection();
        if (!(selection.rangeCount > 0)) {
            return;
        }

        // This gives us a range object of the currently selected text.
        let initialSelectionRange = selection.getRangeAt(0).cloneRange();

        // Get the text from the beginning of the current node to the end of the
        // selection/cursor. We assume the keyword is not split between two nodes.
        let range = initialSelectionRange.cloneRange();
        range.setStart(range.startContainer, 0);
        let lastWord = range.toString().split(" ").pop().toLocaleLowerCase();

        if (!lastWord || !keywords.hasOwnProperty(lastWord)) {
            return;
        }

        // We found a valid keyword, eat the keypress.
        e.stopPropagation();
        e.preventDefault();

        // Extend selection from the end of the current selection/cursor to the
        // beginning of the current word.
        selection.collapseToEnd();
        selection.modify("extend", "backward", "word");
        // Verify that the entire lastWord is selected, and extend the selection
        // if needed. This is needed since #hi is not fully extended as # is not
        // considered to be part of the word.
        while (selection.toString().length < lastWord.length) {
            selection.modify("extend", "backward", "character");
        }

        // Delete the keyword before replacing so the user doesn't see
        // it flash selected-then-replaced.
        document.execCommand('delete');
        //selection.deleteFromDocument();
        //selection.getRangeAt(0).deleteContents();
        requestInsertTemplate(keywords[lastWord])
    }
}

function shortcutKeyDown(e) {
    if (!hasMatchingModifier(e, shortcutModifier)) {
        return;
    }

    if (shortcutTypeAdv) {
        advShortcutModifierIsDown = true;
        if (isRealNumberKey(e)) {
            advShortcutString += e.key;
            // Eat keys if we acted upon them.
            e.stopPropagation();
            e.preventDefault();
        }
    } else if (isRealNumberKey(e) && shortcuts[e.key] && !e.repeat) {
        requestInsertTemplate(shortcuts[e.key]);
        // Eat keys if we acted upon them.
        e.stopPropagation();
        e.preventDefault();
    }
}

async function shortcutKeyUp(e) {
    if (advShortcutModifierIsDown && shortcutTypeAdv && isMatchingModifier(e, shortcutModifier)) {
        if (advShortcutString != "" && typeof shortcuts[advShortcutString] != "undefined") {
            requestInsertTemplate(shortcuts[advShortcutString]);
        }
        advShortcutModifierIsDown = false;
        advShortcutString = "";
    }
}

async function getLatestPrefs() {
    const storage = await import(browser.runtime.getURL("/modules/storage.mjs"));

    keywordKey = await storage.getPref("keywordKey");
    shortcutTypeAdv = await storage.getPref("shortcutTypeAdv");
    shortcutModifier = await storage.getPref("shortcutModifier");

    let rv = await messenger.runtime.sendMessage({ command: "getKeywordsAndShortcuts" });
    keywords = rv.keywords;
    shortcuts = rv.shortcuts;

}
// -----------------------------------------------------------------------------

async function setup() {
    const storage = await import(browser.runtime.getURL("/modules/storage.mjs"));

    await getLatestPrefs();

    window.addEventListener("keydown", shortcutKeyDown, true);
    window.addEventListener("keyup", shortcutKeyUp, true);
    window.addEventListener("keydown", keywordListener, false);

    new storage.StorageListener({
        area: "auto",
        watchedPrefs: ["templates", "managedStorage", "keywordKey", "shortcutTypeAdv", "shortcutModifier"],
        listener: (_events) => {
            getLatestPrefs();
        }
    })
}

messenger.runtime.onMessage.addListener((message, sender) => {
    if (message.insertText) {
        return insertTextFragment(message);
    }
    if (message.insertHtml) {
        return insertHtmlFragment(message);
    }
    if (message.alertLabel) {
        return Promise.resolve(window.alert(message.alertLabel));
    }
    if (message.getSelection) {
        return getSelection(message.getSelection)
    }
    if (message.isPopoverShown) {
        return Promise.resolve(popoverShown);
    }
    if (message.setPopoverShown) {
        popoverShown = message.popoverShownValue;
        return Promise.resolve();
    }
    return false;
});

setup();

console.log("Quicktext compose script loaded");
