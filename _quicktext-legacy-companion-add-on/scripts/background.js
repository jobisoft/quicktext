const MAIN_ADDON_ID = "{8845E3B3-E8FB-40E2-95E9-EC40294818C4}";

// Register resource URLs so composerToolbar.js can be
// loaded via loadSubScript from resource://quicktext-legacy/
await browser.LegacyHelper.registerGlobalUrls([
  ["resource", "quicktext-legacy", "."],
]);

// Toolbar injection is triggered by the main add-on via onMessageExternal.
// The main add-on handles detecting open and newly created compose windows.
browser.runtime.onMessageExternal.addListener((info, sender) => {
  if (sender.id !== MAIN_ADDON_ID) return;
  switch (info.command) {
    case "injectLegacyToolbar":
      return browser.QuicktextToolbar.injectLegacyToolbar(info.windowId, info.labels);
    case "updateLegacyToolbar":
      return browser.QuicktextToolbar.updateLegacyToolbar(info.windowId);
  }
});

// Proxy commands from composerToolbar.js to the main add-on.
browser.QuicktextToolbar.onCommand.addListener(async info => {
  return browser.runtime.sendMessage(MAIN_ADDON_ID, info);
});


// Auto-unload if the main add-on is disabled or uninstalled
browser.management.onDisabled.addListener(async addon => {
  if (addon.id === MAIN_ADDON_ID) {
    await browser.QuicktextToolbar.removeLegacyToolbar();
  }
});
browser.management.onUninstalled.addListener(async addon => {
  if (addon.id === MAIN_ADDON_ID) {
    await browser.QuicktextToolbar.removeLegacyToolbar();
  }
});
