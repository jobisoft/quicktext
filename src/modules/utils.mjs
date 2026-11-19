/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

export async function openSettingsDialog() {
  const { settingsWindowId = null } = await browser.storage.session.get({ settingsWindowId: null });
  if (settingsWindowId !== null) {
    try {
      await browser.windows.update(settingsWindowId, { focused: true });
      return;
    } catch {
      await browser.storage.session.remove("settingsWindowId");
    }
  }
  const win = await browser.windows.create({
    url: "/dialogs/manager/manager.html",
    type: "popup",
    allowScriptsToClose: true,
    width: 800,
    height: 650,
  });
  await browser.storage.session.set({ settingsWindowId: win.id });
  browser.windows.onRemoved.addListener(function onRemoved(windowId) {
    if (windowId === win.id) {
      browser.storage.session.remove("settingsWindowId");
      browser.windows.onRemoved.removeListener(onRemoved);
    }
  });
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
        // Use a replacer function so "$" sequences in the value (e.g. "$&", "$1") are inserted
        // literally instead of being interpreted as replacement patterns.
        return text.replace(new RegExp(escapedTag, 'g'), () => value);
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

// In HTML templates the editor stores "<", ">" and "&" typed by the user as
// entities. That is right for the message body, but values a tag uses as
// plain text (a header, a URL, a path, a script argument, ...) must be
// decoded first (#650). Only entities are replaced, never markup, so a raw
// value such as "Tom <tom@example.com>" passes through unchanged.
const NAMED_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(str) {
    if (typeof str !== "string") return str;
    // One pass, so "&amp;lt;" becomes "&lt;" and not "<".
    return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        if (entity[0] === "#") {
            const code = entity[1] === "x" || entity[1] === "X"
                ? parseInt(entity.slice(2), 16)
                : parseInt(entity.slice(1), 10);
            try {
                return String.fromCodePoint(code);
            } catch {
                return match;
            }
        }
        return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    });
}

// Text to be inserted into an html message as text.
export function escapeHtml(str) {
    if (typeof str !== "string") return str;
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

export function escapeRegExp(aStr) {
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
    // Bypass the HTTP cache: tag-driven URL reads should always
    // see the live resource, never a stale copy from a previous
    // template insert.
    const response = await fetch(url, { cache: "no-store" });

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
    // Bypass the HTTP cache: tag-driven URL reads should always
    // see the live resource, never a stale copy from a previous
    // template insert.
    const response = await fetch(url, { cache: "no-store" });
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

    // Provisional size for the popup window. popup.js measures the rendered
    // content after the window frame settles and resizes the window so the inner
    // area fits exactly (shrinking or growing), so this only needs to be small
    // enough not to flash oversized before that adjustment.
    const size = { width: 400, height: 150 };

    // Best-effort centering over the parent compose window. Some Wayland
    // setups ignore the requested position, which is fine - the small size is
    // the actual fix.
    const centeredOverParent = async () => {
        try {
            const { left, top, width, height } = await browser.windows.get(parentId);
            return {
                left: Math.round(left + (width - size.width) / 2),
                top: Math.round(top + (height - size.height) / 2),
            };
        } catch {
            return {};
        }
    };

    const onRemovedListener = windowId => {
        if (windowId == popupId) {
            status = "closed";
            popup.resolve();
        }
    };
    // When the parent window gains focus, refocus the popup to keep
    // it modal-like.
    const onFocusChangedListener = async windowId => {
        if (status != "active") {
            return;
        }
        if (windowId == parentId) {
            try {
                // Return focus to the popup. This keeps it in front and, by
                // taking focus back from the compose window, prevents typing into
                // the message while the input dialog is open (sending is
                // separately blocked via onBeforeSend). Do not resize.
                await browser.windows.update(popupId, { focused: true });
            } catch (e) {
                // The popup might have been closed in the meantime.
                console.warn("Could not refocus popup, it might be closing.", e.message);
            }
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
        }
        return false;
    }

    browser.runtime.onMessage.addListener(onMessageListener);
    browser.windows.onRemoved.addListener(onRemovedListener);
    browser.windows.onFocusChanged.addListener(onFocusChangedListener);

    popupId = await browser.windows.create({
        url: "/dialogs/popup/popup.html",
        type: "popup",
        allowScriptsToClose: true,
        ...size,
        ...await centeredOverParent(),
    }).then(window => window.id);

    await messenger.tabs.sendMessage(tabId, {
        setInputPopupOpen: true,
        open: true,
    });

    let rv = await popup.promise;

    browser.runtime.onMessage.removeListener(onMessageListener);
    browser.windows.onRemoved.removeListener(onRemovedListener);
    browser.windows.onFocusChanged.removeListener(onFocusChangedListener);

    await messenger.tabs.sendMessage(tabId, {
        setInputPopupOpen: true,
        open: false,
    });

    return rv;
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
            title: "Quicktext v7",
            message: `Some of your template, group or script names include one or more forbidden chars ("|", "[[" or "]]"). These entries will not work.`,
        });
    }
}

