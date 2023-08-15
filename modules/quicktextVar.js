import * as utils from "/modules/utils.js";
import * as preferences from "/modules/preferences.js";

const allowedTags = ['ATT', 'CLIPBOARD', 'COUNTER', 'DATE', 'FILE', 'IMAGE', 'FROM', 'INPUT', 'ORGATT', 'ORGHEADER', 'SCRIPT', 'SUBJECT', 'TEXT', 'TIME', 'TO', 'URL', 'VERSION', 'SELECTION', 'HEADER'];

export class QuicktextVar {
    constructor(aTab) {
        this.clearData();
        this.mTab = aTab;
    }

    clearData() {
        this.mData = {}
        this.mDetails = null;
    }

    async getDetails() {
        if (!this.mDetails) {
            this.mDetails = await browser.compose.getComposeDetails(this.mTab.id)
        }
        return this.mDetails
    }

    async process_version(aVariables) {
        if (this.mData['VERSION'] && this.mData['VERSION'].checked) {
            return this.mData['VERSION'].data;
        }

        let info = await browser.runtime.getBrowserInfo();
        this.mData['VERSION'] = {};
        this.mData['VERSION'].checked = true;
        this.mData['VERSION'].data = {};
        this.mData['VERSION'].data['number'] = info.version;
        this.mData['VERSION'].data['full'] = `${info.name} ${info.version}`;

        return this.mData['VERSION'].data;
    }
    async get_version(aVariables = []) {
        let data = await this.process_version(aVariables);

        if (aVariables.length < 1) {
            aVariables.push("full");
        }

        if (typeof data[aVariables[0]] != 'undefined') {
            return data[aVariables[0]];
        }

        return "";
    }

