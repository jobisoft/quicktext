
var settings = {

  load: async function(document) {
    for (let node of document.querySelectorAll("[preference]")) {
      if (node.getAttribute("instantApply") == "true") {
        node.addEventListener("change", function(event) {this.savePref(event.target);});
      }
    this.loadPref(node);    
    }
  },

  save: async function(document) {
    for (let node of document.querySelectorAll("[preference]")) {
      this.savePref(node);    
    }
  },

  loadPref: async function(node) {
    switch (node.tagName.toLowerCase()) {
      case "input":
        node.setAttribute("value", await this.getPref(node.getAttribute("preference")));
        break;
    }
  },

  savePref: async function(node) {
    switch (node.tagName.toLowerCase()) {
      case "input":
        await this.setPref(node.getAttribute("preference"), node.value);
        break;
    }
  }
}
