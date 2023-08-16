export class QuicktextScript {
  constructor(config) {
    this.mName        = config.name || "";
    this.mScript      = config.script || "";
    this.mType        = config.type || 0;
  }

  get name() { return this.mName; }
  set name(aName) { if (typeof aName != 'undefined') return this.mName = aName; }

  get script() { return this.mScript; }
  set script(aScript) { if (typeof aScript != 'undefined') return this.mScript = aScript; }

  get type() { return this.mType; }
  set type(aType) { if (typeof aType != 'undefined') return this.mType = aType; }

  clone() {
    return new QuicktextScript({
      name: this.mName,
      script: this.mScript,
      type: this.mType,
    });
  }
}
