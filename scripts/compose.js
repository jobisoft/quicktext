const alternatives = {
    "Enter": ["NumpadEnter"]
}

let keywords, keywordKey, shortcutTypeAdv, shortcutModifier, shortcuts;
let advShortcutModifierIsDown = false;
let advShortcutString = "";

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

function requestInsertTemplate(text) {
    return messenger.runtime.sendMessage({ command: "insertTemplate", group: text[0], text: text[1] });
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
                    selection.deleteFromDocument();
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

function isRealKey(e) {
    return e.key.length == 1;
}

function keywordListener(e) {
    if (e.code == keywordKey || alternatives[keywordKey]?.includes(e.code)) {
        let selection = window.getSelection();
        if (!(selection.rangeCount > 0)) {
            return;
        }

        // This gives us a range object of the currently selected text
        // and as the user usually does not have any text selected when
        // triggering keywords, it is a collapsed range at the current
        // cursor position.
        let initialSelectionRange = selection.getRangeAt(0).cloneRange();

        // Get a temp selection, which we can modify to search for the beginning
        // of the last word.
        let tmpRange = initialSelectionRange.cloneRange();
        tmpRange.collapse(false);
        selection.removeAllRanges();
        selection.addRange(tmpRange);

        // Extend selection to the beginning of the current word.
        selection.modify("extend", "backward", "word");

        // We should only have one word selected, but make sure to only get the
        // last one by chopping up its content.
        let lastWord = selection.toString().split(" ").pop().toLowerCase();
        if (!lastWord) {
            // Restore to the initialSelectionRange and abort.
            selection.removeAllRanges();
            selection.addRange(initialSelectionRange);
            return;
        }

        let lastWordIsKeyword = keywords.hasOwnProperty(lastWord);
        if (!lastWordIsKeyword) {
            // Restore to the initialSelectionRange and abort.
            selection.removeAllRanges();
            selection.addRange(initialSelectionRange);
            return;
        }

        // So this is it. Eat the keypress, remove the keyword from the document
        // and insert the template.
        e.stopPropagation();
        e.preventDefault();

        // The following line will remove the keyword before we replace it. If we
        // do not do that, we see the keyword being selected and then replaced.
        // It does look interesting, but I keep it as it was before.
        selection.deleteFromDocument()
        requestInsertTemplate(keywords[lastWord])
    }
}

function shortcutKeyDown(e) {
    if (!hasMatchingModifier(e, shortcutModifier)) {
        return;
    }

    if (shortcutTypeAdv) {
        advShortcutModifierIsDown = true;
        if (isRealKey(e)) {
            advShortcutString += e.key;
            //console.log(advShortcutString);
        }
    } else if (isRealKey(e) && shortcuts[e.key] && !e.repeat) {
        requestInsertTemplate(shortcuts[e.key]);
    }

    // Eat all keys while modifier is down.
    e.stopPropagation();
    e.preventDefault();
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

// -----------------------------------------------------------------------------

async function setup() {
    keywordKey = await messenger.runtime.sendMessage({ command: "getPref", pref: "keywordKey" });
    shortcutTypeAdv = await messenger.runtime.sendMessage({ command: "getPref", pref: "shortcutTypeAdv" });
    shortcutModifier = await messenger.runtime.sendMessage({ command: "getPref", pref: "shortcutModifier" });

    let rv = await messenger.runtime.sendMessage({ command: "getKeywordsAndShortcuts" });
    keywords = rv.keywords;
    shortcuts = rv.shortcuts;

    window.addEventListener("keydown", shortcutKeyDown, true);
    window.addEventListener("keyup", shortcutKeyUp, true);
    window.addEventListener("keydown", keywordListener, false);
}

messenger.runtime.onMessage.addListener((message, sender) => {
    if (message.insertText) {
        return insertTextFragment(message);
    }
    if (message.insertHtml) {
        return insertHtmlFragment(message);
    }
    if (message.promptLabel) {
        return Promise.resolve(window.prompt(message.promptLabel, message.promptValue));
    }
    if (message.alertLabel) {
        return Promise.resolve(window.alert(message.alertLabel));
    }
    if (message.getSelection) {
        return getSelection(message.getSelection)
    }
    return false;
});

setup();

console.log("Quicktext compose script loaded");
