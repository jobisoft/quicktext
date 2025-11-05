/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export async function registerExternalScriptAddon(id, name, scripts) {
    let externalScripts = await browser.storage.session
        .get({ externalScripts: [] })
        .then(rv => rv.externalScripts.filter(e => e.id != id));
    externalScripts.push({
        id,
        name,
        scripts,
    });
    await browser.storage.session.set({ externalScripts });
    console.log("registered external scripts", externalScripts)
}

export function getDateTimeFormat(format, timeStamp) {
    let options = {};
    options["date-short"] = { dateStyle: "short" };
    options["date-long"] = { dateStyle: "full" };
    options["date-monthname"] = { month: "long" };
    options["time-noseconds"] = { timeStyle: "short" };
    options["time-seconds"] = { timeStyle: "medium" };
    return new Intl.DateTimeFormat(messenger.i18n.getUILanguage(), options[format.toLowerCase()]).format(timeStamp)
}

export function trimString(aStr) {
    if (!aStr) return "";
    return aStr.toString().replace(/(^\s+)|(\s+$)/g, '')
}

export async function parseDisplayName(addr) {
    let [rv] = await browser.messengerUtilities.parseMailboxString(addr);
    return {
        name: rv?.name || "",
        email: rv?.email || addr,
    }
}

export function replaceText(tag, value, text, { collapseLineBreaks }) {
    const escapedTag = escapeRegExp(tag);

    if (value != "") {
        return text.replace(new RegExp(escapedTag, 'g'), value);
    }

    // If value is "", we collapse a leading spaces and optionally linebreaks. Do not use global mode
    // here, but force this function to be called on each tag (even if used multiple times), so the
    // fallback regexp can cleanup a line until it is matching the single tag regexp and correctly
    // removes the entire line.
    if (collapseLineBreaks) {
        // Match lines with a single empty tag and optional whitespaces.
        const singleTagRegExp = new RegExp(`(^|\\r?\\n)( )*${escapedTag}( )*(\\r?\\n|$)`, 'm');
        const collapsed = text.replace(singleTagRegExp, (match, leadingLB, leadingWSP, trailingWSP, trailingLB, offset, fullText) => {
            // leadingLB and trailingLB are either "" or a line break. If we're matching two
            // line breaks (one before, one after), preserve one.
            return leadingLB && trailingLB ? leadingLB : "";
        });
        if (collapsed !== text) {
            return collapsed;
        }
    }

    // Match empty tags anywhere with optional single space before the tag.
    return text.replace(new RegExp(`( )?${escapedTag}`, ''), value);
}

function escapeRegExp(aStr) {
    return aStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export async function writeFileToDisc(data, filename) {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    try {
        let id = null;
        const { promise, resolve } = Promise.withResolvers();

        const listener = delta => {
            if (id == delta.id && delta.state?.current === 'complete') {
                browser.downloads.onChanged.removeListener(listener);
                resolve();
            }
        }

        browser.downloads.onChanged.addListener(listener);
        id = await browser.downloads.download({
            url,
            filename,
            saveAs: true,
        });

        await promise;
    } catch (error) {
        console.error("Error downloading the file:", error);
    }

    URL.revokeObjectURL(url);
}

export async function pickFileFromDisc(aTypes) {
    let picker = Promise.withResolvers();

    // Hidden input to open file dialog.
    const inputElement = document.createElement("input");
    inputElement.setAttribute("type", "file");
    inputElement.addEventListener("change", () => { picker.resolve(inputElement.files) }, false);
    inputElement.addEventListener("cancel", () => { picker.resolve([]) }, false);

    let acceptedFileTypes = []
    for (let aType of aTypes) {
        switch (aType) {
            case 0: // TXT files
            case "text/plain":
                acceptedFileTypes.push("text/plain");
                break;
            case 1: // HTML files
            case "text/html":
                acceptedFileTypes.push("text/html");
                break;
            case 2: // arbitrary files
                break;
            case 3: // legacy Quicktext XML files
                acceptedFileTypes.push(".xml");
                break;
            case 4: // image files
                acceptedFileTypes.push("images/*");
                break;
            case 5: // JSON
                acceptedFileTypes.push(".json");
                break;
            default: // attachments
                break;
        }
    }

    inputElement.setAttribute("accept", acceptedFileTypes.join(", "));
    inputElement.click();
    const [file] = await picker.promise;
    inputElement.remove();

    return file;
}

export async function getTextFileContent(file) {
    const content = await new Promise(resolve => {
        const reader = new FileReader();
        reader.onloadend = function (evt) {
            if (evt.target.readyState == FileReader.DONE) {
                var filedata = evt.target.result;
                resolve(filedata);
            }
        };
        reader.readAsText(file)
    })
    return content;
}

export async function fetchFileAsFile(url, name) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const filename = name ?? getLeafName(url);
    const contentType = blob.type || getTypeFromExtension(filename)

    return new File([blob], filename, { type: contentType });
}

