var locales = {
  load : async function (document) {
    for (let node of document.querySelectorAll("[i18n-data-id]")) {
      let i18nId = node.getAttribute("i18n-data-id");
      // small convinient hack: if the id ends with a colon, then it is not part of the id
      // but should actually be printed
      let i18nValue = i18nId.endsWith(":") 
        ? browser.i18n.getMessage(i18nId.slice(0, -1)) + ":"
        : browser.i18n.getMessage(i18nId);
      
      switch (node.tagName.toLowerCase()) {
        case "p":
          node.innerHTML = browser.i18n.getMessage(i18nId);
          break;
      }
    }    
  }
}
