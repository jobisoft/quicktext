export class QuicktextTemplate {
  constructor(config) {
    this.mName = config.name || "";
    this.mText = config.text || "";
    this.mShortcut = config.shortcut || "";
    this.mType = config.type || "";
    this.mKeyword = config.keyword || "";
    this.mSubject = config.subject || "";
    this.mAttachments = config.attachments || "";
    this.mHeaders = [];
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get text() { return this.mText; }
  set text(aText) { if (typeof aText != 'undefined') return this.mText = aText; }

  get shortcut() { return this.mShortcut; }
  set shortcut(aShortcut) { if (typeof aShortcut != 'undefined') return this.mShortcut = aShortcut; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  get keyword() { return this.mKeyword; }
  set keyword(aKeyword) { if (typeof aKeyword != 'undefined') return this.mKeyword = aKeyword; }

  get subject() { return this.mSubject; }
  set subject(aSubject) { if (typeof aSubject != 'undefined') return this.mSubject = aSubject; }

  get attachments() { return this.mAttachments; }
  set attachments(aAttachments) { if (typeof aAttachments != 'undefined') return this.mAttachments = aAttachments; }

  getHeader(aIndex) {
    return this.mHeaders[aIndex];
  }

  addHeader(aType, aValue) {
    var tmp = new QuicktextHeader({
      type: aType,
      value: aValue,
    });
    this.mHeaders.push(tmp);
  }

  removeHeader(aIndex) {
    this.mHeaders.splice(aIndex, 0);
  }

  removeHeaders() {
    this.mHeaders = [];
  }

  getHeaderLength() {
    return this.mHeaders.length;
  }

  clone() {
    let newTemplate = new QuicktextTemplate({
      name: this.mName,
      text: this.mText,
      shortcut: this.mShortcut,
      type: this.mType,
      keyword: this.mKeyword,
      subject: this.mSubject,
      attachments: this.mAttachments,
    });

    for (let i = 0; i < this.mHeaders.length; i++)
      newTemplate.addHeader(this.mHeaders[i].type, this.mHeaders[i].value);

    return newTemplate;
  }
}