    async process_att(aVariables) {
        if (this.mData['ATT'] && this.mData['ATT'].checked)
            return this.mData['ATT'].data;

        this.mData['ATT'] = {};
        this.mData['ATT'].checked = true;
        this.mData['ATT'].data = [];

        let attachments = await browser.compose.listAttachments(this.mTab.id);
        for (let attachment of attachments) {
            let file = await browser.compose.getAttachmentFile(attachment.id);
            this.mData['ATT'].data.push([file.name, file.size, file.lastModified]);
        }

        return this.mData['ATT'].data;
    }
    async get_att(aVariables) {
        var data = await this.process_att(aVariables);

        if (data.length > 0) {
            var value = [];
            for (var i in data) {
                if (aVariables[0] == "full")
                    value.push(data[i][0] + " (" + utils.niceFileSize(data[i][1]) + ")");
                else if (aVariables[0] == "modified")
                    value.push(data[i][2])
                else
                    value.push(data[i][0]);
            }

            if (aVariables.length < 2)
                aVariables[1] = ", ";

            return utils.trimString(value.join(aVariables[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t")));
        }

        return "";
    }

    async process_subject(aVariables) {
        if (this.mData['SUBJECT'] && this.mData['SUBJECT'].checked)
            return this.mData['SUBJECT'].data;

        this.mData['SUBJECT'] = {};
        this.mData['SUBJECT'].checked = true;
        this.mData['SUBJECT'].data = "";

        let details = await this.getDetails();
        this.mData['SUBJECT'].data = details.subject;

        return this.mData['SUBJECT'].data;
    }
    async get_subject(aVariables) {
        return this.process_subject(aVariables);
    }


    preprocess_datetime() {
        this.mData['DATE'] = {};
        this.mData['DATE'].checked = true;
        this.mData['DATE'].data = {};
        this.mData['TIME'] = {};
        this.mData['TIME'].checked = true;
        this.mData['TIME'].data = {};

        var timeStamp = new Date();
        let fields = ["DATE-long", "DATE-short", "DATE-monthname", "TIME-seconds", "TIME-noseconds"];
        for (let i = 0; i < fields.length; i++) {
            let field = fields[i];
            let fieldinfo = field.split("-");
            this.mData[fieldinfo[0]].data[fieldinfo[1]] = utils.trimString(utils.getDateTimeFormat(field, timeStamp));
        }
    }
    async process_date(aVariables) {
        if (this.mData['DATE'] && this.mData['DATE'].checked)
            return this.mData['DATE'].data;

        this.preprocess_datetime();
        return this.mData['DATE'].data;
    }
    async process_time(aVariables) {
        if (this.mData['TIME'] && this.mData['TIME'].checked)
            return this.mData['TIME'].data;

        this.preprocess_datetime();
        return this.mData['TIME'].data;
    }
    async get_date(aVariables) {
        var data = await this.process_date(aVariables);

        if (aVariables.length < 1)
            aVariables[0] = "short";
        if (typeof data[aVariables[0]] != 'undefined')
            return data[aVariables[0]];

        return "";
    }
    async get_time(aVariables) {
        var data = await this.process_time(aVariables);
        if (aVariables.length < 1)
            aVariables[0] = "noseconds";
        if (typeof data[aVariables[0]] != 'undefined')
            return data[aVariables[0]];

        return "";
    }

    async process_clipboard(aVariables, aType) {
        if (this.mData['CLIPBOARD'] && this.mData['CLIPBOARD'].checked)
            return this.mData['CLIPBOARD'].data;

        this.mData['CLIPBOARD'] = {};
        this.mData['CLIPBOARD'].checked = true;
        this.mData['CLIPBOARD'].data = "";

        // I do not know how to access html variant.
        this.mData['CLIPBOARD'].data = await navigator.clipboard.readText();

        return this.mData['CLIPBOARD'].data;
    }
    async get_clipboard(aVariables, aType) {
        return utils.trimString(await this.process_clipboard(aVariables, aType));
    }

    async process_counter(aVariables)
    {
      if (this.mData['COUNTER'] && this.mData['COUNTER'].checked)
        return this.mData['COUNTER'].data;
  
      this.mData['COUNTER'] = {};
      this.mData['COUNTER'].checked = true;
      this.mData['COUNTER'].data = await preferences.getPref("counter");
      this.mData['COUNTER'].data++;
      await preferences.setPref("counter", this.mData['COUNTER'].data);
  
      return this.mData['COUNTER'].data;
    }
    async get_counter(aVariables) {
      return await this.process_counter(aVariables);
    }
  
    // -------------------------------------------------------------------------

    async parse(aStr, aType) {
        try {
            // Reparse the text until there is no difference in the text
            // or that we parse 100 times (so we don't make an infinitive loop)
            var oldStr;
            var count = 0;

            do {
                count++;
                oldStr = aStr;
                aStr = await this.parseText(aStr, aType);
            } while (aStr != oldStr && count < 20);

            return aStr;
        } catch (ex) {
            console.log(ex);
        }
    }
    async parseText(aStr, aType) {
        var tags = getTags(aStr);

        // If we don't find any tags there will be no changes to the string so return.
        if (tags.length == 0)
            return aStr;

        // Replace all tags with there right contents
        for (var i = 0; i < tags.length; i++) {
            var value = "";
            var variable_limit = -1;
            switch (tags[i].tagName.toLowerCase()) {
                case 'att':
                case 'clipboard':
                case 'selection':
                case 'counter':
                case 'date':
                case 'subject':
                case 'time':
                case 'version':
                case 'orgatt':
                    variable_limit = 0;
                    break;
                case 'file':
                case 'image':
                case 'from':
                case 'input':
                case 'orgheader':
                case 'script':
                case 'to':
                case 'url':
                    variable_limit = 1;
                    break;
                case 'text':
                case 'header':
                    variable_limit = 2;
                    break;
            }

            // if the method "get_[tagname]" exists and there is enough arguments we call it
            if (typeof this["get_" + tags[i].tagName.toLowerCase()] == "function" && variable_limit >= 0 && tags[i].variables.length >= variable_limit) {

                // these tags need different behavior if added in "text" or "html" mode
                if (
                    tags[i].tagName.toLowerCase() == "image" ||
                    tags[i].tagName.toLowerCase() == "clipboard" ||
                    tags[i].tagName.toLowerCase() == "selection") {
                    value = await this["get_" + tags[i].tagName.toLowerCase()](tags[i].variables, aType);
                } else {
                    value = await this["get_" + tags[i].tagName.toLowerCase()](tags[i].variables);
                }
            }

            aStr = replaceText(tags[i].tag, value, aStr);
        }

        return aStr;
    }
}

function getTags(aStr) {
    // We only get the beginning of the tag.
    // This is because we want to handle recursive use of tags.
    var rexp = new RegExp("\\[\\[((" + allowedTags.join("|") + ")(\\_[a-z]+)?)", "ig");
    var results = [];
    var result = null;
    while ((result = rexp.exec(aStr)))
        results.push(result);

    // If we don't found any tags we return
    if (results.length == 0)
        return [];

    // Take care of the tags starting with the last one
    var hits = [];
    results.reverse();
    var strLen = aStr.length;
    for (var i = 0; i < results.length; i++) {
        var tmpHit = {};
        tmpHit.tag = results[i][0];
        tmpHit.variables = [];

        // if the tagname contains a "_"-char that means
        // that is an old tag and we need to translate it
        // to a tagname and a variable
        var pos = results[i][1].indexOf("_");
        if (pos > 0) {
            tmpHit.variables.push(results[i][1].substr(pos + 1).toLowerCase());
            tmpHit.tagName = results[i][1].substring(0, pos);
        }
        else
            tmpHit.tagName = results[i][1];

        // Get the end of the starttag
        pos = results[i].index + results[i][1].length + 2;

        // If the tag ended here we're done
        if (aStr.substr(pos, 2) == "]]") {
            tmpHit.tag += "]]";
            hits = addTag(hits, tmpHit);
        }
        // If there is arguments we get them
        else if (aStr[pos] == "=") {
            // We go through until we find ]] but we must have went
            // through the same amount of [ and ] before. So if there
            // is an tag in the middle we just jump over it.
            pos++;
            var bracketCount = 0;
            var ready = false;
            var vars = "";
            while (!ready && pos < strLen) {
                if (aStr[pos] == "[")
                    bracketCount++;
                if (aStr[pos] == "]") {
                    bracketCount--;
                    if (bracketCount == -1 && aStr[pos + 1] == "]") {
                        ready = true;
                        break;
                    }
                }
                vars += aStr[pos];
                pos++;
            }

            // If we found the end we parses the arguments
            if (ready) {
                tmpHit.tag += "=" + vars + "]]";
                vars = vars.split("|");
                for (var j = 0; j < vars.length; j++)
                    tmpHit.variables.push(vars[j]);

                // Adds the tag
                hits = addTag(hits, tmpHit);
            }
        }

        // We don't want to go over this tag again
        strLen = results[i].index;
    }

    hits.reverse();
    return hits;
}

// Some of this could be moved to utils.js

// Checks if the tag isn't added before.
// We just want to handle all unique tags once
function addTag(aTags, aNewTag) {
    for (var i = 0; i < aTags.length; i++)
        if (aTags[i].tag == aNewTag.tag)
            return aTags;

    aTags.push(aNewTag);
    return aTags;
}

function replaceText(tag, value, text) {
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
