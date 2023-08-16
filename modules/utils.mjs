import { parse5322 } from "/modules/email-addresses.mjs"

export function getDateTimeFormat(format, timeStamp) {
    let options = {};
    options["date-short"] = { dateStyle: "short" };
    options["date-long"] = { dateStyle: "full" };
    options["date-monthname"] = { month: "long" };
    options["time-noseconds"] = { timeStyle: "short" };
    options["time-seconds"] = { timeStyle: "medium" };
    return new Intl.DateTimeFormat(messenger.i18n.getUILanguage(), options[format.toLowerCase()]).format(timeStamp)
}

export function niceFileSize(size) {
    var unit = ["B", "kB", "MB", "GB", "TB"];
    var i = 0;
    while (size > 1024) {
        i++;
        size = size / 1024;
    }
    return (Math.round(size * 100) / 100) + " " + unit[i];
}

export function trimString(aStr) {
    if (!aStr) return "";
    return aStr.toString().replace(/(^\s+)|(\s+$)/g, '')
}

export function parseDisplayName(addr) {
    let rv = parse5322.parseOneAddress(addr);
    return {
        name: rv.name || "",
        email: rv.address || addr,
    }
}

export function replaceText(tag, value, text) {
    var replaceRegExp;
    if (value != "")
        replaceRegExp = new RegExp(escapeRegExp(tag), 'g');
    else
        replaceRegExp = new RegExp("( )?" + escapeRegExp(tag), 'g');
    return text.replace(replaceRegExp, value);
}

function escapeRegExp(aStr) {
    return aStr.replace(/([\^\$\_\.\\\[\]\(\)\|\+\?])/g, "\\$1");
}

export function removeBadHTML(aStr) {
    // Remove the head-tag
    aStr = aStr.replace(/<head(| [^>]*)>.*<\/head>/gim, '');
    // Remove html and body tags
    aStr = aStr.replace(/<(|\/)(head|body)(| [^>]*)>/gim, '');
    return aStr;
}

export function getTypeFromExtension(filename) {
    let ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    console.log(ext)
    // Extracted from https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#Image_types
    switch (ext) {
        case ".apng":
            return "image/apng";
        case ".bmp":
            return "image/bmp";
        case ".gif":
            return "image/gif";
        case ".ico":
        case ".cur":
            return "image/x-icon";
        case ".jpg":
        case ".jpeg":
        case ".jfif":
        case ".pjpeg":
        case ".pjp":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".svg":
            return "image/svg+xml";
        case ".tif":
        case ".tiff":
            return "image/tiff";
        case ".webp":
            return "image/webp";
        default:
            return "application/octet-stream";
    }
}

export function uint8ArrayToBase64(bytes) {
    return btoa(
        bytes.reduce((acc, current) => acc + String.fromCharCode(current), "")
    );
}

export function getLeafName(fileName) {
    return fileName.split('\\').pop().split('/').pop();
}