const createNotification = async message => {
    await browser.notifications.create(
        "qt-duplicated-entries", {
        type: "basic",
        title: "Quicktext v7",
        message
    });
    console.warn(`[Quicktext v7] ${message}`)
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

// Unified deprecation detection. Scans all bundles for:
// - Templates: deprecated FILE-typed tags (explicit, implicit, underscore).
// - Scripts: deprecated v5 API keywords + deprecated FILE tag calls via
//   this.quicktext.getTag/processTag.
// All script scanning runs on comment-stripped code.
// Results are stored in browser.storage.local and returned.
export async function detectDeprecatedUsages(bundles) {
    const results = { templates: [], scripts: [] };

    // -- Helpers --

    function stripComments(code) {
        return code.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    }

    // Find ]] respecting nested [[ ]] pairs, same logic as the parser.
    function findClosingBrackets(str) {
        let bracketCount = 0;
        for (let i = 0; i < str.length; i++) {
            if (str[i] === "[") bracketCount++;
            if (str[i] === "]") {
                bracketCount--;
                if (bracketCount === -1 && str[i + 1] === "]") return i;
            }
        }
        return -1;
    }

    // Find deprecated FILE-typed tags in a string. Catches:
    //   [[FILE=...]], [[IMAGE=FILE|...]], [[ATTACHMENT=FILE|...]],
    //   [[IMAGE_FILE|...]], [[ATTACHMENT_FILE|...]],
    //   [[IMAGE=/path]] / [[ATTACHMENT=/path]] (implicit FILE mode).
    const tagOpener = /\[\[(file|image|attachment)([=_])/gi;
    function findFileTagsIn(str) {
        const found = [];
        let m;
        while ((m = tagOpener.exec(str)) !== null) {
            const tagName = m[1].toLowerCase();
            const sep = m[2];
            const rest = str.slice(m.index + m[0].length);
            const close = findClosingBrackets(rest);
            if (close === -1) continue;
            const fullTag = str.slice(m.index, m.index + m[0].length + close + 2);
            const inner = rest.slice(0, close);
            const parts = inner.split("|");

            let path = null;
            let isFileMode = false;

            if (tagName === "file") {
                // [[FILE=<path>]] or [[FILE=<path>|flags]]
                path = parts[0].trim();
                isFileMode = true;
            } else if (sep === "_") {
                // [[IMAGE_FILE|<path>]] / [[ATTACHMENT_FILE|<path>]]
                const suffix = parts[0].split("=")[0].trim().toLowerCase();
                if (suffix === "file") {
                    path = parts[1]?.trim() ?? null;
                    isFileMode = true;
                }
            } else {
                // sep === "=": [[IMAGE=...|...]] / [[ATTACHMENT=...|...]]
                const mode = parts[0].trim().toLowerCase();
                if (mode === "file") {
                    // Explicit: [[IMAGE=FILE|<path>]]
                    path = parts[1]?.trim() ?? null;
                    isFileMode = true;
                } else if (!["url", "vfs"].includes(mode)) {
                    // Implicit FILE: [[IMAGE=<path>]] where <path> isn't a mode keyword
                    path = parts[0].trim();
                    isFileMode = true;
                }
            }

            if (!isFileMode) continue;
            const migration = (path && !path.includes("[[")) ? "auto" : "manual";
            found.push({ tag: fullTag, path, migration });
        }
        tagOpener.lastIndex = 0;
        return found;
    }

    // -- Template scan --

    for (const bundle of bundles) {
        const groups = bundle.templates?.groups ?? [];
        const texts = bundle.templates?.texts ?? [];
        for (let gi = 0; gi < groups.length; gi++) {
            for (let ti = 0; ti < (texts[gi]?.length ?? 0); ti++) {
                const tmpl = texts[gi][ti];
                const tags = [
                    ...findFileTagsIn(tmpl.text || ""),
                    ...findFileTagsIn(tmpl.subject || ""),
                ];
                if (tags.length === 0) continue;
                results.templates.push({
                    storageUuid: bundle.storageUuid,
                    storageName: bundle.storageName,
                    group: groups[gi].name,
                    template: tmpl.name,
                    tags,
                });
                for (const t of tags) {
                    console.warn(
                        `[Quicktext] Deprecated FILE tag (${t.migration}) in `
                        + `"${bundle.storageName}" › "${groups[gi].name}" › "${tmpl.name}": ${t.tag}`
                    );
                }
            }
        }
    }

    // -- Script scan --

    const deprecatedApiKeywords = ["this.mWindow", "this.mVariables", "this.mQuicktext"];
    // Match getTag("file", ...) / processTag("file", ...) - the FILE tag itself.
    // Captures: [1]=function name, [2]=quote style around "file",
    // then optionally a second string arg (the path).
    const fileTagCallRe = /(getTag|processTag)\s*\(\s*(["'])file\2\s*(?:,\s*(["'])([^"']*)\3)?/gi;
    // Match getTag("image"/"attachment", "file", ...) - explicit FILE mode.
    const fileModCallRe = /(getTag|processTag)\s*\(\s*(["'])(image|attachment)\2\s*,\s*(["'])file\4\s*(?:,\s*(["'])([^"']*)\5)?/gi;

    function extractCallPath(pathGroup) {
        const path = pathGroup ?? null;
        const migration = (path && !path.includes("[[")) ? "auto" : "manual";
        return { path, migration };
    }

    for (const bundle of bundles) {
        for (const script of (bundle.scripts ?? [])) {
            const code = stripComments(script.script || "");
            const issues = [];
            const details = [];

            for (const kw of deprecatedApiKeywords) {
                if (code.includes(kw)) {
                    if (!issues.includes("deprecated-api")) issues.push("deprecated-api");
                    details.push({ type: "deprecated-api", keyword: kw, migration: "manual" });
                }
            }

            let rm;
            while ((rm = fileTagCallRe.exec(code)) !== null) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                const { path, migration } = extractCallPath(rm[4]);
                details.push({ type: "deprecated-tag", call: rm[0], path, migration });
            }
            fileTagCallRe.lastIndex = 0;
            while ((rm = fileModCallRe.exec(code)) !== null) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                const { path, migration } = extractCallPath(rm[6]);
                details.push({ type: "deprecated-tag", call: rm[0], path, migration });
            }
            fileModCallRe.lastIndex = 0;

            const fileTags = findFileTagsIn(code);
            for (const ft of fileTags) {
                if (!issues.includes("deprecated-tag")) issues.push("deprecated-tag");
                details.push({ type: "deprecated-tag", call: ft.tag, path: ft.path, migration: ft.migration });
            }

            if (issues.length === 0) continue;
            results.scripts.push({
                storageUuid: bundle.storageUuid,
                storageName: bundle.storageName,
                script: script.name,
                issues,
                details,
            });
            for (const d of details) {
                const label = d.type === "deprecated-api" ? d.keyword : d.call;
                console.warn(
                    `[Quicktext] Deprecated usage (${d.migration}) in script `
                    + `"${bundle.storageName}" › "${script.name}": ${label}`
                );
            }
        }
    }

    await browser.storage.local.set({ deprecatedUsages: results });

    return results;
}

// Ids of everything the migration report lists. The report stores them when
// the user dismisses it, and opens again at startup only if a new id shows up.
export function getMigrationReportIds(deprecatedUsages, droppedFileEntries) {
    return [
        ...(deprecatedUsages?.templates ?? []).map(t => `t|${t.storageUuid}|${t.group}|${t.template}`),
        ...(deprecatedUsages?.scripts ?? []).map(s => `s|${s.storageUuid}|${s.script}`),
        ...(droppedFileEntries ?? []).map(e => `d|${e.type}|${e.path}`),
    ];
}

export function rewriteTagPreview(tag, vfsPath) {
    const lc = tag.toLowerCase();
    if (lc.startsWith("[[file=")) {
        return `[[VFSFILE=${vfsPath}${tag.includes("|") ? tag.slice(tag.indexOf("|")) : "]]"}`;
    }
    if (lc.match(/^\[\[(image|attachment)=file\|/)) {
        return tag.replace(/=file\|/i, `=VFS|`).replace(
            /\|[^|\]]+/,
            `|${vfsPath}`
        );
    }
    if (lc.match(/^\[\[(image|attachment)_file\|/)) {
        return tag.replace(/_(file)\|/i, `=VFS|`).replace(
            /\|[^|\]]+/,
            `|${vfsPath}`
        );
    }
    // Implicit FILE mode: [[IMAGE=/path]] → [[IMAGE=VFS|/vfsPath]]
    if (lc.match(/^\[\[(image|attachment)=/)) {
        const tagName = tag.match(/^\[\[(\w+)=/)[1];
        const rest = tag.slice(tag.indexOf("=") + 1, -2);
        const parts = rest.split("|");
        parts[0] = `VFS|${vfsPath}`;
        return `[[${tagName}=${parts.join("|")}]]`;
    }
    return tag;
}

// Extract the parent directory from a config file path.
export function getConfigDir(configPath) {
    return (configPath || "").replace(/\/[^/]*$/, "") || "";
}

// Compute the full VFS target path for a migrated file.
export function getVfsTargetPath(configDir, tagOrCall, sourcePath) {
    const folder = getFolderForTag(tagOrCall);
    const leaf = sourcePath ? getLeafName(sourcePath) : "?";
    return `${configDir}/${folder}/${leaf}`;
}

// Determine the VFS destination folder for a FILE-typed tag or script call.
export function getFolderForTag(tagOrCall) {
    const lc = (tagOrCall || "").toLowerCase();
    if (lc.match(/^\[\[file=/) || lc.match(/(["'])file\1/)) return "files";
    if (lc.match(/^\[\[image/) || lc.match(/(["'])image\1/)) return "images";
    return "attachments";
}

// Preview the rewritten form of a deprecated script getTag/processTag call.
export function rewriteScriptCallPreview(call, path, vfsPath) {
    return call
        .replace(/["']file["']/i, `"vfsfile"`)
        .replace(new RegExp(escapeRegExp(path)), vfsPath);
}

