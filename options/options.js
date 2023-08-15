window.addEventListener("load", async () => {
  let tab = await messenger.tabs.getCurrent();
  await messenger.Quicktext.openSettings(tab.windowId);
  messenger.tabs.remove(tab.id)
})
