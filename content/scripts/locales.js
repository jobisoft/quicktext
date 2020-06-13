/*
 license: The MIT License, Copyright (c) 2016-2019 YUKI "Piro" Hiroshi
 original: http://github.com/piroor/webextensions-lib-l10n
 
  Modification by John Bieling:
   * Auto select ConversionHelper.i18n or browser.i18n
   * Removed logging
*/

// This file can be used in WX but also in legacy code, where it adds to the global
// scope. Therefore, it is encapsuled.
(function (addonId, pathToConversionHelperJSM){

	let localization = {
		i18n: null,
		
		updateString(string) {
			return string.replace(/__MSG_(.+?)__/g, matched => {
				const key = matched.slice(6, -2);
				return this.i18n.getMessage(key) || matched;
			});
		},
		
		updateSubtree(node) {
			const texts = document.evaluate(
				'descendant::text()[contains(self::text(), "__MSG_")]',
				node,
				null,
				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
				null
			);
			for (let i = 0, maxi = texts.snapshotLength; i < maxi; i++) {
				const text = texts.snapshotItem(i);
				if (text.nodeValue.includes("__MSG_")) text.nodeValue = this.updateString(text.nodeValue);
			}
			
			const attributes = document.evaluate(
				'descendant::*/attribute::*[contains(., "__MSG_")]',
				node,
				null,
				XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
				null
			);
			for (let i = 0, maxi = attributes.snapshotLength; i < maxi; i++) {
				const attribute = attributes.snapshotItem(i);
				if (attribute.value.includes("__MSG_")) attribute.value = this.updateString(attribute.value);
			}
		},
		
		async updateDocument() {
			// do we need to load the ConversionHelper?
			try {
				if (browser) this.i18n = browser.i18n;
			} catch (e) {
				let { ConversionHelper } = ChromeUtils.import(pathToConversionHelperJSM);
				this.i18n = ConversionHelper.i18n;
			}
			this.updateSubtree(document);
		}
	};

	// standard event if loaded by a standard window
	document.addEventListener('DOMContentLoaded', () => {
		localization.updateDocument();
	}, { once: true });

	// custom event, fired by the overlay loader after it has finished loading
	document.addEventListener("DOMOverlayLoaded_" + addonId, () => {
		localization.updateDocument();
	}, { once: true });

})("{8845E3B3-E8FB-40E2-95E9-EC40294818C4}", "chrome://quicktext/content/api/ConversionHelper/ConversionHelper.jsm");
