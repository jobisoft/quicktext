export class QuicktextHeader {
  constructor(config) {
    this.mType      = config.type || "";
    this.mValue     = config.name || "";
  }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  get value() { return this.mValue; }
  set value(aValue) { if (typeof aValue != 'undefined') return this.mValue = aValue; }

  clone() {
    return new QuicktextHeader({
      type: this.mType,
      value: this.mValue,  
    });
  }
}
