const alternatives = {
    "Enter": ["NumpadEnter"]
}

let keywords, keywordKey, shortcutTypeAdv, shortcutModifier;

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

function editorKeyPress(e) {
    if (e.code == keywordKey || alternatives[keywordKey]?.includes(e.code)) {
        let selection = window.getSelection();
        if (!(selection.rangeCount > 0)) {
            return;
        }

        // This gives us a range object of the currently selected text
        // and as the user usually does not have any text selected when
        // triggering keywords, it is a collapsed range at the current
        // cursor position.
        var initialSelectionRange = selection.getRangeAt(0).cloneRange();
        
        // Get a temp selection, which we can modify to search for the beginning
        // of the last word.
        var tmpRange = initialSelectionRange.cloneRange();
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
        
        let text = keywords[lastWord];
        messenger.runtime.sendMessage({command: "insertTemplate", group: text[0], text: text[1]});
    }
}

async function setupKeyListeners() {
    keywordKey = await messenger.runtime.sendMessage({ command: "getPref", pref: "keywordKey" });
    shortcutTypeAdv = await messenger.runtime.sendMessage({ command: "getPref", pref: "shortcutTypeAdv" });
    shortcutModifier = await messenger.runtime.sendMessage({ command: "getPref", pref: "shortcutModifier" });

    keywords = await messenger.runtime.sendMessage({ command: "getKeywords" });

    window.addEventListener("keydown", editorKeyPress, false);
}
// -----------------------------------------------------------------------------

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

setupKeyListeners();

console.log("Quicktext compose script loaded");

// -----------------------------------------------------------------------------

/*
async function windowKeyPress(e) {
    if (shortcutTypeAdv) {
        var shortcut = e.charCode - 48;
        if (shortcut >= 0 && shortcut < 10 && this.mShortcutModifierDown) {
            this.mShortcutString += String.fromCharCode(e.charCode);

            e.stopPropagation();
            e.preventDefault();
        }
    }
    else {
        var modifier = shortcutModifier;
        var shortcut = e.charCode - 48;
        if (shortcut >= 0 && shortcut < 10 && typeof this.mShortcuts[shortcut] != "undefined" && (
            e.altKey && modifier == "alt" ||
            e.ctrlKey && modifier == "control" ||
            e.metaKey && modifier == "meta")) {
            await this.insertTemplate(this.mShortcuts[shortcut][0], this.mShortcuts[shortcut][1]);

            e.stopPropagation();
            e.preventDefault();
        }
    }
}

function windowKeyDown(e) {
    var modifier = shortcutModifier;
    if (!this.mShortcutModifierDown && shortcutTypeAdv && (
        e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
        e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
        e.keyCode == e.DOM_VK_META && modifier == "meta"))
        this.mShortcutModifierDown = true;
}

async function windowKeyUp(e) {
    var modifier = shortcutModifier;
    if (shortcutTypeAdv && (
        e.keyCode == e.DOM_VK_ALT && modifier == "alt" ||
        e.keyCode == e.DOM_VK_CONTROL && modifier == "control" ||
        e.keyCode == e.DOM_VK_META && modifier == "meta")) {
        if (this.mShortcutString != "" && typeof this.mShortcuts[this.mShortcutString] != "undefined") {
            await this.insertTemplate(this.mShortcuts[this.mShortcutString][0], this.mShortcuts[this.mShortcutString][1]);

            e.stopPropagation();
            e.preventDefault();
        }

        this.mShortcutModifierDown = false;
        this.mShortcutString = "";
    }
}
async function install() {
    window.quicktext = {
        mLoaded: false,
        mShortcuts: {},
        mShortcutString: "",
        mShortcutModifierDown: false,
        mKeywords: {}
        ,
        load: async function (extension, aTabId) {
            // Add an eventlistener for keypress in the window
            window.addEventListener("keypress", function (e) { quicktext.windowKeyPress(e); }, true);
            window.addEventListener("keydown", function (e) { quicktext.windowKeyDown(e); }, true);
            window.addEventListener("keyup", function (e) { quicktext.windowKeyUp(e); }, true);
        }
        ,
        unload: function () {
            window.removeEventListener("keypress", function (e) { quicktext.windowKeyPress(e); }, true);
            window.removeEventListener("keydown", function (e) { quicktext.windowKeyDown(e); }, true);
            window.removeEventListener("keyup", function (e) { quicktext.windowKeyUp(e); }, true);

            // Remove the eventlistener from the editor
            var contentFrame = GetCurrentEditorElement();
            contentFrame.removeEventListener("keypress", function (e) { quicktext.editorKeyPress(e); }, false);
        }
        ,
    }
}
*/
