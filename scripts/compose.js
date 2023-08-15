messenger.runtime.onMessage.addListener((message, sender) => {
    if (message.insertText) {
        return insertTextFragment(message);
    }
    if (message.insertHtml) {
        return insertHtmlFragment(message);
    }    
    return false;
});

async function insertHtmlFragment(message) {
    document.execCommand('insertHtml', false, message.insertHtml);
}

// https://stackoverflow.com/questions/25941559/is-there-a-way-to-keep-execcommandinserthtml-from-removing-attributes-in-chr
async function insertTextFragment(message) {
    document.execCommand('insertText', false, message.insertText);
}
