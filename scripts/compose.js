async function insertHtmlFragment(message) {
    document.execCommand('insertHtml', false, message.insertHtml);
    await handlerCursorTags();
}

async function insertTextFragment(message) {
    document.execCommand('insertText', false, message.insertText);
    await handlerCursorTags();
}

messenger.runtime.onMessage.addListener((message, sender) => {
    if (message.insertText) {
        return insertTextFragment(message);
    }
    if (message.insertHtml) {
        return insertHtmlFragment(message);
    }
    return false;
});

console.log("Loaded");


async function handlerCursorTags() {
    const CURSOR = '[[CURSOR]]'
    try {
        let items = window.document.evaluate("//*", document, null, XPathResult.ANY_TYPE, null);
        let foundElements = [];
        let nextItem;
        do {
            if (
                nextItem && 
                nextItem.firstChild && 
                nextItem.firstChild.nodeType == 3 &&
                nextItem.firstChild.nodeValue.includes(CURSOR)
            ) {
                // Store the actual #text node.
                foundElements.push(nextItem.firstChild);
            }
            nextItem = items.iterateNext();
        }
        while (nextItem)

        if (foundElements.length == 0) {
            return;
        }

        for (let foundElement of foundElements) {
            let selection = window.getSelection();
            selection.removeAllRanges();

            const range = document.createRange();
            let startPos = foundElement.nodeValue.indexOf(CURSOR);

            range.setStart(foundElement, startPos);
            range.setEnd(foundElement, startPos + CURSOR.length);
            selection.addRange(range);
            selection.deleteFromDocument();
        }
        
    } catch (ex) {
        console.debug(ex);
    }
}
