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