export async function fetchFileAsText(url) {
    try {
        const response = await fetch(url);
        if (response?.ok) {
            return await response.text();
        }
        throw new Error('Network response was not ok');
    } catch (ex) {
        console.error('There was a problem with the fetch operation:', ex);
    }
}

export async function fetchFileAsDataUrl(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function openPopup(tabId, config) {
    let status = "none";
    let popup = Promise.withResolvers();
    let popupId;
    let parentId = await browser.tabs.get(tabId).then(tab => tab.windowId);
    let lastFocusedWindow = parentId;

    const dimension = ({ top, left, width, height }) => {
        // On Linux, skip centering for wayland compatability
        // Windows/macOS always center
        if (navigator.userAgent.includes('Linux')) {
            return {};
        }

        const excessWidth = 100;
        const excessHeight = 100;
        return {
            top: top + Math.round(0.5 * excessHeight),
            left: left + Math.round(0.5 * excessWidth),
            width: width - excessWidth,
            height: height - excessHeight,
        }
    }

    const onRemovedListener = windowId => {
        if (windowId == popupId) {
            status = "closed";
            popup.resolve();
        }
    };
    const onFocusChangedListener = async windowId => {
        if (status != "active") {
            return;
        }

        let currentlyFocusedWindow = lastFocusedWindow;
        lastFocusedWindow = windowId;

        // GOAL: Force our popup window to always be directly above the parent.
        if (windowId == popupId && currentlyFocusedWindow != parentId) {
            await browser.windows.update(parentId, {
                focused: true
            });
        }

        // GOAL: We want to allow switching away from the popup to a different
        // window, but if the parent is focused, bring us back in front.
        if (windowId == parentId) {
            await browser.windows.update(popupId, {
                focused: true,
                ...dimension(await browser.windows.get(parentId))
            });
        }

    };
    const onMessageListener = (info, sender, sendResponse) => {
        // Validate windowId for all actions, allow first config request to set popupId to resolve race condition
        if (sender.tab.windowId != popupId) {
            if (info?.action === "config" && !popupId) {
                popupId = sender.tab.windowId;
            } else {
                return false;
            }
        }

        switch (info?.action) {
            case "config":
                status = "active";
                return Promise.resolve(config);
            case "close":
                popup.resolve(info.rv);
                status = "closed";
                return Promise.resolve();
            case "isPopoverShown":
                return Promise.resolve(true);
        }
        return false;
    }

    browser.runtime.onMessage.addListener(onMessageListener);
    browser.windows.onRemoved.addListener(onRemovedListener);
    browser.windows.onFocusChanged.addListener(onFocusChangedListener);

    popupId = await browser.windows.create({
        url: "/html/popup.html",
        type: "popup",
        allowScriptsToClose: true,
        ...dimension(await browser.windows.get(parentId))
    }).then(window => window.id);

    await messenger.tabs.sendMessage(tabId, {
        setPopoverShown: true,
        popoverShownValue: true,
    });

    let rv = await popup.promise;

    browser.runtime.onMessage.removeListener(onMessageListener);
    browser.windows.onRemoved.removeListener(onRemovedListener);
    browser.windows.onFocusChanged.removeListener(onFocusChangedListener);

    await messenger.tabs.sendMessage(tabId, {
        setPopoverShown: true,
        popoverShownValue: false,
    });

    return rv;
}

// Keep this function async, so it can be used in then-chaining.
export async function removeProtectedTemplates(templates) {
    if (!templates) {
        return null;
    }
    const protectedTemplatesIndices = new Set(
        templates.groups.reduce((indices, value, index) => {
            if (value.protected) {
                indices.push(index);
            }
            return indices;
        }, [])
    );
    if (protectedTemplatesIndices.size > 0) {
        templates = {
            groups: templates.groups.filter((_, index) => !protectedTemplatesIndices.has(index)),
            texts: templates.texts.filter((_, index) => !protectedTemplatesIndices.has(index))
        }
    }
    return templates;
}

// Keep this function async, so it can be used in then-chaining.
export async function removeProtectedScripts(scripts) {
    if (!scripts) {
        return null;
    }
    const protectedScriptsIndices = new Set(
        scripts.reduce((indices, value, index) => {
            if (value.protected) {
                indices.push(index);
            }
            return indices;
        }, [])
    );
    if (protectedScriptsIndices.size > 0) {
        scripts = scripts.filter((_, index) => !protectedScriptsIndices.has(index));
    }
    return scripts;
}

export async function checkBadNameEntries(templates, scripts) {
    const badSubstrings = ["|", "[[", "]]"];
    let badEntries = 0;

    if (templates?.groups) {
        badEntries += templates.groups.filter(e => badSubstrings.some(sub => e.name.includes(sub))).length;
    }
    if (templates?.texts) {
        badEntries += templates.texts.flat().filter(e => badSubstrings.some(sub => e.name.includes(sub))).length;
    }
    if (scripts) {
        badEntries += scripts.filter(e => badSubstrings.some(sub => e.name.includes(sub))).length
    }
    if (badEntries > 0) {
        browser.notifications.create("qt-bad-entries", {
            type: "basic",
            title: "Quicktext v6",
            message: `Some of your template, group or script names include one or more forbidden chars ("|", "[[" or "]]"). These entries will not work.`,
        });
    }
}

const createNotification = async message => {
    await browser.notifications.create(
        "qt-duplicated-entries", {
        type: "basic",
        title: "Quicktext v6",
        message
    });
    console.warn(`[Quicktext v6] ${message}`)
}

export async function checkDuplicatedEntries(templates, scripts) {
    const findDuplicates = array => {
        const seen = new Set();
        const duplicates = new Set();
        for (const item of array) {
            if (seen.has(item)) {
                duplicates.add(item);
            } else {
                seen.add(item);
            }
        }
        return [...duplicates];
    }


    const scriptNames = Array.isArray(scripts)
        ? scripts.map(e => e.name.trim())
        : []
    const duplicatedScriptNames = findDuplicates(scriptNames);
    if (duplicatedScriptNames.length) {
        await createNotification(
            `Invalid script data, multiple scripts with the same name: ${duplicatedScriptNames.join(", ")}`
        );
    }

    const groupNames = Array.isArray(templates?.groups)
        ? templates.groups.map(e => e.name.trim())
        : []
    const duplicatedGroupNames = findDuplicates(groupNames);
    if (duplicatedGroupNames.length) {
        await createNotification(
            `Invalid template data, multiple groups with the same name: ${duplicatedGroupNames.join(", ")}`
        );
    }

    if (Array.isArray(templates?.texts)) {
        if (templates.texts.length != groupNames.length) {
            await createNotification(
                `Invalid template data, number of groups does not match number of template groups.`
            );
        }
        for (let i = 0; i < templates.texts.length; i++) {
            const textNames = templates.texts[i].map(e => e.name.trim());
            const duplicatedNames = findDuplicates(textNames);
            if (duplicatedNames.length) {
                await createNotification(
                    `Invalid template data, multiple templates in group "${groupNames[i]}" with the same name: ${duplicatedNames.join(", ")}`
                )
            }
        }
    }
}

export async function checkForIncompatibleScripts(scripts) {
    const targets = ["this.mWindow", "this.mVariables", "this.mQuicktext"];
    const incompatibleScripts = scripts.filter(s =>
        targets.some(target => s.script.includes(target))
    );
    if (incompatibleScripts.length > 0) {
        browser.notifications.create("qt-incompatible-scripts", {
            type: "basic",
            title: "Quicktext v6 - Incompatible Scripts!",
            message: `Some of your scripts (for example ${incompatibleScripts.map(s => `'${s.name}'`).slice(0, 2).join(" and ")}) are incompatible with Quicktext v6. Click for more details.`,
        });

    }
}

export async function checkForDeprecatedAttachmentUsage(templates) {
    const groupNames = Array.isArray(templates?.groups)
        ? templates.groups.map(e => e.name.trim())
        : []

    if (templates?.texts) {
        for (let i = 0; i < templates.texts.length; i++) {
            const badEntries = templates.texts[i].filter(e => e.attachments).map(
                e => e.name.trim()
            );
            if (badEntries.length) {
                await createNotification(
                    `Some of your templates in group "${groupNames[i]}" use the deprecated attachments field instead of the ATTACHMENT tag: ${badEntries.join(", ")}`
                );
            }
        }
    }
}
